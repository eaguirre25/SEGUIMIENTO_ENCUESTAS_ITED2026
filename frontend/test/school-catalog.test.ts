import { describe, expect, it } from "vitest";
import { EES47_NAME, EPS408_NAME } from "../../shared/schools";
import { officialSchoolId, officialSchoolName, schoolLocation } from "../src/school-catalog";

describe("catálogo oficial de escuelas", () => {
  it("mantiene separadas la EES Nº47 y la EPS/CFP Nº408 aunque compartan edificio", () => {
    const ees47 = { school: "EES 47", schoolNumber: 47, managementType: "state" as const };
    const eps408 = { school: "EPS 408", schoolNumber: null, managementType: "state" as const };
    expect(officialSchoolName(ees47)).toBe(EES47_NAME);
    expect(officialSchoolName(eps408)).toBe(EPS408_NAME);
    expect(officialSchoolId(ees47)).toBe("state:47");
    expect(officialSchoolId(eps408)).toBe("state:eps-408");
    expect(officialSchoolId({ ...eps408, school: "EPS 408 (ES47)", schoolNumber: 47 })).toBe("state:eps-408");
    expect(schoolLocation(ees47)?.coordinates).toEqual(schoolLocation(eps408)?.coordinates);
  });

  it("no confunde el Instituto Alfonsina Storni privado con la EES Nº6", () => {
    const privateSchool = { school: "Instituto Alfonsina Storni", schoolNumber: null, managementType: "private" as const };
    expect(officialSchoolName(privateSchool)).toBe("INSTITUTO ALFONSINA STORNI");
    expect(officialSchoolId(privateSchool)).not.toBe("state:6");
  });
});
