# OpenRound — Plan

DIY on-course shot tracking: one reusable 3D-printed grip-end sensor puck plus passive club docks (accelerometer + BLE + coin cell), auto shot detection, phone GPS, open data. Sibling project to openflight. See `craftsman-decision.md` for the original reasoning and **`hardware-review.md` (2026-08-20) for the verified engineering review that revised the architecture** — where this plan and that review disagree, the review wins.

## Architecture (post-review baseline)

- **Reusable puck**: certified nRF52832 BLE module + LIS2DW12 accelerometer + replaceable CR2032 (Energizer/Panasonic/Murata only), ≥100 µF effective MLCC bulk bank, DCDC inductor, no 32 kHz crystal (calibrated LFRC). ASA printed rigid carrier, keyed dovetail receiver, captured battery door, and lid-preloaded cell retention. Target 9–10 g.
- **Passive docks**: two-piece split collars around the upper grip with TPU contact ribs, visible club labels, and captive spring-tab latches. One dock stays on each supported club; no club electronics.
- **Wake chain (two-stage)**: sleep with accel in low-power 25 Hz + continuous 32-sample FIFO (1.28 s rolling swing history, ~3 µA system) → 2–3 g threshold trips on the downswing ~100–250 ms before impact → switch accel to 1600 Hz high-performance and capture impact + shaft ringing live → two-factor classify (FIFO swing ramp AND 50–400 Hz ring energy/clip features, high-passed at 50 Hz) → log event → sleep.
- **Sync**: flash-backed sequence-numbered puck event log; connectable advertising until GATT-acked; the phone reads and acks the one puck's log. Every event references a mount session carrying puck ID, club assignment, mount mode, and age. Advertisement doubles as an opportunistic beacon (puckID, epoch, seq, age, battery).
- **Location**: phone keeps a background GPS breadcrumb during the round; each event carries its age; shot location = breadcrumb at (receipt − age). Never fix-on-receipt beyond ~20 s age.

## Phases

### Phase 0 — Liberate the Shot Scope data (software only) — BUILT 2026-08-20, awaiting first live run

Value now, zero hardware. Also creates the ground-truth dataset Phase 2 needs.

- [x] **Exporter built** (`python -m openround shotscope`): logs into dashboard.shotscope.com exactly like the web form (anti-forgery token + session cookie — recon verified the flow live), pulls `GET /api/Rounds/slim` + `GET /api/v2/rounds/{id}` (per-shot GPS, club, lie, lost-ball; distances in meters). Endpoints verified against MIT-licensed prior art (mohit-nontechnical/caddie-book-public, working as of 2026-08-13). Raw responses archived to `data/shotscope-raw/`.
- [x] **Open schema defined** (`src/openround/schema.sql`): rounds / holes (incl. pin position from PinCollect) / shots (`distance_type` keeps GPS totals and radar carries apart) / clubs.
- [x] **Roadmap auto-fill built** (`python -m openround roadmap`): fills the Scratch Golf Roadmap baseline table + round-log rows; dry-run diff by default, backup on `--write`; never touches Handicap Index or Notes.
- [x] **First live export + `roadmap --write` — DONE 2026-08-20.** 5 rounds exported (3× 18-hole, 2 partials); the real v2 API shape (dict clubs, vendor distances/`remaining` in meters, per-shot timestamps, positional/lost/water flags) is captured in schema + tests; baseline in the Obsidian roadmap: FW 5.3/14 (38%), GIR 6.0, Putts 31.0, Scrambling 25%, Doubles+ 2.7. Refresh anytime: `uv run python -m openround shotscope` then `roadmap --write` (`--offline` re-imports from the raw archive without login).
- Notes from recon: per-shot strokes gained is NOT in the API (the dashboard computes it client-side) — we recompute SG ourselves later from positions + lies, which the raw dumps make possible. Putts are derivable per hole only with the putter tag (shots with lie "Green"); otherwise the round-level total backfills.
- Exit criteria: roadmap baseline populated from real data; repeatable per-round import.

### Phase 1 — Prove the physics (1 prototype rig, ~$50)

