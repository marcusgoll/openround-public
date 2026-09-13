# OpenRound field-log format

Use this format for the real-iPhone release gate in `course-library-field-test.md`. The evaluator is deterministic and does not create measurements.

Run it from `prototypes/openround-iphone`:

```text
npm run evaluate:course-field-log -- path/to/field-log.json --personal-beta
```

Each run records one device/course/hole combination. The personal beta uses one iPhone across Squaw Valley Links, Squaw Valley Lakes, and a geographically separate control; record any incomplete hole as its actual grade instead of promoting it to ready. In the on-course sheet, **CAPTURE FRESH FIX** reads the current phone GPS timestamp and fills only accuracy and fix age; expected and recorded yards remain explicit measurements so the evidence cannot be self-derived. For a walked-distance check, **CAPTURE GPS START** stores a fresh start fix, then **CAPTURE GPS END** stores a second fresh fix and computes the recorded yards with the same deterministic haversine-style distance function used by the app. Both endpoint coordinates and endpoint fix ages are exported with `source: "phone_pair"`; the evaluator rejects a pair whose recorded yards do not match its endpoints within 2 yd, or whose endpoint fix is older than the release threshold.

The following is a schema-only example with illustrative placeholder measurements. Replace every value with a fresh export from the test iPhone before evaluating; do not submit these numbers as field evidence.

```json
{
  "version": 1,
  "runs": [
    {
      "id": "field-run-2026-08-30-squaw-links-hole-1",
      "device": "iPhone current",
      "courseId": "personal-squaw-valley-links-osm-v1",
      "hole": 1,
      "teeBox": "blue",
      "geometryGrade": "B",
      "geometryVersion": "personal-osm-links-v2",
      "gps": [
        { "expectedYards": 100, "recordedYards": 99, "accuracyMeters": 5, "fixAgeSeconds": 2 }
      ],
      "alignment": { "lateralYards": 6, "longitudinalYards": 8 },
      "imagery": {
        "provider": "usgs",
        "attributionVisible": true,
        "overlayAligned": true,
        "alignmentZooms": { "oneX": true, "twoX": true }
      },
      "createdAt": "2026-08-30T12:00:00.000Z"
    }
  ]
}
```

A two-fix sample has this additional shape (the compatibility `fixAgeSeconds` is the end-fix age):

```json
{
  "expectedYards": 100,
  "recordedYards": 100,
  "accuracyMeters": 6,
  "fixAgeSeconds": 1,
  "source": "phone_pair",
  "start": { "lat": 32.000000, "lon": -97.000000 },
  "end": { "lat": 32.000824, "lon": -97.000000 },
  "startFixAgeSeconds": 2,
  "endFixAgeSeconds": 1
}
```

The command fails closed unless the log contains at least one device, three courses, one valid GPS sample for every course, grade-A/B alignment evidence from at least two courses, and imagery evidence for every run. New app captures also record the active `teeBox` (`blue`, `white`, `gold`, `black`, or `red`) automatically from round setup; legacy v1 exports may omit it for historical comparison. GPS thresholds are checked both overall and per course, so a failing course cannot be hidden by stronger results elsewhere. Add `--personal-beta` for the one-phone release gate; that profile additionally requires payload `version: 1`, a unique `id`, non-empty `geometryVersion`, and valid `createdAt` timestamp on every run, exactly one device, both `personal-squaw-valley-links-osm-v1` and `personal-squaw-valley-lakes-pending-v1`, a third control course, a valid tee box on every run, and at least one valid `source: "phone_pair"` sample for every course. `provider` is `usgs` for the no-key path, `google` only when a user-supplied key is configured, or `bundled` for the offline fallback. `attributionVisible` and `overlayAligned` must both be `true`; new personal-beta captures must also include `alignmentZooms` with both `oneX` and `twoX` set to `true`, recorded after checking the overlay at each zoom. Legacy v1 exports without this optional object remain readable for historical comparison, but should be recollected for the release gate. New app captures include `fixAgeSeconds`, measured from the browser GPS timestamp to the capture; the evaluator reports max/p95 age and rejects any recorded age above 20 seconds. It reports overall and per-course GPS median/p95 error, maximum reported accuracy, maximum lateral/longitudinal alignment mismatch, GPS freshness, tee boxes observed, the number of courses with valid phone pairs, and the imagery providers observed. The current release gate applies GPS median ≤3%, accuracy ≤12 m, fix age ≤20 s, and alignment ≤10 yd; p95 is reported for review and future thresholding.
