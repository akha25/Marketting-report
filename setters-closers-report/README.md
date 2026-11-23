# Daily Setters & Closers Performance Report

One website for the 2 PM / 5 PM / 7 PM / 9 PM report. You upload the dialer CSV, the booking screenshot and the CC screenshot. The app reads them, matches agents, splits setters and closers, calculates, sorts and colour-codes the tables, and gives you a Slack-ready screenshot, Excel, CSV or PDF. Every session is saved separately in history.

```
frontend/   React + TypeScript + Tailwind + Recharts (Vite)
backend/    FastAPI + Pandas + SQLAlchemy (Postgres / Supabase, or SQLite locally)
            Screenshot reading: Claude vision (ANTHROPIC_API_KEY) or free Tesseract OCR
```

## Run it

### Option A: Docker (recommended for the office machine or a server)

```bash
cp .env.example .env          # add ANTHROPIC_API_KEY, optionally APP_USERNAME / APP_PASSWORD
docker compose up -d --build  # app + Postgres
```
Open http://localhost:8000. Data lives in the `pgdata` and `uploads` volumes.

### Option B: run locally without Docker

Needs Python 3.11+, Node 20+ and (for the free OCR) Tesseract (`brew install tesseract`, `sudo apt install tesseract-ocr`, or the Windows installer from UB Mannheim).

```bash
cd frontend && npm install && npm run build && cd ..
cd backend && pip install -r requirements.txt
export ANTHROPIC_API_KEY=sk-ant-...          # optional but recommended
uvicorn app.main:app --port 8000
```
Open http://localhost:8000. Without `DATABASE_URL` it uses SQLite in `backend/data/`.

To work on the frontend with hot reload: run the backend as above, then `cd frontend && npm run dev` and open http://localhost:5173.

### Supabase

Set `DATABASE_URL` to the Supabase connection string (Project settings → Database → URI). Tables are created on first start. Uploaded files are stored on the app's disk (`DATA_DIR`), so keep that folder or volume backed up too.

## Daily workflow

1. Pick the date and session (2 / 5 / 7 / 9 PM) in the top bar.
2. **Upload Reports**: drop the dialer CSV, booking screenshot and CC screenshot.
3. Click **Process Reports**. The screenshots are read, and everything is matched and calculated.
4. Work through the **"to fix"** list. You won't need most of these after the first day:
   - Confirm the unit of each time column once. It is remembered by header name.
   - Check amber cells (uncertain readings) against the image beside them. Type a correction, or press **Checked**.
   - Confirm similar names ("Setter Charly" → "Setter Charlie"). Confirmed spellings are remembered.
   - Choose Setter or Closer for anyone the CSV team column doesn't classify.
5. Click **Generate Final Report**. This saves version 1 for that session. Regenerating later saves v2 and keeps v1.
6. **Export Reports** → **Capture Full Report Screenshot**. The PNG downloads and is copied to the clipboard, so you can paste it straight into Slack.

## Accuracy rules built in

| Situation | What the app does |
|---|---|
| Empty cell, `-`, `N/A` | Shown as **N/A**, never as 0. A real `0` shows as 0. |
| Plain-number time column (e.g. `128`) | Blocks until you confirm the unit (minutes, seconds, hours…). `1:32:30` is read as h:mm:ss automatically. |
| Screenshot reading below 90% confidence | Highlighted amber and blocks the report until you check it. |
| Unreadable value (OCR read `3` as `E`) | Error on that cell, never guessed. |
| Screenshot has a **Total** row | Rows are added up and compared to it. A mismatch is flagged. |
| Similar but not identical names | Suggested only, and needs your confirmation. Sharing one word ("Priya Sharma" / "Neha Sharma") never counts as a match. |
| Same agent twice in the CSV with different numbers | Blocks until you choose: add up, keep first, or keep last. Identical duplicate rows are counted once. |
| Same file uploaded for another session | Blocks until you confirm it's intended. |
| Agent in the CSV but not in a screenshot | Bookings/CC show **N/A**. You can change this to "count as 0" in Settings. |
| CSV with one row per call | Detected and aggregated per agent (calls = row count). You can switch it in the mapping. |

All calculations run on numbers parsed from the files. Formatting is applied only for display. Exports keep full precision.

## Settings you will want to check

- **Metrics & targets:** add, remove, rename, reorder and show/hide metrics. Targets: TT ≥ 90, Host Time ≥ 90, Bookings ≥ 5 (light green at or above, light red below). Turn colouring on for any metric.
- **Conversion Rate** defaults to Bookings ÷ Total Calls × 100. Change the formula if you define it differently (for example Bookings ÷ Connected).
- **Unknown CSV columns** (e.g. Connected) are not guessed. Map them, or click **Add as metric** on the upload screen. Same for CC screenshot columns.
- **Setter / closer keywords** for the CSV team column. Without a team column, you assign each new person once.
- **Agents:** rename, set email, reassign or exclude.

## Configuration (environment variables)

| Variable | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | Enables Claude image reading for screenshots (recommended) |
| `ANTHROPIC_MODEL` | Default `claude-sonnet-5-5` |
| `OCR_PROVIDER` | `auto` (Claude if key set, else Tesseract), `anthropic`, `tesseract`, `manual` |
| `DATABASE_URL` | Postgres/Supabase URI; empty = SQLite |
| `APP_USERNAME`, `APP_PASSWORD` | Turns on a browser login for the whole site |
| `DATA_DIR` | Where uploaded files are kept |
| `REPORT_TIMEZONE` | Default `Asia/Kolkata` |
| `MAX_UPLOAD_MB` | Default 15 |

## Tests

```bash
cd backend
python tests/make_samples.py         # placeholder CSV + screenshots ("Setter Alpha"…)
python -m pytest -q tests
```
The tests run two full sessions through the API: upload, real Tesseract reading, corrections, matching, generation, Excel/CSV export, history and comparison. They also check duplicate handling and file validation.

## API (for automation later)

`POST /api/sessions` {date, slot} · `POST /api/sessions/{id}/uploads/{csv|booking|cc}` · `POST /api/sessions/{id}/process` · `GET /api/sessions/{id}` (preview + issues) · `PATCH /api/uploads/{id}` (mapping, corrections) · `PATCH /api/sessions/{id}/matches` · `POST /api/sessions/{id}/finalize` · `GET /api/snapshots` · `GET /api/snapshots/{id}/export.{csv|xlsx}` · `GET /api/compare?a=&b=`
