import sqlite3
from copy import deepcopy

import pytest

from openround import db


def _columns(con, table):
    return {row[1] for row in con.execute(f"PRAGMA table_info({table})")}


def test_schema_contains_immutable_evidence_and_shot_links(con):
    evidence_columns = _columns(con, "shot_evidence")
    assert {
        "source",
        "source_round_id",
        "event_key",
        "source_event_id",
        "fingerprint",
        "canonical_json",
        "canonical_sha256",
        "created_at",
    } <= evidence_columns
    assert {"source_event_id", "evidence_id"} <= _columns(con, "shots")
    assert con.execute("PRAGMA user_version").fetchone()[0] == 1


def test_shot_evidence_rejects_update_and_delete(con):
    con.execute(
        "INSERT INTO shot_evidence "
        "(source, source_round_id, event_key, fingerprint, canonical_json, canonical_sha256) "
        "VALUES ('test', 'r1', 'fingerprint:x', 'x', '{}', 'x')"
    )
    with pytest.raises(sqlite3.IntegrityError, match="shot evidence is immutable"):
        con.execute("UPDATE shot_evidence SET canonical_json = '{\"changed\"}' WHERE id = 1")
    with pytest.raises(sqlite3.IntegrityError, match="shot evidence is immutable"):
        con.execute("DELETE FROM shot_evidence WHERE id = 1")


def test_legacy_rows_remain_readable_without_fabricated_evidence(tmp_path):
    path = tmp_path / "legacy.db"
    legacy = sqlite3.connect(path)
    legacy.executescript(
        """
        CREATE TABLE rounds (
            id INTEGER PRIMARY KEY,
            source TEXT NOT NULL,
            source_id TEXT,
            played_at TEXT NOT NULL,
            course TEXT,
            tees TEXT,
            holes INTEGER,
            score INTEGER,
            putts INTEGER,
            UNIQUE (source, source_id)
        );
        CREATE TABLE holes (
            id INTEGER PRIMARY KEY,
            round_id INTEGER NOT NULL,
            number INTEGER NOT NULL,
            par INTEGER,
            strokes INTEGER,
            putts INTEGER,
            fairway TEXT,
            gir INTEGER,
            penalties INTEGER NOT NULL DEFAULT 0,
            up_and_down TEXT,
            pin_lat REAL,
            pin_lon REAL,
            UNIQUE (round_id, number)
        );
        CREATE TABLE shots (
            id INTEGER PRIMARY KEY,
            round_id INTEGER NOT NULL,
            hole INTEGER,
            seq INTEGER,
            club TEXT,
            lat REAL,
            lon REAL,
            end_lat REAL,
            end_lon REAL,
            distance_m REAL,
            distance_type TEXT,
            lie TEXT,
            end_lie TEXT,
            remaining_m REAL,
            positional INTEGER NOT NULL DEFAULT 0,
            lost_ball INTEGER NOT NULL DEFAULT 0,
            water_hazard INTEGER NOT NULL DEFAULT 0,
            timestamp TEXT,
            temperature_c REAL,
            source TEXT NOT NULL DEFAULT 'shotscope'
        );
        INSERT INTO rounds (source, played_at) VALUES ('legacy', '2026-08-01');
        INSERT INTO shots (round_id, hole, seq, club) VALUES (1, 1, 1, 'Driver');
        """
    )
    legacy.commit()
    legacy.close()

    con = db.connect(path)
    round_row = con.execute("SELECT source_id FROM rounds WHERE id = 1").fetchone()
    shot_row = con.execute("SELECT club, evidence_id FROM shots WHERE id = 1").fetchone()
    assert round_row[0] is None
    assert shot_row[0] == "Driver"
    assert shot_row[1] is None
    assert con.execute("SELECT COUNT(*) FROM shot_evidence").fetchone()[0] == 0


def test_import_and_reimport_is_idempotent(con, fixture_round):
    rid1 = db.upsert_round(con, fixture_round)
    rid2 = db.upsert_round(con, fixture_round)
    assert rid1 == rid2
    assert con.execute("SELECT COUNT(*) FROM rounds").fetchone()[0] == 1
    assert con.execute("SELECT COUNT(*) FROM holes").fetchone()[0] == 9
    assert con.execute("SELECT COUNT(*) FROM shots").fetchone()[0] == 2


def test_score_summed_from_holes(con, fixture_round):
    rid = db.upsert_round(con, fixture_round)
    rnd = con.execute("SELECT * FROM rounds WHERE id = ?", (rid,)).fetchone()
    assert rnd["score"] == 41
    assert rnd["holes"] == 9


