"""Full session with placeholder files: upload -> process (Tesseract) -> review -> generate -> export -> compare."""
import io
import os
import tempfile
from pathlib import Path

import pytest

TMP = tempfile.mkdtemp()
os.environ["DATA_DIR"] = TMP
os.environ["DATABASE_URL"] = f"sqlite:///{TMP}/t.db"
os.environ["OCR_PROVIDER"] = "tesseract"

from fastapi.testclient import TestClient  # noqa: E402
from openpyxl import load_workbook  # noqa: E402

from app.main import app  # noqa: E402
from tests import make_samples  # noqa: E402

S = Path(make_samples.__file__).parent / "samples"


@pytest.fixture(scope="module")
def client():
    make_samples.main()
    with TestClient(app) as c:
        yield c


def errors(pv, code=None):
    return [i for i in pv["issues"] if i["severity"] == "error" and (code is None or i["code"] == code)]


def upload(c, sid, kind, name):
    with open(S / name, "rb") as f:
        r = c.post(f"/api/sessions/{sid}/uploads/{kind}", files={"file": (name, f)})
    assert r.status_code == 200, r.text
    return r.json()["preview"]


def resolve_everything(c, sid, pv):
    # 1. Confirm the Host Time unit (a plain number is never assumed to be minutes)
    up = pv["uploads"]["csv"]
    mapping = up["mapping"]
    for i in errors(pv, "unit_unconfirmed"):
        mapping[i["column"]]["unit_confirmed"] = True
    pv = c.patch(f"/api/uploads/{up['id']}", json={"mapping": mapping}).json()
    assert not errors(pv, "unit_unconfirmed")
    # 2. A misread screenshot value is corrected by typing it (here: from the known sample data)
    truth = {"booking": make_samples.BOOKINGS, "cc": make_samples.CC}
    for kind in ("booking", "cc"):
        u = pv["uploads"].get(kind)
        if not u:
            continue
        fixes = [{"row": i["row"], "col": i["column"], "text": truth[kind][i["row"]][i["column"]]}
                 for i in pv["issues"] if i.get("upload_id") == u["id"] and i["code"] == "bad_value"]
        if fixes:
            pv = c.patch(f"/api/uploads/{u['id']}", json={"cells": fixes}).json()
    # 3. Cells read with low confidence must be checked
    for kind in ("booking", "cc"):
        u = pv["uploads"].get(kind)
        if not u:
            continue
        rows = sorted({i["row"] for i in pv["issues"] if i.get("upload_id") == u["id"] and i["code"] == "uncertain_cell"})
        if rows:
            pv = c.patch(f"/api/uploads/{u['id']}", json={"verify_rows": rows}).json()
    # 4. Similar name -> confirm
    for m in pv["matches"]:
        if m["status"] == "suggested":
            pv = c.patch(f"/api/sessions/{sid}/matches",
                         json={"key": m["key"], "action": "link", "agent_id": m["candidates"][0]["agent_id"],
                               "name": m["name"]}).json()
    return pv


