import type { CourseCatalogEntry } from "./openroundCourseCatalog.ts";
import type { CourseTeeSet } from "./openroundCourseData.ts";

/**
 * Personal, user-pinned course seeds that are not present in the OpenGolfAPI
 * bulk release. These entries are deliberately separate from the catalog so
 * the pinned OpenGolfAPI checksum and course count remain truthful.
 *
 * The facility center is the OSM-mapped clubhouse location. Squaw Valley has
 * two OSM layouts in the same response, so refreshes select the numbered
 * feature cohort for Apache Links and the numbered-hole cohort for Comanche
 * Lakes. Any hole that is missing a required layer remains graded and fails
 * closed rather than borrowing features from the other layout.
 */
export const PERSONAL_COURSE_ENTRIES: readonly CourseCatalogEntry[] = [
  {
    id: "personal-squaw-valley-links-osm-v1",
    name: "Squaw Valley Golf Course · Links",
    aliases: ["Squaw Valley Course", "Apache Links", "Squaw Valley Apache Links"],
    country: "US",
    state: "TX",
    city: "Glen Rose",
    center: { lat: 32.25769, lon: -97.72271 },
    holes: 18,
    par: 72,
    totalYardage: 7063,
    updatedAt: "2026-08-28T00:00:00.000Z",
    sourceVersion: "personal-osm-links-v2",
  },
  {
    id: "personal-squaw-valley-lakes-pending-v1",
    name: "Squaw Valley Golf Course · Lakes",
    aliases: ["Squaw Valley Course", "Comanche Lakes", "Squaw Valley Comanche Lakes"],
    country: "US",
    state: "TX",
    city: "Glen Rose",
    center: { lat: 32.25769, lon: -97.72271 },
    holes: 18,
    par: 72,
    totalYardage: 7000,
    updatedAt: "2026-08-28T00:00:00.000Z",
    sourceVersion: "personal-osm-lakes-v1",
  },
];

export const DEFAULT_OPENROUND_COURSE = PERSONAL_COURSE_ENTRIES[1];

export const PERSONAL_COURSE_IDS = new Set(PERSONAL_COURSE_ENTRIES.map((course) => course.id));

/**
 * Scorecard tee metadata is kept separate from mapped tee polygons: OSM proves
 * location, while reviewed scorecards provide the marker names and totals.
 * Rating and slope stay omitted because the reviewed directories disagree.
 */
const PERSONAL_COURSE_TEE_SETS: Readonly<Record<string, readonly CourseTeeSet[]>> = {
  "personal-squaw-valley-links-osm-v1": [
    { id: "gold", name: "Gold", totalYards: 7063, holeYards: {} },
    { id: "blue", name: "Blue", totalYards: 6731, holeYards: {} },
    { id: "white", name: "White", totalYards: 6284, holeYards: {} },
    { id: "black", name: "Black", totalYards: 5194, holeYards: {} },
    { id: "red", name: "Red", totalYards: 5009, holeYards: {} },
  ],
  "personal-squaw-valley-lakes-pending-v1": [
    { id: "gold", name: "Gold", totalYards: 7000, holeYards: {} },
    { id: "blue", name: "Blue", totalYards: 6633, holeYards: {} },
    { id: "white", name: "White", totalYards: 6143, holeYards: {} },
    { id: "black", name: "Black", totalYards: 5597, holeYards: {} },
    { id: "red", name: "Red", totalYards: 5116, holeYards: {} },
  ],
};

// Reviewed 2026-09-04 against Golfify's published Apache Links and Comanche Lakes scorecards.
const PERSONAL_COURSE_HOLE_PARS: Readonly<Record<string, readonly number[]>> = {
  "personal-squaw-valley-links-osm-v1": [4, 3, 4, 4, 5, 3, 4, 5, 4, 3, 4, 5, 4, 3, 4, 4, 4, 5],
  "personal-squaw-valley-lakes-pending-v1": [4, 5, 3, 4, 4, 5, 3, 4, 4, 4, 3, 4, 3, 5, 4, 4, 4, 5],
};

export function getPersonalCourseTeeSets(courseId: string | undefined): readonly CourseTeeSet[] {
  return courseId ? PERSONAL_COURSE_TEE_SETS[courseId] ?? [] : [];
}

export function getPersonalCourseHolePar(courseId: string | undefined, holeNumber: number): number | undefined {
  return courseId ? PERSONAL_COURSE_HOLE_PARS[courseId]?.[holeNumber - 1] : undefined;
}
