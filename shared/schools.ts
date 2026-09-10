export type SchoolManagement = "state" | "private" | "unknown";

export const EES4_NAME = 'ESCUELA DE EDUCACIÓN SECUNDARIA Nº4 "DR. RICARDO ROJAS"';
export const EES6_NAME = 'ESCUELA DE EDUCACIÓN SECUNDARIA Nº6 "ALFONSINA STORNI"';
export const EES24_NAME = "ESCUELA DE EDUCACIÓN SECUNDARIA Nº24";
export const EES47_NAME = 'ESCUELA DE EDUCACIÓN SECUNDARIA Nº47 "OSVALDO BAYER"';
export const EPS408_NAME = "ESCUELA PROFESIONAL SECUNDARIA · CFP Nº408";
export const REVIEW_REQUIRED_NAME = "Requieren revisión";

export interface SchoolIdentity {
  school: string;
  schoolNumber: number | null;
  managementType: SchoolManagement;
  inSanMartin?: boolean | null;
}

export type SchoolClassificationMethod = "direct" | "id_and_name" | "name_only" | "id_only" | "time_window" | "requires_review";
export type SchoolReviewReason = "conflict" | "insufficient";

export interface StudentSchoolResolution {
  identity: SchoolIdentity;
  method: SchoolClassificationMethod;
  reviewReason?: SchoolReviewReason;
}

export function foldSchoolText(value: string): string {
  return value.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase("es-AR")
    .replace(/[^a-z0-9]+/g, " ").trim();
}

export function parseSchoolNumber(value: unknown): number | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const matches = String(value).match(/\d+/g);
  if (!matches || matches.length !== 1) return null;
  const number = Number(matches[0]);
  return number >= 1 && number <= 99 ? number : null;
}

export function officialStateSchoolName(number: number): string {
  if (number === 4) return EES4_NAME;
  if (number === 6) return EES6_NAME;
  if (number === 24) return EES24_NAME;
  if (number === 47) return EES47_NAME;
  return `ESCUELA DE EDUCACIÓN SECUNDARIA Nº${number}`;
}

export function canonicalSchoolLabel(value: string, managementType: SchoolManagement = "unknown"): string {
  const clean = value.trim().replace(/\s+/g, " ");
  const folded = foldSchoolText(clean);
  if (!clean) return clean;
  if (clean === REVIEW_REQUIRED_NAME) return clean;
  if (managementType === "private") return clean;
  if (/\b408\b/.test(folded) || /^eps(?:\d| |$)/.test(folded) || /^cfp(?:\d| |$)/.test(folded)
    || /\b(?:escuela )?(?:profesional secundaria|secundaria profesional)\b/.test(folded)) return EPS408_NAME;
  if (/\bosvaldo (?:bayer|valler|baller)\b/.test(folded)) return EES47_NAME;
  if ((/\b(?:ala )?(?:alfon[cs]ina|alfosina|alsonfina|alfons na)(?: storni| estonir)?\b/.test(folded)
    && !/\binstituto\b/.test(folded)) || folded === "e e s") return EES6_NAME;
  if (/\bricardo rojas\b/.test(folded)) return EES4_NAME;
  const number = parseSchoolNumber(clean);
  const compact = folded.replace(/\s+/g, "");
  const marked = /^(?:ees|ee|es|media|md|secundaria|escuela|escuelasecundaria|escueladeeducacionsecundaria)?(?:n|no|numero)?0*\d+(?:\D|$)/.test(compact);
  if (number === null || !marked) return clean;
  return officialStateSchoolName(number);
}

