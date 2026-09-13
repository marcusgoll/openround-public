import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DEFAULT_ON_COURSE_CONDITIONS,
  DEFAULT_ON_COURSE_WEATHER,
  createDefaultOnCourseState,
  loadOnCourseState,
  projectOnCourseState,
  reduceOnCourseState,
  saveOnCourseState,
  type OnCourseAction,
  type OnCourseConditions,
  type OnCourseIdentity,
  type OnCourseProjection,
  type OnCourseProjectionInput,
  type OnCourseState,
  type WeatherSnapshot,
} from "./openroundOnCourseModel.ts";
import { getBrowserOnCourseStorage, type OnCourseStorage } from "./openroundOnCoursePersistence.ts";
import {
  defaultOpenMeteoWeatherPort,
  type WeatherLocation,
  type WeatherPort,
} from "./openroundOnCourseWeather.ts";
import { type EquipmentClub, type RoundLog } from "./openroundModel.ts";

export type OpenRoundOnCourseInput = {
  identity: OnCourseIdentity;
  roundLog: RoundLog;
  equipment: readonly EquipmentClub[];
  baseTargetYards: number | undefined;
  signedOffsetYards: number;
  par: number;
  score: number;
  active: boolean;
  hazards: OnCourseProjectionInput["hazards"];
  weatherLocation?: WeatherLocation;
  fallbackConditions?: OnCourseConditions;
  trackedShotReviewId?: string | null;
  clubStatisticSamples?: OnCourseProjectionInput["clubStatisticSamples"];
  storage?: OnCourseStorage;
  weatherPort?: WeatherPort;
};

export type WeatherLoadState = "idle" | "loading" | "error";

export type WeatherRefreshResult = {
  status: "live" | "fallback" | "unavailable" | "superseded";
  snapshot: WeatherSnapshot;
};

export type OpenRoundOnCourseController = {
  state: OnCourseState;
  view: OnCourseProjection;
  weatherLoadState: WeatherLoadState;
  dispatch: (action: OnCourseAction) => void;
  refreshWeather: () => Promise<WeatherRefreshResult>;
  reset: (identity?: OnCourseIdentity, restored?: OnCourseState) => void;
};

function identityKey(identity: OnCourseIdentity): string {
  return `${identity.roundId}\u0000${identity.courseId}\u0000${identity.holeNumber}`;
}

function stateMatchesIdentity(state: OnCourseState, identity: OnCourseIdentity): boolean {
  return state.roundId === identity.roundId
    && state.courseId === identity.courseId
    && state.holeNumber === identity.holeNumber;
}

function fallbackWeather(weather: WeatherSnapshot): WeatherSnapshot {
  return weather.source === "fixture"
    ? { ...DEFAULT_ON_COURSE_WEATHER }
    : { ...weather, source: "cached" };
}

