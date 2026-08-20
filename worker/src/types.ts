export interface Env {
  LIMESURVEY_RPC_URL: string;
  LIMESURVEY_USERNAME: string;
  LIMESURVEY_PASSWORD: string;
  LIMESURVEY_STUDENT_SURVEY_ID: string;
  LIMESURVEY_TEACHER_SURVEY_ID: string;
  DASHBOARD_ALLOWED_ORIGIN: string;
  DASHBOARD_USERNAME: string;
  DASHBOARD_PASSWORD: string;
  DASHBOARD_DB: D1Database;
}

export type RawResponse = Record<string, unknown>;

export interface NormalizedResponse {
  school: string;
  schoolKey: string;
  schoolNumber: number | null;
  managementType: ManagementType;
  courseYear: number | null;
  complete: boolean;
  lat: number | null;
  lon: number | null;
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
  school: string;
  schoolNumber: number | null;
  managementType: ManagementType;
  roles: { student: RoleCounts };
}

export interface DashboardPayload {
  generatedAt: string;
  surveyId: string;
  summary: Counts;
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
  role: string;
  managementType: ManagementType;
  courseYear: number | null;
  complete: boolean;
}

export type ManagementType = "state" | "private" | "unknown";
