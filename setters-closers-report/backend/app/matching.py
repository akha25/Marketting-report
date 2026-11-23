"""Agent name normalisation and matching.

Only exact matches (same email, same normalised name, or a name the user has already
confirmed as an alias) are applied automatically. Fuzzy matches are suggestions that the
user must confirm.
"""
import re
import unicodedata

from rapidfuzz import fuzz

_TITLES = {"mr", "mrs", "ms", "miss", "dr", "sir", "madam"}


def normalize_name(name: str | None) -> str:
    if not name:
        return ""
    s = unicodedata.normalize("NFKD", str(name)).encode("ascii", "ignore").decode()
    s = s.strip()
    if s.count(",") == 1:  # "Sharma, Priya" -> "Priya Sharma"
        last, first = [p.strip() for p in s.split(",")]
        if first and last and " " not in last:
            s = f"{first} {last}"
    s = re.sub(r"[^a-zA-Z0-9]+", " ", s).lower().strip()
    parts = s.split()
    while parts and parts[0] in _TITLES:
        parts = parts[1:]
    return " ".join(parts)


def _tok_sim(x: str, y: str) -> float:
    if x == y:
        return 1.0
    if len(x) == 1 or len(y) == 1:  # initial: "priya s" vs "priya sharma"
        return 0.9 if x[0] == y[0] else 0.0
    return fuzz.ratio(x, y) / 100


def _score(a: str, b: str) -> float:
    """Every word of the shorter name must closely match a word of the other name.
    Sharing one word ("Priya Sharma" / "Neha Sharma") is not enough."""
    ta, tb = a.split(), b.split()
    if not ta or not tb:
        return 0.0
    if len(ta) > len(tb):
        ta, tb = tb, ta
    if len(ta) == 1 and len(tb) > 1:  # first name only
        return 0.8 * _tok_sim(ta[0], tb[0])
    best = [max(_tok_sim(t, u) for u in tb) for t in ta]
    if min(best) < 0.75:
        return 0.0
    s = sum(best) / len(best)
    if len(ta) != len(tb):
        s *= 0.9
    return s


def match_record(name: str | None, email: str | None, agents: list[dict], suggest_min: float = 0.6,
                 prefer_ids: set | None = None, exclude_ids: set | None = None,
                 exact_only: bool = False) -> dict:
    """agents: [{id, name, normalized, email, aliases}] -> match result."""
    email = (email or "").strip().lower() or None
    nn = normalize_name(name)
    exclude_ids = exclude_ids or set()
    pool = [a for a in agents if a["id"] not in exclude_ids]
    if email:
        for a in pool:
            if a["email"] and a["email"].lower() == email:
                return {"status": "auto", "agent_id": a["id"], "score": 1.0, "reason": "same email", "candidates": []}
    if nn:
        exact = [a for a in pool if (a["normalized"] == nn or nn in (a.get("aliases") or []))
                 and not (email and a["email"] and a["email"].lower() != email)]
        if len(exact) == 1:
            return {"status": "auto", "agent_id": exact[0]["id"], "score": 1.0, "reason": "same name", "candidates": []}
        if len(exact) > 1:
            cands = [{"agent_id": a["id"], "name": a["name"], "score": 1.0} for a in exact]
            return {"status": "suggested", "agent_id": None, "score": 1.0,
                    "reason": "several agents share this name", "candidates": cands}
    if exact_only:
        return {"status": "pending", "agent_id": None, "score": 0.0, "reason": "", "candidates": []}
    scored = []
    for a in pool:
        if email and a["email"] and a["email"].lower() != email:
            continue  # different emails: different people
        s = max([_score(nn, a["normalized"])] + [_score(nn, al) for al in (a.get("aliases") or [])])
        if prefer_ids and a["id"] in prefer_ids and s > 0:
            s = min(1.0, s + 0.03)
        if s >= suggest_min:
            scored.append({"agent_id": a["id"], "name": a["name"], "score": round(s, 3)})
    scored.sort(key=lambda c: -c["score"])
    if scored:
        return {"status": "suggested", "agent_id": None, "score": scored[0]["score"],
                "reason": "similar name", "candidates": scored[:4]}
    return {"status": "unmatched", "agent_id": None, "score": 0.0, "reason": "no similar name", "candidates": []}


def classify_team(team: str | None, settings: dict) -> str | None:
    if not team:
        return None
    t = " " + re.sub(r"[^a-z0-9]+", " ", team.lower()) + " "
    cls = settings["classification"]
    hit_s = any(f" {re.sub(r'[^a-z0-9]+', ' ', k.lower()).strip()} " in t for k in cls.get("setter_keywords", []) if k.strip())
    hit_c = any(f" {re.sub(r'[^a-z0-9]+', ' ', k.lower()).strip()} " in t for k in cls.get("closer_keywords", []) if k.strip())
    if hit_s and not hit_c:
        return "setter"
    if hit_c and not hit_s:
        return "closer"
    return None
