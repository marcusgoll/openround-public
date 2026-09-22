import { useCallback, useEffect, useRef, useState, type SetStateAction } from "react";
import { getBrowserOnCourseStorage, type OnCourseStorage } from "./openroundOnCoursePersistence.ts";
import { loadRounds, saveRounds, type SavedHole, type SavedRound } from "./openroundRounds.ts";

export const ACTIVE_ROUND_STORAGE_KEY = "openround:active-round:v1";
export const ROUND_SESSION_STORAGE_KEY = "openround:round-session:v1";

export type ActiveRoundStatus = "ready" | "tracking" | "paused" | "complete";

export type ActiveRoundSummary = {
  version: 1;
  courseId: string;
  courseName: string;
  layoutLabel: string;
  holeNumber: number;
  teeBox: string;
  status: ActiveRoundStatus;
  updatedAt: string;
};

export type RoundSessionCourse = {
  id: string;
  name: string;
};

export type RoundSessionState = {
  activeRound: ActiveRoundSummary | null;
  savedRounds: SavedRound[];
  roundRecordId: string | null;
  roundSaveError: boolean;
};

export function loadStoredActiveRound(
  storage: OnCourseStorage | undefined,
  isValidTeeBox: (value: unknown) => boolean,
): ActiveRoundSummary | null {
  if (!storage) return null;
  try {
    const storedValue = storage.getItem(ACTIVE_ROUND_STORAGE_KEY);
    if (!storedValue) return null;
    const parsed: unknown = JSON.parse(storedValue);
    if (isActiveRoundSummary(parsed, isValidTeeBox)) return parsed;
    removeStorageValue(storage, ACTIVE_ROUND_STORAGE_KEY);
    return null;
  } catch {
    removeStorageValue(storage, ACTIVE_ROUND_STORAGE_KEY);
    return null;
  }
}

function persistActiveRoundSummary(
  storage: OnCourseStorage | undefined,
  activeRound: ActiveRoundSummary | null,
): void {
  if (!storage) return;
  try {
    if (activeRound) storage.setItem(ACTIVE_ROUND_STORAGE_KEY, JSON.stringify(activeRound));
    else removeStorageValue(storage, ACTIVE_ROUND_STORAGE_KEY);
  } catch {
    // The round remains usable in memory when local storage is unavailable.
  }
}

export function loadRoundSession(
  storage: OnCourseStorage | undefined,
  validateStoredSession: (value: unknown) => unknown,
  isValidTeeBox: (value: unknown) => boolean,
): RoundSessionState {
  const activeRound = loadStoredActiveRound(storage, isValidTeeBox);
  const savedRounds = loadRounds(storage, validateStoredSession);
  const roundRecordId = [...savedRounds]
    .reverse()
    .find((round) => round.endedAt === null && round.courseId === activeRound?.courseId)?.id ?? null;
  return { activeRound, savedRounds, roundRecordId, roundSaveError: false };
}

export function createActiveRoundSummary(
  course: RoundSessionCourse | null,
  demoCourseId: string,
  holeNumber: number,
  teeBox: string,
  status: ActiveRoundStatus,
): ActiveRoundSummary {
  const isDemo = !course || course.id === demoCourseId;
  const layout = course?.name.split("·").at(-1)?.trim();
  return {
    version: 1,
    courseId: course?.id ?? demoCourseId,
    courseName: course?.name ?? "DEMO COURSE",
    layoutLabel: isDemo ? "DEMO FIXTURE" : layout ? layout.toUpperCase() : "COURSE",
    holeNumber: Math.max(1, Math.min(18, Math.round(holeNumber))),
    teeBox,
    status,
    updatedAt: new Date().toISOString(),
  };
}

export type OpenSavedRoundInput = {
  currentRecordId: string | null;
  newRound: boolean;
  id: string;
  course: RoundSessionCourse;
  teeBox: string;
  golfers: readonly string[];
  startedAt: string;
};

