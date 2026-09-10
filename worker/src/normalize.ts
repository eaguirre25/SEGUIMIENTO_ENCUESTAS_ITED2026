import {
  canonicalSchoolLabel,
  EPS408_NAME,
  REVIEW_REQUIRED_NAME,
  parseSchoolNumber,
  resolveStudentSchool,
  schoolIdentityKey,
} from "../../shared/schools";
export { parseSchoolNumber } from "../../shared/schools";
import { QUESTION_MAP } from "./question-map";
import type {
  AgeGroup,
  Counts,
  DashboardPayload,
  DemographicSummary,
  LoadMonitoringRow,
  SurveyQuestionDefinition,
  ManagementType,
  NormalizedResponse,
  RawResponse,
  RoleCounts,
  SchoolSummary,
} from "./types";
import { calculateRequiredProgress } from "./required-progress";

type OptionalSchoolBranch = "PRIVATE_SCHOOL" | "STATE_SCHOOL" | "ROLE" | "ROLE_OTHER" | "IN_SAN_MARTIN" | "AGE" | "GENDER" | "EXTERNAL_SCHOOL";
export type QuestionMap = Omit<Record<keyof typeof QUESTION_MAP, string | readonly string[] | null>, OptionalSchoolBranch>
  & Partial<Record<OptionalSchoolBranch, string | readonly string[] | null>>;

export const LEGACY_EXCLUDED_TEST_RESPONSE_KEYS = new Set([
  "2026-08-12|09:18:21|ees26|00|state|3|complete",
  "2026-08-12|09:05:59|ees 1|1|state|1|complete",
  "2026-08-11|23:24:09|sin informar|s6|unknown|4|incomplete",
  "2026-08-11|22:09:20|sin informar|sin informar|unknown||incomplete",
]);

const SAN_MARTIN_BOUNDS = {
  minLat: -34.66,
  maxLat: -34.49,
  minLon: -58.66,
  maxLon: -58.43,
} as const;

export const AGE_GROUPS: readonly AgeGroup[] = [
  "Hasta 15", "16–18", "19–29", "30–39", "40–49", "50–59", "60 o más",
];

export function normalizeSchool(value: unknown, managementType: ManagementType = "unknown"): { original: string; key: string } | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const cleaned = String(value).trim().replace(/\s+/g, " ");
  const original = canonicalSchoolLabel(cleaned, managementType);
  if (!original) return null;
  return {
    original,
    key: original.normalize("NFKC").toLocaleLowerCase("es-AR"),
  };
}

function parseStateSchoolNumber(value: unknown): number | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  return parseSchoolNumber(canonicalSchoolLabel(String(value)));
}

export function detectCompletion(raw: RawResponse, field = "submitdate"): boolean {
  const value = raw[field];
  if (value === true || value === 1) return true;
  if (value === false || value === 0 || value == null) return false;
  if (typeof value !== "string") return Boolean(value);
  const normalized = value.trim().toLocaleLowerCase("es-AR");
  if (!normalized || ["n", "no", "false", "incomplete", "incompleta", "0", "null", "0000-00-00", "0000-00-00 00:00:00"].includes(normalized)) return false;
  return true;
}

export function parseCourseYear(value: unknown): number | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const match = String(value).match(/\b([1-7])\b/);
  return match ? Number(match[1]) : null;
}

export function parseYesNo(value: unknown): boolean | null {
  if (value === true || value === 1) return true;
  if (value === false || value === 0) return false;
  if (typeof value !== "string") return null;
  const normalized = value.trim().normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase("es-AR");
  if (["si", "s", "yes", "y", "1", "true"].includes(normalized)) return true;
  if (["no", "n", "0", "false"].includes(normalized)) return false;
  return null;
}

export function parseAgeGroup(value: unknown): AgeGroup | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const text = String(value).trim();
  if (!/^\d{1,3}(?:[.,]0+)?$/.test(text)) return null;
  const age = Number(text.replace(",", "."));
  if (!Number.isInteger(age) || age < 5 || age > 120) return null;
  if (age <= 15) return "Hasta 15";
  if (age <= 18) return "16–18";
  if (age <= 29) return "19–29";
  if (age <= 39) return "30–39";
  if (age <= 49) return "40–49";
  if (age <= 59) return "50–59";
  return "60 o más";
}

