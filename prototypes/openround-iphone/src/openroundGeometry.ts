import booleanPointInPolygon from "@turf/boolean-point-in-polygon";
import distance from "@turf/distance";
import { point } from "@turf/helpers";
import {
  getHoleReadiness,
  type CourseFeature,
  type GeoJsonGeometry,
  type GeoJsonPosition,
  type GeometryStatus,
  type OpenRoundHole,
} from "./openroundCourseData.ts";

export type OverpassElement = {
  type?: unknown;
  id?: unknown;
  tags?: unknown;
  geometry?: unknown;
};

export type GeometryQuality = {
  grade: "A" | "B" | "C" | "D";
  status: GeometryStatus;
  missing: string[];
  hazardsUsable: boolean;
  pinUsable: boolean;
  attribution: "© OpenStreetMap contributors (ODbL 1.0)";
};

export type LoadedHoleGeometry = {
  hole: OpenRoundHole;
  quality: GeometryQuality;
  provider: "openstreetmap-overpass";
  sourceVersion: string;
};

/**
 * Some OSM facilities contain two layouts in one Overpass response. One
 * layout numbers its tees/fairways/greens, while the other numbers `golf=hole`
 * centerlines and leaves its child features unnumbered. Callers that know the
 * intended layout can select it explicitly; `auto` preserves the historical
 * single-layout behavior for general providers and tests.
 */
export type OverpassGeometryLayout = "auto" | "ref_features" | "hole_centerlines";

export type GeometryProjection = {
  bounds: {
    minLongitude: number;
    maxLongitude: number;
    minLatitude: number;
    maxLatitude: number;
  };
  project(position: GeoJsonPosition): { x: number; y: number };
  unproject(point: { x: number; y: number }): GeoJsonPosition;
};

const GEOMETRY_PROJECTION_PADDING = 0.08;

// An unnumbered feature may belong to a neighboring hole when Overpass
// returns a facility-wide response.  Keep the fallback deliberately tight
// whenever a numbered hole centerline is available: a course feature should
// sit within roughly 165 m of that path before it is allowed into the hole
// snapshot.  A conservative false negative is safer than showing a hazard
// distance computed from another hole's geometry.
const UNNUMBERED_FEATURE_MAX_PATH_DISTANCE_DEGREES = 0.0015;
const UNNUMBERED_FEATURE_MAX_ANCHOR_DISTANCE_DEGREES = 0.008;

export function webMercatorWorldPixel(point: { lat: number; lon: number }, zoom: number, tileSize = 256) {
  const size = tileSize * 2 ** zoom;
  const longitude = Number.isFinite(point.lon) ? point.lon : 0;
  const latitude = Math.max(-85.05112878, Math.min(85.05112878, Number.isFinite(point.lat) ? point.lat : 0));
  const latitudeRadians = (latitude * Math.PI) / 180;
  return {
    x: ((longitude + 180) / 360) * size,
    y: ((1 - Math.asinh(Math.tan(latitudeRadians)) / Math.PI) / 2) * size,
  };
}

export function webMercatorGeoPoint(pixel: { x: number; y: number }, zoom: number, tileSize = 256) {
  const size = tileSize * 2 ** zoom;
  const longitude = (pixel.x / size) * 360 - 180;
  const normalizedY = Math.PI - (2 * Math.PI * pixel.y) / size;
  const latitude = (180 / Math.PI) * Math.atan(Math.sinh(normalizedY));
  return { lat: latitude, lon: longitude };
}

type RecordValue = Record<string, unknown>;

function asRecord(value: unknown): RecordValue | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as RecordValue) : undefined;
}

function asText(value: unknown) {
  if (typeof value === "string") return value.trim();
  return typeof value === "number" && Number.isFinite(value) ? String(value) : "";
}

function asNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function geometryPositions(geometry: GeoJsonGeometry): GeoJsonPosition[] {
  if (geometry.type === "Point") return [geometry.coordinates];
  if (geometry.type === "LineString") return geometry.coordinates;
  if (geometry.type === "Polygon") return geometry.coordinates.flat();
  return geometry.coordinates.flat(2);
}

