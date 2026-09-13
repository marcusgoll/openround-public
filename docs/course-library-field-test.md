# OpenRound real-device course-library field test

This is the release gate for the parts a local prototype cannot prove: phone GPS behavior, imagery alignment, and course coverage in the field.

## Devices and courses

This personal beta is intentionally limited to one iPhone, tested on both cellular and Wi-Fi, with location permission set to **While Using the App**. Use the two Squaw Valley layouts in Glen Rose, TX plus one geographically separate control course. Record the course ID, hole number, tee color, and geometry grade for every run.

Squaw Valley is not present in the pinned OpenGolfAPI v2.1.0 US release, so the app keeps two personal seeds outside the bulk catalog checksum. The OSM-mapped facility center is 32.25769, -97.72271. The refreshed geometry snapshot separates the Apache Links and Comanche Lakes OSM cohorts instead of mixing them. Treat both as personal OSM candidates, not provider-certified identities, until the field check confirms them on site.

Suggested first fixtures from the pinned catalog:

- Egyptian Country Club, Mounds, IL (`0e1e596d-8e86-4ff8-90e9-6a439a0ba271`)
- Pinehurst Resort Country Club No 2, Pinehurst, NC (`86620a66-2f67-409e-8aaa-8d503d820631`)
- A local course selected with **NEAR ME** so the GPS matching path is exercised rather than name search only

Personal beta seeds:

- Squaw Valley Golf Course · Links, Glen Rose, TX (`personal-squaw-valley-links-osm-v1`) — separated OSM candidate bundle, validate against Apache Links on site; provider pin is not assumed
- Squaw Valley Golf Course · Lakes, Glen Rose, TX (`personal-squaw-valley-lakes-pending-v1`) — separated OSM candidate bundle, validate against Comanche Lakes on site; hole 13 is grade B with hazards usable but pin unverified, while any incomplete holes remain preview-only

The repeatable network probe (`npm run verify:course-geometry`) was rerun against the pinned release on 2026-08-29. It returned complete tee/green/path layers for Egyptian Country Club (grade B, hazards withheld), Pinehurst No. 2 (grade B, hazards distance-ready), Pebble Beach (grade A, pin verified, hazards distance-ready), Apache Links (grade B, pin not verified, hazards distance-ready), and Comanche Lakes (grade A, pin verified, hazards distance-ready). A fresh workstation rerun on 2026-08-30 failed closed for all five samples (`fetch failed` on the default endpoint), so no new geometry was promoted. A subsequent run through the optional `https://maps.mail.ru/osm/tools/overpass/api/interpreter` mirror passed all five samples with zero-drift projection checks; a repeat run later aborted on the Pinehurst request, so the mirror is treated as opportunistic refresh-path reachability rather than a reliability guarantee. It must never replace the pinned bundle or permit live geometry during a round. The shared endpoint has also returned HTTP 429 during earlier reruns. Hazard distances remain withheld when a mapped hazard layer is absent or incomplete. This validates provider parsing, not phone GPS accuracy or visual alignment.

The latest mirror probe on 2026-08-30 completed all five samples in one run: Squaw Valley Links hole 1 was grade A with tee, green, fairway, bunker, and pin layers; Squaw Valley Lakes hole 1 was grade A with tee, green, fairway, centerline, bunker, water, and pin layers; Egyptian hole 1 was grade B with tee, green, and centerline layers and hazards withheld; Pinehurst No. 2 hole 1 was grade B with tee, green, fairway, centerline, bunker, and water layers and hazards distance-ready; and Pebble Beach hole 1 was grade A with tee, green, fairway, centerline, bunker, and pin layers and hazards distance-ready. Every sample passed the normalized projection round trip with zero reported drift. This is stronger refresh-path evidence only; it still does not substitute for the required physical-iPhone GPS and 1×/2× imagery alignment checks.

The real-course overlay and satellite layer now share the same Web Mercator world-pixel transform. The model suite checks the normalized geometry transform and the multi-course probe checks every returned feature for in-bounds, zero-drift projection. The versioned geometry cache currently pins partial representative bundles (8 holes for Egyptian Country Club, 11 for Pebble Beach, and 14 for Pinehurst No. 2) plus 18-hole personal Squaw Valley Links and Lakes cohorts. Each record is checksum-verified at runtime; missing holes remain graded and the UI withholds unsafe distances. These are deterministic transform checks; they do not replace the on-device imagery alignment check below.

The no-key imagery path is also wired for the free stack: Google tiles are used only when a user-supplied key creates a session; otherwise the PWA requests a display-only, high-density USGS/USDA NAIP Plus viewport export and keeps level-16 USGS tiles underneath as a fallback. Both paths use the same level-16 Web Mercator world-pixel scale as the overlays. A zero-cost probe on 2026-08-29 returned `200 image/jpeg` for Squaw Valley, Egyptian Country Club, Pinehurst No. 2, and Pebble Beach, and the NAIP Plus `exportImage` endpoint returned `200 image/jpeg` for a Squaw Valley viewport on 2026-08-30. This proves endpoint reachability, not that every course has current leaf-on imagery; the device check must still record provider status and visual alignment.

