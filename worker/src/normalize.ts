import { QUESTION_MAP } from "./question-map";
import type {
  Counts,
  DashboardPayload,
  LoadMonitoringRow,
  ManagementType,
  NormalizedResponse,
  RawResponse,
  RoleCounts,
  SchoolSummary,
} from "./types";

type OptionalSchoolBranch = "PRIVATE_SCHOOL" | "STATE_SCHOOL" | "ROLE" | "ROLE_OTHER";
export type QuestionMap = Omit<Record<keyof typeof QUESTION_MAP, string | readonly string[] | null>, OptionalSchoolBranch>
  & Partial<Record<OptionalSchoolBranch, string | readonly string[] | null>>;

const EXCLUDED_TEST_RESPONSE_KEYS = new Set([
  "2026-08-12|09:18:21|ees26|00|state|3|complete",
  "2026-08-12|09:05:59|ees 1|1|state|1|complete",
  "2026-08-11|23:24:09|sin informar|s6|unknown|4|incomplete",
  "2026-08-11|22:09:20|sin informar|sin informar|unknown||incomplete",
]);

const STATE_SCHOOL_NUMBER_ALIASES: Readonly<Record<string, number>> = {
  "alfonsina storni": 6,
};

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
  const folded = foldSchoolText(value);
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

function parseStateSchoolNumber(value: unknown): number | null {
  const parsed = parseSchoolNumber(value);
  if (parsed !== null) return parsed;
  if (typeof value !== "string") return null;
  return STATE_SCHOOL_NUMBER_ALIASES[foldSchoolText(value)] ?? null;
}

function foldSchoolText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase("es-AR")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
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
  let managementType = normalizeManagementType(readSemanticValue(raw, map.MANAGEMENT_TYPE, isManagementAnswer));
  const genericSchoolValue = map.SCHOOL ? readMappedValue(raw, map.SCHOOL) : null;
  const stateSchoolValue = map.STATE_SCHOOL ? readMappedValue(raw, map.STATE_SCHOOL) : genericSchoolValue;
  const privateSchoolValue = map.PRIVATE_SCHOOL ? readMappedValue(raw, map.PRIVATE_SCHOOL) : genericSchoolValue;
  const isStateSchool = managementType === "state";
  let schoolNumber = isStateSchool ? parseStateSchoolNumber(stateSchoolValue) : null;
  let mappedSchoolValue = isStateSchool
    ? (schoolNumber === null ? stateSchoolValue : `EES ${schoolNumber}`)
    : managementType === "private" ? privateSchoolValue : genericSchoolValue;
  let school = normalizeSchool(mappedSchoolValue);
  if (managementType === "unknown" && school?.original.match(/^EES \d+$/)) {
    managementType = "state";
    schoolNumber = parseSchoolNumber(school.original);
    mappedSchoolValue = schoolNumber === null ? mappedSchoolValue : `EES ${schoolNumber}`;
    school = normalizeSchool(mappedSchoolValue);
  }
  if (!school) return null;
  return { school, schoolNumber, managementType };
}

function schoolAnswerAsReceived(raw: RawResponse, map: QuestionMap): string {
  const managementType = normalizeManagementType(map.MANAGEMENT_TYPE ? readMappedValue(raw, map.MANAGEMENT_TYPE) : null);
  const field = managementType === "state" && map.STATE_SCHOOL
    ? map.STATE_SCHOOL
    : managementType === "private" && map.PRIVATE_SCHOOL
      ? map.PRIVATE_SCHOOL
      : map.SCHOOL;
  const value = field ? readMappedValue(raw, field) : null;
  return value === null || value === undefined ? "Sin informar" : String(value);
}

function normalizeManagementType(value: unknown): ManagementType {
  const normalized = String(value ?? "").trim().normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase("es-AR");
  if (normalized === "estatal") return "state";
  if (normalized === "privada") return "private";
  return "unknown";
}

function readMappedValue(raw: RawResponse, fields: string | readonly string[]): unknown {
  for (const field of typeof fields === "string" ? [fields] : fields) {
    const exactValue = raw[field];
    if (exactValue !== null && exactValue !== undefined && String(exactValue).trim() !== "") return exactValue;
    const matchingEntry = Object.entries(raw).find(([key, value]) => (
      keyMatchesQuestionCode(key, field)
      && value !== null
      && value !== undefined
      && String(value).trim() !== ""
    ));
    const value = matchingEntry?.[1];
    if (value !== null && value !== undefined && String(value).trim() !== "") return value;
  }
  return null;
}

