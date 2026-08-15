import { LimeSurveyClient } from "./limesurvey";
import { buildDashboard } from "./normalize";
import { DASHBOARD_EXPORT_FIELDS } from "./question-map";
import type { Env } from "./types";

const CACHE_ROW_ID = 1;
const DASHBOARD_TIME_ZONE = "America/Argentina/Buenos_Aires";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin");
    const cors = corsHeaders(origin, env.DASHBOARD_ALLOWED_ORIGIN);

    if (request.method === "OPTIONS") {
      return cors ? new Response(null, { status: 204, headers: cors }) : jsonError("Origen no permitido", 403);
    }
    if (request.method !== "GET" || url.pathname !== "/api/dashboard") {
      return jsonError("No encontrado", 404, cors);
    }
    if (origin && !cors) return jsonError("Origen no permitido", 403);

    try {
      assertEnv(env);
      if (!(await isAuthorized(request, env))) return unauthorized(cors);
      const forceRefresh = url.searchParams.get("refresh") === "1";
      const refreshPaused = isDashboardRefreshPaused(Date.now());
      if (!forceRefresh || refreshPaused) {
        const cached = await readCachedDashboard(env);
        if (cached) return jsonText(cached, 200, cors, refreshPaused ? "D1-PAUSED" : "D1");
        if (refreshPaused) {
          return jsonError("La actualización está pausada fuera del horario operativo", 503, cors);
        }
      }
      const fresh = await refreshDashboard(env);
      return jsonText(fresh, 200, cors, forceRefresh ? "REFRESH" : "SEED");
    } catch (error) {
      console.error(JSON.stringify({ message: "dashboard request failed", error: errorMessage(error) }));
      const message = error instanceof Error ? error.message : "Error inesperado";
      return jsonError(message, 502, cors);
    }
  },
  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    if (isDashboardRefreshPaused(controller.scheduledTime)) {
      console.log(JSON.stringify({
        message: "dashboard refresh skipped",
        reason: "outside operating hours",
        timeZone: DASHBOARD_TIME_ZONE,
      }));
      return;
    }
    ctx.waitUntil(refreshDashboard(env).then(
      () => console.log(JSON.stringify({ message: "dashboard cache refreshed" })),
      (error) => console.error(JSON.stringify({ message: "dashboard refresh failed", error: errorMessage(error) })),
    ));
  },
} satisfies ExportedHandler<Env>;

export function isDashboardRefreshPaused(timestamp: number): boolean {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: DASHBOARD_TIME_ZONE,
    weekday: "short",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(timestamp));
  const weekday = parts.find((part) => part.type === "weekday")?.value;
  const hour = Number(parts.find((part) => part.type === "hour")?.value);
  const weekend = weekday === "Sat" || weekday === "Sun";
  return weekend || hour >= 23 || hour < 8;
}

async function readCachedDashboard(env: Env): Promise<string | null> {
  const row = await env.DASHBOARD_DB.prepare(
    "SELECT payload FROM dashboard_cache WHERE id = ?1",
  ).bind(CACHE_ROW_ID).first<{ payload: string }>();
  return row?.payload ?? null;
}

async function refreshDashboard(env: Env): Promise<string> {
  const surveyId = env.LIMESURVEY_STUDENT_SURVEY_ID;
  const client = new LimeSurveyClient(
    env.LIMESURVEY_RPC_URL,
    env.LIMESURVEY_USERNAME,
    env.LIMESURVEY_PASSWORD,
  );
  const raw = await client.exportAllResponses(Number(surveyId), DASHBOARD_EXPORT_FIELDS);
  const serialized = JSON.stringify(buildDashboard(raw, surveyId));
  await env.DASHBOARD_DB.prepare(`
    INSERT INTO dashboard_cache (id, payload, updated_at)
    VALUES (?1, ?2, datetime('now'))
    ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at
  `).bind(CACHE_ROW_ID, serialized).run();
  return serialized;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function assertEnv(env: Env): void {
  const required: Array<keyof Env> = [
    "LIMESURVEY_RPC_URL",
    "LIMESURVEY_USERNAME",
    "LIMESURVEY_PASSWORD",
    "LIMESURVEY_STUDENT_SURVEY_ID",
    "DASHBOARD_ALLOWED_ORIGIN",
    "DASHBOARD_USERNAME",
    "DASHBOARD_PASSWORD",
    "DASHBOARD_DB",
  ];
  const missing = required.filter((key) => !env[key]);
  if (missing.length) throw new Error(`Falta configuración requerida: ${missing.join(", ")}`);
  if (!/^\d+$/.test(env.LIMESURVEY_STUDENT_SURVEY_ID)) throw new Error("Survey ID inválido");
}

function corsHeaders(origin: string | null, allowed: string): Headers | undefined {
  if (!origin) return undefined;
  const localAllowed = isLocalhost(origin) && isLocalhost(allowed);
  if (origin !== allowed && !localAllowed) return undefined;
  return new Headers({
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Accept, Authorization, Cache-Control, Content-Type, Pragma",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  });
}

function isLocalhost(value: string): boolean {
  try {
    return ["localhost", "127.0.0.1", "[::1]"].includes(new URL(value).hostname);
  } catch {
    return false;
  }
}

function json(payload: unknown, status: number, cors?: Headers, cache = "BYPASS"): Response {
  return jsonText(JSON.stringify(payload), status, cors, cache);
}

function jsonText(payload: string, status: number, cors?: Headers, cache = "BYPASS"): Response {
  const headers = cors ?? new Headers();
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "private, no-store");
  headers.set("X-Dashboard-Cache", cache);
  return new Response(payload, { status, headers });
}

function jsonError(message: string, status: number, cors?: Headers): Response {
  return json({ error: message }, status, cors);
}

async function isAuthorized(request: Request, env: Env): Promise<boolean> {
  const authorization = request.headers.get("Authorization");
  if (!authorization?.startsWith("Basic ")) return false;
  let decoded: string;
  try {
    const binary = atob(authorization.slice(6));
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    decoded = new TextDecoder().decode(bytes);
  } catch {
    return false;
  }
  const separator = decoded.indexOf(":");
  if (separator < 0) return false;
  const username = decoded.slice(0, separator);
  const password = decoded.slice(separator + 1);
  const [usernameMatches, passwordMatches] = await Promise.all([
    secureEqual(username, env.DASHBOARD_USERNAME),
    secureEqual(password, env.DASHBOARD_PASSWORD),
  ]);
  return usernameMatches && passwordMatches;
}

async function secureEqual(left: string, right: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const [leftHash, rightHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(left)),
    crypto.subtle.digest("SHA-256", encoder.encode(right)),
  ]);
  const a = new Uint8Array(leftHash);
  const b = new Uint8Array(rightHash);
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) difference |= a[index] ^ b[index];
  return difference === 0;
}

function unauthorized(cors?: Headers): Response {
  const headers = cors ?? new Headers();
  headers.set("WWW-Authenticate", 'Basic realm="Seguimiento ITED", charset="UTF-8"');
  return json({ error: "Credenciales requeridas" }, 401, headers);
}
