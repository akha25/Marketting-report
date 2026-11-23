"""Report engine: uploads -> records -> matched agents -> setter/closer tables -> snapshot.

All numbers come from the uploaded files (or from a correction the user typed). Nothing is
estimated. Missing values stay missing (N/A) unless a setting explicitly says otherwise.
"""
import copy
from collections import defaultdict
from datetime import datetime
from zoneinfo import ZoneInfo

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from . import config
from .db import Agent, ReportSession, Snapshot, Upload, iso, utcnow
from .matching import classify_team, match_record, normalize_name
from .parsing import (DURATION_UNITS, TOTAL_WORDS, ParseError, csv_table, is_missing,
                      parse_duration_minutes, parse_number)
from .settings_store import SYSTEM_FIELDS, field_options, load_settings, metric_map

KINDS = ("csv", "booking", "cc")
KIND_LABEL = {"csv": "Dialer CSV", "booking": "Booking screenshot", "cc": "CC screenshot"}
SEVERITY_ORDER = {"error": 0, "warning": 1, "info": 2}


class ReportError(ValueError):
    pass


def issue(severity: str, source: str, code: str, message: str, **extra) -> dict:
    d = {"severity": severity, "source": source, "code": code, "message": message}
    d.update(extra)
    return d


def slot_label(settings: dict, slot: str) -> str:
    return next((s["label"] for s in settings["slots"] if s["value"] == slot), slot)


def today_local():
    return datetime.now(ZoneInfo(config.REPORT_TIMEZONE)).date()


# ---------------------------------------------------------------- formatting

def fmt(v, m: dict, settings: dict) -> str:
    if v is None:
        return "N/A"
    k = m.get("kind")
    if k == "percent":
        return f"{v:.1f}%"
    if k == "duration":
        return f"{v:,.{settings.get('duration_decimals', 1)}f}"
    if abs(v - round(v)) < 1e-9:
        return f"{int(round(v)):,}"
    return f"{v:,.2f}"


def status_for(v, m: dict) -> str | None:
    th = m.get("threshold") or {}
    if not th.get("enabled"):
        return None
    if v is None:
        return "na"
    return "met" if v >= float(th.get("value", 0)) else "below"


# ---------------------------------------------------------------- upload -> records

def get_table(up: Upload) -> tuple[list, list]:
    if up.kind == "csv":
        return csv_table(up.parsed)
    t = up.parsed["tables"][up.parsed.get("table_index", 0)]
    return t["headers"], t["rows"]


def _label(field: str, mm: dict) -> str:
    return SYSTEM_FIELDS.get(field) or (mm[field]["label"] if field in mm else field)


