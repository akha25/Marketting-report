"""CSV reading, header mapping, and value parsing.

Rules that matter for accuracy:
- An empty cell is missing (None), never 0. "0" is zero.
- Values are converted to numbers before any calculation; formatted strings are never added.
- Time columns are converted to minutes using a unit the user has confirmed.
"""
import csv
import io
import math
import re

import pandas as pd
from rapidfuzz import fuzz

from .settings_store import metric_map, norm_header

MISSING_TOKENS = {"", "-", "--", "—", "–", "n/a", "na", "null", "none", "nil", "#n/a", "nan"}
DURATION_UNITS = {
    "minutes": "Minutes (e.g. 92.5)",
    "seconds": "Seconds (e.g. 5550)",
    "hours": "Hours (e.g. 1.5)",
    "hh:mm:ss": "Hours:minutes:seconds (1:32:30)",
    "mm:ss": "Minutes:seconds (92:30)",
    "hh:mm": "Hours:minutes (1:32)",
    "text": "Text (1h 32m 30s)",
}
TOTAL_WORDS = {"total", "totals", "grand total", "sum", "overall", "all agents"}
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
_TEXT_DUR = re.compile(
    r"^\s*(?:(\d+(?:\.\d+)?)\s*h(?:r|rs|our|ours)?)?\s*(?:(\d+(?:\.\d+)?)\s*m(?:in|ins|inute|inutes)?)?"
    r"\s*(?:(\d+(?:\.\d+)?)\s*s(?:ec|ecs|econd|econds)?)?\s*$", re.I)


class ParseError(ValueError):
    pass


def is_missing(v) -> bool:
    if v is None:
        return True
    if isinstance(v, float) and math.isnan(v):
        return True
    return str(v).strip().lower() in MISSING_TOKENS


def parse_number(v) -> float | None:
    if is_missing(v):
        return None
    if isinstance(v, (int, float)):
        return float(v)
    t = str(v).strip().replace(",", "").replace("%", "").replace(" ", "").replace("−", "-")
    try:
        x = float(t)
    except ValueError:
        raise ParseError(f"'{v}' is not a number")
    if math.isnan(x) or math.isinf(x):
        raise ParseError(f"'{v}' is not a number")
    return x


def parse_duration_minutes(v, unit: str | None) -> float | None:
    """Convert a time value to minutes using the confirmed source unit."""
    if is_missing(v):
        return None
    t = str(v).strip()
    if ":" in t:
        try:
            parts = [float(p) for p in t.split(":")]
        except ValueError:
            raise ParseError(f"'{v}' is not a time value")
        if len(parts) == 3:
            h, m, s = parts
            return h * 60 + m + s / 60
        if len(parts) == 2:
            a, b = parts
            if unit == "hh:mm":
                return a * 60 + b
            if unit == "mm:ss":
                return a + b / 60
            raise ParseError(f"'{v}' could be mm:ss or hh:mm; choose the unit for this column")
        raise ParseError(f"'{v}' is not a time value")
    if re.search(r"[a-z]", t, re.I):
        m = _TEXT_DUR.match(t)
        if not m or not any(m.groups()):
            raise ParseError(f"'{v}' is not a time value")
        h, mi, s = (float(g) if g else 0.0 for g in m.groups())
        return h * 60 + mi + s / 60
    x = parse_number(t)
    if unit == "seconds":
        return x / 60
    if unit == "hours":
        return x * 60
    if unit in ("minutes", "text", None):
        return x
    if x == 0:
        return 0.0
    raise ParseError(f"'{v}' is a plain number but the column unit is {unit}")


def guess_duration_unit(values: list) -> tuple[str, bool]:
    """Returns (unit, certain). Only unambiguous formats are certain; the rest need confirmation."""
    vals = [str(v).strip() for v in values if not is_missing(v)]
    if not vals:
        return "minutes", False
    colon = [v for v in vals if ":" in v]
    if colon:
        if all(len(v.split(":")) == 3 for v in colon):
            return "hh:mm:ss", True
        return "mm:ss", False
    if any(re.search(r"[a-z]", v, re.I) for v in vals):
        return "text", True
    nums = []
    for v in vals:
        try:
            nums.append(parse_number(v))
        except ParseError:
            pass
    if nums and max(nums) > 600:
        return "seconds", False
    return "minutes", False


# ---------------------------------------------------------------- CSV file