- [ ] Hardware (availability verified 2026-08-20): Seeed XIAO nRF52840 Sense ($15.90, DigiKey 1597-102010469-ND — the Sense variant with the IMU, not the $10 plain board) **plus an Adafruit ADXL375 ±200 g breakout ($24.95, PID 5374 / DigiKey 1528-5374-ND**, I2C 0x53 or SPI, STEMMA QT) — the XIAO's ±16 g IMU clips on impact by design; the ±200 g channel measures the true butt-end shock spectrum that no published literature has. Note: the ADXL375's 145 µA doesn't matter here — the Phase 1 rig is Li-Po powered; **ADXL372 remains the production-tag contingency chip** (no hobbyist breakout exists; only the $47 EVAL-ADXL372Z). Wiring notes: XIAO onboard IMU is on an internal I²C bus at 0x6A gated by the 6D_PWR pin (P1.08); battery attaches to bare BAT+/− pads (no JST jack — cut the LiPo's lead, verify polarity first). Li-Po for prototyping only; never leave it in a hot car. Do NOT buy the Mikroe Accel 5 Click (it is a low-g BMA400, not an ADXL372).
- [ ] Print the Phase 1 rig and passive-dock fit coupons (`cad/phase1-rig-mount.scad`, parametric, **scaffolded 2026-08-20**, syntax unverified — OpenSCAD not installed on this machine): rigid sensor platform plus a two-piece split-collar dock with keyed dovetail and captive spring tab. **Caliper first** (upper-grip diameter, butt-cap OD, depth, and obstructions — instructions in `cad/README.md`); the default 13.5 mm hole diameter is a placeholder, and the ADXL375 mounting-hole spacing needs checking against the physical board.
- [x] Firmware v0 **scaffolded 2026-08-20** (`firmware/phase1/`, Zephyr v4.4.2, board `xiao_ble/nrf52840/sense` — symbols verified against the Zephyr source tree; UNTESTED until first compile): USB CDC-ACM streaming at 1666 Hz ±16 g in the CSV contract `capture.py` parses, DRDY-thread capture with drop counting, EVT threshold markers with hysteresis. Known follow-ups flagged in its README: Zephyr has **no ADXL375 driver** (integration is a real Phase 1 task — options ranked in app.overlay comments), lossless 1666 Hz over I²C needs bench confirmation via t_us deltas, and timestamps are 30.5 µs RTC resolution (TIMER upgrade path noted).
- [ ] First compile + flash (needs the Zephyr toolchain installed — commands in `firmware/phase1/README.md` — and the XIAO in hand).
- [ ] Range sessions with labels: N real balls + N practice swings + **≥100 deliberate fat/turf-brush swings** (the classifier's hardest confuser) + bag jostling + bag drops, on at least one steel iron and one graphite club (steel rings louder; thresholds will be per-club-type).
- [ ] Offline (Python, uv): two-factor classifier on clip-tolerant features (clip count, 50–400 Hz band energy, decay τ, FIFO ramp profile); emulate the LIS2DW12 filter chain when training on XIAO data. Verify every swing type crosses 2–3 g ≥100 ms before impact (wake-latency check).
- [ ] Radio measurements piggybacked on the same sessions: RSSI-vs-scenario matrix (hand/bag × pocket/cart × steel/graphite) and a screen-off iOS background discovery+connect latency CDF over ≥100 synthetic events.
- Exit criteria: ≥95 % precision/recall on the labeled set including fat swings; measured butt-end shock spectrum; go/no-go on the ADXL372 second footprint; wake-latency margin confirmed.

### Phase 2 — On-course MVP (1 reusable puck + passive club docks + minimal iOS app)

- [ ] Classifier into firmware (Q15 fixed-point, CMSIS-DSP; thresholds in NVS, pushed per-club-type from the app).
- [ ] Sync per the architecture above: connectable adv until acked, GATT event log + ack, boot-epoch counter, age-based backdating.
- [ ] iOS app v0 (SwiftUI + Core Bluetooth + Core Location): pending connect to the known puck, state restoration, background location breadcrumb, round list + map, one-tap delete/reassign.
- [ ] **Putt-tap + pin-mark flow** (2 taps per green + one tap at the pin): unlocks putts, scrambling, SG-putting, AND the approach shot's end position → SG-approach — the #1 stat for the scratch goal. Design it in from v0, not as a later add-on.
- [ ] Club assignment by an explicit **mount-session confirmation** when the puck moves between passive docks; defer passive dock identification until the latch and user flow are proven.
- [ ] Use one puck across 3–4 passive docks (driver, steel mid-iron, wedge) and play rounds wearing **both** systems; Shot Scope output is ground truth.
- Exit criteria: ≥90 % of shots auto-captured with correct club + location across 3 rounds vs Shot Scope; measured false-wake and missed-event rates.

### Phase 3 — Full bag (one custom puck, passive docks)

- [ ] PCB: certified nRF52832 module (Raytac MDBT42Q-class — publishing the design files is fine; the module also deletes the coin-PCB antenna problem) + LIS2DW12 + **unpopulated ADXL372 footprint** (populate only if Phase 1 said so) + 2× 100 µF 6.3 V X5R 1206 soft-termination bulk + 10 µH DCDC inductor + leaf-spring cell contacts. POF at 2.4 V; DFU refused below 2.8 V under load; MCUboot dual-slot.
- [ ] Board clamped at 3+ bosses; 0402 ceramics with 1 mm edge keep-outs; conformal coat; **no potting**.
- [ ] Reusable puck enclosure v1: **ASA** rigid carrier, captured battery door, keyed dovetail receiver, and no alignment features that violate the butt-end geometry rule. Passive club docks: 2–3 STL collar variants from the caliper survey, TPU contact ribs only, and a captive spring-tab latch. 9–10 g target, 12 g ceiling.
- [ ] Acceptance tests for the puck and each dock: 30-min submersion witness test for the puck; PPK2 sleep floor ≤5 µA; battery-insert self-test (WHO_AM_I, accel self-test, NVS scan, loaded-VDD measurement).
- [ ] Cycle-test each dock latch (100+ attach/remove cycles, pull-out ≥50 N); fridge-test a half-drained cell; hammer-strike VDD scope test for contact bounce.
- [ ] Tear down a Garmin CT10 (~$30) before layout freeze.
- [ ] App v1: per-club distributions with P-AVG-style trimming, FW/GIR derivation vs OSM (with per-course completeness grading + graceful degradation), SG off-the-tee, CSV/SQLite export into the Phase-0 schema (Shot Scope becomes removable).
- [ ] Open-source release openflight-style: honest accuracy numbers from Phase 2, BOM with links (module FCC ID noted, cell brands specced), STLs + print settings, flashable UF2, TestFlight group.

### Phase 4 — Parked, deliberately

- Swing-lab sensor: ONE rechargeable streaming unit (ICM-20649-class ±4000 dps gyro — standard ±2000 dps saturates at impact) moved club-to-club at the range; tempo/plane only, never sold as path/face.
- Apple Watch companion — **scoped 2026-08-20 for Marcus's Series 7**: the Golfshot-style automatic putt detection needs the watchOS high-frequency (800 Hz) motion API, which is hardware-gated to Series 8/Ultra+ — NOT available on Series 7. What the Series 7 companion still delivers, and why it's worth building in Phase 2/3: (a) a workout-session app stays running all round → wrist-worn BLE receiver for the tags (the architecture every shipping competitor converged on; verify watchOS Core Bluetooth concurrent-connection limits before committing to watch-as-primary-hub), (b) putt-tap + pin-mark on the wrist instead of the phone (the friction that makes-or-breaks the SG-approach data), (c) watch GPS breadcrumb during the workout. EXPERIMENTAL stretch: putt-stroke counting from the standard ~100 Hz motion API gated on GPS-in-green-polygon context — putting strokes are slow enough that 800 Hz may not be needed for counting (vs analyzing); range-test before promising. Upgrade path: if the watch is ever replaced with S8+, Golfshot-style auto-putts turn on.
- Putter support (requires a different modality — physics review confirmed a putt never reaches any viable wake threshold).
- Strokes-gained approach/short-game full stack: optional user-supplied benchmark data with explicit provenance and validation.

## Data products (ranked for the scratch goal; full catalog in hardware-review.md)

1. **SG-approach + proximity by distance bucket** (attacks SG approach −7.46; needs OSM geometry + pin-mark + putt-tap)
2. **Per-club gapping/dispersion** with P-AVG trimming
3. **Range-vs-course gap per club** (openflight carry vs on-course total — unique to this stack, shipped by nobody)
4. **Putt-tap + pin-mark flow** (enabler: putts, scrambling, SG-putting, SG-approach, completes the Obsidian roadmap)
5. **Tempo family + longitudinal drift** (free from the two-stage wake's FIFO)

Novel data nobody ships: practice-swing counts, pre-shot routine duration, per-shot grip temperature → personal weather curves, wake/reject telemetry, the Phase-1 grip-end shock dataset itself (publishable).

## Key risks (post-review)

| Risk | Mitigation |
|---|---|
| Fat practice swings clip like real strikes | Phase 1 oversamples them with unclipped ±200 g reference data; ringing-spectrum features; ADXL372 footprint as the escape hatch |
| iOS background BLE misses events | Connect-based sync (pending connects never time out); advertise-until-acked; age-backdated locations; measured latency CDF in Phase 1 |
| Wake fires too late on smooth swings | Phase 1 wake-latency check is an explicit exit criterion; threshold/ODR tunable per club type |
| Dock latch wears or releases | 100+ attach/remove cycles, pull-out testing, keyed hard stop, captive spring tab, and sacrificial-club fit checks |
| Hot car trunk | ASA enclosure; CR2032 rated to 60 °C — documented storage warning; BR2032 fallback |
| Coin-cell contact bounce at impact | Lid-preload retention + ≥100 µF ride-through + all state in flash + POF |
| Scope creep toward club path in tags | Review re-confirmed the descope: butt-end IMU physics can't do it; openflight's radar does |

## Open questions for Marcus

1. Project name: `openround` is a placeholder — happy to rename (opentag? opencaddie is too close to Arccos Caddie).
2. Phase 1 spend (~$50 rig + later ~$100 PPK2 + $30 CT10 teardown): order now or after Phase 0 ships?
3. Do you already have nRF52 dev boards or an ADXL breakout from other projects?
