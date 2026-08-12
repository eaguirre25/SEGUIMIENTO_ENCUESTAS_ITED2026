import { LimeSurveyClient } from "./limesurvey";
import { buildDashboard } from "./normalize";
import type { DashboardPayload, Env } from "./types";

const CACHE_MS = 20_000;
let memoryCache: { expiresAt: number; surveyId: string; payload: DashboardPayload } | null = null;

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
      const surveyId = env.LIMESURVEY_STUDENT_SURVEY_ID;
      const now = Date.now();
      if (memoryCache && memoryCache.surveyId === surveyId && memoryCache.expiresAt > now) {
        return json(memoryCache.payload, 200, cors, "HIT");
      }
      const client = new LimeSurveyClient(
        env.LIMESURVEY_RPC_URL,
        env.LIMESURVEY_USERNAME,
        env.LIMESURVEY_PASSWORD,
      );
      const raw = await client.exportAllResponses(Number(surveyId));
      const payload = buildDashboard(raw, surveyId);
      memoryCache = { expiresAt: now + CACHE_MS, surveyId, payload };
      return json(payload, 200, cors, "MISS");
    } catch (error) {
      console.error("Dashboard API error", error);
      const message = error instanceof Error ? error.message : "Error inesperado";
      return jsonError(message, 502, cors);
    }
  },
} satisfies ExportedHandler<Env>;

function assertEnv(env: Env): void {
  const required: Array<keyof Env> = [
    "LIMESURVEY_RPC_URL",
    "LIMESURVEY_USERNAME",
    "LIMESURVEY_PASSWORD",
    "LIMESURVEY_STUDENT_SURVEY_ID",
    "DASHBOARD_ALLOWED_ORIGIN",
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
    "Access-Control-Allow-Headers": "Content-Type",
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
  const headers = cors ?? new Headers();
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "public, max-age=20");
  headers.set("X-Dashboard-Cache", cache);
  return new Response(JSON.stringify(payload), { status, headers });
}

function jsonError(message: string, status: number, cors?: Headers): Response {
  return json({ error: message }, status, cors);
}

