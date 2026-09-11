import { LimeSurveyClient } from "./limesurvey";
import { buildDashboard, LEGACY_EXCLUDED_TEST_RESPONSE_KEYS } from "./normalize";
import {
  DASHBOARD_EXPORT_FIELDS,
  FAMILY_DASHBOARD_EXPORT_FIELDS,
  FAMILY_QUESTION_MAP,
  QUESTION_MAP,
  TEACHER_DASHBOARD_EXPORT_FIELDS,
  TEACHER_QUESTION_MAP,
} from "./question-map";
import type { Env } from "./types";

const DASHBOARD_TIME_ZONE = "America/Argentina/Buenos_Aires";
const DASHBOARD_MAX_CACHE_AGE_MS = 5 * 60_000;
type DashboardPopulation = "students" | "teachers" | "families";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin");
    const cors = corsHeaders(origin, env.DASHBOARD_ALLOWED_ORIGIN);

    if (request.method === "OPTIONS") {
      return cors ? new Response(null, { status: 204, headers: cors }) : jsonError("Origen no permitido", 403);
    }
    if (request.method === "POST" && url.pathname === "/api/session") {
      if (origin && !cors) return jsonError("Origen no permitido", 403);
      try {
        assertEnv(env);
        if (!(await isBasicAuthorized(request, env))) return unauthorized(cors);
        return json({ token: await createSessionToken(env), expiresIn: 28_800 }, 200, cors);
      } catch (error) {
        return jsonError(errorMessage(error), 502, cors);
      }
    }
    if (request.method !== "GET" || url.pathname !== "/api/dashboard") {
      return jsonError("No encontrado", 404, cors);
    }
    if (origin && !cors) return jsonError("Origen no permitido", 403);

    try {
      assertEnv(env);
      if (!(await isAuthorized(request, env))) return unauthorized(cors);
      const population = parsePopulation(url.searchParams.get("population"));
      if (!population) return jsonError("Población no válida", 400, cors);
      const config = surveyConfig(population, env);
      const forceRefresh = url.searchParams.get("refresh") === "1";
      const refreshPaused = isDashboardRefreshPaused(Date.now());
      if (!forceRefresh || refreshPaused) {
        const cached = await readCachedDashboard(env, population, config.surveyId);
        if (cached && (refreshPaused || !isDashboardCacheStale(cached.generatedAt, Date.now()))) {
          return dashboardJson(cached.payload, 200, cors, refreshPaused ? "D1-PAUSED" : "D1", cached.generatedAt);
        }
        if (cached && !refreshPaused) {
          try {
            const fresh = await refreshDashboard(env, population);
            return dashboardJson(fresh, 200, cors, "STALE-REFRESH");
          } catch (error) {
            console.error(JSON.stringify({ message: "stale dashboard refresh failed", population, error: errorMessage(error) }));
            return dashboardJson(cached.payload, 200, cors, "D1-STALE", cached.generatedAt, true);
          }
        }
        if (refreshPaused) {
          return jsonError("La actualización está pausada fuera del horario operativo", 503, cors);
        }
      }
      const fresh = await refreshDashboard(env, population);
      return dashboardJson(fresh, 200, cors, forceRefresh ? "REFRESH" : "SEED");
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
    for (const population of ["students", "teachers", "families"] as const) {
      ctx.waitUntil(refreshDashboard(env, population).then(
        () => console.log(JSON.stringify({ message: "dashboard cache refreshed", population })),
        (error) => console.error(JSON.stringify({ message: "dashboard refresh failed", population, error: errorMessage(error) })),
      ));
    }
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

export function isDashboardCacheStale(generatedAt: string, now = Date.now()): boolean {
  const generated = Date.parse(generatedAt);
  return !Number.isFinite(generated) || now - generated > DASHBOARD_MAX_CACHE_AGE_MS;
}

async function readCachedDashboard(
  env: Env,
  population: DashboardPopulation,
  expectedSurveyId: string,
): Promise<{ payload: string; generatedAt: string } | null> {
  const row = await env.DASHBOARD_DB.prepare(
    "SELECT payload FROM dashboard_population_cache WHERE population = ?1",
  ).bind(population).first<{ payload: string }>();
  if (!row?.payload) return null;
  try {
    const cached = JSON.parse(row.payload) as { surveyId?: unknown; generatedAt?: unknown };
    return cached.surveyId === expectedSurveyId && typeof cached.generatedAt === "string"
      ? { payload: row.payload, generatedAt: cached.generatedAt }
      : null;
  } catch {
    return null;
  }
}

async function refreshDashboard(env: Env, population: DashboardPopulation): Promise<string> {
  const config = surveyConfig(population, env);
  const client = new LimeSurveyClient(
    env.LIMESURVEY_RPC_URL,
    env.LIMESURVEY_USERNAME,
    env.LIMESURVEY_PASSWORD,
  );
  const { responses: raw, questions } = await client.exportResponsesWithQuestions(Number(config.surveyId), config.exportFields);
  const exclusions = await readExcludedResponseKeys(env);
  const serialized = JSON.stringify(buildDashboard(raw, config.surveyId, config.questionMap, new Date().toISOString(), exclusions, questions));
  await env.DASHBOARD_DB.prepare(`
    INSERT INTO dashboard_population_cache (population, payload, updated_at)
    VALUES (?1, ?2, datetime('now'))
    ON CONFLICT(population) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at
  `).bind(population, serialized).run();
  return serialized;
}

async function readExcludedResponseKeys(env: Env): Promise<ReadonlySet<string>> {
  try {
    const rows = await env.DASHBOARD_DB.prepare(
      "SELECT response_key FROM dashboard_excluded_responses",
    ).all<{ response_key: string }>();
    return new Set(rows.results.map((row) => row.response_key));
  } catch (error) {
    console.error(JSON.stringify({ message: "excluded responses table unavailable; using legacy list", error: errorMessage(error) }));
    return LEGACY_EXCLUDED_TEST_RESPONSE_KEYS;
  }
}

function parsePopulation(value: string | null): DashboardPopulation | null {
  if (value === null || value === "" || value === "students") return "students";
  if (value === "teachers" || value === "families") return value;
  return null;
}

function surveyConfig(population: DashboardPopulation, env: Env) {
  if (population === "students") return {
    surveyId: env.LIMESURVEY_STUDENT_SURVEY_ID,
    questionMap: QUESTION_MAP,
    exportFields: DASHBOARD_EXPORT_FIELDS,
  };
  if (population === "teachers") return {
    surveyId: env.LIMESURVEY_TEACHER_SURVEY_ID,
    questionMap: TEACHER_QUESTION_MAP,
    exportFields: TEACHER_DASHBOARD_EXPORT_FIELDS,
  };
  return {
    surveyId: env.LIMESURVEY_FAMILY_SURVEY_ID,
    questionMap: FAMILY_QUESTION_MAP,
    exportFields: FAMILY_DASHBOARD_EXPORT_FIELDS,
  };
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
    "LIMESURVEY_TEACHER_SURVEY_ID",
    "LIMESURVEY_FAMILY_SURVEY_ID",
    "DASHBOARD_ALLOWED_ORIGIN",
    "DASHBOARD_USERNAME",
    "DASHBOARD_PASSWORD",
    "DASHBOARD_DB",
  ];
  const missing = required.filter((key) => !env[key]);
  if (missing.length) throw new Error(`Falta configuración requerida: ${missing.join(", ")}`);
  for (const surveyId of [
    env.LIMESURVEY_STUDENT_SURVEY_ID,
    env.LIMESURVEY_TEACHER_SURVEY_ID,
    env.LIMESURVEY_FAMILY_SURVEY_ID,
  ]) {
    if (!/^\d+$/.test(surveyId)) throw new Error("Survey ID inválido");
  }
}