function pointInRing(point: GeoJsonPosition, ring: GeoJsonPosition[]) {
  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index, index += 1) {
    const [x, y] = ring[index];
    const [previousX, previousY] = ring[previous];
    const intersects = (y > point[1]) !== (previousY > point[1]) && point[0] < ((previousX - x) * (point[1] - y)) / (previousY - y || Number.EPSILON) + x;
    if (intersects) inside = !inside;
  }
  return inside;
}

function pointToSegmentDistance(point: GeoJsonPosition, start: GeoJsonPosition, end: GeoJsonPosition) {
  const [x, y] = point;
  const [startX, startY] = start;
  const [endX, endY] = end;
  const deltaX = endX - startX;
  const deltaY = endY - startY;
  const lengthSquared = deltaX * deltaX + deltaY * deltaY;
  if (lengthSquared === 0) return Math.hypot(x - startX, y - startY);
  const projection = Math.max(0, Math.min(1, ((x - startX) * deltaX + (y - startY) * deltaY) / lengthSquared));
  return Math.hypot(x - (startX + projection * deltaX), y - (startY + projection * deltaY));
}

function pointNearRing(point: GeoJsonPosition, ring: GeoJsonPosition[], toleranceDegrees: number) {
  return ring.some((start, index) => pointToSegmentDistance(point, start, ring[(index + 1) % ring.length]!) <= toleranceDegrees);
}

const AUTOMATIC_GREEN_LANDING_YARDS = 1;
const AUTOMATIC_GREEN_BINARY_STEPS = 24;

function interpolateGeoPosition(start: GeoJsonPosition, end: GeoJsonPosition, fraction: number): GeoJsonPosition {
  return [start[0] + (end[0] - start[0]) * fraction, start[1] + (end[1] - start[1]) * fraction];
}

function geoDistanceYards(start: GeoJsonPosition, end: GeoJsonPosition) {
  return distance(point(start), point(end), { units: "yards" });
}

function crossProduct(first: GeoJsonPosition, second: GeoJsonPosition) {
  return first[0] * second[1] - first[1] * second[0];
}

function segmentIntersectionFraction(start: GeoJsonPosition, end: GeoJsonPosition, edgeStart: GeoJsonPosition, edgeEnd: GeoJsonPosition) {
  const direction: GeoJsonPosition = [end[0] - start[0], end[1] - start[1]];
  const edge: GeoJsonPosition = [edgeEnd[0] - edgeStart[0], edgeEnd[1] - edgeStart[1]];
  const offset: GeoJsonPosition = [edgeStart[0] - start[0], edgeStart[1] - start[1]];
  const denominator = crossProduct(direction, edge);
  if (Math.abs(denominator) <= Number.EPSILON) return undefined;
  const fraction = crossProduct(offset, edge) / denominator;
  const edgeFraction = crossProduct(offset, direction) / denominator;
  return fraction > 0 && fraction < 1 && edgeFraction >= 0 && edgeFraction <= 1 ? fraction : undefined;
}

function geometryRings(geometry: GeoJsonGeometry) {
  if (geometry.type === "Polygon") return geometry.coordinates;
  if (geometry.type === "MultiPolygon") return geometry.coordinates.flat();
  return [];
}

function segmentBoundaryIntersections(start: GeoJsonPosition, end: GeoJsonPosition, geometry: GeoJsonGeometry) {
  const intersections: number[] = [];
  for (const ring of geometryRings(geometry)) {
    for (let index = 0; index < ring.length; index += 1) {
      const fraction = segmentIntersectionFraction(start, end, ring[index]!, ring[(index + 1) % ring.length]!);
      if (fraction !== undefined && !intersections.some((existing) => Math.abs(existing - fraction) <= 1e-10)) intersections.push(fraction);
    }
  }
  return intersections.sort((first, second) => first - second);
}

export function isGeoPositionInsideGeometry(position: GeoJsonPosition, geometry: GeoJsonGeometry, toleranceDegrees = 0.0002) {
  if (geometry.type === "Point") return Math.hypot(position[0] - geometry.coordinates[0], position[1] - geometry.coordinates[1]) <= toleranceDegrees;
  if (geometry.type === "Polygon" || geometry.type === "MultiPolygon") {
    return booleanPointInPolygon(point(position), geometry, { ignoreBoundary: true });
  }
  const points = geometryPositions(geometry);
  if (points.length === 0) return false;
  const longitudes = points.map(([longitude]) => longitude);
  const latitudes = points.map(([, latitude]) => latitude);
  return position[0] >= Math.min(...longitudes) - toleranceDegrees && position[0] <= Math.max(...longitudes) + toleranceDegrees && position[1] >= Math.min(...latitudes) - toleranceDegrees && position[1] <= Math.max(...latitudes) + toleranceDegrees;
}

