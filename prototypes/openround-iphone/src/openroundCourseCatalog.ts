export type CatalogGeoPoint = {
  lat: number;
  lon: number;
};

export type CourseCatalogEntry = {
  id: string;
  name: string;
  /** Optional local search terms (for example a facility's published layout name). */
  aliases?: string[];
  country: string;
  state?: string;
  city?: string;
  center?: CatalogGeoPoint;
  holes?: number;
  par?: number;
  totalYardage?: number;
  updatedAt?: string;
  sourceVersion: string;
};

export type CourseCatalogIndex = {
  provider: "opengolfapi";
  version: string;
  generatedAt: string;
  courseCount: number;
  entries: CourseCatalogEntry[];
};

export type CourseCatalogManifest = {
  provider: "opengolfapi";
  release: string;
  generatedAt: string;
  artifact: string;
  format: string;
  sha256: string;
  courseCount: number;
  geometryCoverage: string;
  sourceUrl: string;
  license: string;
  attribution: string;
};

export type CourseSelection = {
  version: 1;
  courseId: string;
  holeNumber: number;
  sourceVersion: string;
  confirmedAt: string;
};

export const COURSE_SELECTION_STORAGE_KEY = "openround:course-selection:v1";
export const COURSE_CATALOG_INDEX_URL = "/course-data/opengolfapi-us-current.index.json";
export const COURSE_CATALOG_MANIFEST_URL = "/course-data/opengolfapi-us-current.manifest.json";

const US_STATE_NAME_TO_ABBREVIATION: Readonly<Record<string, string>> = {
  alabama: "al",
  alaska: "ak",
  arizona: "az",
  arkansas: "ar",
  california: "ca",
  colorado: "co",
  connecticut: "ct",
  delaware: "de",
  florida: "fl",
  georgia: "ga",
  hawaii: "hi",
  idaho: "id",
  illinois: "il",
  indiana: "in",
  iowa: "ia",
  kansas: "ks",
  kentucky: "ky",
  louisiana: "la",
  maine: "me",
  maryland: "md",
  massachusetts: "ma",
  michigan: "mi",
  minnesota: "mn",
  mississippi: "ms",
  missouri: "mo",
  montana: "mt",
  nebraska: "ne",
  nevada: "nv",
  "new hampshire": "nh",
  "new jersey": "nj",
  "new mexico": "nm",
  "new york": "ny",
  "north carolina": "nc",
  "north dakota": "nd",
  ohio: "oh",
  oklahoma: "ok",
  oregon: "or",
  pennsylvania: "pa",
  "rhode island": "ri",
  "south carolina": "sc",
  "south dakota": "sd",
  tennessee: "tn",
  texas: "tx",
  utah: "ut",
  vermont: "vt",
  virginia: "va",
  washington: "wa",
  "west virginia": "wv",
  wisconsin: "wi",
  wyoming: "wy",
};

const US_STATE_ABBREVIATION_TO_NAME: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(US_STATE_NAME_TO_ABBREVIATION).map(([name, abbreviation]) => [abbreviation, name]),
);

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as UnknownRecord) : null;
}

function asText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function asPositiveInteger(value: unknown): number | undefined {
  const number = asNumber(value);
  return number !== undefined && Number.isInteger(number) && number > 0 ? number : undefined;
}

function normalizeSearchText(value: string): string {
  return value
    .trim()
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function searchTokens(value: string | undefined): string[] {
  const normalized = normalizeSearchText(value ?? "");
  return normalized ? normalized.split(" ") : [];
}

function stateSearchTokens(state: string | undefined): string[] {
  const normalized = normalizeSearchText(state ?? "");
  if (!normalized) return [];
  const aliases = normalized.length === 2
    ? searchTokens(US_STATE_ABBREVIATION_TO_NAME[normalized])
    : searchTokens(US_STATE_NAME_TO_ABBREVIATION[normalized]);
  return [...new Set([normalized, ...aliases])];
}

export function normalizeCatalogEntry(value: unknown, sourceVersion = "unversioned"): CourseCatalogEntry | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  const properties = asRecord(record.properties) ?? record;
  const id = asText(record.id ?? properties.id ?? properties.course_id);
  const name = asText(properties.name ?? properties.course_name ?? record.name);
  const centerRecord = asRecord(properties.center);
  const coordinates = Array.isArray(asRecord(record.geometry)?.coordinates)
    ? (asRecord(record.geometry)?.coordinates as unknown[])
    : undefined;
  const lon = asNumber(properties.longitude ?? properties.lon ?? properties.lng ?? centerRecord?.lon ?? coordinates?.[0]);
  const lat = asNumber(properties.latitude ?? properties.lat ?? centerRecord?.lat ?? coordinates?.[1]);
  if (!id || !name) return undefined;

  return {
    id,
    name,
    aliases: Array.isArray(properties.aliases)
      ? properties.aliases.filter((alias): alias is string => typeof alias === "string" && alias.trim().length > 0).map((alias) => alias.trim())
      : undefined,
    country: asText(properties.country) ?? "US",
    state: asText(properties.state ?? properties.region),
    city: asText(properties.city),
    center: lat !== undefined && lon !== undefined ? { lat, lon } : undefined,
    holes: asPositiveInteger(properties.holes),
    par: asNumber(properties.par),
    totalYardage: asNumber(properties.total_yardage ?? properties.yardage),
    updatedAt: asText(properties.updated_at ?? properties.updatedAt),
    sourceVersion: asText(properties.source_version ?? properties.version) ?? sourceVersion,
  };
}