export function normalizeGender(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const label = String(value).trim().replace(/\s*\[[^\]]+\]\s*$/, "").replace(/\s+/g, " ");
  return label || null;
}

export function parseCoordinate(value: unknown, kind: "lat" | "lon"): number | null {
  if (typeof value !== "number" && typeof value !== "string") return null;
  const parsed = Number(String(value).trim().replace(",", "."));
  const limit = kind === "lat" ? 90 : 180;
  return Number.isFinite(parsed) && parsed >= -limit && parsed <= limit ? parsed : null;
}

export function isCoordinateInSanMartin(lat: number, lon: number): boolean {
  return lat >= SAN_MARTIN_BOUNDS.minLat && lat <= SAN_MARTIN_BOUNDS.maxLat
    && lon >= SAN_MARTIN_BOUNDS.minLon && lon <= SAN_MARTIN_BOUNDS.maxLon;
}

export function normalizeResponse(raw: RawResponse, map: QuestionMap): NormalizedResponse | null {
  if (!map.SCHOOL) throw new Error("Falta configurar QUESTION_MAP.SCHOOL en src/question-map.ts");
  const identity = identifySchool(raw, map);
  if (!identity) return null;
  const { school, schoolNumber, managementType, classificationMethod, reviewReason } = identity;
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
    ageGroup: map.AGE ? parseAgeGroup(readMappedValue(raw, map.AGE)) : null,
    gender: map.GENDER ? normalizeGender(readMappedValue(raw, map.GENDER)) : null,
    classificationMethod,
    ...(reviewReason ? { reviewReason } : {}),
  };
}

function identifySchool(raw: RawResponse, map: QuestionMap): {
  school: { original: string; key: string };
  schoolNumber: number | null;
  managementType: ManagementType;
  classificationMethod: NormalizedResponse["classificationMethod"];
  reviewReason?: NormalizedResponse["reviewReason"];
} | null {
  const inSanMartin = map.IN_SAN_MARTIN ? parseYesNo(readMappedValue(raw, map.IN_SAN_MARTIN)) : null;
  let managementType = normalizeManagementType(readSemanticValue(raw, map.MANAGEMENT_TYPE, isManagementAnswer));
  const schoolValueAsReceived = readSchoolBranch(raw, map);
  const genericSchoolValue = map.ROLE ? firstTeacherSchoolMention(schoolValueAsReceived) : schoolValueAsReceived;
  if (map.SCHOOL_IDENTIFIER && inSanMartin !== false) {
    const resolution = resolveStudentSchool(genericSchoolValue, readMappedValue(raw, map.SCHOOL_IDENTIFIER), managementType);
    const school = normalizeSchool(resolution.identity.school, resolution.identity.managementType);
    if (!school) return null;
    return {
      school,
      schoolNumber: resolution.identity.schoolNumber,
      managementType: resolution.identity.managementType,
      classificationMethod: resolution.method,
      ...(resolution.reviewReason ? { reviewReason: resolution.reviewReason } : {}),
    };
  }
  const stateSchoolValue = map.STATE_SCHOOL ? readMappedValue(raw, map.STATE_SCHOOL) : genericSchoolValue;
  const privateSchoolValue = map.PRIVATE_SCHOOL ? readMappedValue(raw, map.PRIVATE_SCHOOL) : genericSchoolValue;
  const isStateSchool = managementType === "state";
  let schoolNumber = isStateSchool ? parseStateSchoolNumber(stateSchoolValue) : null;
  let mappedSchoolValue = isStateSchool
    ? (schoolNumber === null ? stateSchoolValue : `EES ${schoolNumber}`)
    : managementType === "private" ? privateSchoolValue : genericSchoolValue;
  let school = inSanMartin === false ? normalizeExternalSchool(mappedSchoolValue) : normalizeSchool(mappedSchoolValue, managementType);
  if (managementType === "unknown" && inSanMartin !== false && school && (school.original.startsWith("EES ") || school.original.startsWith("ESCUELA DE EDUCACIÓN SECUNDARIA Nº"))) {
    managementType = "state";
    schoolNumber = parseSchoolNumber(school.original);
    mappedSchoolValue = schoolNumber === null ? mappedSchoolValue : `EES ${schoolNumber}`;
    school = normalizeSchool(mappedSchoolValue, managementType);
  }
  if (!school) return null;
  if (inSanMartin !== false && school.original === EPS408_NAME) {
    schoolNumber = null;
    managementType = "state";
  }
  return { school, schoolNumber, managementType, classificationMethod: "direct" };
}

