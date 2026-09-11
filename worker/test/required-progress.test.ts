import { describe, expect, it, vi } from "vitest";
import { LimeSurveyClient, decodeQuestions, selectRequiredFields } from "../src/limesurvey";
import { calculateRequiredProgress, isQuestionApplicable } from "../src/required-progress";
import type { SurveyQuestionDefinition } from "../src/types";

const question = (overrides: Partial<SurveyQuestionDefinition>): SurveyQuestionDefinition => ({
  qid: "1",
  gid: "10",
  sid: "977929",
  parentQid: null,
  code: "Q1",
  type: "L",
  mandatory: "Y",
  relevance: "1",
  ...overrides,
});

describe("avance de preguntas obligatorias", () => {
  it("cuenta preguntas obligatorias respondidas y vacías sin contar opcionales", () => {
    const progress = calculateRequiredProgress(
      { Q1: "Sí", Q2: "", Q3: "opcional" },
      [question({ code: "Q1" }), question({ qid: "2", code: "Q2" }), question({ qid: "3", code: "Q3", mandatory: "N" })],
    );
    expect(progress).toEqual({
      answeredRequiredQuestions: 1,
      requiredQuestions: 2,
      missingRequiredQuestions: 1,
      requiredCompletionPct: 50,
    });
  });

  it("descuenta preguntas que no correspondían por lógica condicional", () => {
    const questions = [
      question({ code: "ROL" }),
      question({ qid: "2", code: "DOCENTE", relevance: "{ROL.NAOK == 'Docente'}" }),
      question({ qid: "3", code: "ALUMNO", relevance: "ROL == 'Estudiante'" }),
    ];
    expect(calculateRequiredProgress({ ROL: "Docente", DOCENTE: "Respondida", ALUMNO: "" }, questions)).toEqual({
      answeredRequiredQuestions: 2,
      requiredQuestions: 2,
      missingRequiredQuestions: 0,
      requiredCompletionPct: 100,
    });
    expect(isQuestionApplicable("!is_empty(ROL) and ROL != 'Estudiante'", { ROL: "Docente" })).toBe(true);
  });

  it("exige al menos una selección en múltiple choice y todas las filas en matrices", () => {
    const progress = calculateRequiredProgress(
      { "MULTI[A]": "N", "MULTI[B]": "Y", "MATRIX[A]": "Bien", "MATRIX[B]": "" },
      [question({ code: "MULTI", type: "M" }), question({ qid: "2", code: "MATRIX", type: "A" })],
    );
    expect(progress).toMatchObject({ answeredRequiredQuestions: 1, requiredQuestions: 2, missingRequiredQuestions: 1 });
  });

  it("reconoce los metadatos obligatorios de LimeSurvey", () => {
    expect(decodeQuestions({ 1: { qid: 1, gid: 10, sid: 977929, title: "Q1", type: "L", mandatory: "Y", relevance: "1", parent_qid: 0 } }, 977929)).toEqual([
      question({}),
    ]);
  });

  it("selecciona sólo campos obligatorios y los necesarios para su relevancia", () => {
    const questions = [
      question({ qid: "1", code: "ROL", mandatory: "N" }),
      question({ qid: "2", code: "DETALLE", relevance: "ROL.NAOK == 'Docente'" }),
      question({ qid: "3", code: "OPCIONAL", mandatory: "N" }),
    ];
    const fields = selectRequiredFields({
      Q1: { fieldname: "Q1", qid: "1" },
      Q2: { fieldname: "Q2", qid: "2" },
      Q3: { fieldname: "Q3", qid: "3" },
    }, questions);
    expect(fields).toEqual(["Q1", "Q2"]);
  });

  it("obtiene preguntas y respuestas en una sola sesión y exporta todos los campos", async () => {
    const calls: Array<{ method: string; params: unknown[] }> = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      const request = JSON.parse(String(init.body)) as { id: number; method: string; params: unknown[] };
      calls.push(request);
      const result = request.method === "get_session_key"
        ? "session-key"
        : request.method === "list_questions"
          ? [{ qid: 1, gid: 10, sid: 977929, title: "Q1", type: "L", mandatory: "Y", relevance: "1" }]
          : request.method === "get_fieldmap"
            ? { Q1: { fieldname: "Q1", qid: 1 } }
          : request.method === "export_responses"
            ? btoa(JSON.stringify({ responses: [{ id: 1, Q1: request.params[6] === "short" ? "Y" : "Yes" }] }))
            : "OK";
      return Response.json({ id: request.id, result });
    }));
    try {
      const result = await new LimeSurveyClient("https://example.invalid/rpc", "user", "password").exportResponsesWithQuestions(977929, ["submitdate"]);
      expect(result.responses).toEqual([{ id: 1, Q1: "Yes" }]);
      expect(result.progressResponses).toEqual([{ id: 1, Q1: "Y" }]);
      expect(result.questions).toHaveLength(1);
      expect(calls.map(({ method }) => method)).toEqual(["get_session_key", "list_questions", "get_fieldmap", "export_responses", "export_responses", "release_session_key"]);
      expect(calls[3].params[6]).toBe("long");
      expect(calls[3].params[9]).toEqual(["id", "submitdate"]);
      expect(calls[4].params[6]).toBe("short");
      expect(calls[4].params[9]).toEqual(["id", "Q1"]);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
