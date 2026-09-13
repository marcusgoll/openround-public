export type CourseProvider = "opengolfapi" | "openstreetmap" | "prototype_fixture";

export type GeometryStatus = "complete" | "partial" | "unmapped";

export type GeoPoint = {
  lat: number;
  lon: number;
};

export type GeoJsonPosition = [number, number];

export type GeoJsonGeometry =
  | { type: "Point"; coordinates: GeoJsonPosition }
  | { type: "LineString"; coordinates: GeoJsonPosition[] }
  | { type: "Polygon"; coordinates: GeoJsonPosition[][] }
  | { type: "MultiPolygon"; coordinates: GeoJsonPosition[][][] };

export type CourseFeatureKind =
  | "tee"
  | "green"
  | "fairway"
  | "bunker"
  | "water"
  | "waste"
  | "out_of_bounds"
  | "pin"
  | "centerline";

export type CourseFeature = {
  id: string;
  kind: CourseFeatureKind;
  geometry: GeoJsonGeometry;
  sourceId?: string;
  carryYards?: number;
  clearYards?: number;
};

export type CourseTeeSet = {
  id: string;
  name: string;
  rating?: number;
  slope?: number;
  totalYards?: number;
  holeYards: Record<string, number>;
  point?: GeoJsonGeometry;
};

export type OpenRoundHole = {
  number: number;
  par?: number;
  handicap?: number;
  yardage?: number;
  tees: CourseTeeSet[];
  features: CourseFeature[];
  geometryStatus: GeometryStatus;
};

export type OpenRoundCourse = {
  id: string;
  name: string;
  country: string;
  state?: string;
  city?: string;
  center?: GeoPoint;
  holes: OpenRoundHole[];
  source: {
    provider: CourseProvider;
    sourceId: string;
    license: string;
    version: string;
  };
  geometryStatus: GeometryStatus;
};

export type HoleReadiness = {
  status: "ready" | "partial" | "unmapped";
  ready: boolean;
  missing: string[];
  optionalMissing: string[];
};

export type CourseDataAdapter = {
  provider: CourseProvider;
  normalize(value: unknown): OpenRoundCourse;
};

type RawRecord = Record<string, unknown>;

const FEATURE_KINDS: readonly CourseFeatureKind[] = [
  "tee",
  "green",
  "fairway",
  "bunker",
  "water",
  "waste",
  "out_of_bounds",
  "pin",
  "centerline",
];

function asRecord(value: unknown): RawRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as RawRecord) : null;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function asFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function asPositiveInteger(value: unknown): number | undefined {
  const number = asFiniteNumber(value);
  return number !== undefined && Number.isInteger(number) && number > 0 ? number : undefined;
}

function asGeoJsonPosition(value: unknown): GeoJsonPosition | undefined {
  if (!Array.isArray(value) || value.length < 2) return undefined;
  const longitude = asFiniteNumber(value[0]);
  const latitude = asFiniteNumber(value[1]);
  return longitude === undefined || latitude === undefined || longitude < -180 || longitude > 180 || latitude < -90 || latitude > 90
    ? undefined
    : [longitude, latitude];
}

function normalizeGeometry(value: unknown): GeoJsonGeometry | undefined {
  const record = asRecord(value);
  if (!record) return undefined;

  const type = asString(record.type);
  const coordinates = record.coordinates;
  if (type === "Point") {
    const position = asGeoJsonPosition(coordinates);
    return position ? { type, coordinates: position } : undefined;
  }
  if (type === "LineString" && Array.isArray(coordinates)) {
    const positions = coordinates.map(asGeoJsonPosition);
    return positions.every(Boolean)
      ? { type, coordinates: positions as GeoJsonPosition[] }
      : undefined;
  }
  if (type === "Polygon" && Array.isArray(coordinates)) {
    const rings = coordinates.map((ring) => (Array.isArray(ring) ? ring.map(asGeoJsonPosition) : []));
    return rings.every((ring) => ring.length > 0 && ring.every(Boolean))
      ? { type, coordinates: rings as GeoJsonPosition[][] }
      : undefined;
  }
  if (type === "MultiPolygon" && Array.isArray(coordinates)) {
    const polygons = coordinates.map((polygon) =>
      Array.isArray(polygon)
        ? polygon.map((ring) => (Array.isArray(ring) ? ring.map(asGeoJsonPosition) : []))
        : [],
    );
    return polygons.every((polygon) => polygon.length > 0 && polygon.every((ring) => ring.length > 0 && ring.every(Boolean)))
      ? { type, coordinates: polygons as GeoJsonPosition[][][] }
      : undefined;
  }

  return undefined;
}

function normalizeFeatureKind(value: unknown, fallback?: CourseFeatureKind): CourseFeatureKind | undefined {
  const kind = asString(value)?.toLowerCase().replace(/[ -]/g, "_");
  if (kind && FEATURE_KINDS.includes(kind as CourseFeatureKind)) return kind as CourseFeatureKind;
  return fallback;
}

