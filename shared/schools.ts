export type SchoolManagement = "state" | "private" | "unknown";

export const EES4_NAME = 'ESCUELA DE EDUCACIÓN SECUNDARIA Nº4 "DR. RICARDO ROJAS"';
export const EES6_NAME = 'ESCUELA DE EDUCACIÓN SECUNDARIA Nº6 "ALFONSINA STORNI"';
export const EES24_NAME = "ESCUELA DE EDUCACIÓN SECUNDARIA Nº24";
export const EES47_NAME = 'ESCUELA DE EDUCACIÓN SECUNDARIA Nº47 "OSVALDO BAYER"';
export const EEST5_NAME = 'ESCUELA DE EDUCACIÓN SECUNDARIA TÉCNICA Nº5 "GALILEO GALILEI"';
export const EEST2_NAME = 'ESCUELA DE EDUCACIÓN SECUNDARIA TÉCNICA Nº2 "ALEMANIA"';
export const EEST3_NAME = "ESCUELA DE EDUCACIÓN SECUNDARIA TÉCNICA Nº3";
export const EEST4_NAME = "ESCUELA DE EDUCACIÓN SECUNDARIA TÉCNICA Nº4";
export const EPS408_NAME = "ESCUELA PROFESIONAL SECUNDARIA · CFP Nº408";
export const REVIEW_REQUIRED_NAME = "Requieren revisión";

export interface SchoolIdentity {
  school: string;
  schoolNumber: number | null;
  managementType: SchoolManagement;
  inSanMartin?: boolean | null;
}

export type SchoolClassificationMethod = "direct" | "id_and_name" | "name_only" | "id_only" | "time_window" | "requires_review" | "reviewed";
export type SchoolReviewReason = "conflict" | "insufficient";

export interface StudentSchoolResolution {
  identity: SchoolIdentity;
  method: SchoolClassificationMethod;
  reviewReason?: SchoolReviewReason;
}

export function foldSchoolText(value: string): string {
  return value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, " ").trim();
}

export function parseSchoolNumber(value: unknown): number | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const text = String(value);
  let matches = text.match(/\d+/g);
  if (matches && matches.length > 1 && !/\banexo\b|\//i.test(text)) {
    const stripped = text.replace(/\b[1-7]\s*(?:ro|do|to|mo|er|º|°)?\s*(?:a[ñn]o|curso|div(?:isi[oó]n)?)\b.*$/i, "");
    matches = stripped.match(/\d+/g);
  }
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

// Las técnicas tienen una numeración propia, independiente de las EES.
export function technicalSchoolNumber(value: string): number | null {
  const folded = foldSchoolText(value);
  if (/\b(?:galileo|galilei)\b/.test(folded)) return 5;
  if (/\balemania\b/.test(folded)) return 2;
  if (/\b(?:prefectura naval|carlos maria moyano)\b/.test(folded)) return 3;
  const compact = folded.replace(/\s+/g, "");
  const hasPrefix = /^(?:id)?(?:la|el)?(?:eest|eet|esst|est|et|enet|t|tec|tecnica|tecnico|tecnia|tencica|tecnca|ind|industrial|esctec(?:nica|nico)?|escuelatec(?:nica|nico)?|sectec(?:nica|nico)?|secundariatec(?:nica|nico)?|colegiotec(?:nica|nico)?|escuelasecundariatec(?:nica|nico)?|escueladeeducacion(?:secundaria)?tec(?:nica|nico)?)(?:n|no|nro|num|numero)?0*\d+/.test(compact);
  const hasWord = /\b(?:eest|eet|esst|enet|tecnica|tecnico|tecnia|tencica|tecnca|industrial)\b/.test(folded)
    || /\b(?:et|est|tec|ind)\s*(?:n|no|nro|num|numero)?\s*0*\d+\b/.test(folded)
    || /\b0*\d+\s*(?:et|est|tec|tecnica|tecnico)\b/.test(folded);
  if (!hasPrefix && !hasWord) return null;
  return parseSchoolNumber(value);
}

