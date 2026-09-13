import { parseStoredRoundLog, type RoundLog } from "./openroundModel.ts";
import { parseStoredOnCourseState, type OnCourseState } from "./openroundOnCourseModel.ts";
import type { OnCourseStorage } from "./openroundOnCoursePersistence.ts";

export type SavedHole = {
  holeNumber: number;
  session: string;
  log: RoundLog;
  onCourse: OnCourseState;
  friendScores: Record<string, number>;
};

export type SavedRound = {
  id: string;
  courseId: string;
  courseName: string;
  teeBox: string;
  startedAt: string;
  endedAt: string | null;
  golfers: string[];
  holes: SavedHole[];
};

export const ROUNDS_STORAGE_KEY = "openround:rounds:v1";

export function loadRounds(storage: OnCourseStorage | undefined, validateSession: (value: unknown) => unknown): SavedRound[] {
  try {
    const value = JSON.parse(storage?.getItem(ROUNDS_STORAGE_KEY) ?? "[]");
    if (!Array.isArray(value) || new Set(value.map((round) => round?.id)).size !== value.length) return [];
    return value.filter((round): round is SavedRound => {
      if (!round || typeof round !== "object" ||
        ![round.id, round.courseId, round.courseName, round.teeBox].every((v) => typeof v === "string" && v.length > 0 && v.length <= 160) ||
        typeof round.startedAt !== "string" || !Number.isFinite(Date.parse(round.startedAt)) ||
        !(round.endedAt === null || typeof round.endedAt === "string" && Number.isFinite(Date.parse(round.endedAt))) ||
        !Array.isArray(round.golfers) || round.golfers.length > 3 ||
        !round.golfers.every((name: unknown) => typeof name === "string" && name.trim().length > 0 && name.length <= 40) ||
        new Set(round.golfers).size !== round.golfers.length ||
        !Array.isArray(round.holes) || round.holes.length > 18) return false;
      return new Set(round.holes.map((hole: SavedHole) => hole?.holeNumber)).size === round.holes.length &&
        round.holes.every((hole: SavedHole) => {
          if (!hole || !Number.isInteger(hole.holeNumber) || hole.holeNumber < 1 || hole.holeNumber > 18 ||
            typeof hole.session !== "string" || !hole.friendScores || typeof hole.friendScores !== "object" || Array.isArray(hole.friendScores)) return false;
          const log = parseStoredRoundLog(hole.log);
          const state = parseStoredOnCourseState(hole.onCourse);
          let session;
          try { session = JSON.parse(hole.session); } catch { return false; }
          return log && state && log.courseId === round.courseId && state.courseId === round.courseId &&
            log.holeNumber === hole.holeNumber && state.holeNumber === hole.holeNumber &&
            validateSession(session) && session.roundId === log.roundId && log.roundId === state.roundId &&
            session.courseId === round.courseId && session.holeNumber === hole.holeNumber && session.score === log.score &&
            Object.entries(hole.friendScores).every(([name, score]) => round.golfers.includes(name) && Number.isInteger(score) && score >= 1 && score <= 20);
        });
    });
  } catch {
    return [];
  }
}

export function saveRounds(storage: OnCourseStorage | undefined, rounds: SavedRound[]): boolean {
  // ponytail: one local archive; move to IndexedDB when quota or save latency limits round history.
  try {
    if (!storage) return false;
    storage.setItem(ROUNDS_STORAGE_KEY, JSON.stringify(rounds));
    return true;
  } catch {
    return false;
  }
}

export function roundTotals(round: SavedRound) {
  const outcomes = round.holes.flatMap((hole) => hole.onCourse.holes.filter((outcome) => outcome.holeNumber === hole.holeNumber));
  return {
    holes: outcomes.length,
    score: outcomes.reduce((sum, hole) => sum + hole.score, 0),
    putts: outcomes.length > 0 && outcomes.every((hole) => hole.putts !== null)
      ? outcomes.reduce((sum, hole) => sum + (hole.putts ?? 0), 0) : null,
    gpsShots: round.holes.reduce((sum, hole) => sum + hole.log.events.filter((event) => event.holeNumber === hole.holeNumber && event.kind === "gps_shot").length, 0),
  };
}