def test_full_session(client):
    c = client
    sess = c.post("/api/sessions", json={"date": "2026-11-23", "slot": "14:00"}).json()
    sid = sess["id"]
    pv = upload(c, sid, "csv", "dialer.csv")
    m = {pv["uploads"]["csv"]["headers"][i]: x["field"] for i, x in enumerate(pv["uploads"]["csv"]["mapping"])}
    assert m["Agent Name"] == "__name__" and m["Email"] == "__email__" and m["Team"] == "__team__"
    assert m["Total Calls"] == "total_calls" and m["Talk Time"] == "talk_time" and m["Host Time"] == "host_time"
    assert m["Connected"] == "__ignore__"  # not a configured metric: left for the user, not guessed

    upload(c, sid, "booking", "booking.png")
    pv = upload(c, sid, "cc", "cc.png")
    assert errors(pv, "not_processed")
    pv = c.post(f"/api/sessions/{sid}/process").json()
    assert pv["uploads"]["booking"]["processed"] and pv["uploads"]["booking"]["provider"] == "tesseract"
    # Map the CC column as a new metric (unknown column becomes a configurable metric)
    cc = pv["uploads"]["cc"]
    col = cc["headers"].index("CC")
    pv = c.patch(f"/api/uploads/{cc['id']}", json={"new_metric": {"column": col, "label": "CC", "kind": "count"}}).json()

    assert not pv["can_finalize"]
    pv = resolve_everything(c, sid, pv)
    assert errors(pv) == [], errors(pv)
    assert pv["can_finalize"]

    rep = pv["report"]
    setters = {r["name"]: r for r in rep["setters"]["rows"]}
    closers = {r["name"]: r for r in rep["closers"]["rows"]}
    assert set(setters) == {"Setter Alpha", "Setter Bravo", "Setter Charlie", "Setter Delta"}
    assert set(closers) == {"Closer Echo", "Closer Foxtrot"}
    a = setters["Setter Alpha"]
    assert a["values"]["talk_time"] == pytest.approx(102 + 10 / 60)
    assert a["values"]["bookings"] == 7 and a["values"]["cc"] == 2
    assert a["status"] == {**a["status"], "talk_time": "met", "host_time": "met", "bookings": "met"}
    assert setters["Setter Charlie"]["values"]["bookings"] == 3  # via confirmed fuzzy match
    assert setters["Setter Delta"]["values"]["bookings"] == 0 and setters["Setter Delta"]["status"]["bookings"] == "below"
    assert setters["Setter Delta"]["values"]["host_time"] is None and setters["Setter Delta"]["display"]["host_time"] == "N/A"
    assert closers["Closer Foxtrot"]["values"]["bookings"] is None  # not in screenshot -> N/A, not 0
    # Sorted by bookings then talk time
    assert [r["name"] for r in rep["setters"]["rows"]] == ["Setter Alpha", "Setter Bravo", "Setter Charlie", "Setter Delta"]
    assert [r["rank"] for r in rep["setters"]["rows"]] == [1, 2, 3, 4]
    assert rep["setters"]["totals"]["bookings"]["total"] == 15
    assert rep["setters"]["totals"]["conversion_rate"]["total"] == pytest.approx(15 / (142 + 118 + 97 + 131) * 100)
    assert any(i["code"] == "totals_ok" for i in pv["issues"])  # screenshot "Total 19" matches its rows

    snap = c.post(f"/api/sessions/{sid}/finalize").json()
    assert snap["version"] == 1
    xl = c.get(f"/api/snapshots/{snap['snapshot_id']}/export.xlsx")
    ws = load_workbook(io.BytesIO(xl.content))["Report"]
    assert "Setters Performance" in [ws.cell(r, 1).value for r in range(1, 10)]
    assert c.get(f"/api/snapshots/{snap['snapshot_id']}/export.csv").text.count("Setter Alpha") == 1

    # Next session: same CSV re-used is blocked until acknowledged; aliases remembered.
    s2 = c.post("/api/sessions", json={"date": "2026-11-23", "slot": "17:00"}).json()["id"]
    pv2 = upload(c, s2, "csv", "dialer.csv")
    assert errors(pv2, "duplicate_file")
    assert not errors(pv2, "unit_unconfirmed")  # unit confirmation remembered
    pv2 = c.patch(f"/api/uploads/{pv2['uploads']['csv']['id']}", json={"options": {"ack_duplicate": True}}).json()
    upload(c, s2, "booking", "booking.png")
    pv2 = c.post(f"/api/sessions/{s2}/process").json()
    pv2 = c.patch(f"/api/uploads/{pv2['uploads']['booking']['id']}", json={"options": {"ack_duplicate": True}}).json()
    assert not [m for m in pv2["matches"] if m["status"] == "suggested"]  # "Setter Charly" now known
    pv2 = resolve_everything(c, s2, pv2)
    assert pv2["can_finalize"], errors(pv2)
    snap2 = c.post(f"/api/sessions/{s2}/finalize").json()

    # History keeps both sessions; first session is unchanged
    hist = c.get("/api/snapshots").json()
    assert {h["slot"] for h in hist} == {"14:00", "17:00"}
    assert c.get("/api/snapshots", params={"agent": "foxtrot"}).json()
    cmp = c.get("/api/compare", params={"a": snap["snapshot_id"], "b": snap2["snapshot_id"]}).json()
    alpha = next(r for r in cmp["rows"] if r["name"] == "Setter Alpha")
    assert alpha["delta"]["bookings"] == 0 and alpha["delta"]["cc"] is None  # CC not uploaded in session 2

    # Regenerating creates v2; v1 stays
    c.patch(f"/api/agents/{alpha['agent_id']}", json={"role": "closer"})
    pv = c.get(f"/api/sessions/{sid}").json()
    assert "Setter Alpha" in {r["name"] for r in pv["report"]["closers"]["rows"]}
    assert c.post(f"/api/sessions/{sid}/finalize").json()["version"] == 2
    assert len(c.get("/api/snapshots", params={"all_versions": True}).json()) == 3


def test_duplicate_rows_need_a_choice(client):
    c = client
    sid = c.post("/api/sessions", json={"date": "2026-11-24", "slot": "14:00"}).json()["id"]
    raw = b"Agent Name,Total Calls\nSetter Alpha,10\nSetter Alpha,12\nSetter Bravo,5\nSetter Bravo,5\n"
    pv = c.post(f"/api/sessions/{sid}/uploads/csv", files={"file": ("d.csv", raw)}).json()["preview"]
    assert len(errors(pv, "duplicate_agent")) == 1
    assert any(i["code"] == "duplicate_removed" for i in pv["issues"])
    pv = c.patch(f"/api/uploads/{pv['uploads']['csv']['id']}", json={"options": {"duplicate_policy": "sum"}}).json()
    assert not errors(pv, "duplicate_agent")
    rows = {r["name"]: r for sec in ("setters", "closers") for r in pv["report"][sec]["rows"]}
    assert rows["Setter Alpha"]["values"]["total_calls"] == 22 and rows["Setter Bravo"]["values"]["total_calls"] == 5


def test_rejects_bad_files(client):
    sid = client.post("/api/sessions", json={"date": "2026-11-25", "slot": "21:00"}).json()["id"]
    assert client.post(f"/api/sessions/{sid}/uploads/booking", files={"file": ("x.png", b"not an image")}).status_code == 400
    assert client.post(f"/api/sessions/{sid}/uploads/csv", files={"file": ("x.exe", b"a,b\n1,2")}).status_code == 400