export function openSavedRound(
  rounds: readonly SavedRound[],
  input: OpenSavedRoundInput,
): { rounds: SavedRound[]; record: SavedRound; created: boolean } {
  const current = rounds.find((round) => round.id === input.currentRecordId);
  if (!input.newRound && current && current.courseId === input.course.id && current.endedAt === null) {
    return { rounds: [...rounds], record: current, created: false };
  }

  const record: SavedRound = {
    id: input.id,
    courseId: input.course.id,
    courseName: input.course.name,
    teeBox: input.teeBox,
    startedAt: input.startedAt,
    endedAt: null,
    golfers: [...input.golfers],
    holes: [],
  };
  const nextRounds = rounds.map((round) =>
    round.id === current?.id && round.endedAt === null
      ? { ...round, endedAt: input.startedAt }
      : round,
  );
  return { rounds: [...nextRounds, record], record, created: true };
}

export function upsertSavedHole(
  rounds: readonly SavedRound[],
  recordId: string,
  hole: SavedHole,
): SavedRound[] {
  return rounds.map((round) => {
    if (round.id !== recordId || round.endedAt !== null) return round;
    return {
      ...round,
      holes: [...round.holes.filter((saved) => saved.holeNumber !== hole.holeNumber), hole]
        .sort((left, right) => left.holeNumber - right.holeNumber),
    };
  });
}

export function endSavedRound(
  rounds: readonly SavedRound[],
  recordId: string,
  endedAt: string,
): SavedRound[] {
  return rounds.map((round) => round.id === recordId ? { ...round, endedAt } : round);
}

export type OpenRoundRecordInput = {
  newRound: boolean;
  course: RoundSessionCourse;
  teeBox: string;
  golfers: readonly string[];
  startedAt: string;
};

export type SaveCurrentHoleInput = {
  courseIsDemo: boolean;
  courseId: string;
  holeNumber: number;
  roundIdentityId: string;
  onCourseIdentity: { courseId: string; holeNumber: number };
  activeRound: ActiveRoundSummary | null;
  course: RoundSessionCourse | null;
  golfers: readonly string[];
  captureHole: () => SavedHole;
};

export type OpenRoundSessionInput = {
  storage?: OnCourseStorage;
  validateStoredSession: (value: unknown) => unknown;
  isValidTeeBox: (value: unknown) => boolean;
};

export type OpenRoundSessionController = {
  activeRound: ActiveRoundSummary | null;
  setActiveRound: (next: SetStateAction<ActiveRoundSummary | null>) => void;
  savedRounds: SavedRound[];
  roundRecordId: string | null;
  roundRecordIdRef: { current: string | null };
  roundSaveError: boolean;
  openRoundRecord: (input: OpenRoundRecordInput) => SavedRound | undefined;
  saveCurrentHole: (input: SaveCurrentHoleInput) => boolean | undefined;
  endCurrentRound: (endedAt?: string) => boolean;
};

