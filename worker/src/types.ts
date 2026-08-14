export interface Env {
  LIMESURVEY_RPC_URL: string;
  LIMESURVEY_USERNAME: string;
  LIMESURVEY_PASSWORD: string;
  LIMESURVEY_STUDENT_SURVEY_ID: string;
  DASHBOARD_ALLOWED_ORIGIN: string;
}

export type RawResponse = Record<string, unknown>;

export interface NormalizedResponse {
  school: string;
  schoolKey: string;
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
  roles: { student: RoleCounts };
}

export interface DashboardPayload {
  generatedAt: string;
  surveyId: string;
  summary: Counts;
  schools: SchoolSummary[];
  mapPoints: Array<{ school: string; lat: number; lon: number }>;
}