function technicalSchoolName(number: number): string {
  if (number === 2) return EEST2_NAME;
  if (number === 3) return EEST3_NAME;
  if (number === 4) return EEST4_NAME;
  return number === 5 ? EEST5_NAME : `ESCUELA DE EDUCACIÓN SECUNDARIA TÉCNICA Nº${number}`;
}

function technicalIdentity(number: number): SchoolIdentity {
  return { school: technicalSchoolName(number), schoolNumber: number, managementType: "state" };
}

const PRIVATE_SCHOOL_STOPWORDS = new Set([
  "instituto", "colegio", "escuela", "privado", "privada", "secundaria", "secundario", "educacion", "de", "del", "la", "el", "los", "las",
]);

export function canonicalPrivateSchoolKey(value: string): string {
  const folded = foldSchoolText(value)
    .replace(/\bntra\b/g, "nuestra")
    .replace(/\bsra\b/g, "senora")
    .replace(/\bcristiana\s+fe\b/g, "cristiana f e")
    .replace(/\bpio\s+10\b/g, "pio x");
  if (/\bbuen pastor\b/.test(folded)) return "evangelico buen pastor";
  if (/\bcristiana f e\b|\bhogar escuela cristiana\b/.test(folded)) return "hogar cristiana f e";
  if (/\bremedios de escalada\b/.test(folded)) return "remedios escalada san martin";
  if (/\bbuen viaje\b/.test(folded)) return "nuestra senora lujan buen viaje";
  if (/\b(?:instituto|colegio|incorporado)\s+(?:incorporado\s+)?san andres\b/.test(folded)) return "incorporado san andres";
  if (/\b(?:san\s+)?pio\s+x\b/.test(folded)) return "san pio x";
  if (/\bemilio lamarca\b|\blamarca\b/.test(folded)) return "emilio lamarca";
  if (/\bsan antonio de padua\b|\bantonio de padua\b/.test(folded)) return "san antonio padua";
  if (/\bsan martin de porres\b|\bmartin de porres\b/.test(folded)) return "san martin porres";
  if (/\bsan joaquin\b/.test(folded)) return "san joaquin";
  if (/\bsagrado corazon\b/.test(folded)) return "sagrado corazon";
  if (/\bsanta ana\b/.test(folded)) return "santa ana";
  if (/\bagustiniano\b/.test(folded)) return "agustiniano";
  if (/\bmariano moreno\b/.test(folded)) return "mariano moreno";
  if (/\beymard\b/.test(folded)) return "eymard";
  if (/\bnuestra senora del rosario\b/.test(folded)) return "nuestra senora rosario";
  if (/\bnuestra senora de la merced\b/.test(folded)) return "nuestra senora merced";
  if (/\bnuestra senora del libano\b/.test(folded)) return "nuestra senora libano";
  if (/\bnuestra senora de lujan\b/.test(folded)) return "nuestra senora lujan";
  if (/\bconcordia\b/.test(folded)) return "concordia";
  if (/\balmafuerte\b/.test(folded)) return "almafuerte";
  if (/\bla salle\b|\blasalle\b/.test(folded)) return "salle";
  if (/\bsan jose\b/.test(folded)) return "san jose";
  if (/\bjose manuel estrada\b/.test(folded)) return "jose manuel estrada";
  if (/\bmaria inmaculada\b/.test(folded)) return "maria inmaculada";
  if (/\bsagrada familia\b/.test(folded)) return "sagrada familia";
  if (/\bcasa del sol\b/.test(folded)) return "casa sol";
  if (/\btierra de crecimiento\b/.test(folded)) return "tierra crecimiento";
  if (/\bruben dario\b/.test(folded)) return "ruben dario";
  if (/\b(?:instituto|colegio|privado|privada|dr|doctor)\s+(?:privado\s+)?(?:dr\s+|doctor\s+)?manuel belgrano\b/.test(folded)) return "dr manuel belgrano";
  const tokens = folded.split(/\s+/).filter((token) => token && !PRIVATE_SCHOOL_STOPWORDS.has(token));
  return tokens.length ? tokens.join(" ") : folded;
}