function normalizeExternalSchool(value: unknown): { original: string; key: string } | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const original = String(value).trim().replace(/\s+/g, " ");
  if (!original) return null;
  return {
    original,
    key: `external:${original.normalize("NFKC").toLocaleLowerCase("es-AR")}`,
  };
}

function readSchoolBranch(raw: RawResponse, map: QuestionMap): unknown {
  if (map.EXTERNAL_SCHOOL && map.IN_SAN_MARTIN
    && parseYesNo(readMappedValue(raw, map.IN_SAN_MARTIN)) === false) {
    return readMappedValue(raw, map.EXTERNAL_SCHOOL);
  }
  return map.SCHOOL ? readMappedValue(raw, map.SCHOOL) : null;
}

function schoolAnswerAsReceived(raw: RawResponse, map: QuestionMap): string {
  const managementType = normalizeManagementType(map.MANAGEMENT_TYPE ? readMappedValue(raw, map.MANAGEMENT_TYPE) : null);
  const field = managementType === "state" && map.STATE_SCHOOL
    ? map.STATE_SCHOOL
    : managementType === "private" && map.PRIVATE_SCHOOL
      ? map.PRIVATE_SCHOOL
      : map.SCHOOL;
  const value = map.IN_SAN_MARTIN ? readSchoolBranch(raw, map) : field ? readMappedValue(raw, field) : null;
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

function emptyDemographics(): DemographicSummary {
  return {
    validAges: 0,
    ageGroups: Object.fromEntries(AGE_GROUPS.map((group) => [group, 0])) as Record<AgeGroup, number>,
    validGenders: 0,
    genders: [],
  };
}

function addDemographic(demographics: DemographicSummary, ageGroup: AgeGroup | null, gender: string | null): void {
  if (ageGroup) {
    demographics.validAges += 1;
    demographics.ageGroups[ageGroup] += 1;
  }
  if (gender) {
    demographics.validGenders += 1;
    const key = gender.normalize("NFKC").toLocaleLowerCase("es-AR");
    const existing = demographics.genders.find((item) => item.label.normalize("NFKC").toLocaleLowerCase("es-AR") === key);
    if (existing) existing.count += 1;
    else demographics.genders.push({ label: gender, count: 1 });
  }
}

function finishDemographics(demographics: DemographicSummary): DemographicSummary {
  return {
    ...demographics,
    ageGroups: { ...demographics.ageGroups },
    genders: [...demographics.genders].sort((left, right) => right.count - left.count || left.label.localeCompare(right.label, "es")),
  };
}

export function buildDashboard(
  rawResponses: RawResponse[],
  surveyId: string,
  map: QuestionMap = QUESTION_MAP,
  generatedAt = new Date().toISOString(),
  excludedResponseKeys: ReadonlySet<string> = LEGACY_EXCLUDED_TEST_RESPONSE_KEYS,
  requiredQuestions: readonly SurveyQuestionDefinition[] = [],
): DashboardPayload {
  const includedResponses = rawResponses.filter((raw) => !isExcludedTestResponse(raw, map, excludedResponseKeys));
  const classified = includedResponses.map((raw) => ({ raw, item: normalizeResponse(raw, map) }));
  applyTemporalSchoolInference(classified, map);
  const normalized = classified.flatMap(({ item }) => item ? [item] : []);
  const summary = emptyCounts();
  const demographics = emptyDemographics();
  const schools = new Map<string, SchoolSummary>();

  const completionField = firstField(map.COMPLETION) ?? "submitdate";
  for (const raw of includedResponses) {
    add(summary, detectCompletion(raw, completionField));
    addDemographic(
      demographics,
      map.AGE ? parseAgeGroup(readMappedValue(raw, map.AGE)) : null,
      map.GENDER ? normalizeGender(readMappedValue(raw, map.GENDER)) : null,
    );
  }

  for (const item of normalized) {
    let school = schools.get(item.schoolKey);
    if (!school) {
      school = {
        school: item.school,
        ...(item.schoolKey.startsWith("external:") ? { inSanMartin: false } : {}),
        schoolNumber: item.schoolNumber,
        managementType: item.managementType,
        ...emptyCounts(),
        roles: { student: createRole() },
        demographics: emptyDemographics(),
      };
      schools.set(item.schoolKey, school);
    }
    add(school, item.complete);
    add(school.roles.student, item.complete);
    if (item.courseYear) add(school.roles.student.years[String(item.courseYear)], item.complete);
    addDemographic(school.demographics, item.ageGroup, item.gender);
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
      demographics: finishDemographics(school.demographics),
    }))
    .sort((a, b) => b.total - a.total || a.school.localeCompare(b.school, "es"));

  return {
    generatedAt,
    surveyId,
    summary: finishCounts(summary),
    demographics: finishDemographics(demographics),
    schools: schoolList,
    mapPoints: classified.flatMap(({ raw, item }) => {
      const lat = map.LATITUDE ? parseCoordinate(readMappedValue(raw, map.LATITUDE), "lat") : null;
      const lon = map.LONGITUDE ? parseCoordinate(readMappedValue(raw, map.LONGITUDE), "lon") : null;
      if (lat === null || lon === null || !isCoordinateInSanMartin(lat, lon)) return [];
      return [{
        school: item?.school ?? REVIEW_REQUIRED_NAME,
        schoolNumber: item?.schoolNumber ?? null,
        managementType: item?.managementType ?? "unknown",
        complete: detectCompletion(raw, completionField),
        lat,
        lon,
      }];
    }),
    monitoringRows: classified
      .map(({ raw, item }) => toMonitoringRow(raw, map, item, requiredQuestions))
      .sort((left, right) => `${right.date} ${right.time}`.localeCompare(`${left.date} ${left.time}`)),
  };
}