export function findAutomaticGreenLandingPoint(ball: GeoJsonPosition, pin: GeoJsonPosition, green: GeoJsonGeometry): GeoJsonPosition | undefined {
  if ([...ball, ...pin].some((value) => !Number.isFinite(value))) return undefined;
  if (green.type !== "Polygon" && green.type !== "MultiPolygon") return undefined;
  if (isGeoPositionInsideGeometry(ball, green) || !isGeoPositionInsideGeometry(pin, green)) return undefined;

  const segmentYards = geoDistanceYards(ball, pin);
  if (!(segmentYards > AUTOMATIC_GREEN_LANDING_YARDS)) return undefined;

  const intersections = segmentBoundaryIntersections(ball, pin, green);
  let outsideFraction: number | undefined;
  let insideFraction: number | undefined;
  let entryIntersectionIndex: number | undefined;
  for (let index = 0; index < intersections.length; index += 1) {
    const fraction = intersections[index]!;
    const nextFraction = intersections[index + 1] ?? 1;
    const intervalFraction = (fraction + nextFraction) / 2;
    if (isGeoPositionInsideGeometry(interpolateGeoPosition(ball, pin, intervalFraction), green)) {
      outsideFraction = fraction;
      insideFraction = intervalFraction;
      entryIntersectionIndex = index;
      break;
    }
  }
  if (outsideFraction === undefined || insideFraction === undefined || entryIntersectionIndex === undefined) return undefined;
  let entryOutside = outsideFraction;
  let entryInside = insideFraction;

  for (let step = 0; step < AUTOMATIC_GREEN_BINARY_STEPS; step += 1) {
    const midpoint: number = (entryOutside + entryInside) / 2;
    if (isGeoPositionInsideGeometry(interpolateGeoPosition(ball, pin, midpoint), green)) entryInside = midpoint;
    else entryOutside = midpoint;
  }

  const entryPoint = interpolateGeoPosition(ball, pin, entryInside);
  let exitFraction = 1;
  for (let index = entryIntersectionIndex + 1; index < intersections.length; index += 1) {
    const fraction = intersections[index]!;
    const nextFraction = intersections[index + 1] ?? 1;
    if (!isGeoPositionInsideGeometry(interpolateGeoPosition(ball, pin, (fraction + nextFraction) / 2), green)) {
      exitFraction = fraction;
      break;
    }
  }
  if (!(geoDistanceYards(entryPoint, interpolateGeoPosition(ball, pin, exitFraction)) > AUTOMATIC_GREEN_LANDING_YARDS)) return undefined;
  let landingLow: number = entryInside;
  let landingHigh = exitFraction;
  for (let step = 0; step < AUTOMATIC_GREEN_BINARY_STEPS; step += 1) {
    const midpoint = (landingLow + landingHigh) / 2;
    if (geoDistanceYards(entryPoint, interpolateGeoPosition(ball, pin, midpoint)) >= AUTOMATIC_GREEN_LANDING_YARDS) landingHigh = midpoint;
    else landingLow = midpoint;
  }
  const landing = interpolateGeoPosition(ball, pin, landingHigh);
  return isGeoPositionInsideGeometry(landing, green) ? landing : undefined;
}

/**
 * Pin nodes are often snapped to the edge of an OSM green (and small test
 * fixtures can be degenerate lines). Treat a point on the boundary as valid,
 * but keep the tolerance deliberately tight so a pin cannot drift outside the
 * mapped green. The strict helper above remains the interaction guard for
 * manual placement.
 */
