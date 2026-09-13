-- OpenRound open schema. One database holds every source: Shot Scope history,
-- future OpenRound tag rounds, and openflight range sessions (via distance_type).

CREATE TABLE IF NOT EXISTS clubs (
    id       INTEGER PRIMARY KEY,
    name     TEXT NOT NULL UNIQUE,          -- 'Driver', '7 Iron', 'PW', ...
    category TEXT,                          -- wood | hybrid | iron | wedge | putter
    shaft    TEXT                           -- steel | graphite
);

CREATE TABLE IF NOT EXISTS rounds (
    id        INTEGER PRIMARY KEY,
    source    TEXT NOT NULL,                -- 'shotscope' | 'openround' | 'manual'
    source_id TEXT,                         -- vendor round id (dedup key)
    played_at TEXT NOT NULL,                -- ISO date
    course    TEXT,
    tees      TEXT,
    holes     INTEGER,                      -- 9 | 18
    score     INTEGER,
    putts     INTEGER,                      -- vendor round total; fallback when per-hole putts are incomplete
    UNIQUE (source, source_id)
);

CREATE TABLE IF NOT EXISTS holes (
    id          INTEGER PRIMARY KEY,
    round_id    INTEGER NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
    number      INTEGER NOT NULL,
    par         INTEGER,
    strokes     INTEGER,
    putts       INTEGER,
    fairway     TEXT,                       -- hit | left | right | short | long | NULL (par 3 / unknown)
    gir         INTEGER,                    -- 0/1; NULL = derive from strokes-putts vs par
    penalties   INTEGER NOT NULL DEFAULT 0,
    up_and_down TEXT,                       -- converted | missed | NULL (derive when NULL)
    pin_lat     REAL,                       -- pin position (Shot Scope PinCollect / future pin-mark tap)
    pin_lon     REAL,
    UNIQUE (round_id, number)
);

CREATE TABLE IF NOT EXISTS shot_evidence (
    id               INTEGER PRIMARY KEY,
    source           TEXT NOT NULL,
    source_round_id  TEXT NOT NULL,
    event_key        TEXT NOT NULL,
    source_event_id  TEXT,
    fingerprint      TEXT,
    canonical_json   TEXT NOT NULL,
    canonical_sha256 TEXT NOT NULL,
    created_at       TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (source, source_round_id, event_key),
    CHECK (
        (source_event_id IS NOT NULL AND fingerprint IS NULL)
        OR (source_event_id IS NULL AND fingerprint IS NOT NULL)
    )
);

CREATE TRIGGER IF NOT EXISTS shot_evidence_immutable_update
BEFORE UPDATE ON shot_evidence
BEGIN
    SELECT RAISE(ABORT, 'shot evidence is immutable');
END;

CREATE TRIGGER IF NOT EXISTS shot_evidence_immutable_delete
BEFORE DELETE ON shot_evidence
BEGIN
    SELECT RAISE(ABORT, 'shot evidence is immutable');
END;

CREATE TABLE IF NOT EXISTS shots (
    id            INTEGER PRIMARY KEY,
    round_id      INTEGER NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
    hole          INTEGER,
    seq           INTEGER,                  -- shot number within the hole
    club          TEXT,
    lat           REAL,
    lon           REAL,
    end_lat       REAL,
    end_lon       REAL,
    distance_m    REAL,
    distance_type TEXT,                     -- 'total_gps' | 'carry_radar'
    lie           TEXT,                     -- tee | fairway | rough | sand | green | penalty
    end_lie       TEXT,
    remaining_m   REAL,                     -- distance to the hole AFTER this shot (NULL/0 = holed); the strokes-gained input
    positional    INTEGER NOT NULL DEFAULT 0, -- layup/positional: exclude from club distance averages (P-AVG rule)
    lost_ball     INTEGER NOT NULL DEFAULT 0,
    water_hazard  INTEGER NOT NULL DEFAULT 0,
    timestamp     TEXT,
    temperature_c REAL,
    source        TEXT NOT NULL DEFAULT 'shotscope',
    source_event_id TEXT,
    evidence_id   INTEGER REFERENCES shot_evidence(id)
);

CREATE INDEX IF NOT EXISTS idx_shots_round ON shots(round_id, hole, seq);
CREATE INDEX IF NOT EXISTS idx_holes_round ON holes(round_id, number);
CREATE INDEX IF NOT EXISTS idx_shot_evidence_identity
    ON shot_evidence(source, source_round_id, event_key);