const KNOWN_PRIVATE_SCHOOL_KEYS = new Set([
  "evangelico buen pastor", "hogar cristiana f e", "remedios escalada san martin", "nuestra senora lujan buen viaje",
  "incorporado san andres", "san pio x", "emilio lamarca", "san antonio padua", "san martin porres", "san joaquin",
  "sagrado corazon", "santa ana", "agustiniano", "mariano moreno", "eymard", "nuestra senora rosario",
  "nuestra senora merced", "nuestra senora libano", "nuestra senora lujan", "concordia", "almafuerte", "salle",
  "san jose", "jose manuel estrada", "maria inmaculada", "sagrada familia", "casa sol", "tierra crecimiento",
  "ruben dario", "dr manuel belgrano", "holters", "jose hernandez", "ballester", "maipu", "libertad",
]);

function isKnownPrivateSchool(value: string): boolean {
  const folded = foldSchoolText(value);
  if (!folded) return false;
  if (/\b(?:instituto|colegio)\s+alfonsina\b/.test(folded)) return true;
  if (/\b(?:instituto|colegio)\s+(?:ballester|maipu|libertad|holters|jose hernandez)\b/.test(folded)) return true;
  if (/\bescuela\s+holters\b|\bholters\b/.test(folded)) return true;
  const key = canonicalPrivateSchoolKey(value);
  if (["ballester", "maipu", "libertad"].includes(key)) {
    return /\b(?:instituto|colegio)\b/.test(folded);
  }
  return KNOWN_PRIVATE_SCHOOL_KEYS.has(key);
}

function namedStateSchoolNumber(folded: string, managementType: SchoolManagement): number | null {
  if (/\bosvaldo (?:bayer|valler|baller)\b/.test(folded)) return 47;
  if ((/\b(?:ala )?(?:alfon[cs]ina|alfosina|alsonfina|alfons na)(?: storni| estonir)?\b/.test(folded)
    && !/\binstituto\b/.test(folded)) || folded === "e e s") return 6;
  if (/\bricardo rojas\b/.test(folded)) return 4;
  if (/\bperito (?:francisco )?moreno\b/.test(folded)) return 1;
  if (/\barmada argentina\b/.test(folded)) return 2;
  if (/\b(?:leopoldo )?lugones\b/.test(folded)) return 3;
  if (/\b(?:bernardo (?:de )?)?monteagudo\b/.test(folded)) return 5;
  if (/\b(?:esteban )?echeverr?ia\b/.test(folded)) return 8;
  if (/\b(?:eduardo )?wilde\b/.test(folded)) return 12;
  if (/\b(?:general )?manuel belgrano\b/.test(folded) && managementType !== "private" && !/\b(?:instituto|privad[oa])\b/.test(folded)) return 13;
  if (/\btupac amaru\b/.test(folded)) return 21;
  if (/\b(?:rosario )?(?:vera )?pe(?:n|ni)aloza\b/.test(folded)) return 22;
  if (/\b(?:luis (?:alberto )?)?spinet+a\b/.test(folded)) return 26;
  if (/\bvictoria ocampo\b/.test(folded)) return 48;
  if (/\b(?:dr |doctor )?(?:rene )?favaloro\b/.test(folded)) return 52;
  return null;
}

