import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryOnCourseStorage } from "../src/openroundOnCoursePersistence.ts";
import {
  ACTIVE_ROUND_STORAGE_KEY,
  createActiveRoundSummary,
  endSavedRound,
  loadRoundSession,
  openSavedRound,
  upsertSavedHole,
  type ActiveRoundSummary,
} from "../src/openroundRoundSession.ts";
import { ROUNDS_STORAGE_KEY, type SavedHole, type SavedRound } from "../src/openroundRounds.ts";

const validTeeBox = (value: unknown) => value === "blue" || value === "white";

function savedRound(id: string, courseId: string, endedAt: string | null = null): SavedRound {
  return {
    id,
    courseId,
    courseName: courseId.toUpperCase(),
    teeBox: "blue",
    startedAt: "2026-09-21T10:00:00.000Z",
    endedAt,
    golfers: [],
    holes: [],
  };
}

function savedHole(holeNumber: number): SavedHole {
  return {
    holeNumber,
    session: "{}",
    log: {} as SavedHole["log"],
    onCourse: {} as SavedHole["onCourse"],
    friendScores: {},
  };
}

test("round session hydration restores the active summary and matching open record", () => {
  const activeRound: ActiveRoundSummary = createActiveRoundSummary(
    { id: "course-1", name: "Course · Lakes" },
    "demo-course",
    4,
    "blue",
    "paused",
  );
  const storage = createMemoryOnCourseStorage({
    [ACTIVE_ROUND_STORAGE_KEY]: JSON.stringify(activeRound),
    [ROUNDS_STORAGE_KEY]: JSON.stringify([savedRound("record-1", "course-1")]),
  });
  const state = loadRoundSession(storage, () => undefined, validTeeBox);

  assert.deepEqual(state.activeRound, activeRound);
  assert.equal(state.roundRecordId, "record-1");
  assert.equal(state.savedRounds.length, 1);
});

test("opening a round closes the previous open record and creates the new lifecycle record", () => {
  const transition = openSavedRound([savedRound("old", "course-old")], {
    currentRecordId: "old",
    newRound: true,
    id: "new",
    course: { id: "course-new", name: "New Course" },
    teeBox: "white",
    golfers: ["Alex"],
    startedAt: "2026-09-21T11:00:00.000Z",
  });

  assert.equal(transition.created, true);
  assert.equal(transition.rounds[0]?.endedAt, "2026-09-21T11:00:00.000Z");
  assert.deepEqual(transition.record, transition.rounds[1]);
  assert.deepEqual(transition.record.golfers, ["Alex"]);
});

test("hole persistence replaces one hole without disturbing the archive order", () => {
  const rounds = [savedRound("round-1", "course-1")];
  const withSecondHole = upsertSavedHole(
    upsertSavedHole(rounds, "round-1", savedHole(2)),
    "round-1",
    savedHole(1),
  );
  const replaced = upsertSavedHole(withSecondHole, "round-1", savedHole(2));

  assert.deepEqual(replaced[0]?.holes.map((hole) => hole.holeNumber), [1, 2]);
  assert.equal(endSavedRound(replaced, "round-1", "2026-09-21T12:00:00.000Z")[0]?.endedAt, "2026-09-21T12:00:00.000Z");
});
