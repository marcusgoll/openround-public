import numpy as np
import pytest

from openround import capture

FS = 1600.0


def _stream_text(t_us, xyz):
    lines = ["T,2.5"]
    for t, (x, y, z) in zip(t_us, xyz):
        lines.append(f"S,{int(t)},{x:.3f},{y:.3f},{z:.3f}")
    lines.append("garbage line that must be ignored")
    lines.append("S,torn,line")
    return "\n".join(lines)


def _synthetic(kind: str, seconds: float = 2.5):
    """Build a swing (smooth ramp) or strike (ramp + clipped ringing burst)."""
    n = int(seconds * FS)
    t = np.arange(n) / FS
    mag = np.full(n, 1.0)  # 1 g gravity baseline
    impact_t = 2.0
    # swing: smooth centripetal hump peaking at impact and decaying through
    # the follow-through (a step edge here would itself ring broadband)
    mag += 5.0 * np.exp(-(((t - impact_t) / 0.35) ** 2))
    if kind == "strike":
        burst = (t > impact_t) & (t <= impact_t + 0.05)
        ring = 40.0 * np.exp(-(t[burst] - impact_t) / 0.015) * np.sin(
            2 * np.pi * 110 * (t[burst] - impact_t)
        )
        mag[burst] += np.abs(ring)
        mag = np.clip(mag, 0, 16.0)  # the ±16 g IMU rails
    xyz = np.zeros((n, 3))
    xyz[:, 2] = mag  # put it all on one axis: |a| == mag
    return t * 1e6, xyz, impact_t


def test_parse_roundtrip_ignores_junk(tmp_path):
    t_us, xyz, _ = _synthetic("strike", seconds=0.1)
    f = tmp_path / "cap.csv"
    f.write_text(_stream_text(t_us, xyz))
    s = capture.load_stream(f)
    assert len(s.t_s) == len(t_us)
    assert s.sample_rate_hz == pytest.approx(FS, rel=0.01)


def test_event_finder_debounces(tmp_path):
    t_us, xyz, impact_t = _synthetic("strike")
    f = tmp_path / "cap.csv"
    f.write_text(_stream_text(t_us, xyz))
    s = capture.load_stream(f)
    events = capture.find_events(s, threshold_g=4.0)
    assert len(events) == 1
    assert events[0] == pytest.approx(impact_t, abs=0.6)  # fires on the downswing ramp


def test_strike_vs_practice_swing_features_separate(tmp_path):
    feats = {}
    for kind in ("strike", "swing"):
        t_us, xyz, impact_t = _synthetic(kind)
        f = tmp_path / f"{kind}.csv"
        f.write_text(_stream_text(t_us, xyz))
        s = capture.load_stream(f)
        win = capture.window(s, impact_t, pre_s=1.5, post_s=0.5)
        feats[kind] = capture.features(win, event_s=impact_t)

    strike, swing = feats["strike"], feats["swing"]
    assert strike["clip_frac"] > 0 and swing["clip_frac"] == 0
    assert strike["band_rms_g"] > 1.0        # real ringing energy
    assert swing["band_rms_g"] < 0.1         # quiet window gated to ~0
    assert strike["band_ratio_50_400"] > swing["band_ratio_50_400"]
    assert strike["post_rms_g"] > swing["post_rms_g"]
    # both have the downswing ramp — the shared factor (a)
    assert strike["pre_ramp"] > 1.5 and swing["pre_ramp"] > 1.5
