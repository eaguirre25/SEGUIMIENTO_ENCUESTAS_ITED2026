/**
 * Único archivo que debe adaptarse a los nombres reales de la exportación.
 * No se inventan QCodes: complete usa el metadato estándar `submitdate`.
 * Complete los valores null luego de inspeccionar una exportación JSON/CSV real.
 */
export const QUESTION_MAP = {
  SCHOOL: null,
  SCHOOL_IDENTIFIER: null,
  COURSE_YEAR: null,
  LATITUDE: null,
  LONGITUDE: null,
  COMPLETION: "submitdate",
  MANAGEMENT_TYPE: null,
} as const satisfies Record<string, string | null>;

