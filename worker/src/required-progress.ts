import type { RawResponse, SurveyQuestionDefinition } from "./types";

export interface RequiredProgress {
  answeredRequiredQuestions: number;
  requiredQuestions: number;
  missingRequiredQuestions: number;
  requiredCompletionPct: number;
}

const MULTIPLE_ANY_TYPES = new Set(["M", "P", "R"]);
const MULTIPLE_ALL_TYPES = new Set(["1", "A", "B", "C", "E", "F", "H", "K", "Q", ":", ";"]);
const SYSTEM_FIELDS = new Set(["id", "token", "submitdate", "lastpage", "startlanguage", "seed", "startdate", "datestamp", "ipaddr", "refurl"]);

export function calculateRequiredProgress(
  raw: RawResponse,
  questions: readonly SurveyQuestionDefinition[],
): RequiredProgress {
  const required = questions.filter((question) => question.mandatory === "Y" && question.parentQid === null);
  const applicable = required.filter((question) => isQuestionApplicable(question.relevance, raw));
  const answered = applicable.filter((question) => isQuestionAnswered(question, raw)).length;
  return {
    answeredRequiredQuestions: answered,
    requiredQuestions: applicable.length,
    missingRequiredQuestions: applicable.length - answered,
    requiredCompletionPct: applicable.length ? round2(answered * 100 / applicable.length) : 100,
  };
}

export function isQuestionAnswered(question: SurveyQuestionDefinition, raw: RawResponse): boolean {
  const values = matchingValues(question, raw);
  if (!values.length) return false;
  if (MULTIPLE_ANY_TYPES.has(question.type)) return values.some(isSelectedValue);
  if (MULTIPLE_ALL_TYPES.has(question.type)) return values.every(isAnsweredValue);
  return isAnsweredValue(values[0]);
}

function matchingValues(question: SurveyQuestionDefinition, raw: RawResponse): unknown[] {
  const sgqa = question.sid && question.gid ? `${question.sid}X${question.gid}X${question.qid}` : "";
  return Object.entries(raw)
    .filter(([key]) => !SYSTEM_FIELDS.has(key.toLocaleLowerCase("en")) && (
      keyMatchesPrefix(key, question.code) || (sgqa && keyMatchesPrefix(key, sgqa))
    ))
    .map(([, value]) => value);
}

