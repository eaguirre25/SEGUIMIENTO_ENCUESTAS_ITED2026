import { describe, expect, it } from "vitest";
import { buildDashboard, detectCompletion, normalizeSchool, parseCourseYear } from "../src/normalize";
import { decodeExport } from "../src/limesurvey";
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
  it("decodifica la estructura JSON exportada sin asumir QCodes", () => {
    const encoded = btoa(JSON.stringify({ responses: [{ "17": { school: "EES 1", submitdate: null } }] }));
    expect(decodeExport(encoded)).toEqual([{ school: "EES 1", submitdate: null }]);
  });

  it("normaliza espacios y mayúsculas sin perder el original limpio", () => {
    expect(normalizeSchool("  EES   1 ")).toEqual({ original: "EES 1", key: "ees 1" });
    expect(normalizeSchool("ees 1")?.key).toBe("ees 1");
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

  it("elimina coordenadas inválidas y no expone campos personales", () => {
    expect(result.mapPoints).toHaveLength(2);
    expect(Object.keys(result.mapPoints[0])).toEqual(["school", "lat", "lon"]);
    expect(JSON.stringify(result)).not.toContain("privada");
  });

  it("usa un único nombre canónico para variantes de la misma escuela en el mapa", () => {
    const canonical = buildDashboard(
      [
        { school: "EES 1", year: 1, submitdate: null, lat: -34.5, lon: -58.4 },
        { school: " ees 1 ", year: 2, submitdate: null, lat: -34.6, lon: -58.5 },
      ],
      "977929",
      map,
    );
    expect(canonical.mapPoints.map((point) => point.school)).toEqual(["EES 1", "EES 1"]);
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
