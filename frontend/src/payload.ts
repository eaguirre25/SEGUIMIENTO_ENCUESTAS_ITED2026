import type { DashboardPayload, SchoolSummary, ManagementType } from "./types";
import { canonicalSchoolIdentity, schoolIdentityKey, foldSchoolText as foldSchoolLabel } from "../../shared/schools";
export function canonicalizePayload(payload: DashboardPayload): DashboardPayload {
  const schools = new Map<string, SchoolSummary>();
  for (const source of payload.schools) {
    const identity = canonicalSchoolIdentity(source.school, source.schoolNumber, source.managementType, source.inSanMartin);
    const key = schoolIdentityKey(identity);
    const current = schools.get(key) ?? emptySchoolSummary(identity.school, identity.schoolNumber, identity.managementType);
    if (source.inSanMartin === false) current.inSanMartin = false;
    mergeSchoolSummary(current, source);
    schools.set(key, current);
  }
  return {
    ...payload,
    schools: [...schools.values()]
      .map(finishSchoolSummary)
      .sort((left, right) => right.total - left.total || left.school.localeCompare(right.school, "es")),
    mapPoints: payload.mapPoints.map((point) => ({
      ...point,
      ...canonicalSchoolIdentity(point.school, point.schoolNumber, point.managementType),
    })),
    monitoringRows: payload.monitoringRows.map((row) => {
      const identity = canonicalSchoolIdentity(row.resolvedSchool ?? row.school, null, row.managementType, row.inSanMartin);
      return {
        ...row,
        resolvedSchool: identity.school,
        classificationMethod: row.classificationMethod ?? "direct",
        managementType: identity.managementType,
      };
    }),
  };
}

function emptySchoolSummary(school: string, schoolNumber: number | null, managementType: ManagementType): SchoolSummary {
  const years = Object.fromEntries(Array.from({ length: 7 }, (_, index) => [String(index + 1), { year: index + 1, total: 0, complete: 0, incomplete: 0, completePct: 0 }]));
  return { school, schoolNumber, managementType, total: 0, complete: 0, incomplete: 0, completePct: 0, roles: { student: { total: 0, complete: 0, incomplete: 0, completePct: 0, years } }, demographics: emptyDemographics() };
}

function mergeSchoolSummary(target: SchoolSummary, source: SchoolSummary): void {
  target.total += source.total;
  target.complete += source.complete;
  target.incomplete += source.incomplete;
  target.roles.student.total += source.roles.student.total;
  target.roles.student.complete += source.roles.student.complete;
  target.roles.student.incomplete += source.roles.student.incomplete;
  for (let year = 1; year <= 7; year += 1) {
    const sourceYear = source.roles.student.years[String(year)];
    const targetYear = target.roles.student.years[String(year)];
    if (!sourceYear || !targetYear) continue;
    targetYear.total += sourceYear.total;
    targetYear.complete += sourceYear.complete;
    targetYear.incomplete += sourceYear.incomplete;
  }
  target.demographics.validAges += source.demographics.validAges;
  target.demographics.validGenders += source.demographics.validGenders;
  for (const group of Object.keys(target.demographics.ageGroups) as Array<keyof typeof target.demographics.ageGroups>) {
    target.demographics.ageGroups[group] += source.demographics.ageGroups[group] ?? 0;
  }
  for (const item of source.demographics.genders) {
    const existing = target.demographics.genders.find((candidate) => foldSchoolLabel(candidate.label) === foldSchoolLabel(item.label));
    if (existing) existing.count += item.count;
    else target.demographics.genders.push({ ...item });
  }
}

function finishSchoolSummary(school: SchoolSummary): SchoolSummary {
  const percentage = (complete: number, total: number) => total ? Math.round(complete / total * 10_000) / 100 : 0;
  school.completePct = percentage(school.complete, school.total);
  school.roles.student.completePct = percentage(school.roles.student.complete, school.roles.student.total);
  for (const year of Object.values(school.roles.student.years)) year.completePct = percentage(year.complete, year.total);
  school.demographics.genders.sort((left, right) => right.count - left.count || left.label.localeCompare(right.label, "es"));
  return school;
}

function emptyDemographics(): DashboardPayload["demographics"] {
  return {
    validAges: 0,
    ageGroups: { "Hasta 15": 0, "16–18": 0, "19–29": 0, "30–39": 0, "40–49": 0, "50–59": 0, "60 o más": 0 },
    validGenders: 0,
    genders: [],
  };
}