def table_records(kind: str, headers: list, rows: list, mapping: list | None, options: dict, settings: dict):
    mm = metric_map(settings)
    conf_min = settings["ocr"]["confidence_threshold"]
    src = KIND_LABEL[kind]
    issues: list[dict] = []
    mapping = (mapping or [])[: len(headers)]

    cols_by_field = defaultdict(list)
    for i, m in enumerate(mapping):
        f = m.get("field") or "__ignore__"
        if f != "__ignore__":
            cols_by_field[f].append(i)
    for f, cols in cols_by_field.items():
        if len(cols) > 1:
            issues.append(issue("error", src, "mapping_duplicate",
                                f"{_label(f, mm)} is mapped to more than one column "
                                f"({', '.join(repr(headers[c]) for c in cols)}). Keep one."))
    col = {f: cols[0] for f, cols in cols_by_field.items()}
    for f in list(col):
        if not f.startswith("__") and f not in mm:
            issues.append(issue("warning", src, "mapping_unknown",
                                f"Column '{headers[col[f]]}' points to a metric that no longer exists; it is ignored."))
            col.pop(f)
    name_c, email_c, team_c = col.get("__name__"), col.get("__email__"), col.get("__team__")
    if name_c is None and email_c is None:
        issues.append(issue("error", src, "map_name", "Choose which column holds the agent names."))
        return [], issues, {"mode": None, "mapped_metrics": [], "rows_read": 0, "agents": 0}

    metric_cols = {f: c for f, c in col.items() if f in mm}
    units = {}
    for f, c in metric_cols.items():
        if mm[f]["kind"] != "duration":
            continue
        u = mapping[c]
        units[f] = u.get("unit")
        if not u.get("unit"):
            issues.append(issue("error", src, "unit_missing", f"Choose the time unit of column '{headers[c]}'.", column=c))
        elif not u.get("unit_confirmed"):
            sample = next((r[c]["text"] for r in rows if c < len(r) and not is_missing(r[c]["text"])), "")
            issues.append(issue("error", src, "unit_unconfirmed",
                                f"Confirm the unit of '{headers[c]}' (mapped to {mm[f]['label']}): values look like "
                                f"'{sample}', read as {DURATION_UNITS.get(u['unit'], u['unit'])}. Times are reported in minutes.",
                                column=c))

    ignored = set(options.get("ignored_rows") or [])
    check_conf = kind != "csv"
    parsed, totals = [], []

    def cell(cells, c):
        return cells[c] if c is not None and c < len(cells) else {"text": None, "confidence": None}

    for r, cells in enumerate(rows):
        if r in ignored or all(is_missing(c.get("text")) for c in cells):
            continue
        name = (cell(cells, name_c)["text"] or "").strip() if name_c is not None else ""
        email = (cell(cells, email_c)["text"] or "").strip().lower() if email_c is not None else ""
        nn = normalize_name(name)
        is_total = nn in TOTAL_WORDS
        values = {}
        if check_conf and not is_total and name_c is not None:
            nc = cell(cells, name_c)
            if nc.get("confidence") is not None and nc["confidence"] < conf_min and not nc.get("verified"):
                issues.append(issue("error", src, "uncertain_cell",
                                    f"Row {r + 1}: check the name, read as '{nc['text'] or ''}'.", row=r, column=name_c))
        for f, c in metric_cols.items():
            ce = cell(cells, c)
            text = ce.get("text")
            if (check_conf and not is_total and ce.get("confidence") is not None
                    and ce["confidence"] < conf_min and not ce.get("verified")):
                issues.append(issue("error", src, "uncertain_cell",
                                    f"Row {r + 1} ({name or 'no name'}): check {headers[c]}, read as '{text or 'blank'}'.",
                                    row=r, column=c))
            try:
                v = parse_duration_minutes(text, units.get(f)) if mm[f]["kind"] == "duration" else parse_number(text)
            except ParseError as e:
                v = None
                if not is_total:
                    issues.append(issue("error", src, "bad_value", f"Row {r + 1} ({name or 'no name'}), {headers[c]}: {e}.",
                                        row=r, column=c))
            values[f] = v
        if is_total:
            totals.append({"row": r, "values": values})
            continue
        if not nn and not email:
            if any(v is not None for v in values.values()):
                issues.append(issue("error", src, "no_name",
                                    f"Row {r + 1} has numbers but no name. Type the name or ignore the row.", row=r))
            continue
        parsed.append({"row": r, "name": name or email, "email": email or None,
                       "team": cell(cells, team_c)["text"] if team_c is not None else None,
                       "values": values, "ident": email or nn})

    groups: dict[str, list] = defaultdict(list)
    for p in parsed:
        groups[p["ident"]].append(p)

    mode = "summary"
    if kind == "csv":
        mode = options.get("mode")
        if not mode:
            has_count_col = any(mm[f].get("call_log") == "count" for f in metric_cols)
            repeats = len(parsed) > 3 and len(parsed) >= 2 * max(1, len(groups))
            mode = "call_log" if repeats and not has_count_col else "summary"
            if mode == "call_log":
                issues.append(issue("info", src, "call_log_mode",
                                    f"Read as a call log (one row per call): {len(parsed)} rows for {len(groups)} agents. "
                                    "Change the file type in the mapping if this is wrong."))

    def rec(p, vals, rws):
        return {"key": f"{kind}:{p['ident']}", "source": kind, "rows": rws, "name": p["name"], "email": p["email"],
                "team": p["team"], "values": vals}

    def summed(ps):
        out = {}
        for f in metric_cols:
            nums = [p["values"][f] for p in ps if p["values"].get(f) is not None]
            out[f] = sum(nums) if nums else None
        return out

    records = []
    if mode == "call_log":
        for ps in groups.values():
            vals = summed(ps)
            for k, m in mm.items():
                if m["source"] == kind and m.get("call_log") == "count" and k not in metric_cols:
                    vals[k] = float(len(ps))
            records.append(rec(ps[0], vals, [p["row"] for p in ps]))
    else:
        policy = options.get("duplicate_policy")
        for ps in groups.values():
            rws = [p["row"] for p in ps]
            if len(ps) == 1:
                records.append(rec(ps[0], ps[0]["values"], rws))
                continue
            rows_txt = ", ".join(str(x + 1) for x in rws)
            if all(p["values"] == ps[0]["values"] and p["name"] == ps[0]["name"] for p in ps):
                issues.append(issue("info", src, "duplicate_removed",
                                    f"{ps[0]['name']}: {len(ps)} identical rows ({rows_txt}) counted once."))
                records.append(rec(ps[0], ps[0]["values"], rws))
                continue
            if policy == "sum":
                vals = summed(ps)
            elif policy == "last":
                vals = ps[-1]["values"]
            elif policy == "first":
                vals = ps[0]["values"]
            else:
                issues.append(issue("error", src, "duplicate_agent",
                                    f"{ps[0]['name']} appears in {len(ps)} rows with different numbers (rows {rows_txt}). "
                                    "Choose how duplicate rows are combined, or ignore the wrong rows.",
                                    rows=rws, action="duplicate_policy"))
                vals = ps[0]["values"]
            records.append(rec(ps[0], vals, rws))

    for t in totals:
        for f, tv in t["values"].items():
            if tv is None:
                continue
            nums = [r["values"].get(f) for r in records if r["values"].get(f) is not None]
            calc = sum(nums) if nums else 0.0
            tol = 1.0 if mm[f]["kind"] == "duration" else 0.01
            if abs(calc - tv) > tol:
                issues.append(issue("warning", src, "totals_mismatch",
                                    f"The total row says {mm[f]['label']} = {fmt(tv, mm[f], settings)}, "
                                    f"but the rows add up to {fmt(calc, mm[f], settings)}. Check for missing or misread rows.",
                                    row=t["row"]))
            else:
                issues.append(issue("info", src, "totals_ok", f"{mm[f]['label']} rows add up to the file's total row."))

    meta = {"mode": mode, "mapped_metrics": list(metric_cols), "rows_read": len(parsed), "agents": len(records),
            "total_rows": len(totals)}
    return records, issues, meta


