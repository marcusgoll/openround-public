export const CAPTURE_FORMAT = "openround.capture.v1";
export const MAX_BREADCRUMB_AGE_MS = 20_000;

function asIso(value, label) {
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) {
    throw new RangeError(`${label} must be an ISO timestamp`);
  }
  return new Date(milliseconds).toISOString();
}

function asId(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${label} must be nonblank`);
  }
  return value;
}

function asCoordinate(value, label, minimum, maximum) {
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new RangeError(`${label} is out of range`);
  }
  return value;
}

function asAccuracy(value) {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError("accuracy_m must be non-negative");
  }
  return value;
}

function normalizeBreadcrumb(breadcrumb) {
  return {
    timestamp: asIso(breadcrumb.timestamp, "breadcrumb timestamp"),
    lat: asCoordinate(breadcrumb.lat, "latitude", -90, 90),
    lon: asCoordinate(breadcrumb.lon, "longitude", -180, 180),
    accuracy_m: asAccuracy(breadcrumb.accuracy_m),
    source: asId(breadcrumb.source ?? "browser", "breadcrumb source"),
  };
}

export function createRound({ roundId, startedAt }) {
  return {
    format: CAPTURE_FORMAT,
    round_id: asId(roundId, "round_id"),
    started_at: asIso(startedAt, "started_at"),
    ended_at: null,
    breadcrumbs: [],
    events: [],
    gaps: [],
  };
}

export function addBreadcrumb(round, breadcrumb) {
  return {
    ...round,
    breadcrumbs: [...round.breadcrumbs, normalizeBreadcrumb(breadcrumb)],
  };
}

export function resolveEventLocation(
  eventTimestamp,
  breadcrumbs,
  maxAgeMs = MAX_BREADCRUMB_AGE_MS,
) {
  const eventMilliseconds = Date.parse(eventTimestamp);
  if (!Number.isFinite(eventMilliseconds)) {
    throw new RangeError("event timestamp must be an ISO timestamp");
  }
  if (!Number.isFinite(maxAgeMs) || maxAgeMs < 0) {
    throw new RangeError("maxAgeMs must be non-negative");
  }

  const normalized = breadcrumbs.map(normalizeBreadcrumb);
  if (normalized.length === 0) {
    return { status: "missing" };
  }

  const closest = normalized
    .map((breadcrumb) => ({
      breadcrumb,
      timestamp: Date.parse(breadcrumb.timestamp),
      age: Math.abs(Date.parse(breadcrumb.timestamp) - eventMilliseconds),
    }))
    .sort(
      (left, right) =>
        left.age - right.age || left.timestamp - right.timestamp,
    )[0];

  const evidence = {
    breadcrumb_timestamp: closest.breadcrumb.timestamp,
    breadcrumb_age_ms: closest.age,
  };
  if (closest.age > maxAgeMs) {
    return { status: "stale", ...evidence };
  }

  return {
    status: "attributed",
    lat: closest.breadcrumb.lat,
    lon: closest.breadcrumb.lon,
    ...evidence,
  };
}

export function createEvent({
  eventId,
  receivedAt,
  ageMs = 0,
  source = "demo",
  breadcrumbs = [],
}) {
  const receivedIso = asIso(receivedAt, "received_at");
  if (!Number.isSafeInteger(ageMs) || ageMs < 0) {
    throw new RangeError("age_ms must be a non-negative integer");
  }

  const timestamp = new Date(Date.parse(receivedIso) - ageMs).toISOString();
  return {
    event_id: asId(eventId, "event_id"),
    timestamp,
    received_at: receivedIso,
    age_ms: ageMs,
    source: asId(source, "event source"),
    location: resolveEventLocation(timestamp, breadcrumbs),
  };
}

export function addEvent(round, event) {
  return {
    ...round,
    events: [...round.events, event],
  };
}

export function openGap(round, { startedAt, reason }) {
  const lastGap = round.gaps.at(-1);
  if (lastGap && lastGap.ended_at === null) {
    return round;
  }
  return {
    ...round,
    gaps: [
      ...round.gaps,
      {
        started_at: asIso(startedAt, "gap started_at"),
        ended_at: null,
        reason: asId(reason, "gap reason"),
      },
    ],
  };
}

export function closeGap(round, endedAt) {
  const index = round.gaps.findLastIndex((gap) => gap.ended_at === null);
  if (index < 0) {
    return round;
  }
  const gaps = round.gaps.slice();
  gaps[index] = { ...gaps[index], ended_at: asIso(endedAt, "gap ended_at") };
  return { ...round, gaps };
}

export function finishRound(round, endedAt) {
  return { ...closeGap(round, endedAt), ended_at: asIso(endedAt, "ended_at") };
}
