import test from "node:test";
import assert from "node:assert/strict";

import { estimatePinDistanceYards } from "./pin-placement.mjs";

test("distance estimate grows as the flag appears smaller", () => {
  const near = estimatePinDistanceYards({
    measuredFlagHeightPx: 180,
    frameHeightPx: 1080,
    pinHeightIn: 42,
    cameraFovDeg: 65,
    zoom: 1,
    slopeDeg: 0,
  });
  const far = estimatePinDistanceYards({
    measuredFlagHeightPx: 90,
    frameHeightPx: 1080,
    pinHeightIn: 42,
    cameraFovDeg: 65,
    zoom: 1,
    slopeDeg: 0,
  });
  assert.ok(far.slantDistanceYards > near.slantDistanceYards);
});

test("slope correction lowers ground distance when slope is nonzero", () => {
  const flat = estimatePinDistanceYards({
    measuredFlagHeightPx: 120,
    frameHeightPx: 1080,
    pinHeightIn: 42,
    cameraFovDeg: 65,
    zoom: 1,
    slopeDeg: 0,
  });
  const uphill = estimatePinDistanceYards({
    measuredFlagHeightPx: 120,
    frameHeightPx: 1080,
    pinHeightIn: 42,
    cameraFovDeg: 65,
    zoom: 1,
    slopeDeg: 10,
  });
  assert.ok(uphill.horizontalDistanceYards < flat.slantDistanceYards);
});

test("known pin pixel height returns its simulated range", () => {
  const frameHeightPx = 2160;
  const fovDeg = 65;
  const expectedYards = 75;
  const focalPx = frameHeightPx / (2 * Math.tan((fovDeg * Math.PI) / 360));
  const measuredFlagHeightPx = (focalPx * 42 * 0.0254 * 1.0936132983377078) / expectedYards;
  const result = estimatePinDistanceYards({ measuredFlagHeightPx, frameHeightPx, pinHeightIn: 42, cameraFovDeg: fovDeg, zoom: 1, slopeDeg: 0 });
  assert.ok(Math.abs(result.horizontalDistanceYards - expectedYards) < 0.01);
});
