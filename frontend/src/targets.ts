export type TargetPopulation = "students" | "teachers" | "families";

export function targetStorageKey(population: TargetPopulation): string {
  return `dashboard-target-${population}`;
}

export function loadPopulationTarget(storage: Pick<Storage, "getItem">, population: TargetPopulation): number {
  const stored = Number(storage.getItem(targetStorageKey(population)));
  return Number.isFinite(stored) && stored > 0 ? stored : 1500;
}

export function savePopulationTarget(storage: Pick<Storage, "setItem">, population: TargetPopulation, value: number): boolean {
  if (!Number.isFinite(value) || value <= 0) return false;
  storage.setItem(targetStorageKey(population), String(Math.round(value)));
  return true;
}
