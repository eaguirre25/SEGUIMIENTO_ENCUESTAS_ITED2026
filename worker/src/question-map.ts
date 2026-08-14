/**
 * Único archivo que debe adaptarse a los nombres reales de la exportación.
 * QCodes verificados mediante `list_questions`, `get_fieldmap` y los encabezados
 * de `export_responses` de la encuesta 977929 el 2026-08-13.
 */
export const QUESTION_MAP = {
  SCHOOL: ["Q996592", "Q996548"],
  PRIVATE_SCHOOL: "Q996592",
  STATE_SCHOOL: "Q996548",
  SCHOOL_IDENTIFIER: "Q996545",
  COURSE_YEAR: "Q449329",
  LATITUDE: "Q996543[SQ002]",
  LONGITUDE: "Q996543[SQ003]",
  COMPLETION: "submitdate",
  MANAGEMENT_TYPE: "Q996591",
} as const satisfies Record<string, string | readonly string[] | null>;
