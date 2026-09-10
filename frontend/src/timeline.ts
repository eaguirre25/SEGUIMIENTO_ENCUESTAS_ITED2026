export type TimelinePopulation = "students" | "teachers" | "families";

export interface TimelineModel {
  dates: string[];
  epochs: number[];
  startEpoch: number;
  endEpoch: number;
  cumulative: Record<TimelinePopulation, number[]>;
  total: number[];
  maximum: number;
}

const POPULATIONS: readonly TimelinePopulation[] = ["students", "teachers", "families"];

export function buildTimelineModel(datesByPopulation: Record<TimelinePopulation, string[]>): TimelineModel | null {
  const dates = [...new Set(POPULATIONS.flatMap((population) => datesByPopulation[population]))]
    .filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(`${date}T00:00:00Z`)))
    .sort();
  if (!dates.length) return null;
  const epochs = dates.map((date) => Date.parse(`${date}T00:00:00Z`));
  const cumulative = Object.fromEntries(POPULATIONS.map((population) => {
    const frequencies = new Map<string, number>();
    for (const date of datesByPopulation[population]) frequencies.set(date, (frequencies.get(date) ?? 0) + 1);
    let running = 0;
    return [population, dates.map((date) => (running += frequencies.get(date) ?? 0))];
  })) as Record<TimelinePopulation, number[]>;
  const total = dates.map((_, index) => POPULATIONS.reduce((sum, population) => sum + cumulative[population][index], 0));
  return {
    dates,
    epochs,
    startEpoch: epochs[0],
    endEpoch: epochs.at(-1)!,
    cumulative,
    total,
    maximum: Math.max(...total, 1),
  };
}

export function timelinePath(points: Array<{ x: number; y: number }>): string {
  if (!points.length) return "";
  return points.slice(1).reduce((path, point) => `${path} H ${point.x} V ${point.y}`, `M ${points[0].x} ${points[0].y}`);
}

export function timelineTicks(startEpoch: number, endEpoch: number, maximumTicks: number): Array<{ epoch: number; date: string }> {
  if (startEpoch === endEpoch || maximumTicks <= 1) return [{ epoch: startEpoch, date: isoDate(startEpoch) }];
  const dayMs = 86_400_000;
  const days = Math.round((endEpoch - startEpoch) / dayMs);
  const count = Math.min(maximumTicks, days + 1);
  const epochs = Array.from({ length: count }, (_, index) => {
    const day = Math.round(index * days / (count - 1));
    return startEpoch + day * dayMs;
  });
  return [...new Set(epochs)].map((epoch) => ({ epoch, date: isoDate(epoch) }));
}

function isoDate(epoch: number): string {
  return new Date(epoch).toISOString().slice(0, 10);
}