export function isExcludedTestResponse(
  raw: RawResponse,
  map: QuestionMap = QUESTION_MAP,
  excludedResponseKeys: ReadonlySet<string> = LEGACY_EXCLUDED_TEST_RESPONSE_KEYS,
): boolean {
  const row = toMonitoringRow(raw, map);
  const declaredManagement = normalizeManagementType(readSemanticValue(raw, map.MANAGEMENT_TYPE, isManagementAnswer));
  return excludedResponseKeys.has(monitoringRowKey({
    ...row,
    managementType: declaredManagement,
  }));
}

export function firstTeacherSchoolMention(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const clean = value.trim().replace(/\s+/g, " ");
  if (!clean) return clean;
  return clean.split(/\s*(?:\r?\n|;|,|\s+\/\s+|\s+-\s+|\s+(?:y|e)\s+)\s*/i).find(Boolean) ?? clean;
}

function toMonitoringRow(
  raw: RawResponse,
  map: QuestionMap,
  normalized?: NormalizedResponse | null,
  requiredQuestions: readonly SurveyQuestionDefinition[] = [],
): LoadMonitoringRow {
  const timestamp = splitTimestamp(map.LOAD_TIMESTAMP ? readMappedValue(raw, map.LOAD_TIMESTAMP) : null);
  const identity = normalized ?? normalizeResponse(raw, map);
  const progress = requiredQuestions.length ? calculateRequiredProgress(raw, requiredQuestions) : null;
  return {
    date: timestamp.date,
    time: timestamp.time,
    school: schoolAnswerAsReceived(raw, map),
    schoolIdentifier: answerAsReceived(map.SCHOOL_IDENTIFIER ? readMappedValue(raw, map.SCHOOL_IDENTIFIER) : null),
    resolvedSchool: identity?.school ?? REVIEW_REQUIRED_NAME,
    classificationMethod: identity?.classificationMethod ?? "requires_review",
    ...(identity?.reviewReason ? { reviewReason: identity.reviewReason } : {}),
    role: teacherRoleAsReceived(raw, map),
    managementType: identity?.managementType ?? "unknown",
    courseYear: map.COURSE_YEAR ? parseCourseYear(readMappedValue(raw, map.COURSE_YEAR)) : null,
    inSanMartin: map.IN_SAN_MARTIN ? parseYesNo(readMappedValue(raw, map.IN_SAN_MARTIN)) : null,
    complete: detectCompletion(raw, firstField(map.COMPLETION) ?? "submitdate"),
    answeredRequiredQuestions: progress?.answeredRequiredQuestions ?? null,
    requiredQuestions: progress?.requiredQuestions ?? null,
    missingRequiredQuestions: progress?.missingRequiredQuestions ?? null,
    requiredCompletionPct: progress?.requiredCompletionPct ?? null,
  };
}

