import assert from "node:assert/strict";
import test from "node:test";
import {
  CLUB_STATISTICS_STORAGE_KEY,
  createEmptyClubStatistics,
  ingestClubStatistics,
  loadClubStatistics,
  projectClubStatisticSamples,
  saveClubStatistics,
} from "../src/openroundClubStatistics.ts";
import { createMemoryOnCourseStorage } from "../src/openroundOnCoursePersistence.ts";
import type { OnCourseIdentity, ShotDistanceSample } from "../src/openroundOnCourseModel.ts";

function sample(index: number, overrides: Partial<ShotDistanceSample> = {}): ShotDistanceSample {
  return {
    id: `sample-event-${index}`,
    eventId: `event-${index}`,
    holeNumber: 1,
    clubId: "club-6",
    clubName: "6 Iron",
    yards: 160 + index,
    kind: "gps",
    savedToBag: false,
    createdAt: `2026-08-${String(index + 1).padStart(2, "0")}T12:00:00.000Z`,
    ...overrides,
  };
}

const firstHole: OnCourseIdentity = { roundId: "round-a", courseId: "course-a", holeNumber: 1 };
const secondHole: OnCourseIdentity = { roundId: "round-a", courseId: "course-a", holeNumber: 2 };

test("statistics accept live GPS across holes, dedupe replays, and update reviewed state", () => {
  let state = createEmptyClubStatistics();
  state = ingestClubStatistics(state, { mode: "demo", identity: firstHole, samples: [sample(1)] });
  assert.equal(state.records.length, 0);

  state = ingestClubStatistics(state, { mode: "live", identity: firstHole, samples: [sample(1)] });
  state = ingestClubStatistics(state, { mode: "live", identity: firstHole, samples: [sample(1)] });
  state = ingestClubStatistics(state, {
    mode: "live",
    identity: firstHole,
    samples: [sample(1, { savedToBag: true })],
  });
  state = ingestClubStatistics(state, { mode: "live", identity: secondHole, samples: [sample(2, { holeNumber: 2 })] });

  assert.equal(state.records.length, 2);
  assert.deepEqual(projectClubStatisticSamples(state).map(({ yards, savedToBag }) => ({ yards, savedToBag })), [
    { yards: 161, savedToBag: true },
    { yards: 162, savedToBag: false },
  ]);
});

test("statistics retain only the newest 20 records per club", () => {
  const samples = Array.from({ length: 24 }, (_, index) => sample(index));
  const state = ingestClubStatistics(createEmptyClubStatistics(), { mode: "live", identity: firstHole, samples });
  const projected = projectClubStatisticSamples(state);
  assert.equal(projected.length, 20);
  assert.equal(projected[0]?.yards, 164);
  assert.equal(projected.at(-1)?.yards, 183);
});

test("statistics persistence is versioned and malformed storage fails closed", () => {
  const storage = createMemoryOnCourseStorage();
  const state = ingestClubStatistics(createEmptyClubStatistics(), { mode: "live", identity: firstHole, samples: [sample(1)] });
  saveClubStatistics(storage, state);
  assert.equal(projectClubStatisticSamples(loadClubStatistics(storage)).length, 1);

  const malformed = createMemoryOnCourseStorage({ [CLUB_STATISTICS_STORAGE_KEY]: "{bad" });
  assert.deepEqual(loadClubStatistics(malformed), createEmptyClubStatistics());
});