export function isGeoPositionInsideGeometryOrBoundary(position: GeoJsonPosition, geometry: GeoJsonGeometry, toleranceDegrees = 0.00002) {
  if (isGeoPositionInsideGeometry(position, geometry)) return true;
  if (geometry.type === "Polygon") {
    const [outer, ...holes] = geometry.coordinates;
    return Boolean(outer && pointNearRing(position, outer, toleranceDegrees) && !holes.some((ring) => pointInRing(position, ring) || pointNearRing(position, ring, toleranceDegrees)));
  }
  if (geometry.type === "MultiPolygon") return geometry.coordinates.some((polygon) => {
    const [outer, ...holes] = polygon;
    return Boolean(outer && pointNearRing(position, outer, toleranceDegrees) && !holes.some((ring) => pointInRing(position, ring) || pointNearRing(position, ring, toleranceDegrees)));
  });
  return false;
}

/**
 * Build the normalized coordinate transform used by the real-course SVG.
 * Keeping this in the geometry module makes the map projection testable without
 * a browser and prevents the satellite overlay and feature layer from drifting.
 */
export function createGeometryProjection(features: CourseFeature[]): GeometryProjection | undefined {
  const positions = features.flatMap((feature) => geometryPositions(feature.geometry));
  if (positions.length === 0 || positions.some(([longitude, latitude]) => !Number.isFinite(longitude) || !Number.isFinite(latitude))) {
    return undefined;
  }

  const longitudes = positions.map(([longitude]) => longitude);
  const latitudes = positions.map(([, latitude]) => latitude);
  const minLongitude = Math.min(...longitudes);
  const maxLongitude = Math.max(...longitudes);
  const minLatitude = Math.min(...latitudes);
  const maxLatitude = Math.max(...latitudes);
  const longitudeSpan = Math.max(0.00001, maxLongitude - minLongitude);
  const latitudeSpan = Math.max(0.00001, maxLatitude - minLatitude);
  const drawableSpan = 1 - GEOMETRY_PROJECTION_PADDING * 2;

  return {
    bounds: { minLongitude, maxLongitude, minLatitude, maxLatitude },
    project: ([longitude, latitude]) => ({
      x: GEOMETRY_PROJECTION_PADDING + ((longitude - minLongitude) / longitudeSpan) * drawableSpan,
      y: 1 - GEOMETRY_PROJECTION_PADDING - ((latitude - minLatitude) / latitudeSpan) * drawableSpan,
    }),
    unproject: ({ x, y }) => [
      minLongitude + ((x - GEOMETRY_PROJECTION_PADDING) / drawableSpan) * longitudeSpan,
      minLatitude + ((1 - GEOMETRY_PROJECTION_PADDING - y) / drawableSpan) * latitudeSpan,
    ],
  };
}

function toPosition(value: unknown): GeoJsonPosition | undefined {
  const record = asRecord(value);
  const lat = asNumber(record?.lat);
  const lon = asNumber(record?.lon);
  return lat === undefined || lon === undefined ? undefined : [lon, lat];
}

function lineGeometry(value: unknown): Extract<GeoJsonGeometry, { type: "LineString" }> | undefined {
  if (!Array.isArray(value)) return undefined;
  const positions = value.map(toPosition).filter((position): position is GeoJsonPosition => Boolean(position));
  return positions.length >= 2 ? { type: "LineString", coordinates: positions } : undefined;
}

function polygonGeometry(value: unknown): Extract<GeoJsonGeometry, { type: "Polygon" }> | undefined {
  if (!Array.isArray(value)) return undefined;
  const positions = value.map(toPosition).filter((position): position is GeoJsonPosition => Boolean(position));
  return positions.length >= 3 ? { type: "Polygon", coordinates: [positions] } : undefined;
}

function pointGeometry(element: OverpassElement): Extract<GeoJsonGeometry, { type: "Point" }> | undefined {
  const record = asRecord(element);
  const direct = toPosition(record);
  if (direct) return { type: "Point", coordinates: direct };
  const first = Array.isArray(record?.geometry) ? toPosition(record.geometry[0]) : undefined;
  return first ? { type: "Point", coordinates: first } : undefined;
}

function featureFromElement(element: OverpassElement, kind: CourseFeature["kind"], index: number): CourseFeature | undefined {
  const geometry = kind === "pin"
    ? pointGeometry(element)
    : kind === "centerline"
      ? lineGeometry(element.geometry)
      : polygonGeometry(element.geometry) ?? lineGeometry(element.geometry);
  if (!geometry) return undefined;
  const tags = asRecord(element.tags);
  const id = asText(element.id) || `${kind}-${index + 1}`;
  const carry = asNumber(tags?.carry_yards);
  const clear = asNumber(tags?.clear_yards);
  return { id: `osm-${id}`, kind, geometry, sourceId: id, carryYards: carry, clearYards: clear };
}

