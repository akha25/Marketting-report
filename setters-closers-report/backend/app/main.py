import base64
import hashlib
import re
import secrets
import uuid
from contextlib import asynccontextmanager
from datetime import date

from fastapi import Body, Depends, FastAPI, File, HTTPException, Query, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from . import config, engine as eng
from .db import Agent, ReportSession, SessionLocal, Snapshot, Upload, init_db, iso, utcnow
from .exports import to_csv, to_xlsx
from .matching import normalize_name
from .ocr import OCRError, extract, validate_image
from .parsing import ParseError, auto_map, csv_table, read_csv_bytes, remember_mapping
from .settings_store import (DEFAULT_SETTINGS, SettingsError, load_settings, save_settings, slugify)

@asynccontextmanager
async def lifespan(_app):
    config.UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    init_db()
    yield


app = FastAPI(title="Setters & Closers Report API", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=config.CORS_ORIGINS, allow_methods=["*"], allow_headers=["*"],
                   allow_credentials=True)


@app.middleware("http")
async def basic_auth(request: Request, call_next):
    if config.APP_USERNAME and config.APP_PASSWORD and request.url.path != "/api/health":
        ok = False
        h = request.headers.get("authorization", "")
        if h.lower().startswith("basic "):
            try:
                u, _, p = base64.b64decode(h[6:]).decode().partition(":")
                ok = secrets.compare_digest(u, config.APP_USERNAME) and secrets.compare_digest(p, config.APP_PASSWORD)
            except Exception:
                ok = False
        if not ok:
            return Response(status_code=401, headers={"WWW-Authenticate": 'Basic realm="Reports"'})
    return await call_next(request)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def _session(db: Session, sid: int) -> ReportSession:
    s = db.get(ReportSession, sid)
    if not s:
        raise HTTPException(404, "Report session not found.")
    return s


def _upload(db: Session, uid: int) -> Upload:
    u = db.get(Upload, uid)
    if not u:
        raise HTTPException(404, "Upload not found.")
    return u


@app.exception_handler(eng.ReportError)
async def _report_error(_, exc):
    return JSONResponse(status_code=400, content={"detail": str(exc)})


@app.exception_handler(SettingsError)
async def _settings_error(_, exc):
    return JSONResponse(status_code=400, content={"detail": str(exc)})


# ---------------------------------------------------------------- health & settings

@app.get("/api/health")
def health():
    return {"ok": True, "ocr_provider": config.ocr_provider(), "anthropic_configured": bool(config.ANTHROPIC_API_KEY),
            "database": "postgres" if not config.DATABASE_URL.startswith("sqlite") else "sqlite",
            "timezone": config.REPORT_TIMEZONE, "today": eng.today_local().isoformat()}


@app.get("/api/settings")
def get_settings(db: Session = Depends(get_db)):
    return load_settings(db)


@app.put("/api/settings")
def put_settings(data: dict = Body(...), db: Session = Depends(get_db)):
    return save_settings(db, data)


@app.post("/api/settings/reset")
def reset_settings(keep_memory: bool = True, db: Session = Depends(get_db)):
    cur = load_settings(db)
    new = {**DEFAULT_SETTINGS}
    if keep_memory:
        new["column_memory"] = cur["column_memory"]
    return save_settings(db, new)


# ---------------------------------------------------------------- agents

@app.get("/api/agents")
def list_agents(db: Session = Depends(get_db)):
    return [{"id": a.id, "name": a.name, "email": a.email, "role": a.role, "role_source": a.role_source,
             "aliases": a.aliases or [], "created_at": iso(a.created_at)}
            for a in db.scalars(select(Agent).order_by(Agent.name)).all()]


@app.patch("/api/agents/{aid}")
def update_agent(aid: int, body: dict = Body(...), db: Session = Depends(get_db)):
    a = db.get(Agent, aid)
    if not a:
        raise HTTPException(404, "Agent not found.")
    if "role" in body:
        if body["role"] not in ("setter", "closer", "excluded", None):
            raise HTTPException(400, "Role must be setter, closer or excluded.")
        a.role, a.role_source = body["role"], "set by you"
    if body.get("name"):
        old = a.normalized
        a.name, a.normalized = body["name"].strip(), normalize_name(body["name"])
        if old and old != a.normalized:
            a.aliases = sorted(set((a.aliases or []) + [old]))
    if "email" in body:
        a.email = (body["email"] or "").strip().lower() or None
    db.commit()
    return {"ok": True}