# ---------------------------------------------------------------- session state

def active_uploads(db: Session, sess: ReportSession) -> dict[str, Upload]:
    ups = db.scalars(select(Upload).where(Upload.session_id == sess.id, Upload.status == "active")
                     .order_by(Upload.id)).all()
    return {u.kind: u for u in ups}


def _agent_dict(a: Agent) -> dict:
    return {"id": a.id, "name": a.name, "normalized": a.normalized, "email": a.email, "aliases": a.aliases or [],
            "role": a.role, "role_source": a.role_source}


def match_all(db: Session, sess: ReportSession, settings: dict, records: dict) -> None:
    """Attach a match to every record. New names in the CSV become agents; nothing else is created
    without the user's choice."""
    agents = [_agent_dict(a) for a in db.scalars(select(Agent)).all()]
    ids = {a["id"] for a in agents}
    decisions = (sess.state or {}).get("matches", {})
    sm = settings["matching"]["suggest_min"]
    csv_ids: set = set()
    changed = False
    for kind in KINDS:
        recs = records.get(kind, [])
        claimed: set = set()  # one file cannot list the same person under two different identities
        pending = []
        for rec in recs:  # pass 1: your decisions and exact matches
            d = decisions.get(rec["key"]) or {}
            if d.get("action") == "ignore":
                rec["match"] = {"status": "ignored", "agent_id": None, "reason": "ignored by you", "candidates": []}
                continue
            if d.get("action") == "link" and d.get("agent_id") in ids:
                rec["match"] = {"status": "confirmed", "agent_id": d["agent_id"], "reason": "confirmed by you",
                                "candidates": []}
            else:
                rec["match"] = match_record(rec["name"], rec["email"], agents, sm, exact_only=True)
            if rec["match"]["agent_id"]:
                claimed.add(rec["match"]["agent_id"])
            else:
                pending.append(rec)
        for rec in pending:  # pass 2: similar names, never automatic
            m = match_record(rec["name"], rec["email"], agents, sm, exclude_ids=claimed,
                             prefer_ids=csv_ids if kind != "csv" else None)
            if kind == "csv" and m["status"] == "unmatched":
                role = classify_team(rec["team"], settings)
                a = Agent(name=rec["name"], normalized=normalize_name(rec["name"]) or (rec["email"] or ""),
                          email=rec["email"], role=role, role_source="CSV team column" if role else None, aliases=[])
                db.add(a)
                db.flush()
                agents.append(_agent_dict(a))
                ids.add(a.id)
                claimed.add(a.id)
                changed = True
                m = {"status": "new", "agent_id": a.id, "reason": "new name from the CSV", "candidates": []}
            rec["match"] = m
        if kind != "csv":
            continue
        for rec in recs:
            if not rec["match"]["agent_id"]:
                continue
            csv_ids.add(rec["match"]["agent_id"])
            a = db.get(Agent, rec["match"]["agent_id"])
            if a and not a.email and rec["email"]:
                a.email, changed = rec["email"], True
            if a and a.role is None:
                role = classify_team(rec["team"], settings)
                if role:
                    a.role, a.role_source, changed = role, "CSV team column", True
    if changed:
        db.commit()