## Acceptance checks

### One-phone PWA install gate

Run this gate on the single test iPhone before treating the prototype as course-ready:

1. Open the production build from an HTTPS/local-network URL in Safari. The browser must show the OpenRound title and install metadata; do not use the Vite development server for the install check.
2. In Safari, use **Share → Add to Home Screen**, launch OpenRound from the new icon, and confirm it opens in portrait standalone mode without browser chrome.
3. Turn on **While Using the App** location permission. Select **Squaw Valley Golf Course → Lakes**, then repeat with **Links**. Confirm the selected course and hole survive a reload.
4. On each layout, verify the top-facing map (tee at the bottom, hole at the top), Pin green zoom, aim drag/reset, club switching, and the Driver → next-club GPS handoff. Open the on-course field log and use **CAPTURE FRESH FIX** for the phone-reported accuracy/fix age, then check overlay alignment at both 1× and 2× zoom and record any map/overlay drift.
5. Turn on Airplane Mode after the first successful load. The OpenRound shell and bundled course data should still open; remote USGS/Google imagery may be unavailable and must never be reported as cached or verified offline.
6. Remove the Home Screen copy after the run if this is a shared test phone. No account, payment, or cloud sync is required for this personal beta.

1. Search returns the intended course and confirms the course/hole before replacing the round.
2. **NEAR ME** requests a fresh high-accuracy phone fix, ranks by haversine distance, and shows no results when permission/fix is unavailable.
3. Reload restores the confirmed course and hole from local storage; returning to the demo explicitly clears that selection.
4. The map centers on the selected course. Pinch zoom keeps the overlay and live satellite imagery aligned at 1× and 2×, whether the USGS viewport export or tile fallback is visible. In the field log, mark both explicit alignment checks only after visually confirming each zoom; a single zoom check is not sufficient for the personal-beta gate.
   - With no Google key, confirm the map status reads `SATELLITE · USGS READY` and the attribution reads `USGS / USDA NAIP`; do not treat a blank or stale tile as a geometry failure.
   - Tap two different hazard shapes. Only the selected hazard should show a distance callout, and its leader line must terminate on that selected shape rather than on the fairway or another hazard.
5. Hole geometry shows its A/B/C/D grade. Missing tee, green, path, pin, or hazard layers are visibly reported.
6. No numeric hazard distance appears for a hole that has not passed the required geometry checks. GPS shot start/end and total distance remain phone evidence and do not move when the course map is incomplete.
7. On a real course with a loaded green, **PIN** zooms to the green and accepts only an in-green tap. A missing provider pin must not silently become a green-centroid pin until the golfer explicitly places it.
8. Walk 50–100 yards between two fixes and compare the app's total GPS distance to a trusted phone measurement. In the field log, use **CAPTURE GPS START**, walk the measured segment, then use **CAPTURE GPS END**; the app computes `recordedYards` from the two fresh phone fixes and exports both endpoints with `source: "phone_pair"`. Enter the trusted expected yards separately. The personal-beta gate requires at least one valid `phone_pair` sample for each of Links, Lakes, and the control; manually typed distances remain useful for exploratory logs but cannot satisfy this release gate. Record median error, 95th-percentile error, the exported endpoint `startFixAgeSeconds`/`endFixAgeSeconds` (and compatibility `fixAgeSeconds`), and reported accuracy. Fresh samples must be no older than 20 seconds at capture.
9. Compare tee/green/hazard overlay alignment against the course's published scorecard or an on-site reference at both 1× and 2×. Mark both field-log alignment checks and record the largest lateral and longitudinal mismatch in yards.
10. Test a weak-signal area, background/lock-screen transition, denied permission, and a stale fix. The app must fail closed and offer a retry, not save an invented endpoint or distance.
11. Capture attribution and provider status in screenshots for the release record.
12. Export the measurements to the field-log format and run `npm run evaluate:course-field-log -- path/to/field-log.json --personal-beta`. Confirm every new run contains the tee box automatically captured from round setup (`blue`, `white`, or `gold`). A failed report remains a release blocker; do not average away an unsafe accuracy or alignment result.

## Release thresholds

- GPS: median total-distance error ≤ 3%, no accepted shot with an accuracy estimate above 12 m, and no exported fix older than 20 seconds at capture.
- Alignment: ≤ 10 yd lateral mismatch for a grade-A/B hole; grade-C/D holes remain preview-only.
- Reliability: three complete course selections and two hole changes on the single test iPhone without a crash or data loss.
- Legal: provider terms, key restrictions, attribution, and ODbL/share-alike obligations reviewed before production distribution.