/**
 * Validate the pinned upstream shape before a refresh can replace any local
 * artifact. Individual duplicate records are allowed (the preparation step
 * deduplicates by id), but every record must still be a usable US course.
 */
export function isCourseCatalogArtifact(value: unknown): value is { type: "FeatureCollection"; features: unknown[] } {
  const record = asRecord(value);
  if (record?.type !== "FeatureCollection" || !Array.isArray(record.features) || record.features.length === 0) return false;
  return record.features.every((feature) => {
    const normalized = normalizeCatalogEntry(feature, "artifact");
    if (!normalized || normalized.country !== "US") return false;
    if (!normalized.center) return true;
    return normalized.center.lat >= -90 && normalized.center.lat <= 90 &&
      normalized.center.lon >= -180 && normalized.center.lon <= 180;
  });
}

export function createCourseCatalogIndex(value: unknown, version = "v2.1.0"): CourseCatalogIndex {
  const record = asRecord(value);
  const rawFeatures = Array.isArray(record?.features) ? record.features : Array.isArray(value) ? value : [];
  const deduped = new Map<string, CourseCatalogEntry>();
  rawFeatures.forEach((feature) => {
    const entry = normalizeCatalogEntry(feature, version);
    if (!entry || deduped.has(entry.id)) return;
    deduped.set(entry.id, entry);
  });
  const entries = [...deduped.values()].sort((left, right) => {
    const stateCompare = (left.state ?? "").localeCompare(right.state ?? "");
    return stateCompare || left.name.localeCompare(right.name) || left.id.localeCompare(right.id);
  });
  return {
    provider: "opengolfapi",
    version,
    generatedAt: new Date().toISOString(),
    courseCount: entries.length,
    entries,
  };
}

export function mergeCourseCatalogEntries(index: CourseCatalogIndex, additionalEntries: readonly CourseCatalogEntry[]): CourseCatalogIndex {
  const deduped = new Map(index.entries.map((entry) => [entry.id, entry]));
  additionalEntries.forEach((entry) => {
    if (!deduped.has(entry.id)) deduped.set(entry.id, entry);
  });
  const entries = [...deduped.values()].sort((left, right) => {
    const stateCompare = (left.state ?? "").localeCompare(right.state ?? "");
    return stateCompare || left.name.localeCompare(right.name) || left.id.localeCompare(right.id);
  });
  return { ...index, entries, courseCount: entries.length };
}

export function isCourseCatalogIndex(value: unknown): value is CourseCatalogIndex {
  const record = asRecord(value);
  const entries = Array.isArray(record?.entries) ? record.entries : [];
  const ids = entries.map((entry) => asText(asRecord(entry)?.id)).filter((id): id is string => Boolean(id));
  return (
    record?.provider === "opengolfapi" &&
    typeof record.version === "string" && /^v\d+\.\d+\.\d+$/.test(record.version) &&
    typeof record.generatedAt === "string" &&
    typeof record.courseCount === "number" &&
    Number.isInteger(record.courseCount) &&
    record.courseCount > 0 &&
    record.courseCount === entries.length &&
    ids.length === entries.length &&
    new Set(ids).size === ids.length &&
    entries.every((entry) => {
      const normalized = normalizeCatalogEntry(entry, record.version as string);
      if (!normalized || normalized.sourceVersion !== record.version || normalized.country !== "US") return false;
      if (!normalized.center) return true;
      return normalized.center.lat >= -90 && normalized.center.lat <= 90 && normalized.center.lon >= -180 && normalized.center.lon <= 180;
    })
  );
}

export function isCourseCatalogManifest(value: unknown): value is CourseCatalogManifest {
  const record = asRecord(value);
  const courseCount = asNumber(record?.courseCount);
  const validCourseCount = courseCount !== undefined && Number.isInteger(courseCount) && courseCount > 0;
  return Boolean(
    record?.provider === "opengolfapi" &&
      typeof record.release === "string" && /^v\d+\.\d+\.\d+$/.test(record.release) &&
      typeof record.generatedAt === "string" &&
      typeof record.artifact === "string" && record.artifact.length > 0 &&
      typeof record.format === "string" && record.format.length > 0 &&
      typeof record.sha256 === "string" && /^[a-f0-9]{64}$/i.test(record.sha256) &&
      validCourseCount &&
      typeof record.geometryCoverage === "string" && record.geometryCoverage.length > 0 &&
      typeof record.sourceUrl === "string" && record.sourceUrl.length > 0 &&
      typeof record.license === "string" && record.license.length > 0 &&
      typeof record.attribution === "string" && record.attribution.length > 0,
  );
}

