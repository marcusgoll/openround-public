# Normalized round JSON

`openround import` consumes this vendor-neutral format; every source adapter
(Shot Scope scraper, future OpenRound tags, manual entry) converts into it.
Rounds are keyed by `(source, source_id)` — re-importing replaces, never duplicates.
New imports require nonblank `source`, `source_id`, and `played_at`. Older
databases may contain legacy rounds with `source_id: null`; those rows remain
readable, but new id-less imports are rejected.

```json
{
  "source": "shotscope",
  "source_id": "12345",
  "played_at": "2026-08-17",
  "course": "Squaw Valley GC - Lakes",
  "tees": "Blue",
  "score": 85,
  "holes": [
    {
      "number": 1,
      "par": 4,
      "strokes": 5,
      "putts": 2,
      "fairway": "left",
      "gir": 0,
      "penalties": 0,
      "up_and_down": "missed",
      "shots": [
        {
          "seq": 1,
          "source_event_id": "vendor-event-1",
          "club": "Driver",
          "lat": 32.335, "lon": -97.706,
          "end_lat": 32.337, "end_lon": -97.705,
          "distance_m": 215.0,
          "distance_type": "total_gps",
          "lie": "tee",
          "end_lie": "rough",
          "timestamp": "2026-08-17T14:02:11Z"
        }
      ]
    }
  ]
}
```

Field notes:

- `fairway`: `hit | left | right | short | long | missed`, omit for par 3s /
  unknown (`missed` is for sources like Shot Scope's v2 API that only expose a
  hit/miss boolean, not the miss direction).
- Holes may carry `pin_lat`/`pin_lon` (Shot Scope PinCollect, future pin-mark
  tap) — the input strokes-gained-approach needs later.
- `putts_total` (round level) is the vendor-reported putt count; stats fall
  back to it when per-hole putts are incomplete (e.g. no putter tag).
- `gir` (0/1) and `up_and_down` (`converted | missed`) may be omitted — stats.py
  derives them from strokes/putts/par with the standard definitions.
- `score` may be omitted when every hole has `strokes` (it is summed).
- `shots` is optional per hole; per-hole stats work without it. When present,
  `distance_type` distinguishes on-course GPS totals (`total_gps`) from
  openflight radar carries (`carry_radar`) so the two are never averaged together.
- `penalties` defaults to 0.

## Stable shot identity and evidence

Each imported shot has the stable identity `(source, source_id, event_key)`.
Adapters may provide the optional normalized `source_event_id`; it is used as
`event:<source_event_id>`. When it is absent, `event_key` is
`fingerprint:<sha256>` over canonical normalized `{"hole": ..., "shot": ...}`
JSON. The synthetic ordering field `seq` is excluded from that fingerprint, so
renumbering a shot does not change its occurrence identity. Identical fallback
events in one hole are rejected as ambiguous.

The database stores this canonical normalized payload in immutable
`shot_evidence`, not the raw vendor response or raw filesystem export. An
identical re-import reuses its evidence row; changed normalized evidence under
one identity fails closed. Evidence rows that become unreferenced when the
normalized projection is replaced are intentionally retained as an append-only
audit archive; this slice has no garbage collector. Legacy shots can have
`evidence_id: null` because no evidence is fabricated during migration.

`db.import_rounds()` validates the complete list before acquiring one SQLite
write transaction. The normalized-file CLI parses every file before calling
that batch API, and prints success only after the database commit. Shot Scope
exporter-created raw and normalized files are a separate filesystem boundary:
database rollback does not remove files already written by the exporter.
