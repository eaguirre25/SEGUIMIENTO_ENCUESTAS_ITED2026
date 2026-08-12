import type { RawResponse } from "./types";

interface RpcEnvelope<T> {
  id: number;
  result?: T;
  error?: { code: number; message: string } | null;
}

export class LimeSurveyClient {
  private requestId = 0;

  constructor(
    private readonly url: string,
    private readonly username: string,
    private readonly password: string,
  ) {}

  private async call<T>(method: string, params: unknown[]): Promise<T> {
    const response = await fetch(this.url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ method, params, id: ++this.requestId }),
    });
    if (!response.ok) throw new Error(`LimeSurvey respondió HTTP ${response.status}`);
    const envelope = (await response.json()) as RpcEnvelope<T>;
    if (envelope.error) throw new Error(`LimeSurvey RPC: ${envelope.error.message}`);
    if (envelope.result === undefined) throw new Error("LimeSurvey RPC no devolvió result");
    return envelope.result;
  }

  async exportAllResponses(surveyId: number): Promise<RawResponse[]> {
    let sessionKey: string | null = null;
    try {
      const sessionResult = await this.call<unknown>("get_session_key", [this.username, this.password]);
      if (typeof sessionResult !== "string" || !sessionResult || sessionResult.startsWith("Error")) {
        throw new Error(`No se pudo iniciar sesión en LimeSurvey: ${rpcStatus(sessionResult)}`);
      }
      sessionKey = sessionResult;
      const exportResult = await this.call<unknown>("export_responses", [
        sessionKey,
        surveyId,
        "json",
        null,
        "all",
        "code",
        "short",
      ]);
      if (typeof exportResult !== "string") {
        throw new Error(`LimeSurvey no pudo exportar respuestas: ${rpcStatus(exportResult)}`);
      }
      return decodeExport(exportResult);
    } finally {
      if (sessionKey) {
        try {
          await this.call("release_session_key", [sessionKey]);
        } catch (error) {
          console.error("No se pudo liberar la sesión de LimeSurvey", error);
        }
      }
    }
  }
}

function rpcStatus(value: unknown): string {
  if (typeof value === "object" && value !== null && "status" in value) return String(value.status);
  return "respuesta RPC inesperada";
}

export function decodeExport(encoded: string): RawResponse[] {
  let text: string;
  try {
    const bytes = Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0));
    text = new TextDecoder().decode(bytes);
  } catch {
    text = encoded;
  }
  const parsed = JSON.parse(text) as unknown;
  if (Array.isArray(parsed)) return parsed.filter(isRecord);
  if (isRecord(parsed) && (Array.isArray(parsed.responses) || isRecord(parsed.responses))) {
    const items = Array.isArray(parsed.responses) ? parsed.responses : Object.values(parsed.responses);
    return items.flatMap(unwrapExportRow);
  }
  throw new Error("Formato JSON de export_responses no reconocido");
}

function unwrapExportRow(item: unknown): RawResponse[] {
  if (!isRecord(item)) return [];
  if (isRecord(item.response)) return [item.response];
  const keys = Object.keys(item);
  if (keys.length === 1 && isRecord(item[keys[0]])) return [item[keys[0]] as RawResponse];
  return [item];
}

function isRecord(value: unknown): value is RawResponse {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
