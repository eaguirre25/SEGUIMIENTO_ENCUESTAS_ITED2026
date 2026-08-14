import { describe, expect, it } from "vitest";
import { buildDashboard, detectCompletion, normalizeSchool, parseCourseYear, parseSchoolNumber } from "../src/normalize";
import { decodeExport } from "../src/limesurvey";
import { QUESTION_MAP } from "../src/question-map";
import type { QuestionMap } from "../src/normalize";

const map: QuestionMap = {
  SCHOOL: "school",
  SCHOOL_IDENTIFIER: null,
  COURSE_YEAR: "year",
  LATITUDE: "lat",
  LONGITUDE: "lon",
  COMPLETION: "submitdate",
  MANAGEMENT_TYPE: null,
};

describe("normalización", () => {
  it("separa nombre de escuela y tipo de gestión según la exportación XLSX", () => {
    expect(QUESTION_MAP.SCHOOL).toEqual(["Q996592", "Q996548"]);
    expect(QUESTION_MAP.MANAGEMENT_TYPE).toBe("Q996591");
    expect(QUESTION_MAP.SCHOOL).not.toContain(QUESTION_MAP.MANAGEMENT_TYPE);
    expect(QUESTION_MAP.STATE_SCHOOL).toBe("Q996548");
    expect(QUESTION_MAP.PRIVATE_SCHOOL).toBe("Q996592");
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

  it("no expone coordenadas individuales ni campos personales", () => {
    expect(result.mapPoints).toEqual([]);
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

  it("cuenta en el total las respuestas sin escuela sin exponerlas en escuelas o mapa", () => {
    const withMissingSchool = buildDashboard(
      [{ school: "", year: "2", submitdate: null, lat: -34, lon: -58 }],
      "977929",
      map,
    );
    expect(withMissingSchool.summary).toMatchObject({ total: 1, complete: 0, incomplete: 1 });
    expect(withMissingSchool.schools).toEqual([]);
    expect(withMissingSchool.mapPoints).toEqual([]);
  });
});