export function searchCourses(index: CourseCatalogIndex, query: string, limit = 12): CourseCatalogEntry[] {
  const normalized = normalizeSearchText(query);
  if (!normalized) return index.entries.slice(0, limit);
  const tokens = searchTokens(normalized);
  return index.entries
    .map((entry) => {
      const name = normalizeSearchText(entry.name);
      const aliases = (entry.aliases ?? []).map(normalizeSearchText);
      const city = normalizeSearchText(entry.city ?? "");
      const state = normalizeSearchText(entry.state ?? "");
      const country = normalizeSearchText(entry.country);
      const cityTokens = searchTokens(city);
      const stateTokens = stateSearchTokens(entry.state);
      const countryTokens = searchTokens(country);
      const metadata = [city, state, country].filter(Boolean).join(" ");
      const exactAliasBonus = aliases.some((alias) => alias === normalized) ? 44 : 0;
      const exactNameBonus = name === normalized ? 40 : name.startsWith(normalized) ? 12 : name.includes(normalized) ? 6 : 0;
      const exactCityBonus = city === normalized ? 48 : city.includes(normalized) ? 18 : 0;
      const exactStateBonus = stateTokens.includes(normalized) ? 42 : state.includes(normalized) ? 16 : 0;
      const metadataPhraseBonus = metadata.includes(normalized) ? 12 : 0;
      const score = exactAliasBonus + exactNameBonus + exactCityBonus + exactStateBonus + metadataPhraseBonus + tokens.reduce((total, token) => {
        let tokenScore = 0;
        if (name.startsWith(token)) tokenScore += 4;
        else if (name.includes(token)) tokenScore += 2;
        if (aliases.some((alias) => alias.startsWith(token))) tokenScore += 6;
        else if (aliases.some((alias) => alias.includes(token))) tokenScore += 3;
        if (cityTokens.includes(token)) tokenScore += 8;
        else if (city.includes(token)) tokenScore += 4;
        if (stateTokens.includes(token)) tokenScore += 8;
        if (countryTokens.includes(token)) tokenScore += 2;
        return total + tokenScore;
      }, 0);
      return { entry, score };
    })
    .filter((result) => result.score > 0)
    .sort((left, right) => right.score - left.score || left.entry.name.localeCompare(right.entry.name))
    .slice(0, limit)
    .map((result) => result.entry);
}

function haversineMiles(left: CatalogGeoPoint, right: CatalogGeoPoint) {
  const toRadians = (value: number) => (value * Math.PI) / 180;
  const dLat = toRadians(right.lat - left.lat);
  const dLon = toRadians(right.lon - left.lon);
  const latitude = toRadians((left.lat + right.lat) / 2);
  const x = dLon * Math.cos(latitude);
  const y = dLat;
  return Math.hypot(x, y) * 3958.7613;
}

export function findNearbyCourses(index: CourseCatalogIndex, location: CatalogGeoPoint, radiusMiles = 25, limit = 12) {
  return index.entries
    .flatMap((entry) => (entry.center ? [{ entry, distanceMiles: haversineMiles(location, entry.center) }] : []))
    .filter((result) => result.distanceMiles <= radiusMiles)
    .sort((left, right) => left.distanceMiles - right.distanceMiles || left.entry.name.localeCompare(right.entry.name))
    .slice(0, limit);
}

export function parseCourseSelection(value: unknown): CourseSelection | undefined {
  const record = asRecord(value);
  const courseId = asText(record?.courseId);
  const sourceVersion = asText(record?.sourceVersion);
  const holeNumber = asPositiveInteger(record?.holeNumber);
  const confirmedAt = asText(record?.confirmedAt);
  if (record?.version !== 1 || !courseId || !sourceVersion || !holeNumber || !confirmedAt) return undefined;
  return { version: 1, courseId, holeNumber, sourceVersion, confirmedAt };
}

export function isCourseSelectionCurrent(selection: CourseSelection, course: CourseCatalogEntry): boolean {
  return selection.courseId === course.id &&
    selection.sourceVersion === course.sourceVersion &&
    selection.holeNumber <= (course.holes ?? Number.MAX_SAFE_INTEGER);
}

export function loadStoredCourseSelection(storage: Pick<Storage, "getItem"> | undefined): CourseSelection | undefined {
  if (!storage) return undefined;
  try {
    const raw = storage.getItem(COURSE_SELECTION_STORAGE_KEY);
    return raw ? parseCourseSelection(JSON.parse(raw)) : undefined;
  } catch {
    return undefined;
  }
}

export function storeCourseSelection(
  storage: Pick<Storage, "setItem"> | undefined,
  course: CourseCatalogEntry,
  holeNumber: number,
  confirmedAt = new Date().toISOString(),
) {
  const selection: CourseSelection = {
    version: 1,
    courseId: course.id,
    holeNumber,
    sourceVersion: course.sourceVersion,
    confirmedAt,
  };
  try {
    storage?.setItem(COURSE_SELECTION_STORAGE_KEY, JSON.stringify(selection));
  } catch {
    // Private sessions can deny storage; the in-memory selection remains useful.
  }
  return selection;
}