# ---------------------------------------------------------------- sessions

@app.get("/api/sessions")
def list_sessions(date_from: date | None = None, date_to: date | None = None, db: Session = Depends(get_db)):
    settings = load_settings(db)
    q = select(ReportSession).order_by(ReportSession.report_date.desc(), ReportSession.slot.desc())
    if date_from:
        q = q.where(ReportSession.report_date >= date_from)
    if date_to:
        q = q.where(ReportSession.report_date <= date_to)
    out = []
    for s in db.scalars(q).all():
        d = eng.session_dict(db, s, settings)
        d["uploads"] = sorted(eng.active_uploads(db, s).keys())
        out.append(d)
    return out


@app.post("/api/sessions")
def open_session(body: dict = Body(...), db: Session = Depends(get_db)):
    settings = load_settings(db)
    try:
        d = date.fromisoformat(body["date"])
    except Exception:
        raise HTTPException(400, "Give a date as YYYY-MM-DD.")
    slot = body.get("slot")
    if slot not in [s["value"] for s in settings["slots"]]:
        raise HTTPException(400, "Unknown reporting session.")
    s = db.scalar(select(ReportSession).where(ReportSession.report_date == d, ReportSession.slot == slot))
    if not s:
        s = ReportSession(report_date=d, slot=slot, status="draft", state={})
        db.add(s)
        db.commit()
    return eng.session_dict(db, s, settings)


@app.get("/api/sessions/{sid}")
def session_preview(sid: int, db: Session = Depends(get_db)):
    return eng.refresh(db, _session(db, sid))


@app.get("/api/sessions/{sid}/view")
def session_view(sid: int, db: Session = Depends(get_db)):
    """What the report pages show: the latest generated version if nothing changed since, else the live draft."""
    s = _session(db, sid)
    snap = db.scalar(select(Snapshot).where(Snapshot.session_id == sid).order_by(Snapshot.version.desc()))
    if s.status == "final" and snap:
        return {"source": "snapshot", "snapshot_id": snap.id, "report": snap.report}
    pv = eng.refresh(db, s)
    settings = load_settings(db)
    rep = pv["report"]
    rep["session"] = {"id": s.id, "date": s.report_date.isoformat(), "slot": s.slot,
                      "slot_label": eng.slot_label(settings, s.slot)}
    rep["version"], rep["generated_at"] = None, None
    rep["files"] = [{"kind": u["kind"], "label": u["label"], "filename": u["filename"], "uploaded_at": u["uploaded_at"],
                     "sha": u["sha"], "provider": u["provider"]} for u in pv["uploads"].values()]
    return {"source": "draft", "snapshot_id": snap.id if snap else None, "report": rep,
            "counts": pv["counts"], "can_finalize": pv["can_finalize"]}


MAX_BYTES = config.MAX_UPLOAD_MB * 1024 * 1024


@app.post("/api/sessions/{sid}/uploads/{kind}")
async def upload_file(sid: int, kind: str, file: UploadFile = File(...), db: Session = Depends(get_db)):
    sess = _session(db, sid)
    if kind not in eng.KINDS:
        raise HTTPException(400, "Unknown upload type.")
    raw = await file.read(MAX_BYTES + 1)
    if len(raw) > MAX_BYTES:
        raise HTTPException(413, f"Files must be under {config.MAX_UPLOAD_MB} MB.")
    if not raw:
        raise HTTPException(400, "The file is empty.")
    fname = re.sub(r"[^A-Za-z0-9._ -]+", "_", (file.filename or "upload"))[:200]
    ext = fname.rsplit(".", 1)[-1].lower() if "." in fname else ""
    settings = load_settings(db)
    parsed, mapping, content_type = None, None, None
    if kind == "csv":
        if ext not in ("csv", "txt"):
            raise HTTPException(400, "The dialer report must be a .csv file.")
        try:
            parsed = read_csv_bytes(raw)
        except ParseError as e:
            raise HTTPException(400, str(e))
        headers, rows = csv_table(parsed)
        mapping = auto_map("csv", headers, rows, settings)
        content_type = "text/csv"
    else:
        if ext not in ("png", "jpg", "jpeg"):
            raise HTTPException(400, "Screenshots must be PNG, JPG or JPEG.")
        try:
            content_type = validate_image(raw)
        except OCRError as e:
            raise HTTPException(400, str(e))

    sha = hashlib.sha256(raw).hexdigest()
    current = eng.active_uploads(db, sess).get(kind)
    if current and current.sha256 == sha:
        return {"duplicate_of_current": True, "preview": eng.refresh(db, sess)}
    folder = config.UPLOAD_DIR / str(sess.id)
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / f"{uuid.uuid4().hex}_{fname}"
    path.write_bytes(raw)
    if current:
        current.status = "superseded"
    up = Upload(session_id=sess.id, kind=kind, filename=fname, stored_path=str(path), sha256=sha, size=len(raw),
                content_type=content_type, parsed=parsed, mapping=mapping, options={},
                provider="csv" if kind == "csv" else None, extracted_at=utcnow() if kind == "csv" else None)
    db.add(up)
    eng.mark_edited(sess)
    db.commit()
    return {"duplicate_of_current": False, "preview": eng.refresh(db, sess)}