function isNumberedSecondarySchoolText(folded: string): boolean {
  const compact = folded.replace(/\s+/g, "");
  if (/^(?:id)?(?:la|el)?(?:ees|eesn|eem|esb|sb|ee|es|esn|s|media|med|md|sec|secu|secundaria|secundario|secundara|secudaria|secundria|secunadria|segundaria|esc|escuela|escueal|ecuela|escula|escuel|esceula|col|colegio|de|del|educacion|ed|general|gral|basica)*(?:n|no|nro|num|numero)?0*\d+(?:\D|$)/.test(compact)) {
    return true;
  }
  return /\b(?:ees|eesn|eem|esb|sb|ee|es|esn|media|med|md|sec|secu|secundaria|secundario|secundara|secudaria|secundria|secunadria|segundaria|esc|escuela|escueal|ecuela|escula|escuel|esceula)\b/.test(folded);
}

export function canonicalSchoolLabel(value: string, managementType: SchoolManagement = "unknown"): string {
  const clean = value.trim().replace(/\s+/g, " ");
  const folded = foldSchoolText(clean);
  if (!clean) return clean;
  if (clean === REVIEW_REQUIRED_NAME) return clean;
  if (managementType === "private") return clean;
  const technicalNumber = technicalSchoolNumber(clean);
  if (technicalNumber !== null) return technicalSchoolName(technicalNumber);
  if (/\b408\b/.test(folded) || /^eps(?:\d| |$)/.test(folded) || /^cfp(?:\d| |$)/.test(folded)
    || /\b(?:escuela )?(?:profesional secundaria|secundaria profesional)\b/.test(folded)) return EPS408_NAME;
  const namedNumber = namedStateSchoolNumber(folded, managementType);
  if (namedNumber !== null) {
    const explicitNumber = parseSchoolNumber(clean);
    if (explicitNumber === null || explicitNumber === namedNumber) return officialStateSchoolName(namedNumber);
  }
  const number = parseSchoolNumber(clean);
  if (number === null || !isNumberedSecondarySchoolText(folded)) return clean;
  return officialStateSchoolName(number);
}

export function canonicalSchoolIdentity(school: string, schoolNumber: number | null,
  managementType: SchoolManagement, inSanMartin?: boolean | null): SchoolIdentity {
  if (inSanMartin === false) return { school, schoolNumber: null, managementType: "unknown" as const, inSanMartin: false };
  if (school === REVIEW_REQUIRED_NAME) return { school, schoolNumber: null, managementType: "unknown" };
  const explicitLabel = canonicalSchoolLabel(school, managementType);
  const technicalNumber = managementType === "private" ? null : technicalSchoolNumber(explicitLabel);
  if (technicalNumber !== null) return technicalIdentity(technicalNumber);
  if (explicitLabel === EPS408_NAME) return { school: explicitLabel, schoolNumber: null, managementType: "state" };
  const source = managementType === "state" && schoolNumber !== null ? `EES ${schoolNumber}` : school;
  const label = canonicalSchoolLabel(source, managementType);
  const namedNumber = managementType === "private" ? null : namedStateSchoolNumber(foldSchoolText(label), managementType);
  const number = managementType === "private" ? null : parseSchoolNumber(label) ?? namedNumber ?? schoolNumber;
  if (number === null && managementType === "unknown" && isKnownPrivateSchool(label)) {
    return { school: label, schoolNumber: null, managementType: "private" };
  }
  return { school: number === null ? label : officialStateSchoolName(number), schoolNumber: number, managementType: number === null ? managementType : "state" };
}

