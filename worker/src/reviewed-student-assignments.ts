import type { LoadMonitoringRow } from "./types";
import { APPROVED_STUDENT_ASSIGNMENTS } from "./reviewed-student-manifest";

type FingerprintRow = Pick<LoadMonitoringRow, "date" | "time" | "school" | "schoolIdentifier" | "courseYear" | "complete">;

export function studentAssignmentKey(row: FingerprintRow): string {
  const normalize = (s: string) => s.trim().replace(/\s+/g, " ").normalize("NFKC").toLocaleLowerCase("es-AR");
  return [row.date, row.time, normalize(row.school), normalize(row.schoolIdentifier),
    row.courseYear ?? "", row.complete ? "complete" : "incomplete"].join("|");
}

export async function matchApprovedStudentAssignments(
  rows: readonly FingerprintRow[],
  approved: ReadonlyMap<string, number> = APPROVED_STUDENT_ASSIGNMENTS,
): Promise<ReadonlyMap<string, number>> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const key = studentAssignmentKey(row);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const matched = new Map<string, number>();
  await Promise.all([...counts].map(async ([key, count]) => {
    // Never disambiguate duplicates with an unstable table ordinal.
    if (count !== 1) return;
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key));
    const hash = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
    const schoolNumber = approved.get(hash);
    if (schoolNumber !== undefined) matched.set(key, schoolNumber);
  }));
  return matched;
}
