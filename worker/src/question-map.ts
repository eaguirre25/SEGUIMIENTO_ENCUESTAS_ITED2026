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
  LOAD_TIMESTAMP: ["startdate", "datestamp", "submitdate"],
  MANAGEMENT_TYPE: "Q996591",
} as const satisfies Record<string, string | readonly string[] | null>;

/**
 * Nombres internos verificados con get_fieldmap. LimeSurvey exige estos nombres
 * de base de datos en aFields, aunque luego exporte encabezados con QCodes.
 */
export const DASHBOARD_EXPORT_FIELDS = [
  "submitdate",
  "startdate",
  "datestamp",
  "977929X336X3233",
  "977929X336X3258",
  "977929X336X3259",
  "977929X336X3191",
  "977929X336X3238",
  "977929X337X3250SQ002",
  "977929X337X3250SQ003",
] as const;