function kindForTags(tags: RecordValue | undefined): CourseFeature["kind"] | undefined {
  const golf = asText(tags?.golf).toLowerCase();
  if (golf === "tee") return "tee";
  if (golf === "green") return "green";
  if (golf === "fairway") return "fairway";
  if (golf === "bunker") return "bunker";
  if (golf === "water_hazard" || golf === "lateral_water_hazard") return "water";
  if (golf === "waste") return "waste";
  if (golf === "out_of_bounds") return "out_of_bounds";
  if (golf === "pin") return "pin";
  return undefined;
}

function geometryPoints(value: unknown): GeoJsonPosition[] {
  if (!Array.isArray(value)) return [];
  return value.map(toPosition).filter((position): position is GeoJsonPosition => Boolean(position));
}

function elementPoints(value: unknown): GeoJsonPosition[] {
  const record = asRecord(value);
  const geometry = geometryPoints(record?.geometry);
  if (geometry.length > 0) return geometry;
  const point = toPosition(record);
  return point ? [point] : [];
}

function nearestDistanceDegrees(points: GeoJsonPosition[], anchors: GeoJsonPosition[]) {
  let nearest = Number.POSITIVE_INFINITY;
  for (const [longitude, latitude] of points) {
    for (let index = 0; index < anchors.length; index += 1) {
      const [anchorLongitude, anchorLatitude] = anchors[index]!;
      nearest = Math.min(nearest, Math.hypot(longitude - anchorLongitude, latitude - anchorLatitude));
      const next = anchors[index + 1];
      if (!next) continue;
      const dx = next[0] - anchorLongitude;
      const dy = next[1] - anchorLatitude;
      const lengthSquared = dx * dx + dy * dy;
      const projection = lengthSquared > 0
        ? Math.max(0, Math.min(1, ((longitude - anchorLongitude) * dx + (latitude - anchorLatitude) * dy) / lengthSquared))
        : 0;
      nearest = Math.min(nearest, Math.hypot(longitude - (anchorLongitude + dx * projection), latitude - (anchorLatitude + dy * projection)));
    }
  }
  return nearest;
}

export function buildOverpassHoleQuery(center: { lat: number; lon: number }, radiusMeters = 2200) {
  const latDelta = radiusMeters / 111_320;
  const lonDelta = radiusMeters / (111_320 * Math.max(0.2, Math.cos((center.lat * Math.PI) / 180)));
  const south = (center.lat - latDelta).toFixed(6);
  const west = (center.lon - lonDelta).toFixed(6);
  const north = (center.lat + latDelta).toFixed(6);
  const east = (center.lon + lonDelta).toFixed(6);
  return `[out:json][timeout:25];(node["golf"](${south},${west},${north},${east});way["golf"](${south},${west},${north},${east});relation["golf"](${south},${west},${north},${east}););out tags geom;`;
}

function referenceNumber(tags: RecordValue | undefined) {
  const value = Number(asText(tags?.ref));
  return Number.isInteger(value) && value > 0 ? value : undefined;
}

function anchorMap(elements: RecordValue[], predicate: (kind: CourseFeature["kind"] | undefined, tags: RecordValue | undefined) => boolean) {
  const anchors = new Map<number, GeoJsonPosition[]>();
  elements.forEach((element) => {
    const tags = asRecord(element.tags);
    const kind = kindForTags(tags);
    const reference = referenceNumber(tags);
    if (reference === undefined || !predicate(kind, tags)) return;
    const positions = elementPoints(element);
    if (positions.length === 0) return;
    anchors.set(reference, [...(anchors.get(reference) ?? []), ...positions]);
  });
  return anchors;
}

function nearestAnchorHole(points: GeoJsonPosition[], anchors: Map<number, GeoJsonPosition[]>) {
  let nearestHole: number | undefined;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const [hole, holeAnchors] of anchors) {
    const distance = nearestDistanceDegrees(points, holeAnchors);
    if (distance < nearestDistance) {
      nearestHole = hole;
      nearestDistance = distance;
    }
  }
  return { hole: nearestHole, distance: nearestDistance };
}