def compute_records(db: Session, sess: ReportSession, settings: dict, uploads: dict):
    records, issues, metas = {}, [], {}
    for kind, up in uploads.items():
        src = KIND_LABEL[kind]
        if up.error:
            issues.append(issue("error", src, "extract_failed", f"{src}: {up.error}", upload_id=up.id))
            continue
        if up.parsed is None:
            issues.append(issue("error", src, "not_processed", f"{src} is uploaded but not read yet. Click Process Reports.",
                                upload_id=up.id))
            continue
        headers, rows = get_table(up)
        recs, iss, meta = table_records(kind, headers, rows, up.mapping, up.options or {}, settings)
        for i in iss:
            i["upload_id"] = up.id
        records[kind], metas[kind] = recs, meta
        issues.extend(iss)
        if not (up.options or {}).get("ack_duplicate"):
            dup = db.execute(
                select(Upload, ReportSession).join(ReportSession, Upload.session_id == ReportSession.id)
                .where(Upload.sha256 == up.sha256, Upload.id < up.id, Upload.status == "active")).first()
            if dup:
                du, ds = dup
                issues.append(issue("error", src, "duplicate_file",
                                    f"'{up.filename}' is the same file already used as the {KIND_LABEL[du.kind]} for "
                                    f"{ds.report_date:%d %b %Y} {slot_label(settings, ds.slot)}. Upload the new export, "
                                    "or confirm this is intended.", upload_id=up.id, action="ack_duplicate"))
    return records, issues, metas


