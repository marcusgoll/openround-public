const METERS_TO_YARDS = 1.0936132983377078;
export const DEFAULT_PIN_HEIGHT_IN = 42;
const MAX_SAFE_DISTANCE_YARDS = 200;

function toRadians(value) {
  return value * Math.PI / 180;
}

function asFiniteNumber(value, label, { min = -Infinity, max = Infinity } = {}) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    throw new RangeError(`${label} is invalid`);
  }
  return parsed;
}

function clampConfidence(value) {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

export function estimatePinDistanceYards({
  measuredFlagHeightPx,
  frameHeightPx,
  pinHeightIn = DEFAULT_PIN_HEIGHT_IN,
  cameraFovDeg = 65,
  zoom = 1,
  slopeDeg = 0,
}) {
  const flagPx = asFiniteNumber(measuredFlagHeightPx, "measured flag height px", { min: 0.5 });
  const heightPx = asFiniteNumber(frameHeightPx, "frame height", { min: 1 });
  const pinHeight = asFiniteNumber(pinHeightIn, "pin height in", { min: 1 });
  const fovDeg = asFiniteNumber(cameraFovDeg, "camera FOV deg", { min: 1, max: 179 });
  const zoomFactor = asFiniteNumber(zoom, "zoom", { min: 0.1 });
  const slope = Number(slopeDeg) || 0;

  const pinHeightM = pinHeight * 0.0254;
  const fovRad = toRadians(fovDeg);
  const baseFocalPx = heightPx / (2 * Math.tan(fovRad / 2));
  const slantDistanceM = (baseFocalPx * pinHeightM / flagPx) * zoomFactor;
  const slantYards = slantDistanceM * METERS_TO_YARDS;
  const horizontalYards = slantYards * Math.cos(toRadians(Math.abs(slope)));

  const pixelCoverage = Math.min(1, flagPx / (0.38 * heightPx));
  const confidence = clampConfidence(0.22 + pixelCoverage * 0.74);

  return {
    slantDistanceYards: slantYards,
    horizontalDistanceYards: horizontalYards,
    confidence,
    withinTwoHundredYards: horizontalYards <= MAX_SAFE_DISTANCE_YARDS,
  };
}

export function formatPinDistance(yards) {
  if (!Number.isFinite(yards)) return "—";
  return `${Math.round(yards * 10) / 10} yd`;
}
