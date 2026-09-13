# Craftsman Design Decisions

Feature: OpenRound — DIY on-course shot-tracking club tags
Planning Mode: Deep/Ultrathink
Date: 2026-08-19

> **Revision note 2026-08-20**: a verified multi-domain engineering review (`hardware-review.md`) upheld the concept but overturned several specifics recorded below: the >8 g wake-on-impact scheme (now a two-stage 2–3 g downswing wake — the impact transient is invisible at sleep sample rates), the fire-and-forget 30 s advertising sync (iOS background coalescing drops repeat shots; now connect-based with a GATT event log), GPS-fix-on-receipt (now breadcrumb + age backdating), the quarter-turn twist-lock into the grip (no commercial precedent, nothing to engage — now a tapered self-tapping thread; the quarter-turn survives as the battery door), and PETG (now ASA). This file stays as the decision history; the review and plan.md are current.
Working name: **openround** (provisional — sibling to openflight: "flight" measures ball flight at the range, "round" tracks shots on the course)

## Context discovered before designing

Two facts found in your existing projects reshape this idea:

1. **You already own Shot Scope.** Your Scratch Golf Roadmap round log (2026-08-17) says "Raw FW/GIR/putt counts still in ShotScope." A commercial version of this exact product — grip-end tags, auto shot detection, GPS, practice-swing rejection — is already on your clubs. Shot Scope has **no official API or CSV export**; only an unofficial scraper tool exists. The pain you're actually feeling is *data imprisonment*, not missing hardware.
2. **openflight already measures club path** — experimentally, via the IWR6843 angle radar, at the range. Club path is a ball-striking diagnostic you work on in practice, not a stat you act on mid-round.

## Assumptions Questioned

| # | Assumption | Challenge | Resolution |
|---|------------|-----------|------------|
| 1 | "I need to build shot-tracking hardware" | Shot Scope on your bag already does auto-detection + GPS + practice-swing rejection. What's actually unmet? | **REFRAMED.** The unmet needs are: (a) *owning the raw data* so it feeds the Scratch Roadmap automatically, (b) no vendor lock/subscription, (c) an open-source sibling for the openflight community. Build it for openness, not capability — and liberate the Shot Scope data *first* (software only) so the roadmap gets its baseline now. |
| 2 | Rechargeable battery that "stays charged the whole round" | 14 tags × a charging routine is a UX disaster; you'd quit charging them by June. Commercial tags (Garmin CT10 ~4 yr, Arccos ~2 yr) use primary coin cells with interrupt-driven wake. | **CHANGED.** Replaceable CR2032, accelerometer wake-on-impact interrupt, MCU asleep at ~3 µA. Design target: a full season minimum, no charger at all. This *exceeds* the stated goal. |
| 3 | Club path data from the grip-end tag | Physics is against it: the butt end moves least (worst lever arm for angular resolution); impact shock saturates the IMU at exactly the moment of interest; double-integration drifts in <1 s; grip-to-head geometry differs per club. Commercial butt-mounted sensors (Blast, SkyPro) publish tempo/plane metrics, never trusted path/face numbers. Real path data comes from radar or cameras. | **REMOVED from the tags.** Club path remains a range measurement — openflight's radar already does it. Optional Phase 4: a single rechargeable "swing lab" sensor you move to one club at a time, streaming full IMU. Never in all 14 always-on tags. |
| 4 | Accelerometer can distinguish real shot vs practice swing | Ball impact = high-g broadband shock + shaft ringing; practice swing = smooth centripetal profile. Hard confuser: a fat practice swing that brushes turf. Putts barely register. | **VALIDATED with a two-factor gate:** require a downswing acceleration signature AND an impact transient. Target ~95% in firmware, make correction trivial in the app. Putter excluded from v1 (Shot Scope itself needed a separate PIN mechanism for putting). Bonus: wear Shot Scope *and* the prototypes simultaneously — Shot Scope becomes free ground-truth labels for tuning the classifier. |
| 5 | Screw-in butt mount, 3D-printed, fits every club | Standard grips have a butt hole; this is how Arccos/CT10/Shot Scope mount. Fine machine threads print poorly on FDM; a twist-lock barb prints reliably. Weight matters: >12 g at the butt measurably changes swing weight. | **VALIDATED** for the 13 non-putter clubs. Twist-lock (quarter-turn) over threads. Target <12 g total. Putter grip variant deferred. |
| 6 | Phone GPS + iPhone app | iOS background BLE scanning works when filtered on a service UUID; latency is tolerable because you stand at the shot location for 10–30 s. | **VALIDATED.** Connectionless: tag advertises shot events with sequence numbers for ~30 s; phone timestamps with a GPS fix on receipt; buffered replay covers missed packets. The app is the biggest software lift, not the firmware. |
| 7 | Club ID needs NFC or extra tech | Each tag's BLE identity IS the club ID. | **SIMPLIFIED.** One-time assignment in the app: double-tap a tag to wake it, app picks the strongest-RSSI recently-woken tag, you pick the club from a list. Print the club number into the 3D-printed cap as the physical backup. No NFC. |
| 8 | Maybe part of the openflight repo | openflight is a stationary Pi + radar instrument in Python; this is distributed embedded sensors + an iOS app. Different toolchains, runtime, users' build process, release cadence. | **SEPARATE REPO**, sibling branding and shared community. Keeps openflight's scope clean; cross-link in both READMEs. |

## Assumption revisited 2026-08-20: wrist strap instead of club tags?