function keyMatchesQuestionCode(key: string, questionCode: string): boolean {
  if (!key.toLocaleUpperCase("es-AR").startsWith(questionCode.toLocaleUpperCase("es-AR"))) return false;
  const boundary = key.charAt(questionCode.length);
  return boundary === "" || /[\s.:[\]-]/.test(boundary);
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
  const includedResponses = rawResponses.filter((raw) => !isExcludedTestResponse(raw, map));
  const normalized = includedResponses.flatMap((raw) => {
    const item = normalizeResponse(raw, map);
    return item ? [item] : [];
  });
  const summary = emptyCounts();
  const schools = new Map<string, SchoolSummary>();

  const completionField = firstField(map.COMPLETION) ?? "submitdate";
  for (const raw of includedResponses) add(summary, detectCompletion(raw, completionField));

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
    mapPoints: includedResponses.flatMap((raw) => {
      const lat = map.LATITUDE ? parseCoordinate(readMappedValue(raw, map.LATITUDE), "lat") : null;
      const lon = map.LONGITUDE ? parseCoordinate(readMappedValue(raw, map.LONGITUDE), "lon") : null;
      if (lat === null || lon === null) return [];
      const identity = identifySchool(raw, map);
      return [{
        school: identity?.school.original ?? "Sin escuela identificada",
        schoolNumber: identity?.schoolNumber ?? null,
        managementType: identity?.managementType ?? "unknown",
        complete: detectCompletion(raw, completionField),
        lat,
        lon,
      }];
    }),
    monitoringRows: includedResponses
      .map((raw) => toMonitoringRow(raw, map))
      .sort((left, right) => `${right.date} ${right.time}`.localeCompare(`${left.date} ${left.time}`)),
  };
}

export function isExcludedTestResponse(raw: RawResponse, map: QuestionMap = QUESTION_MAP): boolean {
  return EXCLUDED_TEST_RESPONSE_KEYS.has(monitoringRowKey(toMonitoringRow(raw, map)));
}

function toMonitoringRow(raw: RawResponse, map: QuestionMap): LoadMonitoringRow {
  const timestamp = splitTimestamp(map.LOAD_TIMESTAMP ? readMappedValue(raw, map.LOAD_TIMESTAMP) : null);
  const identity = identifySchool(raw, map);
  return {
    date: timestamp.date,
    time: timestamp.time,
    school: schoolAnswerAsReceived(raw, map),
    schoolIdentifier: answerAsReceived(map.SCHOOL_IDENTIFIER ? readMappedValue(raw, map.SCHOOL_IDENTIFIER) : null),
    role: teacherRoleAsReceived(raw, map),
    managementType: identity?.managementType ?? "unknown",
    courseYear: map.COURSE_YEAR ? parseCourseYear(readMappedValue(raw, map.COURSE_YEAR)) : null,
    complete: detectCompletion(raw, firstField(map.COMPLETION) ?? "submitdate"),
  };
}

function teacherRoleAsReceived(raw: RawResponse, map: QuestionMap): string {
  const role = readSemanticValue(raw, map.ROLE, isTeacherRoleAnswer);
  if (role === null || role === undefined || String(role).trim() === "") return "Sin informar";
  const label = String(role).trim().replace(/\s*\[[^\]]+\]\s*$/, "");
  if (/^otro(?:\/a)?$/i.test(label) && map.ROLE_OTHER) {
    const otherRole = readMappedValue(raw, map.ROLE_OTHER);
    if (otherRole !== null) return `Otro: ${String(otherRole).trim()}`;
  }
  return label;
}

function readSemanticValue(
  raw: RawResponse,
  fields: string | readonly string[] | null | undefined,
  matches: (value: unknown) => boolean,
): unknown {
  if (!fields) return null;
  const mapped = fields ? readMappedValue(raw, fields) : null;
  if (mapped !== null) return mapped;
  return Object.values(raw).find(matches) ?? null;
}

function isManagementAnswer(value: unknown): boolean {
  return normalizeManagementType(value) !== "unknown";
}

function isTeacherRoleAnswer(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const normalized = value.trim().normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase("es-AR");
  return /\b(docente|directiv|director|conduccion|preceptor|orientador|bibliotecari|coordinador)\b/.test(normalized);
}

function monitoringRowKey(row: LoadMonitoringRow): string {
  return [
    row.date,
    row.time,
    normalizeExclusionText(row.school),
    normalizeExclusionText(row.schoolIdentifier),
    row.managementType,
    row.courseYear ?? "",
    row.complete ? "complete" : "incomplete",
  ].join("|");
}

function normalizeExclusionText(value: string): string {
  return value.trim().replace(/\s+/g, " ").normalize("NFKC").toLocaleLowerCase("es-AR");
}

function answerAsReceived(value: unknown): string {
  return value === null || value === undefined ? "Sin informar" : String(value);
}

export function splitTimestamp(value: unknown): { date: string; time: string } {
  if (typeof value !== "string" && typeof value !== "number") return { date: "", time: "" };
  const text = String(value).trim();
  if (!text) return { date: "", time: "" };
  const match = text.match(/^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2}(?::\d{2})?))?/);
  return match ? { date: match[1], time: match[2] ?? "" } : { date: text, time: "" };
}

export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
