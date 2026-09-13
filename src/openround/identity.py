"""Stable identity and canonical normalized evidence for imported shots."""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from typing import Any, Mapping


class IdentityError(ValueError):
    """Raised when a shot cannot be represented as canonical JSON."""


@dataclass(frozen=True)
class ShotIdentity:
    source: str
    source_round_id: str
    event_key: str
    source_event_id: str | None
    fingerprint: str | None
    canonical_json: str
    canonical_sha256: str


def identity_for_shot(
    source: str,
    source_round_id: str,
    hole_number: int,
    shot: Mapping[str, Any],
) -> ShotIdentity:
    """Return the stable occurrence key and canonical normalized shot payload."""
    payload = {
        "hole": hole_number,
        "shot": {key: value for key, value in shot.items() if key != "seq"},
    }
    try:
        canonical_json = json.dumps(
            payload,
            sort_keys=True,
            separators=(",", ":"),
            ensure_ascii=False,
            allow_nan=False,
        )
    except (TypeError, ValueError) as exc:
        raise IdentityError("shot evidence must be finite JSON") from exc

    digest = hashlib.sha256(canonical_json.encode("utf-8")).hexdigest()
    event_id = str(shot.get("source_event_id") or "").strip()
    source_event_id = event_id or None
    fingerprint = None if source_event_id else digest
    event_key = f"event:{event_id}" if event_id else f"fingerprint:{digest}"
    return ShotIdentity(
        source=source,
        source_round_id=source_round_id,
        event_key=event_key,
        source_event_id=source_event_id,
        fingerprint=fingerprint,
        canonical_json=canonical_json,
        canonical_sha256=digest,
    )