function keyMatchesPrefix(key: string, prefix: string): boolean {
  if (key === prefix) return true;
  if (!key.startsWith(prefix)) return false;
  return /[\s.:[\]_#-]/.test(key.charAt(prefix.length));
}

function isAnsweredValue(value: unknown): boolean {
  return value !== null && value !== undefined && String(value).trim() !== "";
}

function isSelectedValue(value: unknown): boolean {
  if (!isAnsweredValue(value)) return false;
  return !/^(?:N|No|0|false)$/i.test(String(value).trim());
}

export function isQuestionApplicable(relevance: string, raw: RawResponse): boolean {
  const expression = relevance.trim();
  if (!expression || expression === "1") return true;
  if (expression === "0") return false;
  try {
    const tokens = tokenize(expression);
    const parser = new RelevanceParser(tokens, raw);
    const result = parser.parse();
    return parser.atEnd() ? truthy(result) : true;
  } catch {
    // Una expresión desconocida se considera aplicable para no ocultar una obligación real.
    return true;
  }
}

type Token = { type: "word" | "string" | "number" | "operator" | "paren" | "comma"; value: string };

function tokenize(source: string): Token[] {
  const clean = source.replace(/^\{([\s\S]*)\}$/u, "$1");
  const tokens: Token[] = [];
  let index = 0;
  while (index < clean.length) {
    const rest = clean.slice(index);
    const whitespace = rest.match(/^\s+/);
    if (whitespace) { index += whitespace[0].length; continue; }
    const string = rest.match(/^(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')/);
    if (string) { tokens.push({ type: "string", value: string[0].slice(1, -1) }); index += string[0].length; continue; }
    const operator = rest.match(/^(?:===|!==|==|!=|>=|<=|&&|\|\||>|<|!)/);
    if (operator) { tokens.push({ type: "operator", value: operator[0] }); index += operator[0].length; continue; }
    if (rest[0] === "(" || rest[0] === ")") { tokens.push({ type: "paren", value: rest[0] }); index += 1; continue; }
    if (rest[0] === ",") { tokens.push({ type: "comma", value: "," }); index += 1; continue; }
    const number = rest.match(/^-?\d+(?:\.\d+)?/);
    if (number) { tokens.push({ type: "number", value: number[0] }); index += number[0].length; continue; }
    const word = rest.match(/^[\p{L}_][\p{L}\p{N}_.:[\]-]*/u);
    if (word) { tokens.push({ type: "word", value: word[0] }); index += word[0].length; continue; }
    throw new Error(`Símbolo de relevancia no soportado: ${rest[0]}`);
  }
  return tokens;
}

class RelevanceParser {
  private position = 0;
  constructor(private readonly tokens: Token[], private readonly raw: RawResponse) {}
  atEnd(): boolean { return this.position === this.tokens.length; }
  parse(): unknown { return this.parseOr(); }

  private parseOr(): unknown {
    let value = this.parseAnd();
    while (this.match("||") || this.matchWord("or")) {
      const right = this.parseAnd();
      value = truthy(value) || truthy(right);
    }
    return value;
  }
  private parseAnd(): unknown {
    let value = this.parseComparison();
    while (this.match("&&") || this.matchWord("and")) {
      const right = this.parseComparison();
      value = truthy(value) && truthy(right);
    }
    return value;
  }
  private parseComparison(): unknown {
    let value = this.parseUnary();
    const operator = this.peek()?.type === "operator" ? this.peek()!.value : "";
    if (!["==", "===", "!=", "!==", ">", "<", ">=", "<="].includes(operator)) return value;
    this.position += 1;
    const right = this.parseUnary();
    if (operator === "==" || operator === "===") return comparable(value) === comparable(right);
    if (operator === "!=" || operator === "!==") return comparable(value) !== comparable(right);
    const leftNumber = Number(value);
    const rightNumber = Number(right);
    if (operator === ">") return leftNumber > rightNumber;
    if (operator === "<") return leftNumber < rightNumber;
    if (operator === ">=") return leftNumber >= rightNumber;
    return leftNumber <= rightNumber;
  }
  private parseUnary(): unknown {
    if (this.match("!") || this.matchWord("not")) return !truthy(this.parseUnary());
    return this.parsePrimary();
  }
  private parsePrimary(): unknown {
    if (this.match("(")) {
      const value = this.parseOr();
      this.expect(")");
      return value;
    }
    const token = this.tokens[this.position++];
    if (!token) throw new Error("Expresión incompleta");
    if (token.type === "string") return token.value;
    if (token.type === "number") return Number(token.value);
    if (token.type !== "word") throw new Error("Valor inesperado");
    if (this.peek()?.value === "(") {
      this.position += 1;
      const argument = this.parseOr();
      this.expect(")");
      if (token.value.toLowerCase() === "is_empty") return !isAnsweredValue(argument);
      throw new Error(`Función no soportada: ${token.value}`);
    }
    if (/^(?:true|false)$/i.test(token.value)) return token.value.toLowerCase() === "true";
    return readExpressionValue(this.raw, token.value.replace(/\.NAOK$/i, ""));
  }
  private peek(): Token | undefined { return this.tokens[this.position]; }
  private match(value: string): boolean {
    if (this.peek()?.value !== value) return false;
    this.position += 1;
    return true;
  }
  private matchWord(value: string): boolean {
    const token = this.peek();
    if (token?.type !== "word" || token.value.toLowerCase() !== value) return false;
    this.position += 1;
    return true;
  }
  private expect(value: string): void { if (!this.match(value)) throw new Error(`Se esperaba ${value}`); }
}

function readExpressionValue(raw: RawResponse, code: string): unknown {
  if (code in raw) return raw[code];
  const match = Object.entries(raw).find(([key]) => keyMatchesPrefix(key, code));
  return match?.[1] ?? null;
}

function comparable(value: unknown): string { return String(value ?? "").trim().toLocaleLowerCase("es-AR"); }
function truthy(value: unknown): boolean { return isAnsweredValue(value) && !/^(?:0|false|N|No)$/i.test(String(value).trim()); }
function round2(value: number): number { return Math.round((value + Number.EPSILON) * 100) / 100; }