def build_report(settings: dict, records: dict, metas: dict, agents_by_id: dict, uploads: dict, issues: list) -> dict:
    mm = metric_map(settings)
    metrics = settings["metrics"]
    per: dict = {}
    seen: dict = {}
    for kind in KINDS:
        for rec in records.get(kind, []):
            aid = (rec.get("match") or {}).get("agent_id")
            if not aid:
                continue
            if (kind, aid) in seen:
                other = seen[(kind, aid)]
                issues.append(issue("error", KIND_LABEL[kind], "same_agent_twice",
                                    f"{agents_by_id[aid].name} is matched by two rows in the {KIND_LABEL[kind]} "
                                    f"('{other['name']}' and '{rec['name']}'). Ignore one or link it to someone else.",
                                    key=rec["key"]))
                continue
            seen[(kind, aid)] = rec
            p = per.setdefault(aid, {"by": defaultdict(dict), "found_in": []})
            p["found_in"].append(kind)
            for f, v in rec["values"].items():
                p["by"][f][kind] = v

    absent = settings.get("absent_in_screenshot", {})
    rows = []
    for aid, p in per.items():
        a = agents_by_id[aid]
        if a.role == "excluded":
            continue
        vals, notes = {}, {}
        for m in metrics:
            if m["source"] == "derived":
                continue
            k = m["key"]
            srcs = p["by"].get(k, {})
            if m["source"] in srcs:
                v = srcs[m["source"]]
                for s, x in srcs.items():
                    if s != m["source"] and x is not None and v is not None and abs(x - v) > 0.01:
                        issues.append(issue("warning", KIND_LABEL[s], "source_conflict",
                                            f"{a.name}: {m['label']} is {fmt(x, m, settings)} in the {KIND_LABEL[s]} but "
                                            f"{fmt(v, m, settings)} in the {KIND_LABEL[m['source']]}; the "
                                            f"{KIND_LABEL[m['source']]} value is used."))
            elif srcs:
                v = next((x for x in srcs.values() if x is not None), None)
            else:
                v = None
                src = m["source"]
                if src in uploads and k in metas.get(src, {}).get("mapped_metrics", []):
                    if src in ("booking", "cc") and absent.get(src) == "zero":
                        v, notes[k] = 0.0, f"not listed in the {KIND_LABEL[src]}; counted as 0"
                    else:
                        notes[k] = f"not listed in the {KIND_LABEL[src]}"
            vals[k] = v
        for m in metrics:
            if m["source"] == "derived":
                f = m["formula"]
                n, d = vals.get(f["numerator"]), vals.get(f["denominator"])
                vals[m["key"]] = (n / d * f.get("multiplier", 1)) if (n is not None and d) else None
        role = a.role if a.role in ("setter", "closer") else "unassigned"
        if role == "unassigned":
            issues.append(issue("error", "Agents", "role_needed",
                                f"{a.name}: choose Setter or Closer (or exclude from the report).", agent_id=aid))
        rows.append({"agent_id": aid, "name": a.name, "role": role, "values": vals, "notes": notes,
                     "found_in": p["found_in"], "role_source": a.role_source})

    visible = [m for m in metrics if m.get("visible", True)]
    targets = [m for m in metrics if (m.get("threshold") or {}).get("enabled")]

    def decorate(r):
        r["display"] = {m["key"]: fmt(r["values"].get(m["key"]), m, settings) for m in metrics}
        r["status"] = {m["key"]: status_for(r["values"].get(m["key"]), m) for m in metrics}
        r["meets_all_targets"] = bool(targets) and all(r["status"][m["key"]] == "met" for m in targets)
        return r

    def section(role_rows):
        role_rows = sort_rows([decorate(r) for r in role_rows], settings)
        return {"rows": role_rows, "count": len(role_rows), "totals": aggregate(role_rows, metrics, settings)}

    setters = section([r for r in rows if r["role"] == "setter"])
    closers = section([r for r in rows if r["role"] == "closer"])
    unassigned = [decorate(r) for r in rows if r["role"] == "unassigned"]
    both = setters["rows"] + closers["rows"]
    overall = aggregate(both, metrics, settings)

    cards = [{"label": "Total Setters", "value": str(setters["count"])},
             {"label": "Total Closers", "value": str(closers["count"])}]
    for key, how in (("bookings", "total"), ("total_calls", "total"), ("talk_time", "average"), ("host_time", "average")):
        if key in mm:
            m = mm[key]
            prefix = "Total" if how == "total" else "Average"
            label = m["label"] if m["label"].lower().startswith(prefix.lower()) else f"{prefix} {m['label']}"
            cards.append({"label": label, "value": overall[key][f"{how}_display"],
                          "unit": "min" if m["kind"] == "duration" else None, "metric": key})
    cards.append({"label": "Agents Meeting Targets", "value": f"{sum(r['meets_all_targets'] for r in both)} / {len(both)}",
                  "hint": "Met every target: " + (", ".join(m["label"] for m in targets) or "no targets set")})
    for m in metrics:
        if m["source"] == "cc":
            lab = m["label"] if "cc" in m["label"].lower() else f"CC {m['label']}"
            cards.append({"label": lab if lab.lower().startswith("total") else f"Total {lab}",
                          "value": overall[m["key"]]["total_display"], "metric": m["key"]})

    booking = None
    if "bookings" in mm:
        bm = mm["bookings"]
        top = sorted([r for r in both if r["values"].get("bookings") is not None],
                     key=lambda r: -r["values"]["bookings"])[:5]
        booking = {"label": bm["label"], "total": overall["bookings"]["total_display"],
                   "setters": setters["totals"]["bookings"]["total_display"],
                   "closers": closers["totals"]["bookings"]["total_display"],
                   "target": bm["threshold"]["value"] if bm["threshold"]["enabled"] else None,
                   "at_target": sum(1 for r in both if r["status"].get("bookings") == "met"),
                   "top": [{"name": r["name"], "role": r["role"], "value": r["display"]["bookings"]} for r in top]}

    return {
        "title": settings["report_title"],
        "metrics": [{"key": m["key"], "label": m["label"], "kind": m["kind"], "source": m["source"],
                     "threshold": m["threshold"], "show_total": m.get("show_total", True),
                     "show_average": m.get("show_average", True)} for m in visible],
        "setters": setters, "closers": closers, "unassigned": unassigned, "overall": overall,
        "summary": {"cards": cards, "target_metrics": [m["label"] for m in targets]},
        "booking": booking,
        "cc_metrics": [{"key": m["key"], "label": m["label"], "total": overall[m["key"]]["total_display"]}
                       for m in metrics if m["source"] == "cc"],
        "formatting": settings["formatting"], "sorting": settings["sorting"],
    }