def read_csv_bytes(raw: bytes) -> dict:
    text = None
    for enc in ("utf-8-sig", "cp1252", "latin-1"):
        try:
            text = raw.decode(enc)
            encoding = enc
            break
        except UnicodeDecodeError:
            continue
    if text is None or not text.strip():
        raise ParseError("The file is empty or not a text CSV.")
    sample = text[:8192]
    try:
        delimiter = csv.Sniffer().sniff(sample, delimiters=",;\t|").delimiter
    except csv.Error:
        delimiter = ","
    try:
        df = pd.read_csv(io.StringIO(text), sep=delimiter, dtype=str, keep_default_na=False,
                         skip_blank_lines=True, engine="python")
    except Exception as e:  # pandas raises many types
        raise ParseError(f"Could not read the CSV: {e}")
    df.columns = [str(c).strip() for c in df.columns]
    df = df.fillna("")
    df = df[~(df.apply(lambda r: all(str(x).strip() == "" for x in r), axis=1))]
    if df.shape[1] < 2 or df.shape[0] < 1:
        raise ParseError("The CSV needs a header row, at least two columns and one data row.")
    headers = [("" if c.startswith("Unnamed:") else c) for c in df.columns]
    rows = [[str(x).strip() for x in r] for r in df.itertuples(index=False, name=None)]
    return {"headers": headers, "rows": rows, "delimiter": delimiter, "encoding": encoding, "row_count": len(rows)}


def csv_table(parsed: dict) -> tuple[list, list]:
    """CSV rows as cells, the same shape screenshot tables use."""
    rows = [[{"text": v, "confidence": None} for v in r] for r in parsed["rows"]]
    return parsed["headers"], rows


# ---------------------------------------------------------------- header mapping

def _alias_score(header: str, aliases: list[str]) -> float:
    h = norm_header(header)
    if not h:
        return 0.0
    best = 0.0
    for a in aliases:
        a = norm_header(a)
        if h == a:
            return 1.0
        if len(a) > 3 and (f" {a} " in f" {h} "):
            best = max(best, 0.9)
        best = max(best, fuzz.ratio(h, a) / 100 * 0.95)
    return best


def auto_map(kind: str, headers: list[str], rows: list[list], settings: dict) -> list[dict]:
    """Suggest a field for each column. Remembered choices win; then header aliases.
    Nothing is mapped below 85% similarity, so unknown columns stay for the user to map."""
    mm = metric_map(settings)
    memory = settings["column_memory"].get(kind, {})
    mapping = [{"field": "__ignore__", "unit": None, "unit_confirmed": False, "auto": True} for _ in headers]
    taken = set()

    for i, h in enumerate(headers):
        mem = memory.get(norm_header(h))
        if mem and (mem.get("field") in mm or mem.get("field", "").startswith("__")) and mem["field"] not in taken:
            mapping[i] = {"field": mem["field"], "unit": mem.get("unit"),
                          "unit_confirmed": bool(mem.get("unit_confirmed")), "auto": True, "remembered": True}
            if mem["field"] != "__ignore__":
                taken.add(mem["field"])

    candidates = []
    for field, aliases in settings["aliases"].items():
        if field not in mm and not field.startswith("__"):
            continue
        for i, h in enumerate(headers):
            if mapping[i].get("remembered"):
                continue
            s = _alias_score(h, aliases)
            if s >= 0.85:
                candidates.append((s, i, field))
    for s, i, field in sorted(candidates, reverse=True):
        if field in taken or mapping[i]["field"] != "__ignore__":
            continue
        mapping[i]["field"] = field
        taken.add(field)

    # Email column by content when the header did not say so
    if "__email__" not in taken:
        for i in range(len(headers)):
            if mapping[i]["field"] != "__ignore__":
                continue
            vals = [r[i]["text"] for r in rows[:200] if i < len(r) and not is_missing(r[i]["text"])]
            if vals and sum(bool(EMAIL_RE.match(str(v))) for v in vals) / len(vals) > 0.8:
                mapping[i]["field"] = "__email__"
                taken.add("__email__")
                break

    for i, m in enumerate(mapping):
        f = m["field"]
        if f in mm and mm[f]["kind"] == "duration" and not m.get("remembered"):
            unit, certain = guess_duration_unit([r[i]["text"] for r in rows[:300] if i < len(r)])
            m["unit"], m["unit_confirmed"] = unit, certain
    return mapping


def remember_mapping(settings: dict, kind: str, headers: list[str], mapping: list[dict]) -> None:
    mem = settings["column_memory"].setdefault(kind, {})
    for h, m in zip(headers, mapping):
        key = norm_header(h)
        if key:
            mem[key] = {"field": m.get("field"), "unit": m.get("unit"), "unit_confirmed": bool(m.get("unit_confirmed"))}
