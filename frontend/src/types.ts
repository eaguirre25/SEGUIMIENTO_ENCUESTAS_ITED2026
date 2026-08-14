export interface Counts {
  total: number;
  complete: number;
  incomplete: number;
  completePct: number;
}

export type ManagementType = "state" | "private" | "unknown";

export interface YearCounts extends Counts { year: number }
export interface SchoolSummary extends Counts {
  school: string;
  schoolNumber: number | null;
  managementType: ManagementType;
  roles: { student: Counts & { years: Record<string, YearCounts> } };
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
  monitoringRows: Array<{
    date: string;
    time: string;
    school: string;
    managementType: ManagementType;
    courseYear: number | null;
    complete: boolean;
  }>;
}
