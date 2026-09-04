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
  ROLE: null,
  ROLE_OTHER: null,
  IN_SAN_MARTIN: null,
  AGE: ["Q993999", "977929X337X3228"],
  GENDER: ["Q003", "977929X337X3183"],
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
  "977929X337X3228",
  "977929X337X3183",
] as const;

/**
 * Encuesta activa de docentes y equipos de conducción (985318).
 * Los QCodes y nombres internos fueron verificados contra el formulario
 * público de LimeSurvey el 2026-08-18.
 */
export const TEACHER_QUESTION_MAP = {
  SCHOOL: ["ESCUELAMAYOR", "985318X456X5372"],
  PRIVATE_SCHOOL: null,
  STATE_SCHOOL: null,
  SCHOOL_IDENTIFIER: null,
  COURSE_YEAR: null,
  LATITUDE: null,
  LONGITUDE: null,
  COMPLETION: "submitdate",
  LOAD_TIMESTAMP: ["startdate", "datestamp", "submitdate"],
  MANAGEMENT_TYPE: ["GESTION", "TIPOGESTION", "GESTIONESCUELA", "GESTIONMAYOR"],
  ROLE: ["ROL", "985318X456X5370"],
  ROLE_OTHER: ["ROLOTRO", "985318X456X5426"],
  IN_SAN_MARTIN: null,
  AGE: ["EDAD", "985318X464X5397"],
  GENDER: ["GENERO", "985318X464X5396"],
} as const satisfies Record<string, string | readonly string[] | null>;

// LimeSurvey exige nombres internos en aFields. Pedirlos explícitamente evita
// que la exportación remota devuelva sólo metadatos y omita las respuestas.
export const TEACHER_DASHBOARD_EXPORT_FIELDS = [
  "submitdate",
  "startdate",
  "datestamp",
  "985318X456X5370",
  "985318X456X5426",
  "985318X456X5372",
  "985318X464X5397",
  "985318X464X5396",
] as const;

/**
 * Encuesta de familias y responsables (997168). Se exportan únicamente los
 * campos necesarios para seguimiento de carga y los dos campos demográficos
 * que se agregan en el Worker. Quedan fuera las respuestas abiertas, los datos
 * del hogar y la ubicación declarada.
 */
export const FAMILY_QUESTION_MAP = {
  SCHOOL: ["ESCUELA", "997168X472X5756", "ESCUELAFUERA", "997168X472X5802"],
  PRIVATE_SCHOOL: null,
  STATE_SCHOOL: null,
  SCHOOL_IDENTIFIER: null,
  COURSE_YEAR: ["ANIOEST", "997168X472X5757"],
  LATITUDE: null,
  LONGITUDE: null,
  COMPLETION: "submitdate",
  LOAD_TIMESTAMP: ["startdate", "datestamp", "submitdate"],
  MANAGEMENT_TYPE: null,
  ROLE: ["VINCULO", "997168X472X5754"],
  ROLE_OTHER: ["Q284042", "997168X472X5947"],
  IN_SAN_MARTIN: ["SANMARTIN", "997168X472X5755"],
  AGE: ["EDAD", "997168X472X5779"],
  GENDER: ["GENERO", "997168X472X5778"],
} as const satisfies Record<string, string | readonly string[] | null>;

export const FAMILY_DASHBOARD_EXPORT_FIELDS = [
  "submitdate",
  "startdate",
  "datestamp",
  "997168X472X5754",
  "997168X472X5947",
  "997168X472X5755",
  "997168X472X5756",
  "997168X472X5802",
  "997168X472X5757",
  "997168X472X5779",
  "997168X472X5778",
] as const;