def sort_rows(rows: list, settings: dict, primary: str | None = None, secondary: str | None = None) -> list:
    p = primary or settings["sorting"]["primary"]
    s = secondary or settings["sorting"]["secondary"]

    def key(r):
        a, b = r["values"].get(p), r["values"].get(s)
        return (a is None, -(a or 0), b is None, -(b or 0), r["name"].lower())

    rows = sorted(rows, key=key)
    for i, r in enumerate(rows, 1):
        r["rank"] = i
    return rows


def aggregate(rows: list, metrics: list, settings: dict) -> dict:
    out = {}
    for m in metrics:
        k = m["key"]
        vals = [r["values"][k] for r in rows if r["values"].get(k) is not None]
        avg = sum(vals) / len(vals) if vals else None
        if m["source"] == "derived":
            f = m["formula"]
            pairs = [(r["values"].get(f["numerator"]), r["values"].get(f["denominator"])) for r in rows]
            pairs = [(n, d) for n, d in pairs if n is not None and d is not None]
            den = sum(d for _, d in pairs)
            total = sum(n for n, _ in pairs) / den * f.get("multiplier", 1) if den else None
        else:
            total = sum(vals) if vals else None
        out[k] = {"total": total, "average": avg, "count": len(vals),
                  "total_display": fmt(total, m, settings),
                  "average_display": (f"{avg:,.1f}" if avg is not None and m["kind"] in ("count", "number") else fmt(avg, m, settings)),
                  "total_status": None, "average_status": status_for(avg, m) if avg is not None else None}
    return out


# ---------------------------------------------------------------- serialisation