function applyTemporalSchoolInference(
  rows: Array<{ raw: RawResponse; item: NormalizedResponse | null }>,
  map: QuestionMap,
): void {
  if (!map.SCHOOL_IDENTIFIER) return;
  const timed = rows.map((row) => ({ ...row, timestamp: responseTimestamp(row.raw, map) }));
  const anchors = timed.filter((row) => row.item && row.item.classificationMethod !== "requires_review" && row.timestamp !== null);
  for (const row of timed) {
    if (!row.item || row.item.reviewReason !== "insufficient" || row.timestamp === null) continue;
    const nearby = anchors.filter((anchor) => anchor.timestamp !== null && sameSurveyDate(anchor.timestamp, row.timestamp!)
      && Math.abs(anchor.timestamp - row.timestamp!) <= 120 * 60_000);
    if (nearby.length < 2) continue;
    const counts = new Map<string, { item: NormalizedResponse; count: number }>();
    for (const anchor of nearby) {
      const key = schoolIdentityKey(anchor.item!);
      const current = counts.get(key) ?? { item: anchor.item!, count: 0 };
      current.count += 1;
      counts.set(key, current);
    }
    if (counts.has("state:24") && counts.has("state:47")) continue;
    const dominant = [...counts.values()].sort((left, right) => right.count - left.count)[0];
    if (!dominant || dominant.count / nearby.length < 0.8) continue;
    row.item.school = dominant.item.school;
    row.item.schoolKey = dominant.item.schoolKey;
    row.item.schoolNumber = dominant.item.schoolNumber;
    row.item.managementType = dominant.item.managementType;
    row.item.classificationMethod = "time_window";
    delete row.item.reviewReason;
  }
}

function responseTimestamp(raw: RawResponse, map: QuestionMap): number | null {
  const { date, time } = splitTimestamp(map.LOAD_TIMESTAMP ? readMappedValue(raw, map.LOAD_TIMESTAMP) : null);
  const match = `${date} ${time || "00:00:00"}`.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) return null;
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5]), Number(match[6] ?? 0));
}

function sameSurveyDate(left: number, right: number): boolean {
  return new Date(left).toISOString().slice(0, 10) === new Date(right).toISOString().slice(0, 10);
}

function teacherRoleAsReceived(raw: RawResponse, map: QuestionMap): string {
  const role = readSemanticValue(raw, map.ROLE, isTeacherRoleAnswer);
  if (role === null || role === undefined || String(role).trim() === "") return "Sin informar";
  const label = String(role).trim().replace(/\s*\[[^\]]+\]\s*$/, "");
  if (/^otro(?:\/a)?(?: vínculo)?$/i.test(label) && map.ROLE_OTHER) {
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