function flattenAnchors(anchors: Map<number, GeoJsonPosition[]>) {
  return [...anchors.values()].flat();
}

function scopedOverpassPayload(payload: unknown, holeNumber: number, layout: Exclude<OverpassGeometryLayout, "auto">) {
  const payloadRecord = asRecord(payload);
  const rawElements = Array.isArray(payloadRecord?.elements) ? payloadRecord.elements : [];
  const elements = rawElements.map(asRecord).filter((element): element is RecordValue => Boolean(element));
  const refAnchors = anchorMap(elements, (kind) => kind !== undefined && kind !== "pin");
  const holeAnchors = anchorMap(elements, (_kind, tags) => asText(tags?.golf).toLowerCase() === "hole");
  const refPoints = flattenAnchors(refAnchors);
  const holePoints = flattenAnchors(holeAnchors);

  const scoped = elements.filter((element) => {
    const tags = asRecord(element.tags);
    const golf = asText(tags?.golf).toLowerCase();
    const kind = kindForTags(tags);
    const reference = referenceNumber(tags);
    if (layout === "hole_centerlines" && golf === "hole") return reference === holeNumber;
    if (layout === "ref_features" && golf === "hole") return false;
    if (!kind) return false;
    if (layout === "hole_centerlines" && reference !== undefined) return false;
    if (reference !== undefined) return reference === holeNumber;

    const points = elementPoints(element);
    if (points.length === 0) return false;
    const nearestRef = refPoints.length > 0 ? nearestAnchorHole(points, refAnchors) : { hole: undefined, distance: Number.POSITIVE_INFINITY };
    const nearestHole = holePoints.length > 0 ? nearestAnchorHole(points, holeAnchors) : { hole: undefined, distance: Number.POSITIVE_INFINITY };
    // An explicit layout is authoritative for unreferenced layers. Comparing
    // distances across cohorts can let a nearby feature from the other local
    // layout win, which is especially harmful when repairing a missing layer.
    const selectedHole = layout === "hole_centerlines" ? nearestHole.hole : nearestRef.hole;
    return selectedHole === holeNumber;
  });

  if (layout === "hole_centerlines") {
    // Most centerline cohorts use unreferenced layers owned by the nearest
    // numbered hole. A few holes mix in an explicitly referenced layer (for
    // example, Squaw Valley Lakes hole 13's green). Add only a missing kind so
    // we repair an incomplete layer without blending duplicate layouts.
    const selectedKinds = new Set(
      scoped
        .map((element) => kindForTags(asRecord(element.tags)))
        .filter((kind): kind is CourseFeature["kind"] => Boolean(kind)),
    );
    const referencedFallbacks = elements.filter((element) => {
      const tags = asRecord(element.tags);
      const kind = kindForTags(tags);
      return kind !== undefined && referenceNumber(tags) === holeNumber && !selectedKinds.has(kind);
    }).map((element) => {
      // Treat the repaired layer as part of the centerline cohort during the
      // recursive normalizer pass; retaining its ref would make nearby
      // unreferenced hazards look like a different layout and drop them.
      const fallbackTags = { ...(asRecord(element.tags) ?? {}) };
      delete fallbackTags.ref;
      fallbackTags["openround:repair"] = "1";
      return { ...element, tags: fallbackTags };
    });
    return { elements: [...scoped, ...referencedFallbacks] };
  }

  return { elements: scoped };
}