def session_dict(db: Session, sess: ReportSession, settings: dict) -> dict:
    snaps = db.scalars(select(Snapshot).where(Snapshot.session_id == sess.id).order_by(Snapshot.version)).all()
    return {"id": sess.id, "date": sess.report_date.isoformat(), "slot": sess.slot,
            "slot_label": slot_label(settings, sess.slot), "status": sess.status,
            "created_at": iso(sess.created_at), "updated_at": iso(sess.updated_at),
            "snapshots": [{"id": s.id, "version": s.version, "generated_at": iso(s.generated_at)} for s in snaps]}


def upload_dict(up: Upload, settings: dict, meta: dict | None) -> dict:
    d = {"id": up.id, "kind": up.kind, "label": KIND_LABEL[up.kind], "filename": up.filename,
         "uploaded_at": iso(up.uploaded_at), "size": up.size, "sha": up.sha256[:12], "provider": up.provider,
         "extracted_at": iso(up.extracted_at), "error": up.error, "options": up.options or {},
         "mapping": up.mapping or [], "meta": meta or {}, "fields": field_options(settings),
         "units": DURATION_UNITS, "processed": up.parsed is not None}
    if up.parsed is None:
        return d
    headers, rows = get_table(up)
    d["headers"] = headers
    if up.kind == "csv":
        d["row_count"] = len(rows)
        d["sample_rows"] = [[c["text"] for c in r] for r in rows[:300]]
    else:
        d["rows"] = rows
        d["tables"] = [{"title": t.get("title", ""), "rows": len(t["rows"]), "columns": len(t["headers"])}
                       for t in up.parsed["tables"]]
        d["table_index"] = up.parsed.get("table_index", 0)
        d["other_text"] = up.parsed.get("other_text", [])
        d["confidence_threshold"] = settings["ocr"]["confidence_threshold"]
    return d


def refresh(db: Session, sess: ReportSession) -> dict:
    settings = load_settings(db)
    uploads = active_uploads(db, sess)
    records, issues, metas = compute_records(db, sess, settings, uploads)
    match_all(db, sess, settings, records)
    agents_by_id = {a.id: a for a in db.scalars(select(Agent)).all()}

    matches = []
    for kind in KINDS:
        for rec in records.get(kind, []):
            m = rec["match"]
            aid = m.get("agent_id")
            matches.append({"key": rec["key"], "source": kind, "source_label": KIND_LABEL[kind], "name": rec["name"],
                            "email": rec["email"], "rows": rec["rows"], "status": m["status"], "reason": m.get("reason"),
                            "score": m.get("score"), "candidates": m.get("candidates", []), "agent_id": aid,
                            "agent_name": agents_by_id[aid].name if aid else None,
                            "role": agents_by_id[aid].role if aid else None})
            if m["status"] in ("suggested", "unmatched"):
                what = "is similar to an existing agent" if m["status"] == "suggested" else "does not match anyone in the CSV"
                issues.append(issue("error", KIND_LABEL[kind], "match_needed",
                                    f"'{rec['name']}' {what}. Confirm who it is.", key=rec["key"]))

    report = build_report(settings, records, metas, agents_by_id, uploads, issues)

    if "csv" not in uploads:
        issues.append(issue("error", KIND_LABEL["csv"], "missing_upload", "Upload the dialer CSV for this session."))
    for kind in ("booking", "cc"):
        if kind not in uploads:
            issues.append(issue("warning", KIND_LABEL[kind], "missing_upload",
                                f"No {KIND_LABEL[kind]} uploaded; its metrics will show N/A."))
    seen, unique = set(), []
    for i in issues:
        sig = (i["severity"], i["code"], i["message"])
        if sig not in seen:
            seen.add(sig)
            unique.append(i)
    unique.sort(key=lambda i: SEVERITY_ORDER[i["severity"]])
    errors = sum(1 for i in unique if i["severity"] == "error")
    rows_total = report["setters"]["count"] + report["closers"]["count"]
    return {
        "session": session_dict(db, sess, settings),
        "uploads": {k: upload_dict(u, settings, metas.get(k)) for k, u in uploads.items()},
        "matches": matches,
        "issues": unique,
        "counts": {"errors": errors, "warnings": sum(1 for i in unique if i["severity"] == "warning")},
        "report": report,
        "can_finalize": errors == 0 and "csv" in uploads and rows_total > 0,
        "agents": [{"id": a.id, "name": a.name, "role": a.role} for a in sorted(agents_by_id.values(), key=lambda a: a.name.lower())],
    }