export function useOpenRoundSession(input: OpenRoundSessionInput): OpenRoundSessionController {
  const storage = input.storage ?? getBrowserOnCourseStorage();
  const [session, setSession] = useState<RoundSessionState>(() =>
    loadRoundSession(storage, input.validateStoredSession, input.isValidTeeBox),
  );
  const sessionRef = useRef(session);
  const roundRecordIdRef = useRef(session.roundRecordId);

  const commit = useCallback((update: (current: RoundSessionState) => RoundSessionState) => {
    const next = update(sessionRef.current);
    sessionRef.current = next;
    roundRecordIdRef.current = next.roundRecordId;
    setSession(next);
    return next;
  }, []);

  useEffect(() => {
    sessionRef.current = session;
    roundRecordIdRef.current = session.roundRecordId;
  }, [session]);

  useEffect(() => {
    persistActiveRoundSummary(storage, session.activeRound);
  }, [session.activeRound, storage]);

  const setActiveRound = useCallback((next: SetStateAction<ActiveRoundSummary | null>) => {
    commit((current) => ({
      ...current,
      activeRound: typeof next === "function" ? next(current.activeRound) : next,
    }));
  }, [commit]);

  const persistRounds = useCallback((next: SavedRound[], requireDurable = false): boolean => {
    const saved = saveRounds(storage, next);
    commit((current) => saved || !requireDurable
      ? { ...current, savedRounds: next, roundSaveError: !saved }
      : { ...current, roundSaveError: true });
    return saved;
  }, [commit, storage]);

  const openRoundRecord = useCallback((recordInput: OpenRoundRecordInput): SavedRound | undefined => {
    const current = sessionRef.current;
    const existing = current.savedRounds.find((round) => round.id === current.roundRecordId);
    if (!recordInput.newRound && existing && existing.courseId === recordInput.course.id && existing.endedAt === null) {
      return existing;
    }
    const transition = openSavedRound(current.savedRounds, {
      currentRecordId: current.roundRecordId,
      ...recordInput,
      id: crypto.randomUUID(),
    });
    if (!transition.created) return transition.record;
    if (!persistRounds(transition.rounds, true)) return undefined;
    commit((latest) => ({ ...latest, roundRecordId: transition.record.id }));
    return transition.record;
  }, [commit, persistRounds]);

  const saveCurrentHole = useCallback((holeInput: SaveCurrentHoleInput): boolean | undefined => {
    if (holeInput.courseIsDemo
      || holeInput.onCourseIdentity.courseId !== holeInput.courseId
      || holeInput.onCourseIdentity.holeNumber !== holeInput.holeNumber) return;

    const current = sessionRef.current;
    let recordId = current.roundRecordId;
    if (!recordId && holeInput.activeRound && holeInput.course) {
      const id = current.savedRounds.some((round) => round.id === holeInput.roundIdentityId)
        ? crypto.randomUUID()
        : holeInput.roundIdentityId;
      const record: SavedRound = {
        id,
        courseId: holeInput.course.id,
        courseName: holeInput.course.name,
        teeBox: holeInput.activeRound.teeBox,
        startedAt: holeInput.activeRound.updatedAt,
        endedAt: null,
        golfers: [...holeInput.golfers],
        holes: [],
      };
      commit((latest) => ({ ...latest, savedRounds: [...latest.savedRounds, record], roundRecordId: record.id }));
      recordId = id;
    }
    if (!recordId) return;
    return persistRounds(upsertSavedHole(sessionRef.current.savedRounds, recordId, holeInput.captureHole()));
  }, [commit, persistRounds]);

  const endCurrentRound = useCallback((endedAt = new Date().toISOString()): boolean => {
    const recordId = sessionRef.current.roundRecordId;
    if (!recordId) return true;
    const nextRounds = endSavedRound(sessionRef.current.savedRounds, recordId, endedAt);
    if (!persistRounds(nextRounds, true)) return false;
    commit((current) => ({ ...current, roundRecordId: null }));
    return true;
  }, [commit, persistRounds]);

  return {
    activeRound: session.activeRound,
    setActiveRound,
    savedRounds: session.savedRounds,
    roundRecordId: session.roundRecordId,
    roundRecordIdRef,
    roundSaveError: session.roundSaveError,
    openRoundRecord,
    saveCurrentHole,
    endCurrentRound,
  };
}

function isActiveRoundSummary(
  value: unknown,
  isValidTeeBox: (value: unknown) => boolean,
): value is ActiveRoundSummary {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const summary = value as Partial<ActiveRoundSummary>;
  return summary.version === 1
    && typeof summary.courseId === "string" && summary.courseId.trim().length > 0 && summary.courseId.length <= 160
    && typeof summary.courseName === "string" && summary.courseName.trim().length > 0 && summary.courseName.length <= 160
    && typeof summary.layoutLabel === "string" && summary.layoutLabel.trim().length > 0 && summary.layoutLabel.length <= 64
    && typeof summary.holeNumber === "number" && Number.isInteger(summary.holeNumber) && summary.holeNumber >= 1 && summary.holeNumber <= 18
    && typeof summary.teeBox === "string" && isValidTeeBox(summary.teeBox)
    && (summary.status === "ready" || summary.status === "tracking" || summary.status === "paused" || summary.status === "complete")
    && typeof summary.updatedAt === "string" && Number.isFinite(Date.parse(summary.updatedAt));
}

function removeStorageValue(storage: OnCourseStorage, key: string): void {
  const removable = storage as OnCourseStorage & Partial<Pick<Storage, "removeItem">>;
  try {
    removable.removeItem?.(key);
  } catch {
    // Ignore storage cleanup failures; the invalid record is still ignored.
  }
}
