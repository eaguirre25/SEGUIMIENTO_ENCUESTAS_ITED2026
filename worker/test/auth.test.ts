import { describe, expect, it } from "vitest";
import worker from "../src/index";
import type { Env } from "../src/types";

const env: Env = {
  LIMESURVEY_RPC_URL: "https://example.invalid/rpc",
  LIMESURVEY_USERNAME: "rpc-user",
  LIMESURVEY_PASSWORD: "rpc-password",
  LIMESURVEY_STUDENT_SURVEY_ID: "977929",
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
});