def test_distinct_source_ids_are_distinct_rounds(con, fixture_round):
    db.upsert_round(con, fixture_round)
    second = dict(fixture_round, source_id="r2", played_at="2026-08-24")
    db.upsert_round(con, second)
    assert con.execute("SELECT COUNT(*) FROM rounds").fetchone()[0] == 2


def test_import_rounds_is_atomic_when_later_round_is_malformed(con, fixture_round):
    bad = dict(fixture_round, source_id="bad", holes=[{"number": 0, "shots": []}])
    with pytest.raises(db.ImportValidationError):
        db.import_rounds(con, [fixture_round, bad])
    assert con.execute("SELECT COUNT(*) FROM rounds").fetchone()[0] == 0
    assert con.execute("SELECT COUNT(*) FROM shot_evidence").fetchone()[0] == 0


def test_same_hole_identical_fallback_events_fail_closed(con, fixture_round):
    duplicate = deepcopy(fixture_round)
    duplicate_shot = deepcopy(duplicate["holes"][0]["shots"][0])
    duplicate_shot["seq"] = 3
    duplicate["holes"][0]["shots"].append(duplicate_shot)
    with pytest.raises(db.ImportValidationError, match="ambiguous fallback"):
        db.upsert_round(con, duplicate)


def test_reimport_reuses_immutable_evidence(con, fixture_round):
    rid = db.upsert_round(con, fixture_round)
    first = con.execute(
        "SELECT id, canonical_json, canonical_sha256 FROM shot_evidence ORDER BY id"
    ).fetchall()
    assert first
    assert db.upsert_round(con, deepcopy(fixture_round)) == rid
    second = con.execute(
        "SELECT id, canonical_json, canonical_sha256 FROM shot_evidence ORDER BY id"
    ).fetchall()
    assert [tuple(row) for row in second] == [tuple(row) for row in first]


def test_changed_explicit_event_evidence_is_rejected(con, fixture_round):
    first = deepcopy(fixture_round)
    first["holes"][0]["shots"][0]["source_event_id"] = "evt-1"
    db.upsert_round(con, first)
    changed = deepcopy(first)
    changed["holes"][0]["shots"][0]["distance_m"] = 216.0
    with pytest.raises(db.ImportValidationError, match="immutable evidence"):
        db.upsert_round(con, changed)


def test_new_idless_import_is_rejected(con, fixture_round):
    with pytest.raises(db.ImportValidationError, match="source_id"):
        db.upsert_round(con, dict(fixture_round, source_id=None))


def test_zero_putts_imports_but_negative_putts_is_rejected(con, fixture_round):
    zero_putts = deepcopy(fixture_round)
    zero_putts["holes"][0]["putts"] = 0
    rid = db.upsert_round(con, zero_putts)
    assert con.execute(
        "SELECT putts FROM holes WHERE round_id = ? AND number = 1", (rid,)
    ).fetchone()[0] == 0

    negative_putts = deepcopy(fixture_round)
    negative_putts["holes"][0]["putts"] = -1
    with pytest.raises(db.ImportValidationError, match="putts"):
        db.upsert_round(con, negative_putts)


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("seq", 0),
        ("distance_m", -1),
        ("remaining_m", -1),
    ],
)
def test_invalid_shot_values_are_rejected(con, fixture_round, field, value):
    invalid = deepcopy(fixture_round)
    invalid["holes"][0]["shots"][0][field] = value
    with pytest.raises(db.ImportValidationError):
        db.upsert_round(con, invalid)


def test_duplicate_sequence_is_rejected(con, fixture_round):
    invalid = deepcopy(fixture_round)
    invalid["holes"][0]["shots"][1]["seq"] = 1
    with pytest.raises(db.ImportValidationError, match="duplicate sequence"):
        db.upsert_round(con, invalid)


def test_later_conflict_rolls_back_earlier_round(con, fixture_round):
    existing = deepcopy(fixture_round)
    existing["source_id"] = "existing"
    existing["holes"][0]["shots"][0]["source_event_id"] = "evt-existing"
    db.upsert_round(con, existing)

    first = deepcopy(fixture_round)
    first["source_id"] = "new"
    changed_existing = deepcopy(existing)
    changed_existing["holes"][0]["shots"][0]["distance_m"] = 999.0
    with pytest.raises(db.ImportValidationError, match="immutable evidence"):
        db.import_rounds(con, [first, changed_existing])
    assert [tuple(row) for row in con.execute(
        "SELECT source_id FROM rounds ORDER BY source_id"
    ).fetchall()] == [("existing",)]
