import hashlib

import pytest

from openround.identity import IdentityError, identity_for_shot


def test_explicit_event_id_builds_stable_key():
    result = identity_for_shot(
        "shotscope", "98765", 1,
        {"seq": 1, "source_event_id": "evt-7", "club": "Driver", "distance_m": 215.4},
    )
    assert result.event_key == "event:evt-7"
    assert result.source_event_id == "evt-7"
    assert result.fingerprint is None


def test_missing_event_id_uses_sha256_fingerprint():
    shot = {"seq": 1, "club": "Driver", "distance_m": 215.4}
    result = identity_for_shot("shotscope", "98765", 1, shot)
    expected_json = '{"hole":1,"shot":{"club":"Driver","distance_m":215.4}}'
    assert result.canonical_json == expected_json
    assert result.fingerprint == hashlib.sha256(expected_json.encode()).hexdigest()
    assert result.event_key == "fingerprint:" + result.fingerprint


def test_fingerprint_ignores_synthetic_sequence_number():
    a = identity_for_shot("test", "r1", 1, {"seq": 1, "club": "7 Iron", "distance_m": 140.0})
    b = identity_for_shot("test", "r1", 1, {"seq": 2, "club": "7 Iron", "distance_m": 140.0})
    assert a.event_key == b.event_key
    assert a.canonical_json == b.canonical_json


def test_non_finite_identity_value_is_rejected():
    with pytest.raises(IdentityError, match="finite JSON"):
        identity_for_shot("test", "r1", 1, {"seq": 1, "distance_m": float("nan")})