def _run_extraction(db: Session, up: Upload, provider: str | None = None):
    settings = load_settings(db)
    try:
        with open(up.stored_path, "rb") as fh:
            ext = extract(fh.read(), provider)
        up.parsed, up.error = ext, None
        up.provider, up.extracted_at = ext["provider"], utcnow()
        headers, rows = eng.get_table(up)
        up.mapping = auto_map(up.kind, headers, rows, settings)
    except OCRError as e:
        up.error, up.parsed = str(e), None
    db.commit()


@app.post("/api/sessions/{sid}/process")
def process_session(sid: int, db: Session = Depends(get_db)):
    sess = _session(db, sid)
    for up in eng.active_uploads(db, sess).values():
        if up.kind != "csv" and (up.parsed is None):
            _run_extraction(db, up)
    eng.mark_edited(sess)
    db.commit()
    return eng.refresh(db, sess)


@app.post("/api/uploads/{uid}/extract")
def re_extract(uid: int, provider: str | None = Query(None), db: Session = Depends(get_db)):
    up = _upload(db, uid)
    if up.kind == "csv":
        raise HTTPException(400, "CSV files are read directly.")
    if provider not in (None, "anthropic", "tesseract", "manual"):
        raise HTTPException(400, "Unknown provider.")
    _run_extraction(db, up, provider)
    sess = _session(db, up.session_id)
    eng.mark_edited(sess)
    db.commit()
    return eng.refresh(db, sess)


@app.get("/api/uploads/{uid}/file")
def upload_file_content(uid: int, db: Session = Depends(get_db)):
    up = _upload(db, uid)
    return FileResponse(up.stored_path, media_type=up.content_type or "application/octet-stream",
                        filename=up.filename)


