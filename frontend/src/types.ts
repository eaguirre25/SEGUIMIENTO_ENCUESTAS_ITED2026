export interface Counts {
  total: number;
  complete: number;
  incomplete: number;
  completePct: number;
}

export type ManagementType = "state" | "private" | "unknown";
export type AgeGroup = "Hasta 15" | "16–18" | "19–29" | "30–39" | "40–49" | "50–59" | "60 o más";
export interface DemographicSummary {
  validAges: number;
  ageGroups: Record<AgeGroup, number>;
  validGenders: number;
  genders: Array<{ label: string; count: number }>;
}

export interface YearCounts extends Counts { year: number }
export interface SchoolSummary extends Counts {
  school: string;
  schoolNumber: number | null;
  managementType: ManagementType;
  roles: { student: Counts & { years: Record<string, YearCounts> } };
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
  monitoringRows: Array<{
    date: string;
    time: string;
    school: string;
    schoolIdentifier: string;
    role: string;
    managementType: ManagementType;
    courseYear: number | null;
    inSanMartin: boolean | null;
    complete: boolean;
  }>;
}
