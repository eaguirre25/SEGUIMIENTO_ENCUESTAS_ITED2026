import { describe, expect, it } from "vitest";
import { dataAgeMs, isDataStale, isOperationalTime } from "../src/freshness";
import { buildTimelineModel, timelinePath, timelineTicks } from "../src/timeline";
import { loadPopulationTarget, savePopulationTarget, targetStorageKey } from "../src/targets";
import { canonicalizePayload } from "../src/payload";
import type { DashboardPayload, ManagementType, SchoolSummary } from "../src/types";

describe("frescura visible de los datos", () => {
  it("sólo advierte antigüedad durante el horario operativo", () => {
    const weekdayNoon = Date.parse("2026-09-10T15:00:00Z");
    const weekdayNight = Date.parse("2026-09-11T03:00:00Z");
    expect(isOperationalTime(new Date(weekdayNoon))).toBe(true);
    expect(isOperationalTime(new Date(weekdayNight))).toBe(false);
    expect(isDataStale("2026-09-10T14:54:00Z", weekdayNoon)).toBe(true);
    expect(isDataStale("2026-09-10T14:54:00Z", weekdayNight)).toBe(false);
    expect(dataAgeMs("2026-09-10T14:59:00Z", weekdayNoon)).toBe(60_000);
  });
});

describe("escala temporal", () => {
  it("conserva la distancia real entre días y acumula por población", () => {
    const model = buildTimelineModel({
      students: ["2026-09-01", "2026-09-20"],
      teachers: ["2026-09-02"],
      families: [],
    });
    expect(model?.dates).toEqual(["2026-09-01", "2026-09-02", "2026-09-20"]);
    expect(model?.cumulative.students).toEqual([1, 1, 2]);
    expect(model?.total).toEqual([1, 2, 3]);
    expect(model!.epochs[1] - model!.epochs[0]).toBe(86_400_000);
    expect(model!.epochs[2] - model!.epochs[1]).toBe(18 * 86_400_000);
  });

  it("dibuja una acumulación escalonada y genera marcas de fechas", () => {
    expect(timelinePath([{ x: 0, y: 10 }, { x: 20, y: 5 }, { x: 50, y: 1 }]))
      .toBe("M 0 10 H 20 V 5 H 50 V 1");
    const ticks = timelineTicks(Date.parse("2026-09-01T00:00:00Z"), Date.parse("2026-09-20T00:00:00Z"), 6);
    expect(ticks[0].date).toBe("2026-09-01");
    expect(ticks.at(-1)?.date).toBe("2026-09-20");
    expect(ticks.length).toBeLessThanOrEqual(6);
  });
});

describe("metas por población", () => {
  it("guarda cada población en una clave independiente", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
    };
    expect(targetStorageKey("students")).not.toBe(targetStorageKey("teachers"));
    expect(savePopulationTarget(storage, "students", 1200)).toBe(true);
    expect(savePopulationTarget(storage, "teachers", 400)).toBe(true);
    expect(loadPopulationTarget(storage, "students")).toBe(1200);
    expect(loadPopulationTarget(storage, "teachers")).toBe(400);
    expect(loadPopulationTarget(storage, "families")).toBe(1500);
  });
});

describe("identidad transversal de escuelas", () => {
  it("une una institución local privada con la misma institución sin gestión", () => {
    const payload = emptyPayload([
      school("Colegio Santa Ana", "private", 2),
      school("Colegio Santa Ana", "unknown", 3),
    ]);
    const canonical = canonicalizePayload(payload);
    expect(canonical.schools).toHaveLength(1);
    expect(canonical.schools[0].total).toBe(5);
  });

  it("mantiene separada una escuela externa del mismo nombre", () => {
    const external = { ...school("Colegio Santa Ana", "unknown", 3), inSanMartin: false };
    const canonical = canonicalizePayload(emptyPayload([school("Colegio Santa Ana", "private", 2), external]));
    expect(canonical.schools).toHaveLength(2);
  });
});

function school(name: string, managementType: ManagementType, total: number): SchoolSummary {
  const counts = { total, complete: total, incomplete: 0, completePct: 100 };
  const years = Object.fromEntries(Array.from({ length: 7 }, (_, index) => [String(index + 1), { year: index + 1, total: 0, complete: 0, incomplete: 0, completePct: 0 }]));
  return { school: name, schoolNumber: null, managementType, ...counts, roles: { student: { ...counts, years } }, demographics: emptyDemographics() };
}

function emptyPayload(schools: SchoolSummary[]): DashboardPayload {
  return {
    generatedAt: "2026-09-10T15:00:00Z",
    surveyId: "test",
    summary: { total: 0, complete: 0, incomplete: 0, completePct: 0 },
    demographics: emptyDemographics(),
    schools,
    mapPoints: [],
    monitoringRows: [],
  };
}

function emptyDemographics(): DashboardPayload["demographics"] {
  return {
    validAges: 0,
    ageGroups: { "Hasta 15": 0, "16–18": 0, "19–29": 0, "30–39": 0, "40–49": 0, "50–59": 0, "60 o más": 0 },
    validGenders: 0,
    genders: [],
  };
}
