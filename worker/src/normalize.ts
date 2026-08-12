import { QUESTION_MAP } from "./question-map";
import type {
  Counts,
  DashboardPayload,
  NormalizedResponse,
  RawResponse,
  RoleCounts,
  SchoolSummary,
} from "./types";

export type QuestionMap = Record<keyof typeof QUESTION_MAP, string | null>;

export function normalizeSchool(value: unknown): { original: string; key: string } | null {
  if (typeof value !== "string") return null;
  const original = value.trim().replace(/\s+/g, " ");
  if (!original) return null;
  return {
    original,
    key: original.normalize("NFKC").toLocaleLowerCase("es-AR"),
  };
}

export function detectCompletion(raw: RawResponse, field = "submitdate"): boolean {
  const value = raw[field];
  if (value === true || value === 1) return true;
  if (value === false || value === 0 || value == null) return false;
  if (typeof value !== "string") return Boolean(value);
  const normalized = value.trim().toLocaleLowerCase("es-AR");
  if (!normalized || ["n", "no", "false", "incomplete", "incompleta", "0"].includes(normalized)) return false;
  return true;
}

export function parseCourseYear(value: unknown): number | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const match = String(value).match(/\b([1-7])\b/);
  return match ? Number(match[1]) : null;
}

export function parseCoordinate(value: unknown, kind: "lat" | "lon"): number | null {
  if (typeof value !== "number" && typeof value !== "string") return null;
  const parsed = Number(String(value).trim().replace(",", "."));
  const limit = kind === "lat" ? 90 : 180;
  return Number.isFinite(parsed) && parsed >= -limit && parsed <= limit ? parsed : null;
}

export function normalizeResponse(raw: RawResponse, map: QuestionMap): NormalizedResponse | null {
  if (!map.SCHOOL) throw new Error("Falta configurar QUESTION_MAP.SCHOOL en src/question-map.ts");
  const school = normalizeSchool(raw[map.SCHOOL]);
  if (!school) return null;
  const lat = map.LATITUDE ? parseCoordinate(raw[map.LATITUDE], "lat") : null;
  const lon = map.LONGITUDE ? parseCoordinate(raw[map.LONGITUDE], "lon") : null;
  return {
    school: school.original,
    schoolKey: school.key,
    courseYear: map.COURSE_YEAR ? parseCourseYear(raw[map.COURSE_YEAR]) : null,
    complete: detectCompletion(raw, map.COMPLETION ?? "submitdate"),
    lat,
    lon,
  };
}

function emptyCounts(): Counts {
  return { total: 0, complete: 0, incomplete: 0, completePct: 0 };
}

function finishCounts(counts: Counts): Counts {
  return {
    ...counts,
    completePct: counts.total ? round2((counts.complete / counts.total) * 100) : 0,
  };
}

function add(counts: Counts, complete: boolean): void {
  counts.total += 1;
  counts.complete += complete ? 1 : 0;
  counts.incomplete += complete ? 0 : 1;
}

function createRole(): RoleCounts {
  const years = Object.fromEntries(
    Array.from({ length: 7 }, (_, index) => {
      const year = index + 1;
      return [String(year), { year, ...emptyCounts() }];
    }),
  );
  return { ...emptyCounts(), years };
}

export function buildDashboard(
  rawResponses: RawResponse[],
  surveyId: string,
  map: QuestionMap = QUESTION_MAP,
  generatedAt = new Date().toISOString(),
): DashboardPayload {
  const normalized = rawResponses.flatMap((raw) => {
    const item = normalizeResponse(raw, map);
    return item ? [item] : [];
  });
  const summary = emptyCounts();
  const schools = new Map<string, SchoolSummary>();

  for (const raw of rawResponses) add(summary, detectCompletion(raw, map.COMPLETION ?? "submitdate"));

  for (const item of normalized) {
    let school = schools.get(item.schoolKey);
    if (!school) {
      school = { school: item.school, ...emptyCounts(), roles: { student: createRole() } };
      schools.set(item.schoolKey, school);
    }
    add(school, item.complete);
    add(school.roles.student, item.complete);
    if (item.courseYear) add(school.roles.student.years[String(item.courseYear)], item.complete);
  }

  const schoolList = [...schools.values()]
    .map((school) => ({
      school: school.school,
      ...finishCounts(school),
      roles: {
        student: {
          ...finishCounts(school.roles.student),
          years: Object.fromEntries(
            Object.entries(school.roles.student.years).map(([year, counts]) => [
              year,
              { year: counts.year, ...finishCounts(counts) },
            ]),
          ),
        },
      },
    }))
    .sort((a, b) => b.total - a.total || a.school.localeCompare(b.school, "es"));

  return {
    generatedAt,
    surveyId,
    summary: finishCounts(summary),
    schools: schoolList,
    mapPoints: normalized.flatMap(({ school, schoolKey, lat, lon }) => {
      if (lat === null || lon === null) return [];
      const canonicalSchool = schools.get(schoolKey)?.school ?? school;
      return [{ school: canonicalSchool, lat, lon }];
    }),
  };
}

export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