export function normalizeOverpassHoleGeometry(
  payload: unknown,
  holeNumber: number,
  sourceVersion = "osm-live",
  layout: OverpassGeometryLayout = "auto",
) : LoadedHoleGeometry {
  if (layout !== "auto") {
    const scopedPayload = scopedOverpassPayload(payload, holeNumber, layout);
    const loaded = normalizeOverpassHoleGeometry(scopedPayload, holeNumber, sourceVersion, "auto");
    if (layout === "hole_centerlines") {
      const repairKinds = new Set(
        loaded.quality.missing.filter((missing): missing is CourseFeature["kind"] =>
          missing === "tee" || missing === "green" || missing === "fairway",
        ),
      );
      if (repairKinds.size > 0) {
        const payloadRecord = asRecord(payload);
        const rawElements = Array.isArray(payloadRecord?.elements) ? payloadRecord.elements : [];
        const referencedRepairs = rawElements
          .map(asRecord)
          .filter((element): element is RecordValue => Boolean(element))
          .filter((element) => {
            const tags = asRecord(element.tags);
            const kind = kindForTags(tags);
            return kind !== undefined && repairKinds.has(kind) && referenceNumber(tags) === holeNumber;
          })
          .map((element) => {
            const fallbackTags = { ...(asRecord(element.tags) ?? {}) };
            delete fallbackTags.ref;
            fallbackTags["openround:repair"] = "1";
            return { ...element, tags: fallbackTags };
          });
        if (referencedRepairs.length > 0) {
          return normalizeOverpassHoleGeometry(
            { elements: [...scopedPayload.elements, ...referencedRepairs] },
            holeNumber,
            sourceVersion,
            "auto",
          );
        }
      }
    }
    return loaded;
  }
  const payloadRecord = asRecord(payload);
  const elements = Array.isArray(payloadRecord?.elements) ? payloadRecord.elements : [];
  const features: CourseFeature[] = [];
  const holeElements = elements.filter((element) => {
    const tags = asRecord(asRecord(element)?.tags);
    return asText(tags?.golf).toLowerCase() === "hole" && Number(tags?.ref) === holeNumber;
  });
  // A number of well-mapped courses tag the hole centerline but omit `ref` on
  // its tees, greens, hazards, and pins. Build ownership anchors for every
  // numbered hole so an unnumbered feature is assigned to the nearest hole,
  // instead of leaking neighboring holes into the requested layer.
  const numberedHoleAnchors = new Map<number, GeoJsonPosition[]>();
  elements.forEach((element) => {
    const record = asRecord(element);
    const tags = asRecord(record?.tags);
    const kind = asText(tags?.golf).toLowerCase();
    const reference = Number(tags?.ref);
    if ((kind === "hole" || Boolean(kindForTags(tags))) && Number.isInteger(reference) && reference > 0) {
      const anchors = numberedHoleAnchors.get(reference) ?? [];
      anchors.push(...elementPoints(element));
      numberedHoleAnchors.set(reference, anchors);
    }
  });
  const holePath = holeElements.flatMap((element) => elementPoints(element));
  const targetNumberedAnchors = elements
    .filter((element) => {
      const record = asRecord(element);
      const tags = asRecord(record?.tags);
      const kind = kindForTags(tags);
      return Boolean(kind && asText(tags?.ref) && Number(tags?.ref) === holeNumber);
    })
    .flatMap((element) => elementPoints(element));
  const ownershipAnchors = holePath.length > 0 ? holePath : targetNumberedAnchors;
  const maxUnnumberedFeatureDistance = holePath.length > 0
    ? UNNUMBERED_FEATURE_MAX_PATH_DISTANCE_DEGREES
    : UNNUMBERED_FEATURE_MAX_ANCHOR_DISTANCE_DEGREES;

  holeElements.forEach((element, index) => {
    const feature = featureFromElement(element as OverpassElement, "centerline", index);
    if (feature) features.push(feature);
  });
  elements.forEach((element, index) => {
    const record = asRecord(element);
    const tags = asRecord(record?.tags);
    const kind = kindForTags(asRecord(record?.tags));
    if (!kind || kind === "centerline") return;
    const ref = asText(tags?.ref);
    if (ref && Number(ref) !== holeNumber) return;
    const isLayoutRepair = asText(tags?.["openround:repair"]) === "1";
    if (ref.length === 0 && !isLayoutRepair) {
      const points = elementPoints(record);
      if (points.length === 0) return;
      if (numberedHoleAnchors.size > 1) {
        let nearestHole: number | undefined;
        let nearestDistance = Number.POSITIVE_INFINITY;
        for (const [candidateHole, anchors] of numberedHoleAnchors) {
          const distance = nearestDistanceDegrees(points, anchors);
          if (distance < nearestDistance) {
            nearestHole = candidateHole;
            nearestDistance = distance;
          }
        }
        if (nearestHole !== holeNumber || nearestDistance > maxUnnumberedFeatureDistance) return;
      } else if (ownershipAnchors.length === 0 || nearestDistanceDegrees(points, ownershipAnchors) > maxUnnumberedFeatureDistance) {
        return;
      }
    }
    if (kind === "pin") {
      if (ref && Number(ref) !== holeNumber) return;
    }
    const feature = featureFromElement(element as OverpassElement, kind, index);
    if (feature) features.push(feature);
  });

  const tees = features.filter((feature) => feature.kind === "tee");
  const greens = features.filter((feature) => feature.kind === "green");
  const fairways = features.filter((feature) => feature.kind === "fairway");
  const hazards = features.filter((feature) => ["bunker", "water", "waste", "out_of_bounds"].includes(feature.kind));
  const pins = features.filter((feature) => feature.kind === "pin");
  const pinUsable = greens.length > 0 && pins.some((pin) =>
    geometryPositions(pin.geometry).some((position) => greens.some((green) => isGeoPositionInsideGeometryOrBoundary(position, green.geometry))),
  );
  const hasCenterline = features.some((feature) => feature.kind === "centerline");
  const hasAimPath = hasCenterline || fairways.length > 0;
  const missing = [
    ...(tees.length > 0 ? [] : ["tee"]),
    ...(greens.length > 0 ? [] : ["green"]),
    ...(hasAimPath ? [] : ["aim path"]),
  ];
  const status: GeometryStatus = missing.length === 0 ? "complete" : features.length > 0 ? "partial" : "unmapped";
  const grade: GeometryQuality["grade"] = missing.length === 0 && hazards.length > 0 && pinUsable ? "A" : missing.length === 0 ? "B" : features.length > 0 ? "C" : "D";
  const hole: OpenRoundHole = {
    number: holeNumber,
    tees: [],
    features,
    geometryStatus: status,
  };
  const readiness = getHoleReadiness(hole);
  return {
    hole,
    quality: {
      grade,
      status,
      missing: [...readiness.missing],
      // A complete centerline is not enough to compute hazard distances. A
      // hole with no validated hazard feature must remain distance-suppressed,
      // even when its tee/green/path layers earn grade B.
      hazardsUsable: missing.length === 0 && hazards.length > 0,
      pinUsable,
      attribution: "© OpenStreetMap contributors (ODbL 1.0)",
    },
    provider: "openstreetmap-overpass",
    sourceVersion,
  };
}