def mark_edited(sess: ReportSession) -> None:
    if sess.status == "final":
        sess.status = "draft"
    sess.updated_at = utcnow()


def finalize(db: Session, sess: ReportSession) -> Snapshot:
    pv = refresh(db, sess)
    if not pv["can_finalize"]:
        errs = [i["message"] for i in pv["issues"] if i["severity"] == "error"]
        raise ReportError("Fix these before generating: " + " | ".join(errs[:5]) if errs else "Nothing to report yet.")
    settings = load_settings(db)
    version = (db.scalar(select(func.max(Snapshot.version)).where(Snapshot.session_id == sess.id)) or 0) + 1
    uploads = active_uploads(db, sess)
    now = utcnow()
    report = copy.deepcopy(pv["report"])
    report.update({
        "session": {"id": sess.id, "date": sess.report_date.isoformat(), "slot": sess.slot,
                    "slot_label": slot_label(settings, sess.slot)},
        "version": version, "generated_at": iso(now),
        "files": [{"kind": u.kind, "label": KIND_LABEL[u.kind], "filename": u.filename, "uploaded_at": iso(u.uploaded_at),
                   "sha": u.sha256[:12], "provider": u.provider} for u in uploads.values()],
        "extracted": [{"source": m["source"], "name_in_file": m["name"], "email": m["email"], "status": m["status"],
                       "agent": m["agent_name"]} for m in pv["matches"]],
        "warnings": [i["message"] for i in pv["issues"] if i["severity"] == "warning"],
    })
    snap = Snapshot(session_id=sess.id, version=version, generated_at=now, report=report)
    db.add(snap)
    sess.status = "final"
    sess.updated_at = now
    db.commit()
    return snap


def compare(a: dict, b: dict) -> dict:
    """Compare two snapshot reports agent by agent (B minus A)."""
    metrics = list(a["metrics"]) + [m for m in b["metrics"] if m["key"] not in {x["key"] for x in a["metrics"]}]
    numeric = [m for m in metrics]

    def index(rep):
        return {r["agent_id"]: r for sec in ("setters", "closers") for r in rep[sec]["rows"]}

    ia, ib = index(a), index(b)
    rows = []
    for aid in list(ia) + [x for x in ib if x not in ia]:
        ra, rb = ia.get(aid), ib.get(aid)
        base = rb or ra
        row = {"agent_id": aid, "name": base["name"], "role": base["role"], "in_a": ra is not None, "in_b": rb is not None,
               "a": {}, "b": {}, "delta": {}}
        for m in numeric:
            va = ra["values"].get(m["key"]) if ra else None
            vb = rb["values"].get(m["key"]) if rb else None
            row["a"][m["key"]], row["b"][m["key"]] = va, vb
            row["delta"][m["key"]] = (vb - va) if (va is not None and vb is not None) else None
        rows.append(row)
    rows.sort(key=lambda r: (r["role"] != "setter", r["name"].lower()))

    def meta(rep):
        return {"date": rep["session"]["date"], "slot": rep["session"]["slot"], "slot_label": rep["session"]["slot_label"],
                "version": rep["version"], "generated_at": rep["generated_at"]}

    totals = {}
    for m in numeric:
        ta = (a["overall"].get(m["key"]) or {}).get("total")
        tb = (b["overall"].get(m["key"]) or {}).get("total")
        totals[m["key"]] = {"a": ta, "b": tb, "delta": (tb - ta) if ta is not None and tb is not None else None}
    return {"a": meta(a), "b": meta(b), "metrics": metrics, "rows": rows, "totals": totals}
