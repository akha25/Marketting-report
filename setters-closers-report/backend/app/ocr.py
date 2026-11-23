"""Screenshot reading.

Providers:
- anthropic: Claude vision (best for app screenshots). Needs ANTHROPIC_API_KEY.
- tesseract: free local OCR. Works on clean, high-contrast tables; expect more cells to check.
- manual: no reading; the user types the table into the preview grid.

Every cell carries a confidence between 0 and 1. Cells below the configured threshold are
highlighted and must be checked before the report can be generated.
"""
import base64
import io
import statistics

from PIL import Image, ImageOps

from . import config

CONFIDENCE = {"high": 0.97, "medium": 0.75, "low": 0.4}
ALLOWED_FORMATS = {"PNG": "image/png", "JPEG": "image/jpeg"}


class OCRError(RuntimeError):
    pass


def validate_image(raw: bytes) -> str:
    try:
        img = Image.open(io.BytesIO(raw))
        fmt = img.format
        img.verify()
    except Exception:
        raise OCRError("This file is not a readable PNG or JPG image.")
    if fmt not in ALLOWED_FORMATS:
        raise OCRError(f"Images must be PNG or JPG (this one is {fmt}).")
    return ALLOWED_FORMATS[fmt]


def extract(raw: bytes, provider: str | None = None) -> dict:
    provider = provider or config.ocr_provider()
    if provider == "anthropic":
        tables, other = _anthropic(raw)
    elif provider == "tesseract":
        tables, other = _tesseract(raw)
    elif provider == "manual":
        tables, other = [{"title": "Manual entry", "headers": ["Agent name", "Value"], "rows": []}], []
    else:
        raise OCRError(f"Unknown OCR provider '{provider}'.")
    tables = [_normalise_table(t) for t in tables if t.get("headers")]
    if not tables:
        tables = [{"title": "No table found", "headers": ["Agent name", "Value"], "rows": []}]
    best = max(range(len(tables)), key=lambda i: len(tables[i]["rows"]) * len(tables[i]["headers"]))
    return {"provider": provider, "tables": tables, "table_index": best, "other_text": other}


def _cell(text, confidence: float, note: str = "") -> dict:
    t = None if text is None else str(text).strip()
    return {"text": t if t else None, "original": t if t else None, "confidence": round(float(confidence), 3),
            "note": note or "", "verified": False, "edited": False}


def _normalise_table(t: dict) -> dict:
    headers = [str(h or "").strip() for h in t["headers"]]
    rows = []
    for r in t.get("rows", []):
        cells = list(r)[: len(headers)]
        extra = len(r) - len(headers)
        out = [c if isinstance(c, dict) and "verified" in c else _cell(
            c.get("text") if isinstance(c, dict) else c,
            c.get("confidence", 0.5) if isinstance(c, dict) else 0.5,
            c.get("note", "") if isinstance(c, dict) else "") for c in cells]
        while len(out) < len(headers):
            out.append(_cell(None, 0.4, "cell missing in reading"))
        if extra > 0:
            out[-1]["confidence"] = min(out[-1]["confidence"], 0.4)
            out[-1]["note"] = (out[-1]["note"] + " row had extra cells").strip()
        rows.append(out)
    return {"title": t.get("title") or "", "headers": headers, "rows": rows}


# ---------------------------------------------------------------- Claude vision

_TOOL = {
    "name": "record_tables",
    "description": "Record every table visible in the screenshot exactly as written.",
    "input_schema": {
        "type": "object",
        "properties": {
            "tables": {"type": "array", "items": {"type": "object", "properties": {
                "title": {"type": "string"},
                "headers": {"type": "array", "items": {"type": "string"}},
                "rows": {"type": "array", "items": {"type": "array", "items": {"type": "object", "properties": {
                    "text": {"type": ["string", "null"]},
                    "confidence": {"type": "string", "enum": ["high", "medium", "low"]},
                    "note": {"type": "string"}}, "required": ["text", "confidence"]}}}},
                "required": ["headers", "rows"]}},
            "other_text": {"type": "array", "items": {"type": "string"}},
        },
        "required": ["tables"],
    },
}

_PROMPT = """You are transcribing a screenshot for an accuracy-critical daily sales report.
Rules:
- Transcribe every table you can see. Keep the column order and header text exactly as shown.
- Every row must have exactly one cell per header, in order. Use text null for an empty cell.
- Copy names and numbers exactly as displayed, including commas, colons and % signs.
  Never correct, total, round, translate or infer a value. Never invent rows.
- If any character is blurry, cut off or ambiguous, give your best reading with confidence "low"
  and say what is unclear in note. Use "medium" when fairly but not fully sure.
- Keep total or summary rows as ordinary rows.
- Put readable text outside tables (titles, dates, filters) in other_text.
Call record_tables once with the result."""


def _prepare_for_api(raw: bytes) -> tuple[str, str]:
    img = ImageOps.exif_transpose(Image.open(io.BytesIO(raw)))
    if max(img.size) > 2400:
        img.thumbnail((2400, 2400), Image.LANCZOS)
    buf = io.BytesIO()
    img.convert("RGB").save(buf, "PNG", optimize=True)
    media = "image/png"
    if buf.tell() > 4_500_000:
        buf = io.BytesIO()
        img.convert("RGB").save(buf, "JPEG", quality=92)
        media = "image/jpeg"
    return base64.standard_b64encode(buf.getvalue()).decode(), media