export function useOpenRoundOnCourse(input: OpenRoundOnCourseInput): OpenRoundOnCourseController {
  const storage = input.storage ?? getBrowserOnCourseStorage();
  const weatherPort = input.weatherPort ?? defaultOpenMeteoWeatherPort;
  const identity = input.identity;
  const currentIdentityKey = identityKey(identity);
  const fallbackConditions = input.fallbackConditions ?? DEFAULT_ON_COURSE_CONDITIONS;
  const [state, setState] = useState<OnCourseState>(() => loadOnCourseState(storage, identity, fallbackConditions));
  const [weatherLoadState, setWeatherLoadState] = useState<WeatherLoadState>("idle");
  const stateRef = useRef(state);
  const weatherRequestRef = useRef<AbortController | null>(null);
  const weatherRequestIdRef = useRef(0);

  useEffect(() => {
    const loaded = loadOnCourseState(storage, identity, fallbackConditions);
    stateRef.current = loaded;
    setState(loaded);
    setWeatherLoadState("idle");
  }, [currentIdentityKey, fallbackConditions.elevationYards, fallbackConditions.temperatureF, fallbackConditions.windDirection, fallbackConditions.windMph, storage]);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => () => {
    weatherRequestRef.current?.abort();
  }, [currentIdentityKey]);

  useEffect(() => {
    if (!input.active) return;
    setState((current) => {
      if (!stateMatchesIdentity(current, identity)) return current;
      const existing = current.holes.find((hole) => hole.holeNumber === identity.holeNumber);
      if (existing?.score === input.score && existing.par === input.par) return current;
      const next = reduceOnCourseState(current, {
        type: "record-hole-outcome",
        outcome: {
          holeNumber: identity.holeNumber,
          par: input.par,
          score: input.score,
          putts: existing?.putts ?? null,
          gir: existing?.gir ?? null,
          fairway: existing?.fairway ?? null,
          missDetails: existing?.missDetails ?? current.missDetails.filter((miss) => miss.holeNumber === identity.holeNumber),
          updatedAt: new Date().toISOString(),
        },
      });
      stateRef.current = next;
      return next;
    });
  }, [identity.courseId, identity.holeNumber, identity.roundId, input.active, input.par, input.score]);

  useEffect(() => {
    if (!stateMatchesIdentity(state, identity)) return;
    saveOnCourseState(storage, state);
  }, [currentIdentityKey, state, storage]);

  const dispatch = useCallback((action: OnCourseAction) => {
    setState((current) => {
      const base = stateMatchesIdentity(current, identity)
        ? current
        : createDefaultOnCourseState(identity, fallbackConditions);
      const next = reduceOnCourseState(base, action);
      stateRef.current = next;
      return next;
    });
  }, [fallbackConditions.elevationYards, fallbackConditions.temperatureF, fallbackConditions.windDirection, fallbackConditions.windMph, identity.courseId, identity.holeNumber, identity.roundId]);

  const refreshWeather = useCallback(async (): Promise<WeatherRefreshResult> => {
    const requestId = weatherRequestIdRef.current + 1;
    weatherRequestIdRef.current = requestId;
    weatherRequestRef.current?.abort();
    setWeatherLoadState("loading");

    if (!input.weatherLocation) {
      const snapshot = fallbackWeather(stateRef.current.weather);
      dispatch({ type: "set-weather", weather: snapshot, syncConditions: false });
      setWeatherLoadState("error");
      return { status: "unavailable", snapshot };
    }

    const controller = typeof AbortController === "undefined" ? undefined : new AbortController();
    weatherRequestRef.current = controller ?? null;
    const timeoutId = controller && typeof window !== "undefined"
      ? window.setTimeout(() => controller.abort(), 4_000)
      : undefined;

    try {
      const snapshot = await weatherPort(input.weatherLocation, controller?.signal);
      if (requestId !== weatherRequestIdRef.current) return { status: "superseded", snapshot };
      dispatch({ type: "set-weather", weather: snapshot, syncConditions: true });
      setWeatherLoadState("idle");
      return { status: "live", snapshot };
    } catch {
      const snapshot = fallbackWeather(stateRef.current.weather);
      if (requestId !== weatherRequestIdRef.current) return { status: "superseded", snapshot };
      dispatch({ type: "set-weather", weather: snapshot, syncConditions: false });
      setWeatherLoadState("error");
      return { status: "fallback", snapshot };
    } finally {
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);
      if (requestId === weatherRequestIdRef.current && weatherRequestRef.current === controller) {
        weatherRequestRef.current = null;
      }
    }
  }, [dispatch, input.weatherLocation?.lat, input.weatherLocation?.lon, weatherPort]);

  const reset = useCallback((nextIdentity: OnCourseIdentity = identity, restored?: OnCourseState) => {
    const next = restored && stateMatchesIdentity(restored, nextIdentity) ? restored : createDefaultOnCourseState(nextIdentity);
    saveOnCourseState(storage, next);
    stateRef.current = next;
    setState(next);
    setWeatherLoadState("idle");
  }, [identity.courseId, identity.holeNumber, identity.roundId, storage]);

  const visibleState = stateMatchesIdentity(state, identity)
    ? state
    : createDefaultOnCourseState(identity, fallbackConditions);
  const view = useMemo(() => projectOnCourseState(visibleState, {
    identity,
    baseTargetYards: input.baseTargetYards,
    signedOffsetYards: input.signedOffsetYards,
    par: input.par,
    roundLog: input.roundLog,
    equipment: input.equipment,
    hazards: input.hazards,
    trackedShotReviewId: input.trackedShotReviewId,
    clubStatisticSamples: input.clubStatisticSamples,
  }), [identity, input.baseTargetYards, input.clubStatisticSamples, input.equipment, input.hazards, input.par, input.roundLog, input.signedOffsetYards, input.trackedShotReviewId, visibleState]);

  return {
    state: visibleState,
    view,
    weatherLoadState,
    dispatch,
    refreshWeather,
    reset,
  };
}
