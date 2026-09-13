"""SQLite storage for the OpenRound open schema."""

from __future__ import annotations

import json
import math
import sqlite3
from collections.abc import Iterable, Mapping
from pathlib import Path

from .identity import IdentityError, ShotIdentity, identity_for_shot

DEFAULT_DB = Path(__file__).resolve().parents[2] / "data" / "openround.db"
_SCHEMA = (Path(__file__).with_name("schema.sql")).read_text()


class ImportValidationError(ValueError):
    """Raised when a normalized import is malformed or conflicts with evidence."""


def connect(path: str | Path = DEFAULT_DB) -> sqlite3.Connection:
    """Open (and if needed create) the database, applying the schema idempotently."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(path)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA foreign_keys = ON")
    con.executescript(_SCHEMA)
    _migrate(con)
    return con


def _migrate(con: sqlite3.Connection) -> None:
    """Add Slice A columns without fabricating evidence for legacy rows."""
    con.execute("BEGIN")
    try:
        columns = {
            row[1] for row in con.execute("PRAGMA table_info(shots)").fetchall()
        }
        if "source_event_id" not in columns:
            con.execute("ALTER TABLE shots ADD COLUMN source_event_id TEXT")
        if "evidence_id" not in columns:
            con.execute(
                "ALTER TABLE shots ADD COLUMN evidence_id INTEGER REFERENCES shot_evidence(id)"
            )
        con.execute("PRAGMA user_version = 1")
    except Exception:
        con.rollback()
        raise
    else:
        con.commit()


def import_rounds(con: sqlite3.Connection, rounds: Iterable[Mapping]) -> list[int]:
    """Validate and replace a complete normalized round batch atomically."""
    validated = _validate_rounds(rounds)
    con.execute("BEGIN IMMEDIATE")
    try:
        round_ids = [_import_one(con, rnd, identities) for rnd, identities in validated]
    except ImportValidationError:
        con.rollback()
        raise
    except (sqlite3.IntegrityError, sqlite3.Error) as exc:
        con.rollback()
        raise ImportValidationError(str(exc)) from exc
    except Exception:
        con.rollback()
        raise
    else:
        con.commit()
        return round_ids


def upsert_round(con: sqlite3.Connection, rnd: Mapping) -> int:
    """Validate and replace one normalized round."""
    return import_rounds(con, [rnd])[0]


def _validate_rounds(rounds: Iterable[Mapping]) -> list[tuple[Mapping, dict[tuple[int, int], ShotIdentity]]]:
    try:
        materialized = list(rounds)
    except TypeError as exc:
        raise ImportValidationError("rounds must be an iterable") from exc

    validated = []
    round_keys: set[tuple[str, str]] = set()
    event_keys: set[tuple[str, str, str]] = set()
    for index, rnd in enumerate(materialized, start=1):
        if not isinstance(rnd, Mapping):
            raise ImportValidationError(f"round {index} must be an object")
        _validate_json(rnd, f"round {index}")
        source = _required_text(rnd, "source", f"round {index}")
        source_id = _required_text(rnd, "source_id", f"round {index}")
        _required_text(rnd, "played_at", f"round {index}")
        round_key = (source, source_id)
        if round_key in round_keys:
            raise ImportValidationError("duplicate round identity")
        round_keys.add(round_key)

        holes = rnd.get("holes", [])
        if not isinstance(holes, list):
            raise ImportValidationError(f"round {index} holes must be a list")
        _validate_positive(rnd.get("score"), "score", allow_none=True)
        _validate_nonnegative(rnd.get("putts_total"), "putts_total", allow_none=True)
        _validate_positive(rnd.get("hole_count"), "hole_count", allow_none=True)
        seen_holes: set[int] = set()
        identities: dict[tuple[int, int], ShotIdentity] = {}
        for hole_index, hole in enumerate(holes, start=1):
            if not isinstance(hole, Mapping):
                raise ImportValidationError(f"round {index} hole {hole_index} must be an object")
            number = hole.get("number")
            if not _positive_int(number):
                raise ImportValidationError("hole number must be positive")
            if number in seen_holes:
                raise ImportValidationError("duplicate hole number")
            seen_holes.add(number)
            for field in ("par", "strokes"):
                _validate_positive(hole.get(field), field, allow_none=True)
            _validate_nonnegative(hole.get("putts"), "putts", allow_none=True)
            _validate_nonnegative(hole.get("penalties"), "penalties", allow_none=True)
            shots = hole.get("shots", [])
            if shots is None:
                shots = []
            if not isinstance(shots, list):
                raise ImportValidationError(f"hole {number} shots must be a list")
            seen_sequences: set[int] = set()
            seen_fallbacks: set[str] = set()
            for shot_index, shot in enumerate(shots, start=1):
                if not isinstance(shot, Mapping):
                    raise ImportValidationError(f"hole {number} shot {shot_index} must be an object")
                seq = shot.get("seq")
                if seq is not None:
                    if not _positive_int(seq):
                        raise ImportValidationError("shot sequence must be positive")
                    if seq in seen_sequences:
                        raise ImportValidationError("duplicate sequence")
                    seen_sequences.add(seq)
                _validate_positive(shot.get("distance_m"), "distance_m", allow_none=True)
                _validate_nonnegative(shot.get("remaining_m"), "remaining_m", allow_none=True)
                if "source_event_id" in shot and not str(shot["source_event_id"] or "").strip():
                    raise ImportValidationError("source_event_id must not be blank")
                try:
                    identity = identity_for_shot(source, source_id, number, shot)
                except IdentityError as exc:
                    raise ImportValidationError(str(exc)) from exc
                event_key = (source, source_id, identity.event_key)
                if event_key in event_keys:
                    if identity.fingerprint and identity.event_key in seen_fallbacks:
                        raise ImportValidationError("ambiguous fallback event in same hole")
                    raise ImportValidationError("duplicate event identity")
                event_keys.add(event_key)
                if identity.fingerprint:
                    seen_fallbacks.add(identity.event_key)
                identities[(number, shot_index)] = identity
        validated.append((rnd, identities))
    return validated


def _import_one(
    con: sqlite3.Connection,
    rnd: Mapping,
    identities: dict[tuple[int, int], ShotIdentity],
) -> int:
    source = str(rnd["source"]).strip()
    source_id = str(rnd["source_id"]).strip()
    holes = rnd.get("holes", [])
    score = rnd.get("score")
    if score is None:
        score = _total_strokes(holes)

    existing = con.execute(
        "SELECT id FROM rounds WHERE source = ? AND source_id = ?",
        (source, source_id),
    ).fetchone()
    if existing:
        round_id = existing["id"]
        con.execute("DELETE FROM shots WHERE round_id = ?", (round_id,))
        con.execute("DELETE FROM holes WHERE round_id = ?", (round_id,))
        con.execute(
            "UPDATE rounds SET played_at=?, course=?, tees=?, holes=?, score=?, putts=? WHERE id=?",
            (
                rnd["played_at"],
                rnd.get("course"),
                rnd.get("tees"),
                len(holes) or rnd.get("hole_count"),
                score,
                rnd.get("putts_total"),
                round_id,
            ),
        )
    else:
        cur = con.execute(
            "INSERT INTO rounds (source, source_id, played_at, course, tees, holes, score, putts)"
            " VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (
                source,
                source_id,
                rnd["played_at"],
                rnd.get("course"),
                rnd.get("tees"),
                len(holes) or rnd.get("hole_count"),
                score,
                rnd.get("putts_total"),
            ),
        )
        round_id = cur.lastrowid

    for hole in holes:
        number = hole["number"]
        con.execute(
            "INSERT INTO holes (round_id, number, par, strokes, putts, fairway, gir,"
            " penalties, up_and_down, pin_lat, pin_lon) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                round_id,
                number,
                hole.get("par"),
                hole.get("strokes"),
                hole.get("putts"),
                hole.get("fairway"),
                hole.get("gir"),
                0 if hole.get("penalties") is None else hole.get("penalties"),
                hole.get("up_and_down"),
                hole.get("pin_lat"),
                hole.get("pin_lon"),
            ),
        )
        for shot_index, shot in enumerate(hole.get("shots") or [], start=1):
            identity = identities[(number, shot_index)]
            evidence_id = _evidence_id(con, identity)
            con.execute(
                "INSERT INTO shots (round_id, hole, seq, club, lat, lon, end_lat,"
                " end_lon, distance_m, distance_type, lie, end_lie, remaining_m,"
                " positional, lost_ball, water_hazard, timestamp, temperature_c, source,"
                " source_event_id, evidence_id)"
                " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    round_id,
                    number,
                    shot.get("seq"),
                    shot.get("club"),
                    shot.get("lat"),
                    shot.get("lon"),
                    shot.get("end_lat"),
                    shot.get("end_lon"),
                    shot.get("distance_m"),
                    shot.get("distance_type", "total_gps"),
                    shot.get("lie"),
                    shot.get("end_lie"),
                    shot.get("remaining_m"),
                    int(bool(shot.get("positional"))),
                    int(bool(shot.get("lost_ball"))),
                    int(bool(shot.get("water_hazard"))),
                    shot.get("timestamp"),
                    shot.get("temperature_c"),
                    shot.get("shot_source") or source,
                    identity.source_event_id,
                    evidence_id,
                ),
            )
    return round_id


def _evidence_id(con: sqlite3.Connection, identity: ShotIdentity) -> int:
    row = con.execute(
        "SELECT id, source_event_id, fingerprint, canonical_json, canonical_sha256 "
        "FROM shot_evidence WHERE source=? AND source_round_id=? AND event_key=?",
        (identity.source, identity.source_round_id, identity.event_key),
    ).fetchone()
    if row:
        if tuple(row[key] for key in ("source_event_id", "fingerprint", "canonical_json", "canonical_sha256")) != (
            identity.source_event_id,
            identity.fingerprint,
            identity.canonical_json,
            identity.canonical_sha256,
        ):
            raise ImportValidationError("immutable evidence conflict")
        return row["id"]
    cur = con.execute(
        "INSERT INTO shot_evidence "
        "(source, source_round_id, event_key, source_event_id, fingerprint, canonical_json, canonical_sha256) "
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
        (
            identity.source,
            identity.source_round_id,
            identity.event_key,
            identity.source_event_id,
            identity.fingerprint,
            identity.canonical_json,
            identity.canonical_sha256,
        ),
    )
    return cur.lastrowid


def _validate_json(value: object, context: str) -> None:
    try:
        json.dumps(value, allow_nan=False)
    except (TypeError, ValueError) as exc:
        raise ImportValidationError(f"{context} must contain finite JSON") from exc


def _required_text(mapping: Mapping, field: str, context: str) -> str:
    value = mapping.get(field)
    if not isinstance(value, str) or not value.strip():
        raise ImportValidationError(f"{context} requires nonblank {field}")
    return value.strip()


def _positive_int(value: object) -> bool:
    return isinstance(value, int) and not isinstance(value, bool) and value > 0


def _validate_positive(value: object, field: str, *, allow_none: bool = False) -> None:
    if value is None and allow_none:
        return
    if not isinstance(value, (int, float)) or isinstance(value, bool):
        raise ImportValidationError(f"{field} must be positive")
    if not math.isfinite(value) or value <= 0:
        raise ImportValidationError(f"{field} must be positive")


def _validate_nonnegative(value: object, field: str, *, allow_none: bool = False) -> None:
    if value is None and allow_none:
        return
    if not isinstance(value, (int, float)) or isinstance(value, bool):
        raise ImportValidationError(f"{field} must be nonnegative")
    if not math.isfinite(value) or value < 0:
        raise ImportValidationError(f"{field} must be nonnegative")


def _total_strokes(holes: list[dict]) -> int | None:
    strokes = [h.get("strokes") for h in holes]
    if not strokes or any(s is None for s in strokes):
        return None
    return sum(strokes)