Challenged after Phase 0. Four architectures compared:

1. **Wrist-only (custom strap or Apple Watch app)** — one device, one battery, solves the iOS-background-radio problem (the wearable IS the always-on receiver), and wrist detection is commercially proven (Golfshot ships fully automatic putt detection on watchOS 10's 800 Hz motion API; several apps detect full swings). **Fatal flaw: the wrist cannot know which club you're holding.** Club ID is the spine of every data product we ranked (gapping, SG-by-club, P-AVG, range-vs-course) — losing it means per-shot manual entry (~80 prompts/round) or distance-based ML inference that corrupts exactly the per-club stats we want. Note Core NFC is iPhone-only (not watchOS), so an Apple Watch can't read passive grip tags to recover club ID.
2. **Custom wrist strap hardware specifically** — worst of both: all the wearable's costs (charging, straps, one more device) without solving club ID, while competing with a consumer smartwatch that already does the wrist part with better hardware and GPS.
3. **Hybrid à la Shot Scope (wrist senses, passive tags identify)** — the elegant commercial answer, but their tag link is proprietary short-range RF; a DIY NFC-in-the-grip read from a wrist reader is range-marginal (NFC ~2–4 cm vs grip-to-wrist ~5–10 cm) and unproven. High-risk science project.
4. **Active BLE club tags + phone (current plan)** — club ID intrinsic, no wearable, EE-review-validated end-to-end, CT10 proves it shipping-grade.

**RESOLUTION: keep the club tags.** The wrist's genuine strengths — putt detection and a reliable always-on receiver on the body — are exactly what the *Apple Watch companion* (Phase 4) adds to the tag system without sacrificing club ID. If Marcus owns a Series 8+ watch, pulling that companion forward to Phase 2/3 is the right hybrid: tags for detection + club ID, watch as receiver + putt counter. A custom wrist strap is rejected outright.

- **Buildable by strangers**: parts list with costs and purchase links; prebuilt firmware images so users skip vendor toolchains. openround must ship the same way — BOM, STLs, flashable UF2.
- **Honest accuracy labels**: openflight marks spin and club path "experimental." openround should publish its detection accuracy (validated against Shot Scope ground truth) rather than overclaiming.
- **Engineering rules**: uv-managed Python, failing-test-first on bugs, DRY flagged aggressively, explicit over clever, "engineered enough."
- **Structure to mirror**: `cad/` (a `printable-enclosure/` dir already exists as precedent), `firmware/`, `docs/`, honest README warnings.

## The Simplest Thing That Works

We chose **impact-event tags + phone GPS + open data format** because:
- The tag firmware becomes almost trivial: sleep, wake on interrupt, classify one ~100 ms window, advertise, sleep. No streaming, no time sync, no pairing management.
- Coin cell + interrupt-driven duty cycle turns "charged all round" into "no charging all season."
- All intelligence that can move to the phone, moves to the phone (dedup, editing, mapping, stats).

We rejected **full IMU streaming tags** (Arccos-plus) because club path from the butt is bad physics, and streaming kills the battery and BLE budget on all 14 clubs for data you'd get better from openflight's radar.

We rejected **"just keep using Shot Scope"** as the end state because the data is locked in, but we adopted it as **Phase 0**: liberate the existing data via the unofficial exporter so the Scratch Roadmap baseline fills in *this week*, and keep wearing it as the validation reference for the DIY tags.

Complexity budget spent on: the impact-vs-practice-swing classifier (the one genuinely hard problem) and the iOS background-BLE + GPS capture path (the one genuinely fiddly platform problem). Everything else is deliberately boring.

## Trade-offs Made

- **Longevity over recharge-ability**: replaceable CR2032 over Li-Po + charging, because 14-unit charging discipline fails in practice.
- **Detection accuracy ~95% + easy app correction** over chasing 100% in firmware, because the last 5% (fat practice swings, putts) costs more than a two-tap fix in the app.
- **Openness over polish**: open data format (SQLite/CSV) feeding the Obsidian roadmap beats a prettier proprietary app — that's the whole reason to build this.
- **Separate repo over monorepo**: consistency of each project's soul over convenience of one checkout.

## Architecture Sketch

```
 ┌──────────── per club (×13) ─────────────┐
 │  3D-printed twist-lock cap (<12 g)      │
 │  ┌───────────┐   int   ┌─────────────┐  │
 │  │ LIS2DW12  ├────────▶│ nRF52       │  │      BLE adv burst (30 s)
 │  │ accel     │  wake   │ MCU+radio   │──┼──▶  event {tagID, seq,
 │  └───────────┘         │ CR2032      │  │        impact features}
 │   sleeping @ ~3 µA until impact        │
 └──────────────────────────────────────────┘
                                   │
                                   ▼
                       ┌───────────────────────┐
                       │ iPhone app            │
                       │ bg BLE scan (UUID)    │
                       │ + GPS fix on receipt  │
                       │ + tag→club mapping    │
                       │ + round editing/dedup │
                       └───────────┬───────────┘
                                   ▼
                     open store (SQLite / CSV export)
                        │                    │
                        ▼                    ▼
               Scratch Golf Roadmap    future: merge with
               round log (Obsidian)    openflight range data
```

Detection two-factor gate (firmware): accel interrupt >8 g → capture ~100 ms ring buffer @ 1.6 kHz → require (a) preceding downswing build-up over ~1 s AND (b) sharp broadband transient with post-impact shaft ringing → store + advertise. Bag jostle fails (a); practice swing fails (b).