def _anthropic(raw: bytes):
    if not config.ANTHROPIC_API_KEY:
        raise OCRError("ANTHROPIC_API_KEY is not set. Add it to .env or set OCR_PROVIDER=tesseract.")
    import anthropic

    data, media = _prepare_for_api(raw)
    client = anthropic.Anthropic(api_key=config.ANTHROPIC_API_KEY)
    try:
        msg = client.messages.create(
            model=config.ANTHROPIC_MODEL,
            max_tokens=8000,
            temperature=0,
            tools=[_TOOL],
            tool_choice={"type": "tool", "name": "record_tables"},
            messages=[{"role": "user", "content": [
                {"type": "image", "source": {"type": "base64", "media_type": media, "data": data}},
                {"type": "text", "text": _PROMPT},
            ]}],
        )
    except Exception as e:
        raise OCRError(f"Claude image reading failed: {e}")
    block = next((b for b in msg.content if getattr(b, "type", "") == "tool_use"), None)
    if block is None:
        raise OCRError("Claude did not return a table.")
    out = block.input
    tables = []
    for t in out.get("tables", []):
        rows = [[_cell(c.get("text"), CONFIDENCE.get(c.get("confidence"), 0.4), c.get("note", "")) for c in r]
                for r in t.get("rows", [])]
        tables.append({"title": t.get("title", ""), "headers": t.get("headers", []), "rows": rows})
    if msg.stop_reason == "max_tokens":
        for t in tables:
            for c in (t["rows"][-1] if t["rows"] else []):
                c["confidence"] = min(c["confidence"], 0.4)
                c["note"] = "reading was cut off; check that no rows are missing"
    return tables, out.get("other_text", [])


# ---------------------------------------------------------------- Tesseract

def _tesseract(raw: bytes):
    try:
        import pytesseract
    except ImportError:
        raise OCRError("pytesseract is not installed.")
    img = ImageOps.exif_transpose(Image.open(io.BytesIO(raw))).convert("L")
    if statistics.mean(list(img.resize((64, 64)).getdata())) < 110:  # dark-mode screenshot
        img = ImageOps.invert(img)
    if max(img.size) < 2200:
        f = 2
        img = img.resize((img.width * f, img.height * f), Image.LANCZOS)
    img = ImageOps.autocontrast(img)
    try:
        d = pytesseract.image_to_data(img, config="--psm 6", output_type=pytesseract.Output.DICT)
    except Exception as e:
        raise OCRError(f"Tesseract failed: {e}")

    words = []
    for i, txt in enumerate(d["text"]):
        if txt and txt.strip() and float(d["conf"][i]) >= 0:
            words.append({"text": txt.strip(), "conf": float(d["conf"][i]) / 100, "x0": d["left"][i],
                          "x1": d["left"][i] + d["width"][i], "y": d["top"][i] + d["height"][i] / 2,
                          "h": d["height"][i], "line": (d["block_num"][i], d["par_num"][i], d["line_num"][i])})
    if not words:
        return [], []
    med_h = statistics.median(w["h"] for w in words) or 10

    lines: dict = {}
    for w in words:
        lines.setdefault(w["line"], []).append(w)
    ordered = sorted(lines.values(), key=lambda ws: statistics.mean(w["y"] for w in ws))

    def split_cells(ws):
        ws = sorted(ws, key=lambda w: w["x0"])
        cells = [[ws[0]]]
        for w in ws[1:]:
            if w["x0"] - cells[-1][-1]["x1"] > 1.3 * med_h:
                cells.append([w])
            else:
                cells[-1].append(w)
        return [{"text": " ".join(w["text"] for w in c), "conf": min(w["conf"] for w in c),
                 "x0": c[0]["x0"], "x1": c[-1]["x1"]} for c in cells]

    cell_lines = [split_cells(ws) for ws in ordered]
    head_i = max(range(min(5, len(cell_lines))), key=lambda i: len(cell_lines[i]))
    header = cell_lines[head_i]
    centres = [(c["x0"] + c["x1"]) / 2 for c in header]
    other = [" ".join(c["text"] for c in cl) for cl in cell_lines[:head_i]]

    rows = []
    for cl in cell_lines[head_i + 1:]:
        slots: list[list] = [[] for _ in header]
        for c in cl:
            mid = (c["x0"] + c["x1"]) / 2
            j = min(range(len(centres)), key=lambda k: abs(centres[k] - mid))
            slots[j].append(c)
        row = []
        for s in slots:
            if s:
                row.append(_cell(" ".join(c["text"] for c in s), min(c["conf"] for c in s),
                                 "" if min(c["conf"] for c in s) >= 0.9 else "low OCR confidence"))
            else:
                row.append(_cell(None, 0.85, "blank in screenshot - check"))
        rows.append(row)
    table = {"title": "", "headers": [c["text"] for c in header],
             "rows": [[{"text": c["text"], "confidence": c["confidence"], "note": c["note"]} for c in r] for r in rows]}
    return [table], other
