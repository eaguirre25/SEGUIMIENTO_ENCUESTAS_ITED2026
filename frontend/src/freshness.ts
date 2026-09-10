const MAX_DATA_AGE_MS = 5 * 60_000;
const TIME_ZONE = "America/Argentina/Buenos_Aires";

export function isOperationalTime(now = new Date()): boolean {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: TIME_ZONE,
    weekday: "short",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const weekday = parts.find((part) => part.type === "weekday")?.value;
  const hour = Number(parts.find((part) => part.type === "hour")?.value);
  return weekday !== "Sat" && weekday !== "Sun" && hour >= 8 && hour < 23;
}

export function dataAgeMs(generatedAt: string, now = Date.now()): number | null {
  const generated = Date.parse(generatedAt);
  return Number.isFinite(generated) ? Math.max(0, now - generated) : null;
}

export function isDataStale(generatedAt: string, now = Date.now()): boolean {
  const age = dataAgeMs(generatedAt, now);
  return isOperationalTime(new Date(now)) && (age === null || age > MAX_DATA_AGE_MS);
}

export function formatDataAge(generatedAt: string, now = Date.now()): string {
  const age = dataAgeMs(generatedAt, now);
  if (age === null) return "fecha inválida";
  const minutes = Math.floor(age / 60_000);
  if (minutes < 1) return "menos de 1 min";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} h`;
  return `${Math.floor(hours / 24)} días`;
}

export function formatCutDate(generatedAt: string): string {
  const parsed = new Date(generatedAt);
  if (Number.isNaN(parsed.getTime())) return "Sin fecha válida";
  return new Intl.DateTimeFormat("es-AR", {
    timeZone: TIME_ZONE,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(parsed);
}