function corsHeaders(origin: string | null, allowed: string): Headers | undefined {
  if (!origin) return undefined;
  const localAllowed = isLocalhost(origin) && isLocalhost(allowed);
  if (origin !== allowed && !localAllowed) return undefined;
  return new Headers({
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Accept, Authorization, Cache-Control, Content-Type, Pragma",
    "Access-Control-Expose-Headers": "X-Dashboard-Cache, X-Dashboard-Generated-At, X-Dashboard-Stale",
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

function dashboardJson(
  payload: string,
  status: number,
  cors: Headers | undefined,
  cache: string,
  generatedAt?: string,
  stale = false,
): Response {
  const headers = cors ?? new Headers();
  let timestamp = generatedAt;
  if (!timestamp) {
    try {
      const parsed = JSON.parse(payload) as { generatedAt?: unknown };
      if (typeof parsed.generatedAt === "string") timestamp = parsed.generatedAt;
    } catch { /* el contrato se valida en el frontend */ }
  }
  if (timestamp) headers.set("X-Dashboard-Generated-At", timestamp);
  if (stale) headers.set("X-Dashboard-Stale", "true");
  return jsonText(payload, status, headers, cache);
}

function jsonError(message: string, status: number, cors?: Headers): Response {
  return json({ error: message }, status, cors);
}

async function isAuthorized(request: Request, env: Env): Promise<boolean> {
  const authorization = request.headers.get("Authorization");
  if (authorization?.startsWith("Bearer ")) return verifySessionToken(authorization.slice(7), env);
  return isBasicAuthorized(request, env);
}

async function isBasicAuthorized(request: Request, env: Env): Promise<boolean> {
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

async function createSessionToken(env: Env): Promise<string> {
  const payload = base64UrlEncode(JSON.stringify({
    u: env.DASHBOARD_USERNAME,
    exp: Math.floor(Date.now() / 1000) + 28_800,
  }));
  return `${payload}.${await sign(payload, env.DASHBOARD_PASSWORD)}`;
}

async function verifySessionToken(token: string, env: Env): Promise<boolean> {
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra) return false;
  if (!(await secureEqual(signature, await sign(payload, env.DASHBOARD_PASSWORD)))) return false;
  try {
    const parsed = JSON.parse(base64UrlDecode(payload)) as { u?: unknown; exp?: unknown };
    return parsed.u === env.DASHBOARD_USERNAME
      && typeof parsed.exp === "number"
      && parsed.exp > Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
}

async function sign(value: string, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(value));
  return bytesToBase64Url(new Uint8Array(signature));
}

function base64UrlEncode(value: string): string {
  return bytesToBase64Url(new TextEncoder().encode(value));
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(value: string): string {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  return new TextDecoder().decode(Uint8Array.from(binary, (character) => character.charCodeAt(0)));
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
