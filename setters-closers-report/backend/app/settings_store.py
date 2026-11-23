"""Configurable settings: metrics, thresholds, header aliases, classification, colours.

Everything here can be edited from the Settings page; these are only the starting values.
"""
import copy
import re

from sqlalchemy.orm import Session

from .db import Setting

SYSTEM_FIELDS = {
    "__name__": "Agent name",
    "__email__": "Agent email",
    "__team__": "Team / role",
    "__ignore__": "Ignore this column",
}
SOURCES = ("csv", "booking", "cc", "derived")
KINDS = ("count", "duration", "number", "percent")

DEFAULT_SETTINGS = {
    "report_title": "Daily Setters & Closers Performance Report",
    "slots": [
        {"value": "14:00", "label": "2:00 PM"},
        {"value": "17:00", "label": "5:00 PM"},
        {"value": "19:00", "label": "7:00 PM"},
        {"value": "21:00", "label": "9:00 PM"},
    ],
    # Order here = column order in every report table.
    "metrics": [
        {"key": "total_calls", "label": "Total Calls", "source": "csv", "kind": "count", "visible": True,
         "threshold": {"enabled": False, "value": 0}, "call_log": "count", "show_total": True, "show_average": True},
        {"key": "talk_time", "label": "Talk Time (TT)", "source": "csv", "kind": "duration", "visible": True,
         "threshold": {"enabled": True, "value": 90}, "call_log": "sum", "show_total": True, "show_average": True},
        {"key": "host_time", "label": "Host Time", "source": "csv", "kind": "duration", "visible": True,
         "threshold": {"enabled": True, "value": 90}, "call_log": "sum", "show_total": True, "show_average": True},
        {"key": "bookings", "label": "Bookings", "source": "booking", "kind": "count", "visible": True,
         "threshold": {"enabled": True, "value": 5}, "call_log": "sum", "show_total": True, "show_average": True},
        {"key": "conversion_rate", "label": "Conversion Rate", "source": "derived", "kind": "percent", "visible": True,
         "threshold": {"enabled": False, "value": 0},
         "formula": {"numerator": "bookings", "denominator": "total_calls", "multiplier": 100},
         "show_total": True, "show_average": False},
    ],
    # Header names that map automatically. Matching ignores case, spaces and punctuation.
    "aliases": {
        "__name__": ["agent name", "agent", "name", "user", "user name", "username", "caller", "caller name",
                     "employee", "employee name", "setter name", "closer name", "full name", "member", "rep"],
        "__email__": ["email", "agent email", "user email", "email id", "email address", "mail id"],
        "__team__": ["team", "team name", "group", "role", "department", "designation"],
        "total_calls": ["total calls", "calls", "no of calls", "number of calls", "calls made", "dialed",
                        "dialled", "outbound calls", "total dials"],
        "talk_time": ["talk time", "tt", "total talk time", "talktime", "talk duration", "tt in min", "total tt"],
        "host_time": ["host time", "total host time", "hosttime", "host duration"],
        "bookings": ["bookings", "booking", "booked", "total bookings", "no of bookings", "meetings booked"],
    },
    "classification": {
        "setter_keywords": ["setter", "pre sales", "presales", "pre-sales"],
        "closer_keywords": ["closer", "closing"],
    },
    # What a screenshot that does not list an agent means. "na" = unknown (N/A); "zero" = 0.
    "absent_in_screenshot": {"booking": "na", "cc": "na"},
    "formatting": {"below_bg": "#FDE8E8", "below_text": "#9B2C2C", "met_bg": "#E3F5E9", "met_text": "#1F6B3A"},
    "sorting": {"primary": "bookings", "secondary": "talk_time"},
    "duration_decimals": 1,
    "ocr": {"confidence_threshold": 0.9},
    "matching": {"suggest_min": 0.6},
    # Remembered header -> field/unit choices, per upload kind, so mapping is a one-time job.
    "column_memory": {"csv": {}, "booking": {}, "cc": {}},
}


class SettingsError(ValueError):
    pass


def norm_header(h: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", str(h or "").lower()).strip()


def slugify(label: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "_", label.lower()).strip("_")
    return s or "metric"


def _merge_defaults(data: dict) -> dict:
    out = copy.deepcopy(data)
    for k, v in DEFAULT_SETTINGS.items():
        if k not in out:
            out[k] = copy.deepcopy(v)
        elif isinstance(v, dict) and isinstance(out[k], dict) and k not in ("aliases", "column_memory"):
            for kk, vv in v.items():
                out[k].setdefault(kk, copy.deepcopy(vv))
    for kind in ("csv", "booking", "cc"):
        out["column_memory"].setdefault(kind, {})
    return out


def load_settings(db: Session) -> dict:
    row = db.get(Setting, 1)
    if row is None:
        row = Setting(id=1, data=copy.deepcopy(DEFAULT_SETTINGS))
        db.add(row)
        db.commit()
    return _merge_defaults(row.data)


def validate_settings(data: dict) -> dict:
    data = _merge_defaults(data)
    keys = set()
    for m in data["metrics"]:
        m["label"] = str(m.get("label", "")).strip()
        if not m["label"]:
            raise SettingsError("Every metric needs a name.")
        m["key"] = m.get("key") or slugify(m["label"])
        if m["key"].startswith("__") or m["key"] in keys:
            raise SettingsError(f"Metric key '{m['key']}' is used twice.")
        keys.add(m["key"])
        if m.get("source") not in SOURCES:
            raise SettingsError(f"{m['label']}: source must be one of {', '.join(SOURCES)}.")
        if m.get("kind") not in KINDS:
            raise SettingsError(f"{m['label']}: type must be one of {', '.join(KINDS)}.")
        th = m.get("threshold") or {}
        m["threshold"] = {"enabled": bool(th.get("enabled")), "value": float(th.get("value") or 0)}
        m.setdefault("visible", True)
        m.setdefault("call_log", "sum")
        m.setdefault("show_total", m["kind"] != "percent")
        m.setdefault("show_average", True)
    for m in data["metrics"]:
        if m["source"] == "derived":
            f = m.get("formula") or {}
            for part in ("numerator", "denominator"):
                if f.get(part) not in keys or f.get(part) == m["key"]:
                    raise SettingsError(f"{m['label']}: choose a valid {part} metric.")
            f["multiplier"] = float(f.get("multiplier") or 1)
            m["formula"] = f
    for part in ("primary", "secondary"):
        if data["sorting"].get(part) not in keys:
            data["sorting"][part] = next(iter(keys), None)
    return data


def save_settings(db: Session, data: dict) -> dict:
    data = validate_settings(data)
    row = db.get(Setting, 1)
    if row is None:
        row = Setting(id=1, data=data)
        db.add(row)
    else:
        row.data = copy.deepcopy(data)
    db.commit()
    return data


def metric_map(settings: dict) -> dict:
    return {m["key"]: m for m in settings["metrics"]}


def field_options(settings: dict) -> list[dict]:
    opts = [{"value": k, "label": v, "system": True} for k, v in SYSTEM_FIELDS.items()]
    for m in settings["metrics"]:
        if m["source"] != "derived":
            opts.append({"value": m["key"], "label": m["label"], "kind": m["kind"], "source": m["source"]})
    return opts
