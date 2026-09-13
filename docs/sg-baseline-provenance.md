# Optional strokes-gained benchmarks

OpenRound distributes no calibrated expected-strokes dataset. Its calculations
use an optional JSON file supplied by the user. Obtain permission to use your
chosen dataset and retain its source, population, vintage, and license details.
OpenRound validates its structure, not its accuracy or authorization.

Set `OPENROUND_SG_BASELINE` to the file path before running `openround sg` or
`openround shotmap`. Without a valid file, the SG command reports that SG is
unavailable; ordinary imports and statistics continue to work, and the shot map
shows unavailable SG values. No real-world benchmark is implied by a zero.

## JSON schema

The root object requires:

- `name`: a nonempty string naming the benchmark and its provenance. This name
  is displayed in SG reports and the shot map. Include the source and vintage.
- `putting_ft`: a nonempty array of `[distance_feet, expected_strokes]` rows.
- `off_green_yd`: an object containing nonempty row arrays for every required lie:
  `tee`, `fairway`, `rough`, `sand`, and `recovery`. Distances are yards.

Each row must contain exactly two finite, nonnegative JSON numbers. Distances
must strictly increase within each table. Booleans, duplicate distances, empty
tables, missing lies, and non-finite values are rejected. A one-row table is
allowed and gives a constant value at all distances. Additional metadata fields
are allowed, so source URLs and license notes can remain with the dataset.

For example, these values are invented solely to illustrate the format. They
are **not calibrated golf statistics** and should not be used to assess play:

```json
{
  "name": "Synthetic schema example; not calibrated",
  "putting_ft": [[1, 1], [10, 3]],
  "off_green_yd": {
    "tee": [[10, 2], [100, 5]],
    "fairway": [[10, 2], [100, 5]],
    "rough": [[10, 3], [100, 6]],
    "sand": [[10, 4], [100, 7]],
    "recovery": [[10, 5], [100, 8]]
  }
}
```

## Calculation behavior

Expected strokes are linearly interpolated between rows and clamped to endpoint
values outside a table's range. A holed position is zero. Green lies use the
putting table, penalty lies use recovery, and unknown lies use rough.

Per-shot SG is expected strokes at the start minus expected strokes at the end
minus the shot cost. Shot cost is one, plus one when a lost-ball or water-hazard
flag applies. Coordinates and remaining-distance chains determine distance;
missing geometry can exclude a shot. An undetected zero-distance putt receives
the existing two-foot distance floor, and implausibly long putts are excluded.
These geometry rules do not establish that a supplied benchmark is calibrated.

Tests use `tests/fixtures/synthetic-sg.json`, an independently invented arithmetic
fixture. It verifies interpolation, endpoint clamping, lie selection, penalty
costs, and the whole-hole telescoping identity without reproducing any published
benchmark.