export function resolveStudentSchool(schoolAnswer: unknown, schoolIdentifier: unknown, managementType: SchoolManagement = "unknown"): StudentSchoolResolution {
  const name = candidateFromName(schoolAnswer, managementType);
  const effectiveManagement = name?.managementType === "private" ? "private" : managementType;
  const identifier = candidateFromIdentifier(schoolIdentifier, effectiveManagement);
  if (name && identifier) {
    if (schoolIdentityKey(name) === schoolIdentityKey(identifier)) return { identity: preferNamedIdentity(name, identifier), method: "id_and_name" };
    // Un número o denominación secundaria sin modalidad técnica es compatible con una referencia técnica del mismo número.
    const technical = technicalSchoolNumber(name.school) !== null ? name
      : technicalSchoolNumber(identifier.school) !== null ? identifier : null;
    const other = technical === name ? identifier : name;
    const untypedValue = technical === name ? schoolIdentifier : schoolAnswer;
    const isExplicitEes5Vs500 = String(schoolIdentifier).trim() === "500" && /\bees\b/i.test(String(schoolAnswer));
    if (
      technical
      && !isExplicitEes5Vs500
      && (other.schoolNumber === technical.schoolNumber || new RegExp(`^0*${technical.schoolNumber}$`).test(String(untypedValue).trim()))
    ) {
      return { identity: technical, method: "id_and_name" };
    }
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
  const technicalNumber = technicalSchoolNumber(label);
  if (technicalNumber !== null) return technicalIdentity(technicalNumber);
  if (label === EPS408_NAME) return { school: label, schoolNumber: null, managementType: "state" };
  const namedNumber = namedStateSchoolNumber(foldSchoolText(label), managementType);
  const number = parseSchoolNumber(label) ?? namedNumber;
  if (number !== null) {
    return { school: officialStateSchoolName(number), schoolNumber: number, managementType: "state" };
  }
  if (isKnownPrivateSchool(clean)) {
    return { school: clean, schoolNumber: null, managementType: "private" };
  }
  return null;
}

function candidateFromIdentifier(value: unknown, managementType: SchoolManagement): SchoolIdentity | null {
  if (managementType === "private" || (typeof value !== "string" && typeof value !== "number")) return null;
  const clean = String(value).trim().replace(/\s+/g, " ");
  if (!clean) return null;
  // Identificador de campo informado para Galileo Galilei por el equipo ITED.
  if (clean === "500") return technicalIdentity(5);
  const technicalNumber = technicalSchoolNumber(clean);
  if (technicalNumber !== null) return technicalIdentity(technicalNumber);
  const folded = foldSchoolText(clean);
  if (/\b408\b/.test(folded) || /^eps(?:\d| |$)/.test(folded) || /^cfp(?:\d| |$)/.test(folded)
    || /\b(?:escuela )?(?:profesional secundaria|secundaria profesional)\b/.test(folded)) {
    return { school: EPS408_NAME, schoolNumber: null, managementType: "state" };
  }
  const namedNumber = namedStateSchoolNumber(folded, managementType);
  if (namedNumber !== null) {
    const explicitNumber = parseSchoolNumber(clean);
    if (explicitNumber === null || explicitNumber === namedNumber) {
      return { school: officialStateSchoolName(namedNumber), schoolNumber: namedNumber, managementType: "state" };
    }
  }
  const number = parseSchoolNumber(clean);
  if (number === null) return null;
  if (!isNumberedSecondarySchoolText(folded)) return null;
  return { school: officialStateSchoolName(number), schoolNumber: number, managementType: "state" };
}

function preferNamedIdentity(name: SchoolIdentity, identifier: SchoolIdentity): SchoolIdentity {
  return name.managementType === "private" || technicalSchoolNumber(name.school) !== null ? name : identifier;
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
  const technicalNumber = school.managementType === "private" ? null : technicalSchoolNumber(school.school);
  if (technicalNumber !== null) return `state:eest-${technicalNumber}`;
  if (school.schoolNumber !== null) return `state:${school.schoolNumber}`;
  if (school.managementType === "private" || isKnownPrivateSchool(school.school)) {
    return `institution:${canonicalPrivateSchoolKey(school.school)}`;
  }
  // Docentes y Familias no siempre exportan la gestión. Para instituciones
  // locales no numeradas, el nombre canónico permite unir "private" y
  // "unknown" sin mezclar escuelas declaradas fuera de General San Martín.
  return `institution:${foldSchoolText(school.school)}`;
}
