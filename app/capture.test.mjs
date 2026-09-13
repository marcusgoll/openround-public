import test from "node:test";
import assert from "node:assert/strict";

import {
  addBreadcrumb,
  addEvent,
  closeGap,
  createEvent,
  createRound,
  openGap,
  resolveEventLocation,
} from "./capture.mjs";

const breadcrumb = (timestamp, lat = 32.335, lon = -97.706) => ({
  timestamp,
  lat,
  lon,
  accuracy_m: 8,
  source: "browser",
});

test("resolves to the nearest breadcrumb by timestamp", () => {
  const result = resolveEventLocation("2026-08-24T12:00:07Z", [
    breadcrumb("2026-08-24T12:00:10Z", 32.337),
    breadcrumb("2026-08-24T12:00:04Z", 32.335),
  ]);

  assert.deepEqual(result, {
    status: "attributed",
    lat: 32.335,
    lon: -97.706,
    breadcrumb_timestamp: "2026-08-24T12:00:04.000Z",
    breadcrumb_age_ms: 3000,
  });
});

test("uses absolute time instead of array order", () => {
  const result = resolveEventLocation("2026-08-24T12:00:18Z", [
    breadcrumb("2026-08-24T12:00:25Z", 32.34),
    breadcrumb("2026-08-24T12:00:17Z", 32.33),
  ]);

  assert.equal(result.lat, 32.33);
  assert.equal(result.breadcrumb_age_ms, 1000);
});

test("keeps stale breadcrumbs unlocated", () => {
  const result = resolveEventLocation("2026-08-24T12:01:00Z", [
    breadcrumb("2026-08-24T12:00:00Z"),
  ]);

  assert.equal(result.status, "stale");
  assert.equal("lat" in result, false);
  assert.equal(result.breadcrumb_age_ms, 60000);
});

test("distinguishes missing breadcrumbs from stale breadcrumbs", () => {
  assert.deepEqual(resolveEventLocation("2026-08-24T12:00:00Z", []), {
    status: "missing",
  });
});

test("backdates events before resolving their location", () => {
  const event = createEvent({
    eventId: "event-1",
    receivedAt: "2026-08-24T12:00:20Z",
    ageMs: 5000,
    source: "tag",
    breadcrumbs: [breadcrumb("2026-08-24T12:00:15Z", 32.34)],
  });

  assert.equal(event.timestamp, "2026-08-24T12:00:15.000Z");
  assert.equal(event.location.status, "attributed");
  assert.equal(event.location.lat, 32.34);
});

test("round snapshots retain evidence and close gaps without fabrication", () => {
  let round = createRound({
    roundId: "round-1",
    startedAt: "2026-08-24T12:00:00Z",
  });
  round = addBreadcrumb(round, breadcrumb("2026-08-24T12:00:04Z"));
  round = addEvent(
    round,
    createEvent({
      eventId: "event-1",
      receivedAt: "2026-08-24T12:01:00Z",
      breadcrumbs: round.breadcrumbs,
    }),
  );
  round = openGap(round, {
    startedAt: "2026-08-24T12:01:01Z",
    reason: "page-hidden",
  });
  round = closeGap(round, "2026-08-24T12:01:05Z");

  assert.equal(round.events[0].location.status, "stale");
  assert.equal("lat" in round.events[0].location, false);
  assert.equal(round.breadcrumbs.length, 1);
  assert.equal(round.gaps[0].ended_at, "2026-08-24T12:01:05.000Z");
});