function normalizeFeature(value: unknown, fallbackKind: CourseFeatureKind | undefined, index: number): CourseFeature | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  const geometry = normalizeGeometry(record.geometry ?? record);
  const kind = normalizeFeatureKind(record.kind ?? record.type ?? record.feature, fallbackKind);
  if (!geometry || !kind) return undefined;

  const id = asString(record.id) ?? `${kind}-${index + 1}`;
  return {
    id,
    kind,
    geometry,
    sourceId: asString(record.source_id ?? record.sourceId ?? record.osm_id),
    carryYards: asFiniteNumber(record.carry_yards ?? record.carryYards ?? record.distance_from_tee_yards),
    clearYards: asFiniteNumber(record.clear_yards ?? record.clearYards),
  };
}

function normalizeFeatureCollection(record: RawRecord, indexOffset = 0): CourseFeature[] {
  const features: CourseFeature[] = [];
  const directFeatures = Array.isArray(record.features) ? record.features : [];
  directFeatures.forEach((feature, index) => {
    const normalized = normalizeFeature(feature, undefined, indexOffset + index);
    if (normalized) features.push(normalized);
  });

  const geometry = asRecord(record.geometry);
  const geometryFields: Array<[string, CourseFeatureKind]> = [
    ["tees", "tee"],
    ["greens", "green"],
    ["fairways", "fairway"],
    ["bunkers", "bunker"],
    ["water", "water"],
    ["waste", "waste"],
    ["out_of_bounds", "out_of_bounds"],
    ["pins", "pin"],
    ["centerlines", "centerline"],
    ["centerline", "centerline"],
  ];

  for (const [field, kind] of geometryFields) {
    const values = geometry?.[field] ?? record[field];
    const entries = Array.isArray(values) ? values : values ? [values] : [];
    entries.forEach((entry, index) => {
      const normalized = normalizeFeature(entry, kind, indexOffset + features.length + index);
      if (normalized) features.push(normalized);
    });
  }

  const hazards = Array.isArray(record.hazards) ? record.hazards : [];
  hazards.forEach((hazard, index) => {
    const hazardRecord = asRecord(hazard);
    const hazardKind = normalizeFeatureKind(hazardRecord?.type ?? hazardRecord?.kind, "water");
    const normalized = normalizeFeature(hazard, hazardKind, indexOffset + features.length + index);
    if (normalized) features.push(normalized);
  });

  return features;
}

function normalizeTeeSet(value: unknown, index: number): CourseTeeSet | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  const name = asString(record.name ?? record.label ?? record.color);
  if (!name) return undefined;

  const holeYards: Record<string, number> = {};
  const yardages = Array.isArray(record.yardages) ? record.yardages : [];
  yardages.forEach((yardage) => {
    const yardageRecord = asRecord(yardage);
    const hole = asPositiveInteger(yardageRecord?.hole ?? yardageRecord?.number);
    const yards = asFiniteNumber(yardageRecord?.yards ?? yardageRecord?.yardage ?? yardageRecord?.distance_yards);
    if (hole !== undefined && yards !== undefined) holeYards[String(hole)] = yards;
  });

  return {
    id: asString(record.id ?? record.tee_id) ?? `tee-${index + 1}`,
    name,
    rating: asFiniteNumber(record.rating ?? record.course_rating),
    slope: asFiniteNumber(record.slope),
    totalYards: asFiniteNumber(record.total_yards ?? record.yards),
    holeYards,
    point: normalizeGeometry(record.point ?? record.geometry),
  };
}

function normalizeTeeSets(value: unknown): CourseTeeSet[] {
  const entries = Array.isArray(value) ? value : [];
  return entries.map(normalizeTeeSet).filter((tee): tee is CourseTeeSet => Boolean(tee));
}

function normalizeHole(value: unknown, courseTeeSets: CourseTeeSet[], index: number): OpenRoundHole | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  const number = asPositiveInteger(record.number ?? record.hole);
  if (number === undefined) return undefined;

  const tees = normalizeTeeSets(record.tees);
  const normalizedTees = tees.length > 0 ? tees : courseTeeSets;
  const features = normalizeFeatureCollection(record, index * 10);
  const readiness = getHoleReadiness({
    number,
    par: asFiniteNumber(record.par),
    handicap: asFiniteNumber(record.handicap ?? record.stroke_index),
    yardage: asFiniteNumber(record.yardage ?? record.yards),
    tees: normalizedTees,
    features,
    geometryStatus: "unmapped",
  });

  return {
    number,
    par: asFiniteNumber(record.par),
    handicap: asFiniteNumber(record.handicap ?? record.stroke_index),
    yardage: asFiniteNumber(record.yardage ?? record.yards),
    tees: normalizedTees,
    features,
    geometryStatus: readiness.status === "ready" ? "complete" : readiness.status,
  };
}

