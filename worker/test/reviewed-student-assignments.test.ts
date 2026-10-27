import { describe, expect, it } from "vitest";
import { matchApprovedStudentAssignments, studentAssignmentKey } from "../src/reviewed-student-assignments";
import { APPROVED_STUDENT_ASSIGNMENTS } from "../src/reviewed-student-manifest";
import { buildDashboard, studentAssignmentCandidates } from "../src/normalize";
import { QUESTION_MAP } from "../src/question-map";

async function hash(key: string): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key)))].map(n => n.toString(16).padStart(2, "0")).join("");
}
const raw = { startdate: "2026-09-23 14:23:53", Q996592: "Papa francisco", Q996545: "99", Q449329: "2", submitdate: "2026-09-23 14:30:00" };

describe("closed high-confidence audit", () => {
  it("contains exactly 101 unique approvals and recognizes the approved Papa Francisco response", async () => {
    expect(APPROVED_STUDENT_ASSIGNMENTS.size).toBe(101);
    const before = buildDashboard([raw], "977929");
    const matches = await matchApprovedStudentAssignments(before.monitoringRows);
    expect(matches.size).toBe(1);
    expect(await matchApprovedStudentAssignments(studentAssignmentCandidates([raw], QUESTION_MAP, new Set()))).toEqual(matches);
    const after = buildDashboard([raw], "977929", QUESTION_MAP, "test", new Set(), [], [raw], matches);
    expect(after.monitoringRows[0]).toMatchObject({ resolvedSchool: "ESCUELA DE EDUCACIÓN SECUNDARIA Nº23", classificationMethod: "reviewed", school: "Papa francisco", schoolIdentifier: "99" });
    expect(after.summary).toEqual(before.summary);
    expect(after.demographics).toEqual(before.demographics);
    expect(after.schools[0]).toMatchObject({ schoolNumber: 23, total: 1, complete: 1 });
  });

  it("rejects duplicates and near-matches instead of using table order", async () => {
    const row = buildDashboard([raw], "977929").monitoringRows[0];
    expect((await matchApprovedStudentAssignments([row, row])).size).toBe(0);
    for (const changed of [{ ...row, time: "14:23:54" }, { ...row, schoolIdentifier: "23" }, { ...row, courseYear: 3 }, { ...row, complete: false }]) {
      expect((await matchApprovedStudentAssignments([changed])).size).toBe(0);
    }
  });

  it("does not let reviewed rows alter temporal inference for unapproved responses", async () => {
    const unapproved = { startdate: "2026-09-23 14:24:00", submitdate: null };
    const responses = [raw, { ...raw, startdate: "2026-09-23 14:23:55" }, unapproved];
    const before = buildDashboard(responses, "977929");
    const matches = await matchApprovedStudentAssignments(before.monitoringRows);
    const after = buildDashboard(responses, "977929", QUESTION_MAP, "test", new Set(), [], responses, matches);
    for (const row of before.monitoringRows.filter(r => !matches.has(studentAssignmentKey(r)))) {
      expect(after.monitoringRows.find(r => r.time === row.time)).toEqual(row);
    }
    expect(after.summary).toEqual(before.summary);
  });

  it("scopes corrections to the student survey and preserves map coordinates and totals", async () => {
    const geo = { ...raw, 'Q996543[SQ002]': -34.58, 'Q996543[SQ003]': -58.55 };
    const before = buildDashboard([geo], "977929");
    const key = studentAssignmentKey(before.monitoringRows[0]);
    const matches = await matchApprovedStudentAssignments(before.monitoringRows, new Map([[await hash(key), 23]]));
    const after = buildDashboard([geo], "977929", QUESTION_MAP, "test", new Set(), [], [geo], matches);
    expect(after.mapPoints[0]).toMatchObject({ schoolNumber: 23, lat: -34.58, lon: -58.55 });
    expect(after.mapPoints.length).toBe(before.mapPoints.length);
    const other = buildDashboard([geo], "985318", QUESTION_MAP, "test", new Set(), [], [geo], matches);
    expect(other.monitoringRows[0].classificationMethod).not.toBe("reviewed");
  });
});
