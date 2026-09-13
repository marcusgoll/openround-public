# OpenRound Hardware Review — Electrical & Systems Engineering

Date: 2026-08-20
Method: six parallel domain reviews (power/battery, sensor physics, RF/BLE, mechanical/enclosure, firmware/system, data opportunities), each grounded in datasheets, manuals, FCC/USGA documents, and literature fetched during the review, followed by an adversarial fact-check pass that re-verified every blocker/major/uncertain claim against primary sources. Key sources are linked inline.

## Overall verdict

**The concept is sound and commercially proven — the Garmin Approach CT10 is a near-identical shipped product (9 g, replaceable CR2032, up to 4 years, IPX7) — and the CR2032-for-a-season goal closes with 2.5–8× margin. But the design as written in plan.md has three blockers, all fixable on paper before any hardware is ordered.** The fixes reshape the wake chain, the radio protocol, and the shot-location scheme. The approved reusable-puck/passive-dock redesign also changes the cost architecture: one active puck replaces the planned full bag of active tags while preserving the mass target and phased validation gates.

## The three blockers

### 1. The wake chain as specified is self-contradictory (found independently by power, sensor, and firmware reviews)

The plan says: sleep at 3–5 µA, wake on a >8 g impact, capture ~100 ms at 1600 Hz, classify using ~1 s of pre-impact downswing history.
Physics and the [LIS2DW12 datasheet](https://www.st.com/resource/en/datasheet/lis2dw12.pdf) say no, three ways:

- 1600 Hz ODR exists only in high-performance mode at **90 µA** — always-on HP is 788 mAh/yr, ~4 CR2032s per year. Low-power modes cap at 200 Hz.
- At sleep ODRs (12.5–25 Hz, filter BW ≤ ODR/2), the 5–15 ms grip-end impact transient lands on 0–1 heavily filtered samples — a >8 g wake fires **probabilistically at best, and always AT impact**, after the transient and the entire downswing are over.
- The 32-sample FIFO holds 20 ms at 1600 Hz — the "~1 s pre-impact history" the classifier needs is physically never captured.

**Fix — two-stage wake (now the baseline architecture):**
1. Sleep: LIS2DW12 in Low-Power mode 1 at **25 Hz (~1.5 µA)** with the 32-level FIFO in continuous mode = a rolling **1.28 s pre-history** — which is exactly the factor-(a) swing-profile window (measured swings: 0.7–1.0 s backswing + 0.2–0.45 s downswing, [Grober, arXiv:1001.1137](https://arxiv.org/pdf/1001.1137)).
2. Wake threshold **2–3 g** — the downswing build-up crosses this ~100–250 ms *before* impact (butt end sees 5–25 g centripetal near impact).
3. On interrupt: read the FIFO (factor a), switch the accel to HP 1600 Hz (~1.25 ms settling), and capture the impact transient + ringing **live** (factor b). Back to sleep ≤2 s later. (Fact-check note: the LIS2DW12's hardware SLEEP_DUR can't express a 1–2 s re-arm hysteresis at 25 Hz — its LSB is 20.5 s there — so implement the anti-wake-storm hysteresis in MCU firmware, or accept the 0.64 s default. Also verified: NIOSH-measured cart vibration *peaks* reach 1.2–2.5 g with high crest factors, so washboard paths will graze a 2 g threshold — the FIFO early-exit path is load-bearing, not belt-and-suspenders.)

Total sleep floor: ~3 µA (0.8 µA nRF52 System ON idle w/ PORT-event wake + 1.5 µA accel + RTC). System ON idle, not System OFF — OFF resets on wake and loses the warm state for no meaningful saving.

### 2. iOS background BLE coalescing silently drops repeat shots (RF + firmware reviews)

With the app backgrounded, iOS ignores `AllowDuplicatesKey` and **coalesces all advertisements from a given peripheral into a single discovery callback per scan session** ([Apple Core Bluetooth background guide](https://developer.apple.com/library/archive/documentation/NetworkingInternetWeb/Conceptual/CoreBluetooth_concepts/CoreBluetoothBackgroundProcessingForIOSApps/PerformingTasksWhileYourAppIsInTheBackground.html), [Punch Through guide](https://punchthrough.com/ios-ble-scanning-guide/)). A puck whose 30 s burst for shot #1 was discovered generates **no callback for shot #2** ten minutes later. Sequence-number replay can't fix it — the replay packets are also coalesced. Background scan gaps can exceed 15 s, so entire bursts can be missed; non-connectable advertisements may be suppressed outright in background. Notably, **no shipping competitor uses the architecture we planned**: Garmin CT10 is connection-based to a wrist-worn Garmin (ANT+, can't even pair to a phone); Arccos — the only pocket-phone system — sidesteps iOS BLE with an **ultrasonic chirp into the phone microphone**, and later shipped wearable BLE hubs.

**Fix — connect-based sync (matches what CT10 does):**
- Puck stores every event in a flash-backed, sequence-numbered log and advertises **connectable** (ADV_IND, 128-bit service UUID in the primary PDU — background filtering can't see scan responses) at 20 ms until connected/acked or ~10 s, then down Apple's interval ladder, re-bursting on every subsequent wake while unacked events exist.
- Phone holds a **pending `connectPeripheral()` request to the reusable puck** — Apple documents it does not time out and can relaunch the app in background on connect. On connect: read all unacked GATT records, write an ack (the puck purges + stops advertising early — a battery win: typical connect in 1–5 s vs a blind 30 s burst), disconnect, and re-arm.
- Advertisement payload stays as an opportunistic beacon (puckID, boot-epoch, latest seq, age, battery) for foreground/Android use.
- The puck uses a static random address (no RPA without bonding) so the pending connect keeps matching. Enable Core Bluetooth state restoration; a user force-quit disables background sync until reopened — document honestly, mitigate with a "round in progress" Live Activity.

### 3. "GPS fix on receipt" mislocates every delayed event (RF + firmware reviews)

Delayed delivery is the **common case** (background scan gaps, bag-buried tags, next-hole replay). A shot delivered 4 minutes late gets stamped ~150–300 m down the fairway — corrupting the product's core datum while looking valid.

**Fix — breadcrumb + age backdating:**
- Phone keeps a background location breadcrumb during the round (one fix per 10–15 s; golf GPS apps already run `allowsBackgroundLocationUpdates`).
- Every event carries **age** (u16 seconds in the advertisement, u32 ms in the GATT record), computed from the tag's RTC. Shot location = breadcrumb nearest (receipt_time − age); never fix-on-receipt when age > ~20 s.
- Clock source: **calibrated internal LFRC (±500 ppm ≈ 1.8 s/hour) — sufficient; delete the 32.768 kHz crystal from the BOM entirely** (it was also the most shock-fragile component; only the 32 MHz radio crystal is mandatory).
- Persist sequence tail in the flash log and add a **boot-epoch counter**; after any reset, pre-reboot events are flagged "location unknown" instead of trusting a reborn tick counter.

## Major design changes (verified, adopt into plan.md)

| Area | Was | Now | Why |
|---|---|---|---|
| SoC | nRF52810 or 52832 | **nRF52832** (certified module for release — see FCC row) | 52810: 24 KB RAM runs only "minimal" Zephyr BLE samples, no FPU, 192 KB flash can't dual-bank OTA — a mid-update brownout on a weak cell bricks it till re-flash. 52832 is <$1 more |
| High-g part | ADXL375 contingency | **ADXL372** contingency | ADXL375 idles at 145 µA, no monitoring mode. ADXL372: **instant-on impact watch at 1.4 µA**, 3200/6400 Hz at 22 µA, 512-sample FIFO, ±200 g (fact-check caveat: instant-on does not auto-re-arm after a trigger — firmware must reset it). Lay pads on PCB rev A; populate only if Phase 1 data demands it |
| Classifier features | peak g | **clip-tolerant features** | ±16 g **will rail for the first 5–15 ms of every solid strike** (grip zone: 15–19 g RMS in the first 5 ms, crest-factor peaks plausibly 30–75 g — [Chiementin et al. 2019](https://mdpi-res.com/d_attachment/applsci/applsci-09-02050/article_deploy/applsci-09-02050.pdf); Blast Motion's patent pairs 16/24 g + 100/400 g parts for exactly this). Use clip-count, 50–400 Hz ring energy, decay τ. Grip ringing is dominantly **95–110 Hz** — inside the LIS2DW12's 400 Hz filter cap, so 1600 Hz ODR suffices |
| Impact vs swing separation | amplitude threshold | **spectral separation, high-pass ~50 Hz** | swing centripetal alone reaches 10–25 g axial at the butt near impact — amplitude can't distinguish a hard practice swing from a strike; frequency content can (swing is quasi-DC–10 Hz, impact rings ≥95 Hz) |
| Power BOM | absent | **≥100 µF effective bulk (2× 100 µF 6.3 V X5R 1206, soft-termination; MLCC only), 4.7 µF + 100 nF local, DCDC 10 µH inductor, POF at 2.4 V** | end-of-life/cold cell IR reaches ~100–150 Ω (Energizer handbook: ~100 Ω by 90 mAh used at µA drains); TX pulses droop 0.5–0.75 V without a reservoir. MLCC DC-bias derating halves nominal at 3 V (hence 2×); tantalum leaks ~6 µA — more than the whole sleep budget. DCDC halves battery-side radio pulses (7 vs 12 mA) |
| Cell | any CR2032 | **Energizer/Panasonic/Murata only**, conditioning routine on insert, weekly keep-alive adv | TI SWRA349: 2:1 brand variance under pulse load; stored cells passivate (first burst can dip to ~1.5 V on an 8-yr cell); the keep-alive prevents passivation regrowth off-season |
| Cell retention | holder unspecified | **lid-preload architecture**: PCB leaf contacts + printed battery-door pressing the cell; shock path lid→cell→housing, never through holder solder joints | best rated commercial holder is qualified at only **80 g** shock; butt-end transients likely exceed 150 g. AirTag and CT10 both use lid-preload. Bulk cap rides through ≥1 ms contact bounce; state lives in flash |
| Club mount | one active tag per club with a threaded grip insert | **one reusable active puck + passive split-collar docks**: keyed dovetail, captive spring tab, TPU contact ribs only | removes per-club electronics and preserves a rigid puck-to-dock path; grip interfaces are **not standardized**: caliper supported grips, publish 2–3 dock variants; counterweighted grips unsupported until measured |
| Enclosure material | PETG (SLA option) | **ASA** (PETG for room-temp prototypes only; no SLA structural body) | PETG softens at 68 °C — a 60–70 °C summer car trunk sits on it while the part holds O-ring + door preload; ASA HDT ~93 °C and UV-stable. Note the CR2032 itself is only rated to +60 °C (CT10 similarly specs −10…+50 °C): "don't store clubs in a hot trunk" goes in the README, and BR2032 (+80 °C) is the fallback chemistry |
| Sealing | IPX4+ ambition | **IPX4 spec, radial O-ring battery door, 5–6 perimeters, per-unit 30-min submersion acceptance test** | molded IPX7 (CT10) isn't reachable in bare FDM; radial glands print sealing surfaces as continuous perimeters |
| Mass | <12 g ceiling | **9–10 g target** (12 g hard ceiling) | 4 g at the butt = 1 swingweight point → 12 g ≈ 3 points; CT10 is 9 g, Arccos 7.34 g. Ledger: cell 3.0 + PCBA 1.5–2 + ASA 3–4 + contacts/O-ring ~1 = 8–10 g. **No potting** (2–5 g, kills the margin; dab-pot single components only if testing demands) |
| Legality | assumed OK | **confirmed, with geometry rules** | USGA Equipment Rules Part 2 Rule 1a(iv): butt attachment conforming only if OD ≤ grip-butt OD, protrusion ≤ 50.8 mm, no bulge/waist, **no alignment aids on the cap**, no performance benefit. Arccos precedent (Decision 2017-0754) covers handicap play |
| Club assignment | double-tap wake + strongest RSSI | **mount-session confirmation** (the user confirms the club when the reusable puck moves to a passive dock); passive dock identification remains later work | one puck removes neighbor-tag ambiguity; automatic identification still needs a separate reliability experiment and must not silently assign a shot to the last club |
| Radio params | +4 dBm considered | **0 dBm, 1M PHY** | CT10 ships at −0.45 dBm from the same mounting position; grip-to-pocket closes with >10 dB margin at 0 dBm; 1M PHY has a verified 7 dB sensitivity edge over 2M. 20 ms adv only until ack/10 s (connect typically lands in 1–5 s), then Apple's interval ladder starting at 152.5 ms (100 ms is not an Apple-recommended value) — a blind 20 ms × 30 s burst regime is ~5× the advertising energy (≈ +67 mAh/season on the worst-case budget, fact-checked) |
| Antenna | unspecified | chip antenna at the **rim of the disc, farthest from the shaft axis**, π-match footprint, tuned in-enclosure on a steel-shaft club with a hand on the grip | 25 mm PCB is ground-plane-starved; the steel (or conductive graphite) shaft sits in the near field: budget −6…−15 dB realized gain. Moot if a certified module with integral antenna is used |
| FCC | home-build assumed fine | **certified BLE module (e.g., Raytac MDBT42Q/nRF52832) for the production puck** | the reusable design reduces active radio count, but a custom radio product still needs the certified-module path; publishing design files is not itself a supplied kit. The module also deletes the coin-PCB antenna problem for roughly $2–3 per active puck |
| Firmware stack | Arduino prototype → production | **Zephyr / nRF Connect SDK from day one** (XIAO is an upstream `xiao_ble_sense` board, ships UF2) | Arduino/Bluefruit shares zero stack code with production — the classifier and protocol would be written twice. nRF5 SDK is in maintenance mode. Event log: Zephyr NVS with CRC (endurance is a non-issue: ~300 seasons); DFU policy: refuse below 2.8 V under load, MCUboot dual-slot; classifier in Q15 CMSIS-DSP; per-club thresholds pushed from the app; identity = factory FICR address (zero provisioning); battery-insert self-test; PPK2 phase gate ≤5 µA |

## Season power budget (adopted engineering baseline)

Worst-case single tag absorbing *every* event (105 rounds × 165 wakes + 70 range sessions × 80 balls + jostle allowance, 12 months installed):

| Term | mAh/yr |
|---|---|
| Sleep floor ~2.5 µA | 21.9 |
| 14,525 advertise bursts | 17.3 |
| ~75,400 wake+capture+classify | 8.6 |
| Bag-rattle HP dwell allowance | 9.5 |
| Self-discharge ~1 %/yr | 2.4 |
| **Total** | **~60** |

vs ~150 mAh usable (235 mAh rated, derated for pulse load to 2.0 V cutoff + cold + vendor spread) → **2.5× worst case; a realistic per-tag share is 32–44 mAh/yr = 3–5 seasons per cell**, consistent with CT10's 4-year claim. Design FEP 2.0 V (nRF52 min 1.7 V, LIS2DW12 min 1.62 V). Cold note: at 0 °C the plateau drops to ~2.65 V and ~⅓ of capacity is temporarily inaccessible — covered by the 100–150 Ω cap-sizing point; run one fridge test on a half-drained cell.

## What data can this system gather? (the exhaustive catalog)

Benchmarks: Arccos + Shot Scope (owned). ✅ = commercial systems ship it; ★ = **nobody ships it — genuinely novel data**.

**SOLID (buildable as specced):**
- Shot detection & count per club; shot sequence ✅ (the core product)
- Per-club distance distributions, gapping chart, dispersion ellipses ✅ — must copy Shot Scope's P-AVG discipline: trimmed mean, exclude layups and shots ending <50 yd from the pin
- Fairways-hit % and GIR, automatic via point-in-polygon vs OSM geometry ✅
- Strokes gained off-the-tee ✅ (start = tee polygon, end = next shot — fully automatic)
- Putts, scrambling, SG-putting via a **2-tap putt flow** at each green ✅ (first tap's GPS fix doubles as the approach shot's end position — unblocking SG-approach)
- Pace of play, time per shot ✅; **pre-shot routine duration ★** (GPS-stationary → impact)
- **Practice-swing count per shot ★** — events passing factor (a), failing factor (b); piggyback an 8-bit counter on the next real event, costs nothing
- Per-shot temperature ★ (LIS2DW12 die sensor, free) and battery telemetry (idle V + TX droop → per-tag IR trend → "replace before Saturday" alerts)
- Walking distance/steps/calories (HealthKit) ✅; weather per shot (Open-Meteo, free, no key) ✅; cart-vs-walk segments
- Wake/reject diagnostic counters ★ → false-wake rates, bag-abuse stats, real-world power model

**USABLE (one specific enabler each):**
- **Tempo family** (backswing time, downswing time, ratio, transition) — Blast Motion ships exactly this from the same mounting spot; ours falls out of the two-stage wake's 25 Hz FIFO
- **SG-approach + proximity by distance bucket** — the #1 product for the scratch goal (SG approach −7.46). Needs: OSM course geometry (graded per course), the putt-tap flow, and a **one-tap pin-mark** while pulling the ball from the hole (green-centroid fallback adds 10–15 m error — worse than GPS noise; both commercial systems solved this with the same user action)
- Distance-to-pin per approach; penalty/re-tee inference as suggest-and-confirm; elevation & plays-like via one-time DEM lookup; personal temperature-vs-distance curves ★ (~2 yd per 10 °F on driver — measurable across a 0–45 °C season); per-club distance drift time series
- **Range-to-course gap analysis ★** — openflight radar carry vs on-course GPS **total** (store `distance_type`; model roll ~18 yd typical driver, ~0–10 yd wedge). Quantifies under-clubbing per club. Nobody else owns both datasets in one schema — this is OpenRound's unique data product
- OSM status: 39,627 courses tagged worldwide but only ~half of greens/fairways micromapped and pins are stale by construction — app grades each course at round start and degrades gracefully; budget one JOSM/FairwayMapper afternoon per home course (community contribution)

**EXPERIMENTAL:** strike-quality proxy from ring-energy consistency (a shaft-mounted-IMU study hit 93.8 % face-location classification in the lab — [Hollaus et al. 2023](https://doi.org/10.3390/s23249783) — but no product ships it; log the features from day one, judge later); fatigue curves front-9/back-9 ★ (collect passively, analyze after a season); Apple Watch auto-putt detection (Golfshot proves it on watchOS 10's high-frequency motion API — park for Phase 4); club fingerprinting from ring signature (redundant — the tag knows its club).

**NOT FEASIBLE (stay descoped):** club path/face angle from the butt (review confirms: openflight's radar keeps that job); putt detection from a pocketed phone; real pin positions from map data; waggle counting at µA budgets.

**Phase 0 correction (fact-checked):** the third-party shotscope.vercel.app exporter turns out to export **launch-monitor/range data only — not on-course round history**. Liberating rounds (clubs, coordinates, putts) requires the local dashboard-scrape replica, which was already the recommended path for credential hygiene.

## Corrections to Phase 1 (physics validation)

- **Continuous raw logging is impossible**: 1600 Hz × 3 axes = 34.5 MB/h vs the XIAO's 2 MB QSPI (~3.5 min). Capture triggered ~2 s windows around each stage-1 wake (also rehearses the production wake chain), or stream over USB at the range.
- **Add the purchased ADXL375 breakout beside the XIAO** for all range sessions: it measures an unclipped high-g reference within its bandwidth (no published data exists for grip-end turf strikes or bag drops — this dataset is the whole ballgame for the ±16 g-only vs two-accel decision, and it's publishable). Keep ADXL372 as the production-footprint candidate if the measured spectrum demands more bandwidth.
- **Oversample the confuser**: ≥100 deliberate fat/turf-brush swings across clubs and turf conditions — the single largest unquantified classifier risk is that fat swings also clip, leaving only ringing features to separate them.
- Emulate the LIS2DW12 filter chain when training on the XIAO's LSM6DS3TR-C (different front end; thresholds won't transfer untuned), and include at least one steel iron + one graphite club — steel rings louder and at different modes; thresholds go per-club-type, pushed from the app.
- Log an **RSSI-vs-scenario matrix** (tag in hand/in bag × phone pocket/cart, steel/graphite) and a **screen-off background discovery+connect latency CDF** over ≥100 synthetic events — these two datasets de-risk Phase 2 more than any simulation.
- Putter physics confirmed the v1 exclusion: a putt's grip-end signature is <1 g RMS, below handling noise; even Arccos misses tap-ins and papers over it with app-side ML.

## Cost & procurement notes

- BOM delta vs plan: certified nRF52832 module +$2–3 for the active puck; power-delivery parts ~$1 for the active puck; ADXL372 only if data demands (+$6–9 on the custom PCB). Recompute full-bag cost from one puck plus passive docks; do not carry forward the old 13-tag estimate.
- **Buy one Garmin CT10 (~$30) and tear it down before PCB layout** — it answers cell-contact design, dock/latch profile, O-ring size, and wall thicknesses for this exact use case. (Fact-check correction: FCC ID IPH-03164, cited in an early draft as the CT10 filing, is actually a Garmin handheld — locate the CT10's real filing on fccid.io under Garmin's IPH grantee code before relying on FCC photos; the physical teardown answers everything regardless.)
- Instrumentation: Nordic PPK2 (~$100) is the phase-gate tool for the ≤5 µA sleep floor; a $5 temperature logger in the bag + trunk replaces the assumed 60–70 °C envelope with data.
