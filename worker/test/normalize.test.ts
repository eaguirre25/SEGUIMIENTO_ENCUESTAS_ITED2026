import { describe, expect, it, vi } from "vitest";
import { buildDashboard, detectCompletion, normalizeSchool, parseCourseYear, parseSchoolNumber, splitTimestamp } from "../src/normalize";
import { decodeExport, LimeSurveyClient } from "../src/limesurvey";
import {
  DASHBOARD_EXPORT_FIELDS,
  QUESTION_MAP,
  TEACHER_DASHBOARD_EXPORT_FIELDS,
  TEACHER_QUESTION_MAP,
} from "../src/question-map";
import type { QuestionMap } from "../src/normalize";

const map: QuestionMap = {
  SCHOOL: "school",
  SCHOOL_IDENTIFIER: null,
  COURSE_YEAR: "year",
  LATITUDE: "lat",
  LONGITUDE: "lon",
  COMPLETION: "submitdate",
  MANAGEMENT_TYPE: null,
  LOAD_TIMESTAMP: ["startdate", "submitdate"],
};

describe("normalización", () => {
  it("separa nombre de escuela y tipo de gestión según la exportación XLSX", () => {
    expect(QUESTION_MAP.SCHOOL).toEqual(["Q996592", "Q996548"]);
    expect(QUESTION_MAP.MANAGEMENT_TYPE).toBe("Q996591");
    expect(QUESTION_MAP.SCHOOL).not.toContain(QUESTION_MAP.MANAGEMENT_TYPE);
    expect(QUESTION_MAP.STATE_SCHOOL).toBe("Q996548");
    expect(QUESTION_MAP.PRIVATE_SCHOOL).toBe("Q996592");
    expect(DASHBOARD_EXPORT_FIELDS).toContain("977929X336X3191");
    expect(DASHBOARD_EXPORT_FIELDS).toContain("977929X337X3250SQ003");
  });

  it("mapea los campos verificados de la encuesta docente activa", () => {
    expect(TEACHER_QUESTION_MAP.SCHOOL).toContain("ESCUELAMAYOR");
    expect(TEACHER_QUESTION_MAP.SCHOOL).toContain("985318X456X5372");
    expect(TEACHER_QUESTION_MAP.COMPLETION).toBe("submitdate");
    expect(TEACHER_QUESTION_MAP.ROLE).toContain("985318X456X5370");
    expect(TEACHER_QUESTION_MAP.ROLE_OTHER).toContain("985318X456X5426");
    expect(TEACHER_QUESTION_MAP.MANAGEMENT_TYPE).toContain("GESTION");
    expect(TEACHER_DASHBOARD_EXPORT_FIELDS).toContain("985318X456X5370");
    expect(TEACHER_DASHBOARD_EXPORT_FIELDS).toContain("985318X456X5426");
    expect(TEACHER_DASHBOARD_EXPORT_FIELDS).toContain("985318X456X5372");
  });

  it("decodifica la estructura JSON exportada sin asumir QCodes", () => {
    const encoded = btoa(JSON.stringify({ responses: [{ "17": { school: "EES 1", submitdate: null } }] }));
    expect(decodeExport(encoded)).toEqual([{ school: "EES 1", submitdate: null }]);
  });

  it("normaliza espacios y mayúsculas sin perder el original limpio", () => {
    expect(normalizeSchool("  EES   1 ")).toEqual({ original: "EES 1", key: "ees 1" });
    expect(normalizeSchool("ees 1")?.key).toBe("ees 1");
  });

  it("consolida variantes inequívocas de escuelas numeradas", () => {
    for (const variant of ["4", "EES4", "Media 4", "N°4", "Secundaria 4 Ricardo Rojas", "Escuela Número 4 Ricardo Rojas"]) {
      expect(normalizeSchool(variant)?.original).toBe("EES 4");
    }
    expect(normalizeSchool("ees26")?.original).toBe("EES 26");
    expect(normalizeSchool("Ee27")?.original).toBe("EES 27");
    expect(normalizeSchool("Santa Ana")?.original).toBe("Santa Ana");
  });

  it("recupera el único número escolar válido del texto estatal", () => {
    expect(parseSchoolNumber("Escuela Número 27")).toBe(27);
    expect(parseSchoolNumber("EES6")).toBe(6);
    expect(parseSchoolNumber("Escuela 4 anexo 1")).toBeNull();
    expect(parseSchoolNumber("Santa Ana")).toBeNull();
  });

  it("usa el número de la pregunta estatal como identidad de escuela", () => {
    const surveyMap: QuestionMap = {
      ...map,
      MANAGEMENT_TYPE: "management",
      STATE_SCHOOL: "state_school",
      PRIVATE_SCHOOL: "private_school",
      SCHOOL: ["private_school", "state_school"],
    };
    const result = buildDashboard([
      { management: "Estatal", state_school: "Media 4", submitdate: "2026-08-13" },
      { management: "ESTATAL", state_school: "N°4", submitdate: null },
      { management: "Privada", private_school: "Santa Ana", submitdate: "2026-08-13" },
    ], "977929", surveyMap);
    expect(result.schools).toMatchObject([
      { school: "EES 4", schoolNumber: 4, total: 2 },
      { school: "Santa Ana", schoolNumber: null, total: 1 },
    ]);
  });

  it("consolida Alfonsina Storni dentro de la EES 6 sin alterar las respuestas", () => {
    const surveyMap: QuestionMap = {
      ...map,
      MANAGEMENT_TYPE: "management",
      STATE_SCHOOL: "state_school",
      PRIVATE_SCHOOL: "private_school",
      SCHOOL: ["private_school", "state_school"],
      SCHOOL_IDENTIFIER: "school_identifier",
    };
    const result = buildDashboard([
      { management: "Estatal", state_school: "EES 6", school_identifier: "6", submitdate: "2026-08-14" },
      { management: "Estatal", state_school: "Alfonsina Storni", school_identifier: "ES6", submitdate: "2026-08-14" },
      { management: "Estatal", state_school: "Alfonsina Storni", school_identifier: "99", submitdate: null },
      { management: "Estatal", state_school: "Alfonsina Storni", school_identifier: "ES6", submitdate: "2026-08-14" },
    ], "977929", surveyMap);

    expect(result.summary).toMatchObject({ total: 4, complete: 3, incomplete: 1 });
    expect(result.schools).toHaveLength(1);
    expect(result.schools[0]).toMatchObject({
      school: "EES 6",
      schoolNumber: 6,
      managementType: "state",
      total: 4,
      complete: 3,
      incomplete: 1,
    });
    expect(result.monitoringRows.filter((row) => row.school === "Alfonsina Storni")).toHaveLength(3);
  });

  it("toma la primera rama de escuela informada", () => {
    const branchedMap: QuestionMap = { ...map, SCHOOL: ["school_choice", "school_other"] };
    const result = buildDashboard(
      [{ school_choice: "", school_other: "EES 26", year: 2, submitdate: null }],
      "977929",
      branchedMap,
    );
    expect(result.schools[0].school).toBe("EES 26");
  });

  it("detecta respuestas completas e incompletas", () => {
    expect(detectCompletion({ submitdate: "2026-08-12 10:00:00" })).toBe(true);
    expect(detectCompletion({ submitdate: null })).toBe(false);
    expect(detectCompletion({ submitdate: "N" })).toBe(false);
  });

  it("extrae únicamente cursos 1 a 7", () => {
    expect(parseCourseYear("3.º año")).toBe(3);
    expect(parseCourseYear("8")).toBeNull();
  });

  it("reconoce como estatal una escuela docente informada sólo por número", () => {
    const teacherMap: QuestionMap = {
      ...map,
      SCHOOL: "teacher_school",
      MANAGEMENT_TYPE: null,
    };
    const result = buildDashboard([
      { teacher_school: "33", submitdate: null },
    ], "985318", teacherMap);
    expect(result.schools[0]).toMatchObject({
      school: "EES 33",
      schoolNumber: 33,
      managementType: "state",
      total: 1,
    });
  });

  it("pide a LimeSurvey únicamente los campos necesarios", async () => {
    const calls: Array<{ method: string; params: unknown[] }> = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      const request = JSON.parse(String(init.body)) as { id: number; method: string; params: unknown[] };
      calls.push(request);
      const result = request.method === "get_session_key"
        ? "session-key"
        : request.method === "export_responses"
          ? btoa(JSON.stringify({ responses: [] }))
          : "OK";
      return Response.json({ id: request.id, result });
    }));
    try {
      const client = new LimeSurveyClient("https://example.invalid/rpc", "user", "password");
      await client.exportAllResponses(977929, ["submitdate", "Q996548"]);
      expect(calls[1].params.slice(7)).toEqual([null, null, ["submitdate", "Q996548"]]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("separa fecha y hora sin convertir la zona horaria de LimeSurvey", () => {
    expect(splitTimestamp("2026-08-14 09:07:05")).toEqual({ date: "2026-08-14", time: "09:07:05" });
    expect(splitTimestamp(null)).toEqual({ date: "", time: "" });
  });
});

describe("agregación segura", () => {
  const result = buildDashboard(
    [
      { school: "EES 1", year: "1", submitdate: "2026-08-12", lat: "-34.5", lon: "-58.4", address: "privada" },
      { school: " ees 1 ", year: "1.º año", submitdate: null, lat: "999", lon: "-58.3" },
      { school: "EES 2", year: "7", submitdate: "2026-08-12", lat: "-35,1", lon: "-59,2" },
    ],
    "977929",
    map,
    "2026-08-12T13:00:00.000Z",
  );

  it("agrupa por escuela y curso y calcula porcentajes", () => {
    expect(result.summary).toEqual({ total: 3, complete: 2, incomplete: 1, completePct: 66.67 });
    expect(result.schools[0].roles.student.years["1"]).toMatchObject({ total: 2, complete: 1, incomplete: 1, completePct: 50 });
    expect(result.schools[0].roles.student.years["1"].year).toBe(1);
    expect(Object.keys(result.schools[0].roles.student.years)).toEqual(["1", "2", "3", "4", "5", "6", "7"]);
  });

  it("expone solo los campos mínimos necesarios para el mapa de matrícula", () => {
    expect(result.mapPoints).toHaveLength(2);
    expect(Object.keys(result.mapPoints[0])).toEqual([
      "school", "schoolNumber", "managementType", "complete", "lat", "lon",
    ]);
    expect(JSON.stringify(result)).not.toContain("privada");
  });

  it("usa un único nombre canónico para variantes de la misma escuela", () => {
    const canonical = buildDashboard(
      [
        { school: "EES 1", year: 1, submitdate: null, lat: -34.5, lon: -58.4 },
        { school: " ees 1 ", year: 2, submitdate: null, lat: -34.6, lon: -58.5 },
      ],
      "977929",
      map,
    );
    expect(canonical.schools).toHaveLength(1);
    expect(canonical.schools[0]).toMatchObject({ school: "EES 1", total: 2 });
  });

  it("mantiene completas + incompletas = total", () => {
    expect(result.summary.complete + result.summary.incomplete).toBe(result.summary.total);
    for (const school of result.schools) {
      expect(school.complete + school.incomplete).toBe(school.total);
    }
  });

  it("expone una fila mínima de monitoreo por respuesta y ordena la más reciente primero", () => {
    const monitoringMap: QuestionMap = {
      ...map,
      MANAGEMENT_TYPE: "management",
      STATE_SCHOOL: "school",
      PRIVATE_SCHOOL: "school",
      SCHOOL_IDENTIFIER: "school_identifier",
    };
    const monitored = buildDashboard([
      { school: "Media 1", school_identifier: "ID-001", year: "1.º año", management: "Estatal", startdate: "2026-08-14 08:05:00", submitdate: null },
      { school: "  Colegio del Parque  ", school_identifier: "  PRIV-09  ", year: "3", management: "Privada", startdate: "2026-08-14 09:15:30", submitdate: "2026-08-14 09:20:00" },
    ], "977929", monitoringMap);
    expect(monitored.monitoringRows).toEqual([
      { date: "2026-08-14", time: "09:15:30", school: "  Colegio del Parque  ", schoolIdentifier: "  PRIV-09  ", role: "Sin informar", managementType: "private", courseYear: 3, complete: true },
      { date: "2026-08-14", time: "08:05:00", school: "Media 1", schoolIdentifier: "ID-001", role: "Sin informar", managementType: "state", courseYear: 1, complete: false },
    ]);
    expect(monitored.monitoringRows).toHaveLength(monitored.summary.total);
  });

  it("arma la grilla docente con los campos propios y sin coordenadas", () => {
    const result = buildDashboard([{
      startdate: "2026-08-19 10:15:30",
      "ROL - Para comenzar, seleccioná el rol que cumplís en la institución.": "Director/a [DIR]",
      "ESCUELAMAYOR - ¿Cuál es la escuela en la que tenés mayor carga horaria?": "EESN 4",
      GESTION: "Estatal",
      submitdate: "2026-08-19 10:20:00",
    }], "985318", TEACHER_QUESTION_MAP);
    expect(result.monitoringRows).toEqual([{
      date: "2026-08-19",
      time: "10:15:30",
      role: "Director/a",
      school: "EESN 4",
      schoolIdentifier: "Sin informar",
      managementType: "state",
      courseYear: null,
      complete: true,
    }]);
    expect(result.mapPoints).toEqual([]);
  });

  it("pide explícitamente a LimeSurvey los campos docentes", async () => {
    const calls: Array<{ method: string; params: unknown[] }> = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      const request = JSON.parse(String(init.body)) as { id: number; method: string; params: unknown[] };
      calls.push(request);
      const result = request.method === "get_session_key"
        ? "session-key"
        : request.method === "export_responses"
          ? btoa(JSON.stringify({ responses: [] }))
          : "OK";
      return Response.json({ id: request.id, result });
    }));
    try {
      const client = new LimeSurveyClient("https://example.invalid/rpc", "user", "password");
      await client.exportAllResponses(985318, TEACHER_DASHBOARD_EXPORT_FIELDS);
      expect(calls[1].params[9]).toEqual(expect.arrayContaining([
        "985318X456X5370",
        "985318X456X5426",
        "985318X456X5372",
      ]));
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("muestra el cargo escrito cuando la respuesta de rol es Otro", () => {
    const result = buildDashboard([{
      startdate: "2026-08-19 11:00:00",
      ROL: "Otro [OTRO]",
      ROLOTRO: "Director CENS y profesor",
      ESCUELAMAYOR: "CENS 455",
      submitdate: null,
    }], "985318", TEACHER_QUESTION_MAP);
    expect(result.monitoringRows[0]).toMatchObject({
      role: "Otro: Director CENS y profesor",
      school: "CENS 455",
    });
  });

  it("lee los nombres internos que LimeSurvey entrega al Worker", () => {
    const result = buildDashboard([{
      startdate: "2026-08-20 10:10:08",
      "985318X456X5370": "Docente [DOC]",
      "985318X456X5372": "EESN 4",
      submitdate: "2026-08-20 10:20:00",
    }], "985318", TEACHER_QUESTION_MAP);
    expect(result.monitoringRows[0]).toMatchObject({
      role: "Docente",
      school: "EESN 4",
    });
  });

  it("excluye las cuatro respuestas de prueba de todos los indicadores", () => {
    const exclusionMap: QuestionMap = {
      ...map,
      MANAGEMENT_TYPE: "management",
      STATE_SCHOOL: "state_school",
      PRIVATE_SCHOOL: "private_school",
      SCHOOL: ["private_school", "state_school"],
      SCHOOL_IDENTIFIER: "school_identifier",
    };
    const filtered = buildDashboard([
      { startdate: "2026-08-12 09:18:21", state_school: "ees26", school_identifier: "00", management: "Estatal", year: "3.º año", submitdate: "2026-08-12 09:20:00" },
      { startdate: "2026-08-12 09:05:59", state_school: "Ees 1", school_identifier: "1", management: "Estatal", year: "1.º año", submitdate: "2026-08-12 09:08:00" },
      { startdate: "2026-08-11 23:24:09", school_identifier: "S6", year: "4.º año", submitdate: null },
      { startdate: "2026-08-11 22:09:20", submitdate: null },
      { startdate: "2026-08-12 09:18:22", state_school: "ees26", school_identifier: "00", management: "Estatal", year: "3.º año", submitdate: "2026-08-12 09:20:00" },
    ], "977929", exclusionMap);
    expect(filtered.summary).toMatchObject({ total: 1, complete: 1, incomplete: 0 });
    expect(filtered.monitoringRows).toHaveLength(1);
    expect(filtered.monitoringRows[0].time).toBe("09:18:22");
    expect(filtered.schools).toHaveLength(1);
  });

  it("cuenta en el total las respuestas sin escuela y conserva su punto como no identificado", () => {
    const withMissingSchool = buildDashboard(
      [{ school: "", year: "2", submitdate: null, lat: -34, lon: -58 }],
      "977929",
      map,
    );
    expect(withMissingSchool.summary).toMatchObject({ total: 1, complete: 0, incomplete: 1 });
    expect(withMissingSchool.schools).toEqual([]);
    expect(withMissingSchool.mapPoints).toEqual([{
      school: "Sin escuela identificada",
      schoolNumber: null,
      managementType: "unknown",
      complete: false,
      lat: -34,
      lon: -58,
    }]);
  });
});
