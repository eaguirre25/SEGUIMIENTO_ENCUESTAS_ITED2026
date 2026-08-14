import { QUESTION_MAP } from "./question-map";
import type {
  Counts,
  DashboardPayload,
  ManagementType,
  NormalizedResponse,
  RawResponse,
  RoleCounts,
  SchoolSummary,
} from "./types";

type OptionalSchoolBranch = "PRIVATE_SCHOOL" | "STATE_SCHOOL";
export type QuestionMap = Omit<Record<keyof typeof QUESTION_MAP, string | readonly string[] | null>, OptionalSchoolBranch>
  & Partial<Record<OptionalSchoolBranch, string | readonly string[] | null>>;

export function normalizeSchool(value: unknown): { original: string; key: string } | null {
  if (typeof value !== "string") return null;
  const cleaned = value.trim().replace(/\s+/g, " ");
  const original = canonicalSchoolLabel(cleaned);
  if (!original) return null;
  return {
    original,
    key: original.normalize("NFKC").toLocaleLowerCase("es-AR"),
  };
}

function canonicalSchoolLabel(value: string): string {
  if (!value) return value;
  const folded = value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase("es-AR")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  const schoolNumber = parseSchoolNumber(folded);
  if (schoolNumber === null) return value;
  const number = String(schoolNumber);
  const onlyNumber = folded === String(Number(folded));
  const schoolMarker = new RegExp(`(?:^| )(?:ees|ee|es|n|numero|escuela|secundaria|media|md) *0*${number}(?: |$)`).test(folded);
  return onlyNumber || schoolMarker ? `EES ${number}` : value;
}

export function parseSchoolNumber(value: unknown): number | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const matches = String(value).match(/\d+/g);
  if (!matches || matches.length !== 1) return null;
  const parsed = Number(matches[0]);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 99 ? parsed : null;
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
  const identity = identifySchool(raw, map);
  if (!identity) return null;
  const { school, schoolNumber, managementType } = identity;
  const lat = map.LATITUDE ? parseCoordinate(readMappedValue(raw, map.LATITUDE), "lat") : null;
  const lon = map.LONGITUDE ? parseCoordinate(readMappedValue(raw, map.LONGITUDE), "lon") : null;
  return {
    school: school.original,
    schoolKey: school.key,
    schoolNumber,
    managementType,
    courseYear: map.COURSE_YEAR ? parseCourseYear(readMappedValue(raw, map.COURSE_YEAR)) : null,
    complete: detectCompletion(raw, firstField(map.COMPLETION) ?? "submitdate"),
    lat,
    lon,
  };
}

function identifySchool(raw: RawResponse, map: QuestionMap): {
  school: { original: string; key: string };
  schoolNumber: number | null;
  managementType: ManagementType;
} | null {
  const managementType = normalizeManagementType(map.MANAGEMENT_TYPE ? readMappedValue(raw, map.MANAGEMENT_TYPE) : null);
  const stateSchoolValue = map.STATE_SCHOOL ? readMappedValue(raw, map.STATE_SCHOOL) : null;
  const privateSchoolValue = map.PRIVATE_SCHOOL ? readMappedValue(raw, map.PRIVATE_SCHOOL) : null;
  const isStateSchool = managementType === "state";
  const schoolNumber = isStateSchool ? parseSchoolNumber(stateSchoolValue) : null;
  const mappedSchoolValue = isStateSchool
    ? (schoolNumber === null ? stateSchoolValue : `EES ${schoolNumber}`)
    : managementType === "private" ? privateSchoolValue : (map.SCHOOL ? readMappedValue(raw, map.SCHOOL) : null);
  const school = normalizeSchool(mappedSchoolValue);
  if (!school) return null;
  return { school, schoolNumber, managementType };
}

function normalizeManagementType(value: unknown): ManagementType {
  const normalized = String(value ?? "").trim().normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase("es-AR");
  if (normalized === "estatal") return "state";
  if (normalized === "privada") return "private";
  return "unknown";
}

function readMappedValue(raw: RawResponse, fields: string | readonly string[]): unknown {
  for (const field of typeof fields === "string" ? [fields] : fields) {
    const value = raw[field];
    if (value !== null && value !== undefined && String(value).trim() !== "") return value;
  }
  return null;
}

function firstField(fields: string | readonly string[] | null): string | null {
  if (!fields) return null;
  return typeof fields === "string" ? fields : fields[0] ?? null;
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

  const completionField = firstField(map.COMPLETION) ?? "submitdate";
  for (const raw of rawResponses) add(summary, detectCompletion(raw, completionField));

  for (const item of normalized) {
    let school = schools.get(item.schoolKey);
    if (!school) {
      school = {
        school: item.school,
        schoolNumber: item.schoolNumber,
        managementType: item.managementType,
        ...emptyCounts(),
        roles: { student: createRole() },
      };
      schools.set(item.schoolKey, school);
    }
    add(school, item.complete);
    add(school.roles.student, item.complete);
    if (item.courseYear) add(school.roles.student.years[String(item.courseYear)], item.complete);
  }

  const schoolList = [...schools.values()]
    .map((school) => ({
      school: school.school,
      schoolNumber: school.schoolNumber,
      managementType: school.managementType,
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
    mapPoints: [],
  };
}

export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
