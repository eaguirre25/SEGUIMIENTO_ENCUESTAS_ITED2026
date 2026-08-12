export interface Counts {
  total: number;
  complete: number;
  incomplete: number;
  completePct: number;
}

export interface YearCounts extends Counts { year: number }
export interface SchoolSummary extends Counts {
  school: string;
  roles: { student: Counts & { years: Record<string, YearCounts> } };
}

export interface DashboardPayload {
  generatedAt: string;
  surveyId: string;
  summary: Counts;
  schools: SchoolSummary[];
  mapPoints: Array<{ school: string; lat: number; lon: number }>;
}

