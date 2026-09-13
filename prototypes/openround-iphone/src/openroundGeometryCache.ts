import { isGeoPositionInsideGeometryOrBoundary } from "./openroundGeometry.ts";
import type { LoadedHoleGeometry } from "./openroundGeometry.ts";

export type GeometryCacheRecord = {
  key: string;
  courseId: string;
  holeNumber: number;
  artifact: string;
  sha256: string;
  sourceVersion: string;
  quality: LoadedHoleGeometry["quality"];
  attribution: LoadedHoleGeometry["quality"]["attribution"];
};

export type GeometryCacheManifest = {
  provider: "openstreetmap-overpass";
  version: string;
  generatedAt: string;
  attribution: LoadedHoleGeometry["quality"]["attribution"];
  records: GeometryCacheRecord[];
};

export function geometryCacheKey(courseId: string, holeNumber: number) {
  return `${courseId}:hole-${holeNumber}`;
}

export function geometryCacheArtifact(courseId: string, holeNumber: number, version = "current") {
  const releaseSegment = version === "current" ? "opengolfapi-us-current" : `opengolfapi-us-${version}`;
  return `geometry/${releaseSegment}/${encodeURIComponent(courseId)}/hole-${holeNumber}.json`;
}

export async function sha256Hex(value: string) {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function isQuality(value: unknown): value is LoadedHoleGeometry["quality"] {
  if (!value || typeof value !== "object") return false;
  const quality = value as Partial<LoadedHoleGeometry["quality"]>;
  return (
    (quality.grade === "A" || quality.grade === "B" || quality.grade === "C" || quality.grade === "D") &&
    (quality.status === "complete" || quality.status === "partial" || quality.status === "unmapped") &&
    Array.isArray(quality.missing) && quality.missing.every((item) => typeof item === "string") &&
    // Grade B can be complete tee/green/path geometry with no mapped hazard;
    // only grade A requires hazards by definition. Incomplete grades never
    // expose hazard distances.
    (quality.grade === "A"
      ? quality.hazardsUsable === true
      : quality.grade === "B"
        ? typeof quality.hazardsUsable === "boolean"
        : quality.hazardsUsable === false) &&
    typeof quality.pinUsable === "boolean" &&
    quality.attribution === "© OpenStreetMap contributors (ODbL 1.0)"
  );
}

function hasValidCoordinates(value: unknown): boolean {
  if (!Array.isArray(value) || value.length === 0) return false;
  if (value.length >= 2 && value.slice(0, 2).every((item) => typeof item === "number" && Number.isFinite(item))) {
    const [longitude, latitude] = value as [number, number];
    return longitude >= -180 && longitude <= 180 && latitude >= -90 && latitude <= 90;
  }
  return value.every((item) => hasValidCoordinates(item));
}

function isFeature(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const feature = value as { id?: unknown; kind?: unknown; geometry?: unknown; sourceId?: unknown };
  const geometry = feature.geometry as { type?: unknown; coordinates?: unknown } | undefined;
  return Boolean(
    typeof feature.id === "string" && feature.id.length > 0 &&
    (typeof feature.sourceId === "undefined" || typeof feature.sourceId === "string") &&
    ["tee", "green", "fairway", "bunker", "water", "waste", "out_of_bounds", "pin", "centerline"].includes(String(feature.kind)) &&
    geometry && ["Point", "LineString", "Polygon", "MultiPolygon"].includes(String(geometry.type)) &&
    hasValidCoordinates(geometry.coordinates),
  );
}

function geometryPositions(geometry: LoadedHoleGeometry["hole"]["features"][number]["geometry"]) {
  if (geometry.type === "Point") return [geometry.coordinates];
  if (geometry.type === "LineString") return geometry.coordinates;
  if (geometry.type === "Polygon") return geometry.coordinates.flat();
  return geometry.coordinates.flat(2);
}

export function isGeometryCacheManifest(value: unknown): value is GeometryCacheManifest {
  if (!value || typeof value !== "object") return false;
  const manifest = value as Partial<GeometryCacheManifest>;
  if (
    manifest.provider !== "openstreetmap-overpass" ||
    typeof manifest.version !== "string" ||
    !/^v\d+\.\d+\.\d+$/.test(manifest.version) ||
    typeof manifest.generatedAt !== "string" ||
    manifest.attribution !== "© OpenStreetMap contributors (ODbL 1.0)" ||
    !Array.isArray(manifest.records)
  ) return false;
  const seen = new Set<string>();
  return manifest.records.every((record) => {
    if (!record || typeof record !== "object") return false;
    const candidate = record as Partial<GeometryCacheRecord>;
    const artifactSegments = typeof candidate.artifact === "string" ? candidate.artifact.split("/") : [];
    const safeArtifact = artifactSegments.length === 4 &&
      artifactSegments[0] === "geometry" &&
      artifactSegments.slice(1).every((segment) => segment.length > 0 && segment !== "." && segment !== ".." && !segment.includes("\\")) &&
      /^hole-\d+\.json$/.test(artifactSegments[3] ?? "");
    const valid = (
      typeof candidate.key === "string" && candidate.key === geometryCacheKey(String(candidate.courseId ?? ""), Number(candidate.holeNumber)) && !seen.has(candidate.key) &&
      typeof candidate.courseId === "string" && candidate.courseId.trim().length > 0 &&
      typeof candidate.holeNumber === "number" && Number.isInteger(candidate.holeNumber) && candidate.holeNumber > 0 &&
      safeArtifact &&
      typeof candidate.sha256 === "string" && /^[a-f0-9]{64}$/.test(candidate.sha256) &&
      typeof candidate.sourceVersion === "string" && candidate.sourceVersion.trim().length > 0 && isQuality(candidate.quality) &&
      candidate.attribution === "© OpenStreetMap contributors (ODbL 1.0)"
    );
    if (valid) seen.add(candidate.key as string);
    return valid;
  });
}

export function isLoadedHoleGeometry(value: unknown): value is LoadedHoleGeometry {
  if (!value || typeof value !== "object") return false;
  const loaded = value as Partial<LoadedHoleGeometry>;
  const hole = loaded.hole as Partial<LoadedHoleGeometry["hole"]> | undefined;
  const features = Array.isArray(hole?.features) ? hole.features : [];
  const hasHazards = features.some((feature) => ["bunker", "water", "waste", "out_of_bounds"].includes(feature.kind));
  const greens = features.filter((feature) => feature.kind === "green");
  const pins = features.filter((feature) => feature.kind === "pin");
  const hasUsablePin = greens.length > 0 && pins.some((pin) =>
    geometryPositions(pin.geometry).some((position) => greens.some((green) => isGeoPositionInsideGeometryOrBoundary(position, green.geometry))),
  );
  const quality = loaded.quality;
  const hazardsMatchFeatures = Boolean(quality && (
    quality.grade === "A"
      ? quality.hazardsUsable === true && hasHazards
      : quality.grade === "B"
        ? quality.hazardsUsable === hasHazards
        : quality.hazardsUsable === false
  ));
  return (
    loaded.provider === "openstreetmap-overpass" &&
    typeof loaded.sourceVersion === "string" &&
    Boolean(hole) &&
    typeof hole?.number === "number" && Number.isInteger(hole.number) && hole.number > 0 &&
    (hole?.geometryStatus === "complete" || hole?.geometryStatus === "partial" || hole?.geometryStatus === "unmapped") &&
    Array.isArray(hole?.features) && hole.features.every(isFeature) &&
    isQuality(loaded.quality) &&
    hazardsMatchFeatures && Boolean(quality && quality.pinUsable === hasUsablePin)
  );
}

export async function fetchBundledHoleGeometry(
  courseId: string,
  holeNumber: number,
  fetcher: typeof fetch = fetch,
): Promise<LoadedHoleGeometry | undefined> {
  const manifestResponse = await fetcher("/course-data/opengolfapi-us-current.geometry.manifest.json", { headers: { Accept: "application/json" } });
  if (manifestResponse.status === 404) return undefined;
  if (!manifestResponse.ok) throw new Error(`Bundled geometry manifest unavailable (${manifestResponse.status})`);
  const manifestPayload: unknown = await manifestResponse.json();
  if (!isGeometryCacheManifest(manifestPayload)) throw new Error("Invalid bundled geometry manifest");
  const record = manifestPayload.records.find((candidate) => candidate.key === geometryCacheKey(courseId, holeNumber));
  if (!record) return undefined;
  const artifactResponse = await fetcher(`/course-data/${record.artifact}`, { headers: { Accept: "application/json" } });
  if (!artifactResponse.ok) throw new Error(`Bundled geometry artifact unavailable (${artifactResponse.status})`);
  const artifactText = await artifactResponse.text();
  if (await sha256Hex(artifactText) !== record.sha256) throw new Error("Bundled geometry checksum mismatch");
  const payload: unknown = JSON.parse(artifactText);
  return isLoadedHoleGeometry(payload) ? payload : undefined;
}