function normalizeScorecardEntries(value: unknown): RawRecord[] {
  return Array.isArray(value) ? value.map(asRecord).filter((entry): entry is RawRecord => Boolean(entry)) : [];
}

function normalizeCourseHoles(record: RawRecord, courseTeeSets: CourseTeeSet[]): OpenRoundHole[] {
  const rawHolesValue = record.holes;
  const rawHolesRecord = asRecord(rawHolesValue);
  const rawHoles = Array.isArray(rawHolesValue)
    ? rawHolesValue
    : rawHolesRecord && Array.isArray(rawHolesRecord.holes)
      ? rawHolesRecord.holes
      : [];
  const holes = rawHoles.map((hole, index) => normalizeHole(hole, courseTeeSets, index)).filter((hole): hole is OpenRoundHole => Boolean(hole));
  if (holes.length > 0) return holes.sort((left, right) => left.number - right.number);

  return normalizeScorecardEntries(record.scorecard)
    .map((entry, index) =>
      normalizeHole(
        {
          ...entry,
          number: entry.hole ?? entry.number,
        },
        courseTeeSets,
        index,
      ),
    )
    .filter((hole): hole is OpenRoundHole => Boolean(hole))
    .sort((left, right) => left.number - right.number);
}

function courseGeometryStatus(holes: OpenRoundHole[]): GeometryStatus {
  if (holes.length === 0) return "unmapped";
  if (holes.every((hole) => hole.geometryStatus === "complete")) return "complete";
  if (holes.some((hole) => hole.geometryStatus !== "unmapped")) return "partial";
  return "unmapped";
}

export function normalizeOpenGolfCourse(value: unknown): OpenRoundCourse {
  const record = asRecord(value) ?? {};
  const id = asString(record.id ?? record.course_id) ?? "unknown-course";
  const sourceVersion = asString(record.source_version ?? record.version) ?? "unversioned";
  const centerLat = asFiniteNumber(record.latitude ?? record.lat);
  const centerLon = asFiniteNumber(record.longitude ?? record.lon ?? record.lng);
  const courseTeeSets = normalizeTeeSets(record.tees ?? record.tee_sets);
  const holes = normalizeCourseHoles(record, courseTeeSets);

  return {
    id,
    name: asString(record.name) ?? "Unnamed golf course",
    country: asString(record.country) ?? "US",
    state: asString(record.state ?? record.region),
    city: asString(record.city),
    center: centerLat !== undefined && centerLon !== undefined && centerLat >= -90 && centerLat <= 90 && centerLon >= -180 && centerLon <= 180
      ? { lat: centerLat, lon: centerLon }
      : undefined,
    holes,
    source: {
      provider: "opengolfapi",
      sourceId: id,
      license: asString(record.license) ?? "ODbL-1.0",
      version: sourceVersion,
    },
    geometryStatus: courseGeometryStatus(holes),
  };
}

export const OPEN_GOLF_API_ADAPTER: CourseDataAdapter = {
  provider: "opengolfapi",
  normalize: normalizeOpenGolfCourse,
};

export function getHoleReadiness(hole: OpenRoundHole): HoleReadiness {
  const missing: string[] = [];
  const optionalMissing: string[] = [];
  const hasTee = hole.features.some((feature) => feature.kind === "tee") || hole.tees.some((tee) => Boolean(tee.point));
  const hasGreen = hole.features.some((feature) => feature.kind === "green");
  const hasAimPath = hole.features.some((feature) => feature.kind === "centerline" || feature.kind === "fairway");
  const hasHazards = hole.features.some((feature) => ["bunker", "water", "waste", "out_of_bounds"].includes(feature.kind));

  if (!hasTee) missing.push("tee");
  if (!hasGreen) missing.push("green");
  if (!hasAimPath) missing.push("aim path");
  if (!hasHazards) optionalMissing.push("hazards");

  const hasAnyGeometry = hole.features.length > 0 || hole.tees.some((tee) => Boolean(tee.point));
  const status = missing.length === 0 ? "ready" : hasAnyGeometry ? "partial" : "unmapped";
  return {
    status,
    ready: status === "ready",
    missing,
    optionalMissing,
  };
}

export function getCourseHole(course: OpenRoundCourse, number: number): OpenRoundHole | undefined {
  return course.holes.find((hole) => hole.number === number);
}

export const DEMO_OPENROUND_COURSE: OpenRoundCourse = {
  id: "openround-demo-course-v1",
  name: "OpenRound Demo Course",
  country: "US",
  state: "CA",
  city: "Pebble Beach",
  source: {
    provider: "prototype_fixture",
    sourceId: "openround-demo-course-v1",
    license: "internal-demo-fixture",
    version: "1",
  },
  geometryStatus: "partial",
  holes: [
    {
      number: 7,
      par: 4,
      handicap: 11,
      yardage: 162,
      tees: [],
      features: [],
      geometryStatus: "partial",
    },
  ],
};
