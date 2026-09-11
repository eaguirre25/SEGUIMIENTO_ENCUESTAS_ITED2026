export interface Env {
  LIMESURVEY_RPC_URL: string;
  LIMESURVEY_USERNAME: string;
  LIMESURVEY_PASSWORD: string;
  LIMESURVEY_STUDENT_SURVEY_ID: string;
  LIMESURVEY_TEACHER_SURVEY_ID: string;
  LIMESURVEY_FAMILY_SURVEY_ID: string;
  DASHBOARD_ALLOWED_ORIGIN: string;
  DASHBOARD_SELF_URL: string;
  DASHBOARD_USERNAME: string;
  DASHBOARD_PASSWORD: string;
  DASHBOARD_DB: D1Database;
}

export type RawResponse = Record<string, unknown>;

export interface SurveyQuestionDefinition {
  qid: string;
  gid: string;
  sid: string;
  parentQid: string | null;
  code: string;
  type: string;
  mandatory: "Y" | "S" | "N";
  relevance: string;
}

export interface NormalizedResponse {
  school: string;
  schoolKey: string;
  schoolNumber: number | null;
  managementType: ManagementType;
  courseYear: number | null;
  complete: boolean;
  lat: number | null;
  lon: number | null;
  ageGroup: AgeGroup | null;
  gender: string | null;
  classificationMethod: SchoolClassificationMethod;
  reviewReason?: SchoolReviewReason;
}

export interface Counts {
  total: number;
  complete: number;
  incomplete: number;
  completePct: number;
}

export interface YearCounts extends Counts {
  year: number;
}

export interface RoleCounts extends Counts {
  years: Record<string, YearCounts>;
}

export interface SchoolSummary extends Counts {
  inSanMartin?: boolean | null;
  school: string;
  schoolNumber: number | null;
  managementType: ManagementType;
  roles: { student: RoleCounts };
  demographics: DemographicSummary;
}

export interface DashboardPayload {
  generatedAt: string;
  surveyId: string;
  summary: Counts;
  demographics: DemographicSummary;
  schools: SchoolSummary[];
  mapPoints: Array<{
    school: string;
    schoolNumber: number | null;
    managementType: ManagementType;
    complete: boolean;
    lat: number;
    lon: number;
  }>;
  monitoringRows: LoadMonitoringRow[];
}

export interface LoadMonitoringRow {
  date: string;
  time: string;
  school: string;
  schoolIdentifier: string;
  resolvedSchool: string;
  classificationMethod: SchoolClassificationMethod;
  reviewReason?: SchoolReviewReason;
  role: string;
  managementType: ManagementType;
  courseYear: number | null;
  inSanMartin: boolean | null;
  complete: boolean;
  answeredRequiredQuestions: number | null;
  requiredQuestions: number | null;
  missingRequiredQuestions: number | null;
  requiredCompletionPct: number | null;
}

export type ManagementType = "state" | "private" | "unknown";
export type SchoolClassificationMethod = "direct" | "id_and_name" | "name_only" | "id_only" | "time_window" | "requires_review";
export type SchoolReviewReason = "conflict" | "insufficient";

export type AgeGroup = "Hasta 15" | "16–18" | "19–29" | "30–39" | "40–49" | "50–59" | "60 o más";

export interface DemographicSummary {
  validAges: number;
  ageGroups: Record<AgeGroup, number>;
  validGenders: number;
  genders: Array<{ label: string; count: number }>;
}