export async function fetchOverpassGeometryPayload(
  center: { lat: number; lon: number },
  fetcher: typeof fetch = fetch,
  radiusMeters = 2200,
  endpoint = "https://overpass-api.de/api/interpreter",
): Promise<unknown> {
  const retryableStatuses = new Set([429, 500, 502, 503, 504]);
  const maxAttempts = 3;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);
    try {
      const response = await fetcher(endpoint, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
          "User-Agent": "OpenRound-course-geometry/0.1 (https://openround.app)",
        },
        body: `data=${encodeURIComponent(buildOverpassHoleQuery(center, radiusMeters))}`,
        signal: controller.signal,
      });
      if (response.ok) return response.json();
      if (!retryableStatuses.has(response.status) || attempt === maxAttempts - 1) {
        throw new Error(`OpenStreetMap geometry request failed (${response.status})`);
      }
      const retryAfter = response.headers?.get?.("retry-after");
      const retryAfterSeconds = retryAfter ? Number(retryAfter) : Number.NaN;
      const delayMs = Number.isFinite(retryAfterSeconds) && retryAfterSeconds >= 0
        ? Math.min(5_000, retryAfterSeconds * 1_000)
        : Math.min(5_000, 250 * 2 ** attempt);
      if (delayMs > 0) await new Promise((resolveDelay) => setTimeout(resolveDelay, delayMs));
    } finally {
      clearTimeout(timeout);
    }
  }
  throw new Error("OpenStreetMap geometry request failed after retries");
}

export async function fetchOverpassHoleGeometry(
  center: { lat: number; lon: number },
  holeNumber: number,
  fetcher: typeof fetch = fetch,
  radiusMeters = 2200,
  endpoint = "https://overpass-api.de/api/interpreter",
  layout: OverpassGeometryLayout = "auto",
): Promise<LoadedHoleGeometry> {
  return normalizeOverpassHoleGeometry(await fetchOverpassGeometryPayload(center, fetcher, radiusMeters, endpoint), holeNumber, "osm-live", layout);
}
