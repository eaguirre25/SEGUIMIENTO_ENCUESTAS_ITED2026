import { describe, expect, it } from "vitest";
import worker, { isDashboardRefreshPaused } from "../src/index";
import type { Env } from "../src/types";

const env: Env = {
  LIMESURVEY_RPC_URL: "https://example.invalid/rpc",
  LIMESURVEY_USERNAME: "rpc-user",
  LIMESURVEY_PASSWORD: "rpc-password",
  LIMESURVEY_STUDENT_SURVEY_ID: "977929",
  LIMESURVEY_TEACHER_SURVEY_ID: "985318",
  DASHBOARD_ALLOWED_ORIGIN: "https://example.github.io",
  DASHBOARD_USERNAME: "viewer",
  DASHBOARD_PASSWORD: "strong-password",
  DASHBOARD_DB: {} as D1Database,
};

describe("protección del dashboard", () => {
  it("rechaza solicitudes sin credenciales", async () => {
    const response = await worker.fetch(new Request("https://worker.example/api/dashboard", {
      headers: { Origin: env.DASHBOARD_ALLOWED_ORIGIN },
    }), env);
    expect(response.status).toBe(401);
    expect(response.headers.get("WWW-Authenticate")).toContain("Basic");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("rechaza credenciales incorrectas", async () => {
    const authorization = `Basic ${btoa("viewer:incorrecta")}`;
    const response = await worker.fetch(new Request("https://worker.example/api/dashboard", {
      headers: { Origin: env.DASHBOARD_ALLOWED_ORIGIN, Authorization: authorization },
    }), env);
    expect(response.status).toBe(401);
  });

  it("autoriza los encabezados de autenticación y recarga en la preflight CORS", async () => {
    const response = await worker.fetch(new Request("https://worker.example/api/dashboard", {
      method: "OPTIONS",
      headers: {
        Origin: env.DASHBOARD_ALLOWED_ORIGIN,
        "Access-Control-Request-Method": "GET",
        "Access-Control-Request-Headers": "authorization, cache-control, pragma",
      },
    }), env);
    expect(response.status).toBe(204);
    const allowedHeaders = response.headers.get("Access-Control-Allow-Headers");
    expect(allowedHeaders).toContain("Authorization");
    expect(allowedHeaders).toContain("Cache-Control");
    expect(allowedHeaders).toContain("Pragma");
    expect(response.headers.get("Access-Control-Max-Age")).toBe("86400");
  });

  it("rechaza poblaciones desconocidas antes de consultar datos", async () => {
    const authorization = `Basic ${btoa("viewer:strong-password")}`;
    const response = await worker.fetch(new Request("https://worker.example/api/dashboard?population=otra", {
      headers: { Origin: env.DASHBOARD_ALLOWED_ORIGIN, Authorization: authorization },
    }), env);
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Población no válida" });
  });
});

describe("pausa de actualización durante el fin de semana", () => {
  it("reconoce sábado, domingo y lunes en la zona horaria de Buenos Aires", () => {
    expect(isDashboardRefreshPaused(Date.parse("2026-08-15T15:00:00Z"))).toBe(true);
    expect(isDashboardRefreshPaused(Date.parse("2026-08-16T15:00:00Z"))).toBe(true);
    expect(isDashboardRefreshPaused(Date.parse("2026-08-17T15:00:00Z"))).toBe(false);
  });
});

describe("pausa nocturna durante los días hábiles", () => {
  it("reanuda a las 08:00 hora de Buenos Aires", () => {
    expect(isDashboardRefreshPaused(Date.parse("2026-08-17T10:59:59Z"))).toBe(true);
    expect(isDashboardRefreshPaused(Date.parse("2026-08-17T11:00:00Z"))).toBe(false);
  });

  it("se inicia a las 23:00 hora de Buenos Aires", () => {
    expect(isDashboardRefreshPaused(Date.parse("2026-08-18T01:59:59Z"))).toBe(false);
    expect(isDashboardRefreshPaused(Date.parse("2026-08-18T02:00:00Z"))).toBe(true);
  });
});