@app.patch("/api/uploads/{uid}")
def edit_upload(uid: int, body: dict = Body(...), db: Session = Depends(get_db)):
    """Change column mapping/units, options, or correct screenshot cells."""
    up = _upload(db, uid)
    sess = _session(db, up.session_id)
    settings = load_settings(db)
    if up.parsed is None:
        raise HTTPException(400, "This file has not been read yet.")

    if "table_index" in body and up.kind != "csv":
        p = dict(up.parsed)
        idx = int(body["table_index"])
        if not 0 <= idx < len(p["tables"]):
            raise HTTPException(400, "No such table.")
        p["table_index"] = idx
        up.parsed = p
        headers, rows = eng.get_table(up)
        up.mapping = auto_map(up.kind, headers, rows, settings)

    headers, _ = eng.get_table(up)
    if "mapping" in body:
        mapping = body["mapping"]
        if len(mapping) != len(headers):
            raise HTTPException(400, "Mapping must have one entry per column.")
        clean = []
        for m in mapping:
            clean.append({"field": m.get("field") or "__ignore__", "unit": m.get("unit"),
                          "unit_confirmed": bool(m.get("unit_confirmed")), "auto": False})
        up.mapping = clean
        remember_mapping(settings, up.kind, headers, clean)
        save_settings(db, settings)

    if "new_metric" in body:  # create a metric from an unmapped column
        nm = body["new_metric"]
        col = int(nm["column"])
        label = (nm.get("label") or headers[col] or "New metric").strip()
        key = slugify(label)
        existing = {m["key"] for m in settings["metrics"]}
        base, n = key, 2
        while key in existing:
            key, n = f"{base}_{n}", n + 1
        kind = nm.get("kind") if nm.get("kind") in ("count", "duration", "number", "percent") else "number"
        settings["metrics"].append({"key": key, "label": label, "source": up.kind, "kind": kind, "visible": True,
                                    "threshold": {"enabled": False, "value": 0}, "call_log": "sum",
                                    "show_total": kind != "percent", "show_average": True})
        mapping = list(up.mapping)
        mapping[col] = {"field": key, "unit": nm.get("unit") if kind == "duration" else None,
                        "unit_confirmed": bool(nm.get("unit")) if kind == "duration" else False, "auto": False}
        up.mapping = mapping
        save_settings(db, settings)
        settings = load_settings(db)
        remember_mapping(settings, up.kind, headers, mapping)
        save_settings(db, settings)

    if "options" in body:
        opts = dict(up.options or {})
        for k in ("mode", "duplicate_policy", "ack_duplicate", "ignored_rows"):
            if k in body["options"]:
                opts[k] = body["options"][k]
        up.options = opts

    if "cells" in body or "verify_rows" in body or "add_row" in body:
        if up.kind == "csv":
            raise HTTPException(400, "CSV values are corrected in the source file.")
        p = {**up.parsed, "tables": [dict(t) for t in up.parsed["tables"]]}
        t = p["tables"][p.get("table_index", 0)]
        rows = [[dict(c) for c in r] for r in t["rows"]]
        for ch in body.get("cells", []):
            r, c = int(ch["row"]), int(ch["col"])
            if not (0 <= r < len(rows) and 0 <= c < len(rows[r])):
                raise HTTPException(400, "Cell out of range.")
            cell = rows[r][c]
            if "text" in ch:
                txt = (ch["text"] or "").strip() or None
                if txt != cell.get("text"):
                    cell["text"], cell["edited"] = txt, True
                cell["verified"] = True
            if "verified" in ch:
                cell["verified"] = bool(ch["verified"])
        for r in body.get("verify_rows", []):
            for cell in rows[int(r)]:
                cell["verified"] = True
        if body.get("add_row"):
            rows.append([{"text": None, "original": None, "confidence": 1.0, "note": "added by you",
                          "verified": True, "edited": True} for _ in t["headers"]])
        t["rows"] = rows
        p["tables"][p.get("table_index", 0)] = t
        up.parsed = p

    eng.mark_edited(sess)
    db.commit()
    return eng.refresh(db, sess)


@app.patch("/api/sessions/{sid}/matches")
def decide_match(sid: int, body: dict = Body(...), db: Session = Depends(get_db)):
    sess = _session(db, sid)
    key, action = body.get("key"), body.get("action")
    state = dict(sess.state or {})
    matches = dict(state.get("matches", {}))
    if action == "reset":
        matches.pop(key, None)
    elif action == "ignore":
        matches[key] = {"action": "ignore"}
    elif action in ("link", "new"):
        name = (body.get("name") or "").strip()
        if action == "new":
            if not name:
                raise HTTPException(400, "A name is needed to add a new agent.")
            role = body.get("role") if body.get("role") in ("setter", "closer") else None
            a = Agent(name=name, normalized=normalize_name(name), email=(body.get("email") or None), role=role,
                      role_source="set by you" if role else None, aliases=[])
            db.add(a)
            db.flush()
        else:
            a = db.get(Agent, int(body.get("agent_id") or 0))
            if not a:
                raise HTTPException(400, "Choose an agent.")
            nn = normalize_name(name)
            if nn and nn != a.normalized and nn not in (a.aliases or []):
                a.aliases = sorted(set((a.aliases or []) + [nn]))  # remembered for next time
        matches[key] = {"action": "link", "agent_id": a.id}
    else:
        raise HTTPException(400, "Action must be link, new, ignore or reset.")
    state["matches"] = matches
    sess.state = state
    eng.mark_edited(sess)
    db.commit()
    return eng.refresh(db, sess)


@app.post("/api/sessions/{sid}/reset")
def reset_uploads(sid: int, db: Session = Depends(get_db)):
    """Clear this session's uploads and decisions. Files and generated versions stay in history."""
    sess = _session(db, sid)
    for up in eng.active_uploads(db, sess).values():
        up.status = "superseded"
    sess.state = {}
    sess.status = "draft"
    db.commit()
    return eng.refresh(db, sess)


@app.post("/api/sessions/{sid}/finalize")
def finalize(sid: int, db: Session = Depends(get_db)):
    snap = eng.finalize(db, _session(db, sid))
    return {"snapshot_id": snap.id, "version": snap.version, "report": snap.report}


