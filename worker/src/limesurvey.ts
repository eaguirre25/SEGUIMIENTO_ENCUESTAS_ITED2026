import type { RawResponse, SurveyQuestionDefinition } from "./types";

interface RpcEnvelope<T> {
  id: number;
  result?: T;
  error?: { code: number; message: string } | null;
}

interface SurveyQuestionSchema {
  questions: SurveyQuestionDefinition[];
  requiredFields: string[];
  operationalFieldNames: string[];
  fieldAliases: Map<string, string>;
}
const surveySchemaCache = new Map<number, SurveyQuestionSchema>();

const OPERATIONAL_QUESTION_CODES = new Set([
  "q996591", "q996592", "q996548", "q449329", "q996545", "q996543", "q993999", "q003",
  "escuelamayor", "gestion", "tipogestion", "gestionescuela", "gestionmayor", "rol", "rolotro", "edad", "genero",
  "escuela", "escuelafuera", "anioest", "vinculo", "q284042", "sanmartin",
]);

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

  async exportAllResponses(surveyId: number, fields?: readonly string[]): Promise<RawResponse[]> {
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
        "long",
        null,
        null,
        fields ? [...fields] : null,
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

  async exportResponsesWithQuestions(surveyId: number, operationalFields: readonly string[] = []): Promise<{
    responses: RawResponse[];
    progressResponses: RawResponse[];
    questions: SurveyQuestionDefinition[];
  }> {
    let sessionKey: string | null = null;
    try {
      const sessionResult = await this.call<unknown>("get_session_key", [this.username, this.password]);
      if (typeof sessionResult !== "string" || !sessionResult || sessionResult.startsWith("Error")) {
        throw new Error(`No se pudo iniciar sesión en LimeSurvey: ${rpcStatus(sessionResult)}`);
      }
      sessionKey = sessionResult;
      let schema = surveySchemaCache.get(surveyId);
      if (!schema) {
        const questionResult = await this.call<unknown>("list_questions", [sessionKey, surveyId, null, null]);
        const questions = decodeQuestions(questionResult, surveyId);
        const fieldMapResult = await this.call<unknown>("get_fieldmap", [sessionKey, surveyId, null]);
        const requiredFields = selectRequiredFields(fieldMapResult, questions);
        const operationalFieldNames = selectOperationalFieldNames(fieldMapResult, questions);
        const fieldAliases = buildFieldAliases(fieldMapResult, questions);
        schema = { questions, requiredFields, operationalFieldNames, fieldAliases };
        surveySchemaCache.set(surveyId, schema);
      }
      const { questions, requiredFields, operationalFieldNames, fieldAliases } = schema;
      const dashboardFields = [...new Set(["id", ...operationalFields, ...operationalFieldNames])];
      const progressFields = [...new Set(["id", ...requiredFields])];
      const dashboardExport = await this.call<unknown>("export_responses", [
        sessionKey, surveyId, "json", null, "all", "code", "long", null, null, dashboardFields,
      ]);
      const progressExport = await this.call<unknown>("export_responses", [
        sessionKey, surveyId, "json", null, "all", "code", "short", null, null, progressFields,
      ]);
      if (typeof dashboardExport !== "string" || typeof progressExport !== "string") {
        throw new Error(`LimeSurvey no pudo exportar respuestas: ${rpcStatus(typeof dashboardExport !== "string" ? dashboardExport : progressExport)}`);
      }
      const responses = decodeExport(dashboardExport);
      const progressResponses = decodeExport(progressExport);
      applyFieldAliases(responses, fieldAliases);
      applyFieldAliases(progressResponses, fieldAliases);
      backfillMissingFields(responses, progressResponses);
      return {
        responses,
        progressResponses,
        questions,
      };
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

export function selectRequiredFields(value: unknown, questions: readonly SurveyQuestionDefinition[]): string[] {
  const required = questions.filter((question) => question.mandatory === "Y" && question.parentQid === null);
  const neededQids = new Set(required.map((question) => question.qid));
  const rootByCode = new Map(questions
    .filter((question) => question.parentQid === null)
    .map((question) => [question.code.toLowerCase(), question.qid]));
  for (const question of required) {
    for (const token of question.relevance.match(/[\p{L}_][\p{L}\p{N}_]*/gu) ?? []) {
      const qid = rootByCode.get(token.toLowerCase());
      if (qid) neededQids.add(qid);
    }
  }
  if (!isPlainRecord(value)) return [];
  return Object.entries(value).flatMap(([key, rawField]) => {
    if (!isPlainRecord(rawField) || !neededQids.has(String(rawField.qid ?? ""))) return [];
    const fieldname = String(rawField.fieldname ?? key).trim();
    return fieldname ? [fieldname] : [];
  });
}

function selectOperationalFieldNames(value: unknown, questions: readonly SurveyQuestionDefinition[]): string[] {
  if (!isPlainRecord(value)) return [];
  const operationalQids = new Set(
    questions
      .filter((question) => question.parentQid === null && OPERATIONAL_QUESTION_CODES.has(question.code.toLowerCase()))
      .map((question) => question.qid),
  );
  return Object.entries(value).flatMap(([key, rawField]) => {
    if (!isPlainRecord(rawField)) return [];
    const qid = String(rawField.qid ?? "").trim();
    const title = String(rawField.title ?? "").trim().toLowerCase();
    if (!operationalQids.has(qid) && !OPERATIONAL_QUESTION_CODES.has(title)) return [];
    const fieldname = String(rawField.fieldname ?? key).trim();
    return fieldname ? [fieldname] : [];
  });
}

export function buildFieldAliases(value: unknown, questions: readonly SurveyQuestionDefinition[]): Map<string, string> {
  const aliases = new Map<string, string>();
  const rootByQid = new Map<string, SurveyQuestionDefinition>();
  const subByQid = new Map<string, SurveyQuestionDefinition>();
  for (const question of questions) {
    if (question.parentQid === null) rootByQid.set(question.qid, question);
    else subByQid.set(question.qid, question);
  }
  for (const question of questions) {
    if (question.parentQid === null) {
      if (question.sid && question.gid && question.qid) {
        aliases.set(`${question.sid}X${question.gid}X${question.qid}`, question.code);
      }
    } else {
      const parent = rootByQid.get(question.parentQid);
      if (parent && parent.sid && parent.gid && parent.qid) {
        const sgqaBase = `${parent.sid}X${parent.gid}X${parent.qid}`;
        const fullCode = `${parent.code}[${question.code}]`;
        aliases.set(`${sgqaBase}${question.code}`, fullCode);
        aliases.set(`${sgqaBase}[${question.code}]`, fullCode);
      }
    }
  }
  if (isPlainRecord(value)) {
    for (const [key, rawField] of Object.entries(value)) {
      if (!isPlainRecord(rawField)) continue;
      const fieldname = String(rawField.fieldname ?? key).trim();
      const qid = String(rawField.qid ?? "").trim();
      const sqid = String(rawField.sqid ?? "").trim();
      const parentCode = String(rawField.title ?? rootByQid.get(qid)?.code ?? "").trim();
      const aid = String(rawField.aid ?? subByQid.get(sqid)?.code ?? "").trim();
      if (!fieldname || !parentCode) continue;
      if (aid && aid !== parentCode) {
        aliases.set(fieldname, `${parentCode}[${aid}]`);
      } else {
        const subMatch = fieldname.match(/^\d+X\d+X(\d+)([A-Za-z0-9_]+)$/);
        if (subMatch && subMatch[1] === qid && subMatch[2]) {
          aliases.set(fieldname, `${parentCode}[${subMatch[2]}]`);
        } else {
          aliases.set(fieldname, parentCode);
        }
      }
    }
  }
  return aliases;
}

function applyFieldAliases(rows: RawResponse[], aliases: ReadonlyMap<string, string>): void {
  if (aliases.size === 0) return;
  for (let i = 0; i < rows.length; i += 1) {
    const raw = rows[i];
    const keys = Object.keys(raw);
    for (let k = 0; k < keys.length; k += 1) {
      const key = keys[k];
      const val = raw[key];
      if (val === null || val === undefined || String(val).trim() === "") continue;
      const directAlias = aliases.get(key);
      if (directAlias && (raw[directAlias] === undefined || raw[directAlias] === null || String(raw[directAlias]).trim() === "")) {
        raw[directAlias] = val;
        continue;
      }
      const boundary = key.search(/[\s.:[\]#-]/);
      if (boundary > 0) {
        const prefix = key.slice(0, boundary);
        const prefixAlias = aliases.get(prefix);
        if (prefixAlias) {
          const suffix = key.slice(boundary);
          const mappedKey = suffix.startsWith("[") ? `${prefixAlias}${suffix}` : prefixAlias;
          if (raw[mappedKey] === undefined || raw[mappedKey] === null || String(raw[mappedKey]).trim() === "") {
            raw[mappedKey] = val;
          }
        }
      }
    }
  }
}

function backfillMissingFields(responses: RawResponse[], progressResponses: readonly RawResponse[]): void {
  if (responses.length === 0 || progressResponses.length === 0) return;
  const progressById = new Map<string, RawResponse>();
  for (let i = 0; i < progressResponses.length; i += 1) {
    const p = progressResponses[i];
    if (p.id !== null && p.id !== undefined) progressById.set(String(p.id), p);
  }
  for (let i = 0; i < responses.length; i += 1) {
    const row = responses[i];
    const id = row.id !== null && row.id !== undefined ? String(row.id) : null;
    const progressRow = (id ? progressById.get(id) : null) ?? progressResponses[i];
    if (!progressRow) continue;
    const pKeys = Object.keys(progressRow);
    for (let k = 0; k < pKeys.length; k += 1) {
      const key = pKeys[k];
      const existing = row[key];
      if (existing === undefined || existing === null || String(existing).trim() === "") {
        const pVal = progressRow[key];
        if (pVal !== undefined && pVal !== null && String(pVal).trim() !== "") {
          row[key] = pVal;
        }
      }
    }
  }
}

export function decodeQuestions(value: unknown, surveyId: number): SurveyQuestionDefinition[] {
  const rows = Array.isArray(value)
    ? value
    : isPlainRecord(value)
      ? Object.values(value)
      : [];
  return rows.flatMap((row) => {
    if (!isPlainRecord(row)) return [];
    const code = String(row.title ?? row.code ?? "").trim();
    const qid = String(row.qid ?? "").trim();
    if (!code || !qid) return [];
    const mandatory = String(row.mandatory ?? "N").toUpperCase();
    return [{
      qid,
      gid: String(row.gid ?? "").trim(),
      sid: String(row.sid ?? surveyId).trim(),
      parentQid: normalizeParentQid(row.parent_qid),
      code,
      type: String(row.type ?? "").trim(),
      mandatory: mandatory === "Y" || mandatory === "S" ? mandatory : "N",
      relevance: String(row.relevance ?? "1").trim() || "1",
    }];
  });
}

function normalizeParentQid(value: unknown): string | null {
  const text = String(value ?? "").trim();
  return !text || text === "0" ? null : text;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function rpcStatus(value: unknown): string {
  if (typeof value === "object" && value !== null && "status" in value) return String(value.status);
  return "respuesta RPC inesperada";
}

export function decodeExport(encoded: string): RawResponse[] {
  let text: string;
  try {
    const uint8FromBase64 = (Uint8Array as unknown as { fromBase64?: (b64: string) => Uint8Array }).fromBase64;
    const bytes = uint8FromBase64
      ? uint8FromBase64(encoded)
      : (() => {
          const binary = atob(encoded);
          const buffer = new Uint8Array(binary.length);
          for (let index = 0; index < binary.length; index += 1) buffer[index] = binary.charCodeAt(index);
          return buffer;
        })();
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
