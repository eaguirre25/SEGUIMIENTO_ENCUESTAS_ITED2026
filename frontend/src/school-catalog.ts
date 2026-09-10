import stateSchoolsData from "./data/state-schools.json";
import privateSchoolsData from "./data/private-schools.json";
import {
  canonicalSchoolIdentity,
  EPS408_NAME,
  REVIEW_REQUIRED_NAME,
  schoolIdentityKey,
} from "../../shared/schools";
import type { ManagementType, SchoolSummary } from "./types";

export interface SchoolLocation {
  id: string;
  schoolNumber: number | null;
  managementType: "state" | "private";
  name: string;
  cue: string;
  locality: string;
  address: string;
  coordinates: [number, number];
}

interface StateProperties {
  schoolNumber: number | null;
  schoolCode?: string;
  name: string;
  cue: string;
  locality: string;
  address: string;
}

export const STATE_SCHOOLS: SchoolLocation[] = stateSchoolsData.features.map((feature) => {
  const properties = feature.properties as StateProperties;
  return {
    id: properties.schoolCode ? `state:${properties.schoolCode}` : `state:${properties.schoolNumber}`,
    schoolNumber: properties.schoolNumber,
    managementType: "state",
    name: properties.name,
    cue: properties.cue,
    locality: properties.locality,
    address: properties.address,
    coordinates: [feature.geometry.coordinates[0], feature.geometry.coordinates[1]],
  };
});

export const PRIVATE_SCHOOLS: SchoolLocation[] = privateSchoolsData.features.map((feature) => ({
  id: feature.properties.schoolId,
  schoolNumber: null,
  managementType: "private",
  name: feature.properties.name,
  cue: feature.properties.cue,
  locality: feature.properties.locality,
  address: feature.properties.address,
  coordinates: [feature.geometry.coordinates[0], feature.geometry.coordinates[1]],
}));

export function officialSchoolName(school: Pick<SchoolSummary, "school" | "schoolNumber" | "managementType" | "inSanMartin">): string {
  if (school.inSanMartin === false || school.school === REVIEW_REQUIRED_NAME) return school.school;
  return schoolLocation(school)?.name
    ?? canonicalSchoolIdentity(school.school, school.schoolNumber, school.managementType, school.inSanMartin).school;
}

export function schoolLocation(school: { school: string; schoolNumber: number | null; managementType: ManagementType; inSanMartin?: boolean | null }): SchoolLocation | null {
  if (school.inSanMartin === false || school.school === REVIEW_REQUIRED_NAME) return null;
  const identity = canonicalSchoolIdentity(school.school, school.schoolNumber, school.managementType, school.inSanMartin);
  if (identity.school === EPS408_NAME) return STATE_SCHOOLS.find((candidate) => candidate.id === "state:eps-408") ?? null;
  if (identity.managementType === "state" && identity.schoolNumber !== null) {
    return STATE_SCHOOLS.find((candidate) => candidate.schoolNumber === identity.schoolNumber) ?? null;
  }
  if (identity.managementType === "private" || identity.managementType === "unknown") {
    const key = privateSchoolKey(identity.school);
    const matches = PRIVATE_SCHOOLS.filter((candidate) => privateSchoolKey(candidate.name) === key);
    if (matches.length === 1) return matches[0];
  }
  return null;
}

export function officialSchoolId(school: { school: string; schoolNumber: number | null; managementType: ManagementType; inSanMartin?: boolean | null }): string {
  return schoolLocation(school)?.id ?? schoolIdentityKey(canonicalSchoolIdentity(school.school, school.schoolNumber, school.managementType, school.inSanMartin));
}

export function privateSchoolKey(value: string): string {
  const ignored = new Set(["instituto", "colegio", "escuela", "privado", "privada", "secundaria", "educacion", "de", "del", "la", "el"]);
  return value.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase("es-AR").replace(/[^a-z0-9]+/g, " ").trim().split(/\s+/).filter((token) => token && !ignored.has(token)).join(" ");
}