@app.get("/api/sessions/{sid}/export.{fmt}")
def export_session(sid: int, fmt: str, db: Session = Depends(get_db)):
    v = session_view(sid, db)
    return _export(v["report"], fmt, draft=v["source"] == "draft")


# ---------------------------------------------------------------- history

def _snap_meta(s: Snapshot, latest: bool) -> dict:
    r = s.report
    return {"id": s.id, "session_id": s.session_id, "version": s.version, "generated_at": iso(s.generated_at),
            "date": r["session"]["date"], "slot": r["session"]["slot"], "slot_label": r["session"]["slot_label"],
            "setters": r["setters"]["count"], "closers": r["closers"]["count"],
            "total_bookings": (r.get("booking") or {}).get("total"), "files": r.get("files", []), "latest": latest,
            "agents": [{"name": x["name"], "role": x["role"]} for sec in ("setters", "closers") for x in sec_rows(r, sec)]}


def sec_rows(r, sec):
    return r[sec]["rows"]


@app.get("/api/snapshots")
def list_snapshots(date_from: date | None = None, date_to: date | None = None, slot: str | None = None,
                   role: str | None = None, agent: str | None = None, all_versions: bool = False,
                   db: Session = Depends(get_db)):
    snaps = db.scalars(select(Snapshot).order_by(Snapshot.generated_at.desc())).all()
    latest_by_session = {}
    for s in snaps:
        if s.session_id not in latest_by_session or s.version > latest_by_session[s.session_id]:
            latest_by_session[s.session_id] = s.version
    out = []
    for s in snaps:
        is_latest = latest_by_session[s.session_id] == s.version
        if not all_versions and not is_latest:
            continue
        r = s.report
        d = date.fromisoformat(r["session"]["date"])
        if (date_from and d < date_from) or (date_to and d > date_to) or (slot and r["session"]["slot"] != slot):
            continue
        meta = _snap_meta(s, is_latest)
        if role in ("setter", "closer") and not any(a["role"] == role for a in meta["agents"]):
            continue
        if agent:
            na = normalize_name(agent)
            if not any(na in normalize_name(a["name"]) for a in meta["agents"]
                       if not role or a["role"] == role):
                continue
        out.append(meta)
    out.sort(key=lambda m: (m["date"], m["slot"], m["version"]), reverse=True)
    return out


@app.get("/api/snapshots/{snap_id}")
def get_snapshot(snap_id: int, db: Session = Depends(get_db)):
    s = db.get(Snapshot, snap_id)
    if not s:
        raise HTTPException(404, "Report not found.")
    return {"id": s.id, "report": s.report}


@app.get("/api/snapshots/{snap_id}/export.{fmt}")
def export_snapshot(snap_id: int, fmt: str, db: Session = Depends(get_db)):
    s = db.get(Snapshot, snap_id)
    if not s:
        raise HTTPException(404, "Report not found.")
    return _export(s.report, fmt)


def _export(report: dict, fmt: str, draft: bool = False):
    s = report["session"]
    base = f"setters-closers_{s['date']}_{s['slot'].replace(':', '')}" + (f"_v{report['version']}" if report.get("version") else "_draft")
    if fmt == "csv":
        return Response(to_csv(report, draft), media_type="text/csv",
                        headers={"Content-Disposition": f'attachment; filename="{base}.csv"'})
    if fmt == "xlsx":
        return Response(to_xlsx(report, draft),
                        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                        headers={"Content-Disposition": f'attachment; filename="{base}.xlsx"'})
    raise HTTPException(400, "Format must be csv or xlsx.")


@app.get("/api/compare")
def compare(a: int, b: int, db: Session = Depends(get_db)):
    sa, sb = db.get(Snapshot, a), db.get(Snapshot, b)
    if not sa or not sb:
        raise HTTPException(404, "Choose two generated reports.")
    return eng.compare(sa.report, sb.report)


# ---------------------------------------------------------------- frontend (production build)

if config.FRONTEND_DIST.exists():
    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str):
        if path.startswith("api/"):
            raise HTTPException(404)
        f = (config.FRONTEND_DIST / path).resolve()
        if path and f.is_file() and str(f).startswith(str(config.FRONTEND_DIST.resolve())):
            return FileResponse(f)
        return FileResponse(config.FRONTEND_DIST / "index.html")
