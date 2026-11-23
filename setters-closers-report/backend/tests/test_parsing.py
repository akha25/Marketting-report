import pytest

from app.matching import classify_team, match_record, normalize_name
from app.parsing import (ParseError, guess_duration_unit, parse_duration_minutes, parse_number,
                         read_csv_bytes)
from app.settings_store import DEFAULT_SETTINGS


def test_missing_is_not_zero():
    assert parse_number("") is None
    assert parse_number("N/A") is None
    assert parse_number("0") == 0.0
    assert parse_number("1,234") == 1234.0
    with pytest.raises(ParseError):
        parse_number("7s")  # an OCR misread is an error, never a guess


def test_durations_to_minutes():
    assert parse_duration_minutes("1:30:00", None) == 90
    assert parse_duration_minutes("90:30", "mm:ss") == 90.5
    assert parse_duration_minutes("1:30", "hh:mm") == 90
    assert parse_duration_minutes("5400", "seconds") == 90
    assert parse_duration_minutes("1.5", "hours") == 90
    assert parse_duration_minutes("1h 30m", "text") == 90
    assert parse_duration_minutes("", "minutes") is None
    with pytest.raises(ParseError):
        parse_duration_minutes("90:30", None)  # ambiguous without a unit


def test_unit_guess_needs_confirmation_when_ambiguous():
    assert guess_duration_unit(["1:02:03", "0:45:00"]) == ("hh:mm:ss", True)
    assert guess_duration_unit(["92", "105"]) == ("minutes", False)
    assert guess_duration_unit(["5400", "3600"]) == ("seconds", False)


def test_csv_reader_semicolon_and_bom():
    raw = "﻿Agent;Calls\nA;3\nB;\n".encode("utf-8")
    p = read_csv_bytes(raw)
    assert p["headers"] == ["Agent", "Calls"] and p["rows"] == [["A", "3"], ["B", ""]]


def test_names_and_matching():
    assert normalize_name("  Mr. Setter   ALPHA ") == "setter alpha"
    assert normalize_name("Alpha, Setter") == "setter alpha"
    agents = [{"id": 1, "name": "Setter Alpha", "normalized": "setter alpha", "email": "a@x.com", "aliases": []},
              {"id": 2, "name": "Setter Charlie", "normalized": "setter charlie", "email": None, "aliases": []}]
    assert match_record("anything", "A@X.com", agents)["agent_id"] == 1
    assert match_record("setter alpha", None, agents)["status"] == "auto"
    m = match_record("Setter Charly", None, agents)
    assert m["status"] == "suggested" and m["candidates"][0]["agent_id"] == 2  # fuzzy is never automatic
    assert match_record("Zulu", None, agents)["status"] == "unmatched"
    # sharing one word is not a match
    people = [{"id": 9, "name": "Priya Sharma", "normalized": "priya sharma", "email": None, "aliases": []}]
    assert match_record("Neha Sharma", None, people)["status"] == "unmatched"
    assert match_record("Priya S", None, people)["status"] == "suggested"
    assert match_record("Sharma Priya", None, people)["status"] == "suggested"
    assert match_record("Priya Sharma", "p@x.com", people)["status"] == "auto"


def test_team_classification():
    assert classify_team("Setter Team", DEFAULT_SETTINGS) == "setter"
    assert classify_team("Closer Team", DEFAULT_SETTINGS) == "closer"
    assert classify_team("Ops", DEFAULT_SETTINGS) is None