export function canonicalSchoolIdentity(school: string, schoolNumber: number | null,
  managementType: SchoolManagement, inSanMartin?: boolean | null): SchoolIdentity {
  if (inSanMartin === false) return { school, schoolNumber: null, managementType: "unknown" as const, inSanMartin: false };
  if (school === REVIEW_REQUIRED_NAME) return { school, schoolNumber: null, managementType: "unknown" };
  const explicitLabel = canonicalSchoolLabel(school, managementType);
  if (explicitLabel === EPS408_NAME) return { school: explicitLabel, schoolNumber: null, managementType: "state" };
  const source = managementType === "state" && schoolNumber !== null ? `EES ${schoolNumber}` : school;
  const label = canonicalSchoolLabel(source, managementType);
  const number = managementType === "private" ? null : parseSchoolNumber(label) ?? schoolNumber;
  return { school: number === null ? label : officialStateSchoolName(number), schoolNumber: number, managementType: number === null ? managementType : "state" };
}

export function resolveStudentSchool(schoolAnswer: unknown, schoolIdentifier: unknown, managementType: SchoolManagement = "unknown"): StudentSchoolResolution {
  const name = candidateFromName(schoolAnswer, managementType);
  const identifier = candidateFromIdentifier(schoolIdentifier, managementType);
  if (name && identifier) {
    if (schoolIdentityKey(name) === schoolIdentityKey(identifier)) return { identity: preferNamedIdentity(name, identifier), method: "id_and_name" };
    return reviewResolution("conflict");
  }
  if (name) return { identity: name, method: "name_only" };
  if (identifier) return { identity: identifier, method: "id_only" };
  return reviewResolution("insufficient");
}

function candidateFromName(value: unknown, managementType: SchoolManagement): SchoolIdentity | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const clean = String(value).trim().replace(/\s+/g, " ");
  if (!clean) return null;
  const label = canonicalSchoolLabel(clean, managementType);
  if (managementType === "private") return { school: label, schoolNumber: null, managementType };
  if (label === EPS408_NAME) return { school: label, schoolNumber: null, managementType: "state" };
  const number = parseSchoolNumber(label);
  if (number !== null || label === EES4_NAME || label === EES6_NAME) {
    const resolvedNumber = number ?? (label === EES4_NAME ? 4 : 6);
    return { school: officialStateSchoolName(resolvedNumber), schoolNumber: resolvedNumber, managementType: "state" };
  }
  return null;
}

function candidateFromIdentifier(value: unknown, managementType: SchoolManagement): SchoolIdentity | null {
  if (managementType === "private" || (typeof value !== "string" && typeof value !== "number")) return null;
  const clean = String(value).trim();
  if (!clean) return null;
  const folded = foldSchoolText(clean);
  if (/\b408\b/.test(folded) || /^eps(?:\d| |$)/.test(folded) || /^cfp(?:\d| |$)/.test(folded)) {
    return { school: EPS408_NAME, schoolNumber: null, managementType: "state" };
  }
  const number = parseSchoolNumber(clean);
  if (number === null) return null;
  const compact = folded.replace(/\s+/g, "");
  if (!/^(?:(?:id|s|es|ees|escuela|secundaria)(?:n|no|numero)?)?0*\d+$/.test(compact)) return null;
  return { school: officialStateSchoolName(number), schoolNumber: number, managementType: "state" };
}

function preferNamedIdentity(name: SchoolIdentity, identifier: SchoolIdentity): SchoolIdentity {
  return name.managementType === "private" ? name : identifier;
}

function reviewResolution(reviewReason: SchoolReviewReason): StudentSchoolResolution {
  return {
    identity: { school: REVIEW_REQUIRED_NAME, schoolNumber: null, managementType: "unknown" },
    method: "requires_review",
    reviewReason,
  };
}

export function schoolIdentityKey(school: SchoolIdentity): string {
  if (school.inSanMartin === false) return `external:${foldSchoolText(school.school)}`;
  if (school.school === REVIEW_REQUIRED_NAME) return "review-required";
  if (school.school === EPS408_NAME) return "state:eps-408";
  if (school.schoolNumber !== null) return `state:${school.schoolNumber}`;
  // Docentes y Familias no siempre exportan la gestión. Para instituciones
  // locales no numeradas, el nombre canónico permite unir "private" y
  // "unknown" sin mezclar escuelas declaradas fuera de General San Martín.
  return `institution:${foldSchoolText(school.school)}`;
}
