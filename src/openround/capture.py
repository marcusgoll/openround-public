"""Parse and analyze Phase 1 swing-capture streams.

Input contract (produced by firmware/phase1): text lines
    S,<t_us>,<ax_g>,<ay_g>,<az_g>      one accel sample (XIAO onboard IMU)
    EVT,<t_us>,<peak_g>                firmware threshold-crossing marker
    T,<threshold_g>                    boot banner
Unknown lines are ignored, so serial noise or future line types don't break
old captures.

Features are chosen to be clip-tolerant (the ±16 g IMU rails on real impacts):
peak is reported but never trusted alone; the discriminative set is clip
fraction, 50-400 Hz band-energy ratio (shaft ringing lives at ~95-110 Hz),
and the pre-window RMS ramp (the downswing signature).
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import numpy as np


@dataclass
class Stream:
    t_s: np.ndarray          # seconds, from firmware microsecond timestamps
    xyz_g: np.ndarray        # shape (n, 3)
    events_t_s: list[float]  # firmware EVT markers

    @property
    def magnitude_g(self) -> np.ndarray:
        return np.linalg.norm(self.xyz_g, axis=1)

    @property
    def sample_rate_hz(self) -> float:
        dt = np.median(np.diff(self.t_s))
        return 1.0 / dt if dt > 0 else 0.0


def load_stream(path: str | Path) -> Stream:
    t, xyz, events = [], [], []
    for line in Path(path).read_text().splitlines():
        parts = line.strip().split(",")
        if parts[0] == "S" and len(parts) == 5:
            try:
                t.append(int(parts[1]))
                xyz.append([float(parts[2]), float(parts[3]), float(parts[4])])
            except ValueError:
                continue  # torn serial line
        elif parts[0] == "EVT" and len(parts) >= 2:
            try:
                events.append(int(parts[1]) / 1e6)
            except ValueError:
                continue
    return Stream(
        t_s=np.asarray(t, dtype=np.float64) / 1e6,
        xyz_g=np.asarray(xyz, dtype=np.float64).reshape(-1, 3),
        events_t_s=events,
    )


def find_events(stream: Stream, threshold_g: float = 4.0, min_gap_s: float = 3.0) -> list[float]:
    """Times where |a| first crosses the threshold, debounced by min_gap_s."""
    mag = stream.magnitude_g
    above = np.flatnonzero(mag >= threshold_g)
    events: list[float] = []
    for idx in above:
        t = stream.t_s[idx]
        if not events or t - events[-1] >= min_gap_s:
            events.append(t)
    return events


def window(stream: Stream, center_s: float, pre_s: float = 1.5, post_s: float = 0.5) -> Stream:
    mask = (stream.t_s >= center_s - pre_s) & (stream.t_s <= center_s + post_s)
    return Stream(t_s=stream.t_s[mask], xyz_g=stream.xyz_g[mask], events_t_s=[])


def features(win: Stream, clip_g: float = 15.5, event_s: float | None = None) -> dict:
    """Clip-tolerant feature vector for one event window.

    event_s: the impact-candidate time inside the window (defaults to the
    magnitude peak); the pre-ramp is measured before it, ringing after it.
    """
    mag = win.magnitude_g
    if len(mag) < 8:
        raise ValueError("window too short")
    fs = win.sample_rate_hz
    t0 = win.t_s[np.argmax(mag)] if event_s is None else event_s

    pre = mag[win.t_s < t0 - 0.05]
    post_mask = (win.t_s >= t0) & (win.t_s <= t0 + 0.1)
    post = mag[post_mask]

    # Spectral content of the post-impact segment. The ratio alone is
    # meaningless on a quiet window (noise / noise), so it is gated on a
    # noise floor, and the absolute in-band RMS is the primary feature.
    band_ratio, band_rms = 0.0, 0.0
    if len(post) >= 16 and fs > 200:
        seg = post - post.mean()
        total_rms = float(np.sqrt(np.mean(seg**2)))
        if total_rms > 0.05:  # g; below this the window is flat, not ringing
            spec = np.abs(np.fft.rfft(seg)) ** 2
            freqs = np.fft.rfftfreq(len(seg), d=1.0 / fs)
            total = spec[1:].sum()
            if total > 0:
                band = spec[(freqs >= 50) & (freqs <= 400)].sum()
                band_ratio = float(band / total)
                band_rms = total_rms * band_ratio**0.5

    # downswing ramp: RMS of the last 0.4 s of pre vs the first 0.4 s
    ramp = 0.0
    if len(pre) >= 16:
        k = max(8, int(0.4 * fs))
        early = np.sqrt(np.mean(pre[:k] ** 2))
        late = np.sqrt(np.mean(pre[-k:] ** 2))
        ramp = float(late / early) if early > 0 else float("inf")

    return {
        "peak_g": float(mag.max()),
        "clip_frac": float(np.mean(mag >= clip_g)),
        "band_ratio_50_400": band_ratio,
        "band_rms_g": band_rms,
        "pre_ramp": ramp,
        "post_rms_g": float(np.sqrt(np.mean(post**2))) if len(post) else 0.0,
        "sample_rate_hz": float(fs),
    }
