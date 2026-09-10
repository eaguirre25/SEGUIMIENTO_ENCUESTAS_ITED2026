import { officialSchoolId, officialSchoolName } from "./school-catalog";
import type { AgeGroup, DashboardPayload, DemographicSummary, ManagementType, SchoolSummary } from "./types";
import { formatCutDate, formatDataAge, isDataStale } from "./freshness";
import { buildTimelineModel, timelinePath, timelineTicks } from "./timeline";

export type Population = "students" | "teachers" | "families";
export type PopulationData = Record<Population, DashboardPayload>;

const POPULATIONS: readonly Population[] = ["students", "teachers", "families"];
const LABELS: Record<Population, string> = { students: "Estudiantes", teachers: "Docentes", families: "Familias" };
const COLORS: Record<Population, string> = { students: "#a855f7", teachers: "#34d399", families: "#fb923c" };
const AGE_GROUPS: readonly AgeGroup[] = ["Hasta 15", "16–18", "19–29", "30–39", "40–49", "50–59", "60 o más"];

interface CombinedSchool {
  id: string;
  label: string;
  managementType: ManagementType;
  schools: Partial<Record<Population, SchoolSummary>>;
  counts: Record<Population, number>;
  total: number;
}

let selectedSchoolId = "all";
let ageScope: "all" | Population = "all";
let genderScope: "all" | Population = "all";

export function renderPanoramaGeneral(root: HTMLElement, payloads: PopulationData): void {
  const schools = combineSchools(payloads);
  if (selectedSchoolId !== "all" && !schools.some((school) => school.id === selectedSchoolId)) selectedSchoolId = "all";
  const selectedSchool = schools.find((school) => school.id === selectedSchoolId) ?? null;
  const totals = populationTotals(payloads, selectedSchool);
  const total = POPULATIONS.reduce((sum, population) => sum + totals[population], 0);
  const complete = selectedSchool
    ? POPULATIONS.reduce((sum, population) => sum + (selectedSchool.schools[population]?.complete ?? 0), 0)
    : POPULATIONS.reduce((sum, population) => sum + payloads[population].summary.complete, 0);
  const visibleSchools = selectedSchool ? [selectedSchool] : schools;
  const demographics = demographicFor(payloads, selectedSchool, ageScope);
  const genderDemographics = demographicFor(payloads, selectedSchool, genderScope);
  const studentYears = studentYearCounts(payloads.students, selectedSchool?.schools.students ?? null);
  const studentsWithYear = studentYears.reduce((sum, count) => sum + count, 0);
  const studentsWithoutYear = Math.max(0, totals.students - studentsWithYear);
  const unidentified = unidentifiedSchoolCounts(payloads);
  const timeline = timelineMarkup(payloads, selectedSchool);

  root.innerHTML = `
    <div id="panorama-warning-slot"></div>
    ${freshnessBanner(payloads)}
    <section class="panorama-heading">
      <div><p class="eyebrow">SÍNTESIS TRANSVERSAL</p><h2>Panorama general de la encuesta</h2><p>Cobertura, composición y avance de Estudiantes, Docentes y Familias.</p></div>
      <label class="panorama-filter">Escuela
        <select id="panorama-school-filter">
          <option value="all">Todas las escuelas</option>
          ${schools.map((school) => `<option value="${escapeHtml(school.id)}"${school.id === selectedSchoolId ? " selected" : ""}>${escapeHtml(school.label)}</option>`).join("")}
        </select>
      </label>
    </section>
    ${sourceCuts(payloads)}
    <section class="panorama-kpis" aria-label="Indicadores generales">
      ${kpi("Total de respuestas registradas", total, `${formatNumber(complete)} completas · ${formatNumber(total - complete)} incompletas`, "total")}
      ${kpi("Estudiantes", totals.students, percentCaption(totals.students, total), "students")}
      ${kpi("Docentes", totals.teachers, percentCaption(totals.teachers, total), "teachers")}
      ${kpi("Familias", totals.families, percentCaption(totals.families, total), "families")}
      ${kpi("Escuelas con respuestas", visibleSchools.filter((school) => school.total > 0).length, selectedSchool ? "en la selección actual" : "establecimientos identificados", "schools")}
    </section>
    <section class="panorama-grid panorama-grid-wide">
      ${panel("Respuestas por escuela", "Porcentaje sobre respuestas con escuela identificada", schoolBars(visibleSchools))}
      ${panel("Composición total por población", "Cantidad y porcentaje sobre el total", populationBars(totals))}
    </section>
    <section class="panorama-grid">
      ${panel("Respuestas de estudiantes por año", `${formatNumber(studentsWithYear)} con año válido · ${formatNumber(studentsWithoutYear)} sin año`, simpleBars(studentYears.map((count, index) => ({ label: `${index + 1}.º`, count })), studentsWithYear, "#a855f7"))}
      ${panel("Edad de quienes respondieron", `${formatNumber(demographics.validAges)} respuestas con edad válida`, `${ageSelector()}${simpleBars(AGE_GROUPS.map((label) => ({ label, count: demographics.ageGroups[label] })), demographics.validAges, "#22d3ee")}`)}
      ${panel("Género", `${formatNumber(genderDemographics.validGenders)} respuestas con dato válido`, `${genderSelector()}${simpleBars(genderDemographics.genders, genderDemographics.validGenders, "#f472b6")}`)}
    </section>
    ${panel("Cobertura por escuela y población", "La intensidad representa la cantidad de respuestas", coverageMatrix(visibleSchools), "panorama-full")}
    ${coverageCards(schools, selectedSchool)}
    ${selectedSchool ? "" : missingDataCards(unidentified, studentsWithoutYear)}
    ${timeline}
    <p class="panorama-footnote">Edad y género se reciben como agregados anónimos. Los porcentajes excluyen valores vacíos o inválidos.</p>
  `;

  root.querySelector<HTMLSelectElement>("#panorama-school-filter")?.addEventListener("change", (event) => {
    selectedSchoolId = (event.currentTarget as HTMLSelectElement).value;
    renderPanoramaGeneral(root, payloads);
  });
  root.querySelectorAll<HTMLButtonElement>("[data-age-scope]").forEach((button) => button.addEventListener("click", () => {
    ageScope = button.dataset.ageScope as "all" | Population;
    renderPanoramaGeneral(root, payloads);
  }));
  root.querySelectorAll<HTMLButtonElement>("[data-gender-scope]").forEach((button) => button.addEventListener("click", () => {
    genderScope = button.dataset.genderScope as "all" | Population;
    renderPanoramaGeneral(root, payloads);
  }));
}

function combineSchools(payloads: PopulationData): CombinedSchool[] {
  const combined = new Map<string, CombinedSchool>();
  for (const population of POPULATIONS) {
    for (const school of payloads[population].schools) {
      const id = schoolId(school);
      const canonicalLabel = officialSchoolName(school);
      const current = combined.get(id) ?? {
        id,
        label: canonicalLabel,
        managementType: school.managementType,
        schools: {},
        counts: { students: 0, teachers: 0, families: 0 },
        total: 0,
      };
      current.schools[population] = school;
      current.counts[population] += school.total;
      current.total += school.total;
      if (current.managementType === "unknown" && school.managementType !== "unknown") {
        current.managementType = school.managementType;
        current.label = canonicalLabel;
      }
      combined.set(id, current);
    }
  }
  return [...combined.values()].sort((left, right) => right.total - left.total || left.label.localeCompare(right.label, "es"));
}

function schoolId(school: SchoolSummary): string {
  return officialSchoolId(school);
}

function populationTotals(payloads: PopulationData, school: CombinedSchool | null): Record<Population, number> {
  return Object.fromEntries(POPULATIONS.map((population) => [
    population,
    school ? school.counts[population] : payloads[population].summary.total,
  ])) as Record<Population, number>;
}

function demographicFor(payloads: PopulationData, school: CombinedSchool | null, scope: "all" | Population): DemographicSummary {
  const result = emptyDemographics();
  const populations = scope === "all" ? POPULATIONS : [scope];
  for (const population of populations) {
    mergeDemographics(result, school ? school.schools[population]?.demographics : payloads[population].demographics);
  }
  return result;
}

function emptyDemographics(): DemographicSummary {
  return {
    validAges: 0,
    ageGroups: Object.fromEntries(AGE_GROUPS.map((group) => [group, 0])) as Record<AgeGroup, number>,
    validGenders: 0,
    genders: [],
  };
}

function mergeDemographics(target: DemographicSummary, source?: DemographicSummary): void {
  if (!source) return;
  target.validAges += source.validAges;
  for (const group of AGE_GROUPS) target.ageGroups[group] += source.ageGroups[group] ?? 0;
  target.validGenders += source.validGenders;
  for (const item of source.genders) {
    const key = fold(item.label);
    const existing = target.genders.find((candidate) => fold(candidate.label) === key);
    if (existing) existing.count += item.count;
    else target.genders.push({ ...item });
  }
  target.genders.sort((left, right) => right.count - left.count || left.label.localeCompare(right.label, "es"));
}

function studentYearCounts(payload: DashboardPayload, school: SchoolSummary | null): number[] {
  if (school) return Array.from({ length: 7 }, (_, index) => school.roles.student.years[String(index + 1)]?.total ?? 0);
  return Array.from({ length: 7 }, (_, index) => payload.monitoringRows.filter((row) => row.courseYear === index + 1).length);
}

function kpi(label: string, value: number, caption: string, kind: string): string {
  return `<article class="panorama-kpi ${kind}"><p>${label}</p><strong>${formatNumber(value)}</strong><span>${caption}</span></article>`;
}

function percentCaption(value: number, total: number): string {
  return `${formatPct(total ? value / total * 100 : 0)} del total`;
}

function panel(title: string, subtitle: string, content: string, extraClass = ""): string {
  return `<article class="panorama-panel panel ${extraClass}"><header><div><h3>${title}</h3><p>${subtitle}</p></div></header>${content}</article>`;
}

function schoolBars(schools: CombinedSchool[]): string {
  if (!schools.length) return emptyChart("No hay escuelas identificadas para esta selección.");
  const maximum = Math.max(...schools.map((school) => school.total), 1);
  const grandTotal = schools.reduce((sum, school) => sum + school.total, 0);
  return `<div class="stacked-chart">${schools.map((school) => `
    <div class="stacked-row">
      <span title="${escapeHtml(school.label)}">${escapeHtml(school.label)}</span>
      <div class="stacked-track" style="--bar-width:${school.total / maximum * 100}%" title="${escapeHtml(school.label)} · Total N=${school.total} (${formatPct(grandTotal ? school.total / grandTotal * 100 : 0)}) · Estudiantes N=${school.counts.students} (${formatPct(school.total ? school.counts.students / school.total * 100 : 0)}) · Docentes N=${school.counts.teachers} (${formatPct(school.total ? school.counts.teachers / school.total * 100 : 0)}) · Familias N=${school.counts.families} (${formatPct(school.total ? school.counts.families / school.total * 100 : 0)})">
        <i class="students" style="width:${school.total ? school.counts.students / school.total * 100 : 0}%"></i>
        <i class="teachers" style="width:${school.total ? school.counts.teachers / school.total * 100 : 0}%"></i>
        <i class="families" style="width:${school.total ? school.counts.families / school.total * 100 : 0}%"></i>
      </div><b>N=${formatNumber(school.total)}<small>${formatPct(grandTotal ? school.total / grandTotal * 100 : 0)}</small></b>
    </div>`).join("")}</div>${populationLegend()}`;
}

function populationBars(totals: Record<Population, number>): string {
  const total = POPULATIONS.reduce((sum, population) => sum + totals[population], 0);
  return `<div class="population-chart">${POPULATIONS.map((population) => {
    const pct = total ? totals[population] / total * 100 : 0;
    return `<div class="population-row"><span>${LABELS[population]}</span><div><i style="width:${pct}%;background:${COLORS[population]}"></i></div><strong>N=${formatNumber(totals[population])}<small>${formatPct(pct)}</small></strong></div>`;
  }).join("")}</div>`;
}

function simpleBars(items: Array<{ label: string; count: number }>, denominator: number, color: string): string {
  const maximum = Math.max(...items.map((item) => item.count), 1);
  if (!items.length) return emptyChart("Todavía no hay datos válidos.");
  return `<div class="simple-chart">${items.map((item) => {
    const pct = denominator ? item.count / denominator * 100 : 0;
    return `<div class="simple-row" title="${escapeHtml(item.label)} · N=${item.count} · ${formatPct(pct)}"><span>${escapeHtml(item.label)}</span><div><i style="width:${item.count / maximum * 100}%;background:${color}"></i></div><b>N=${formatNumber(item.count)}<small>${formatPct(pct)}</small></b></div>`;
  }).join("")}</div>`;
}

function ageSelector(): string {
  const choices: Array<["all" | Population, string]> = [["all", "Todos"], ["students", "Estudiantes"], ["teachers", "Docentes"], ["families", "Familias"]];
  return `<div class="age-selector" role="group" aria-label="Población para distribución de edad">${choices.map(([value, label]) => `<button type="button" data-age-scope="${value}" class="${ageScope === value ? "active" : ""}">${label}</button>`).join("")}</div>`;
}

function genderSelector(): string {
  const choices: Array<["all" | Population, string]> = [["all", "Todos"], ["students", "Estudiantes"], ["teachers", "Docentes"], ["families", "Familias"]];
  return `<div class="age-selector" role="group" aria-label="Población para distribución de género">${choices.map(([value, label]) => `<button type="button" data-gender-scope="${value}" class="${genderScope === value ? "active" : ""}">${label}</button>`).join("")}</div>`;
}

function unidentifiedSchoolCounts(payloads: PopulationData): Record<Population, number> {
  return Object.fromEntries(POPULATIONS.map((population) => {
    const identified = payloads[population].schools.reduce((sum, school) => sum + school.total, 0);
    return [population, Math.max(0, payloads[population].summary.total - identified)];
  })) as Record<Population, number>;
}

function missingDataCards(unidentified: Record<Population, number>, studentsWithoutYear: number): string {
  const total = POPULATIONS.reduce((sum, population) => sum + unidentified[population], 0);
  return `<section class="coverage-kpis missing-data-kpis">
    ${coverageKpi("Sin escuela identificada", total, "respuestas")}
    ${coverageKpi("Estudiantes sin escuela", unidentified.students, "respuestas")}
    ${coverageKpi("Docentes sin escuela", unidentified.teachers, "respuestas")}
    ${coverageKpi("Familias sin escuela", unidentified.families, "respuestas")}
    ${coverageKpi("Estudiantes sin año", studentsWithoutYear, "respuestas")}
  </section>`;
}

function coverageMatrix(schools: CombinedSchool[]): string {
  if (!schools.length) return emptyChart("No hay escuelas identificadas para esta selección.");
  const maximum = Math.max(...schools.flatMap((school) => POPULATIONS.map((population) => school.counts[population])), 1);
  return `<div class="coverage-wrap"><table class="coverage-table"><thead><tr><th>Escuela</th>${POPULATIONS.map((population) => `<th>${LABELS[population]}</th>`).join("")}</tr></thead><tbody>${schools.map((school) => `<tr><th>${escapeHtml(school.label)}</th>${POPULATIONS.map((population) => {
    const count = school.counts[population];
    const intensity = .08 + count / maximum * .72;
    const pct = school.total ? count / school.total * 100 : 0;
    return `<td title="${escapeHtml(school.label)} · ${LABELS[population]}: N=${count} · ${formatPct(pct)}" style="--heat:${intensity}"><b>N=${formatNumber(count)}</b><small>${formatPct(pct)}</small></td>`;
  }).join("")}</tr>`).join("")}</tbody></table></div>`;
}

function coverageCards(schools: CombinedSchool[], selectedSchool: CombinedSchool | null): string {
  const source = selectedSchool ? [selectedSchool] : schools;
  const counts = Object.fromEntries(POPULATIONS.map((population) => [population, source.filter((school) => school.counts[population] > 0).length])) as Record<Population, number>;
  const complete = source.filter((school) => POPULATIONS.every((population) => school.counts[population] > 0)).length;
  return `<section class="coverage-kpis">
    ${coverageKpi("Con estudiantes", counts.students, "escuelas")}
    ${coverageKpi("Con docentes", counts.teachers, "escuelas")}
    ${coverageKpi("Con familias", counts.families, "escuelas")}
    ${coverageKpi("Con las tres poblaciones", complete, "Estudiantes + docentes + familias")}
  </section>`;
}

function coverageKpi(label: string, value: number, caption: string): string {
  return `<article><p>${label}</p><strong>${formatNumber(value)}</strong><span>${caption}</span></article>`;
}

function timelineMarkup(payloads: PopulationData, school: CombinedSchool | null): string {
  const datesByPopulation = Object.fromEntries(POPULATIONS.map((population) => [population, filteredDates(payloads[population], school?.schools[population] ?? null)])) as Record<Population, string[]>;
  const model = buildTimelineModel(datesByPopulation);
  if (!model) return "";
  const width = 960;
  const height = 300;
  const plot = { left: 58, right: 14, top: 12, bottom: 258 };
  const point = (value: number, index: number) => {
    const x = model.epochs.length === 1 ? (plot.left + width - plot.right) / 2
      : plot.left + (model.epochs[index] - model.startEpoch) / (model.endEpoch - model.startEpoch) * (width - plot.left - plot.right);
    const y = plot.bottom - value / model.maximum * (plot.bottom - plot.top);
    return { x, y };
  };
  const series: Array<{ label: string; color: string; values: number[] }> = [
    { label: "Total", color: "#f4f6fa", values: model.total },
    ...POPULATIONS.map((population) => ({ label: LABELS[population], color: COLORS[population], values: model.cumulative[population] })),
  ];
  const yTicks = [...new Set([0, .25, .5, .75, 1].map((ratio) => Math.round(model.maximum * ratio)))].map((value) => {
    const y = point(value, 0).y;
    return `<line x1="${plot.left}" x2="${width - plot.right}" y1="${y}" y2="${y}"/><text x="${plot.left - 9}" y="${y + 4}" text-anchor="end">${formatNumber(value)}</text>`;
  }).join("");
  const xTicks = timelineTicks(model.startEpoch, model.endEpoch, 6).map((tick) => {
    const x = model.startEpoch === model.endEpoch ? (plot.left + width - plot.right) / 2
      : plot.left + (tick.epoch - model.startEpoch) / (model.endEpoch - model.startEpoch) * (width - plot.left - plot.right);
    return `<line class="timeline-x-grid" x1="${x}" x2="${x}" y1="${plot.top}" y2="${plot.bottom}"/><text x="${x}" y="${plot.bottom + 25}" text-anchor="middle">${formatDate(tick.date)}</text>`;
  }).join("");
  const chart = `<div class="timeline-chart"><svg viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="timeline-title timeline-desc"><title id="timeline-title">Evolución acumulada de respuestas</title><desc id="timeline-desc">Escala horizontal proporcional a los días transcurridos. Las líneas avanzan por escalones en las fechas con nuevas respuestas.</desc>${yTicks}${xTicks}${series.map((item) => {
    const points = item.values.map((value, index) => point(value, index));
    return `<path d="${timelinePath(points)}" style="stroke:${item.color}"/>${item.values.map((value, index) => `<circle cx="${points[index].x}" cy="${points[index].y}" r="3" style="fill:${item.color}"><title>${item.label} · ${formatDate(model.dates[index])}: N=${value} · ${formatPct(model.total[index] ? value / model.total[index] * 100 : 0)}</title></circle>`).join("")}`;
  }).join("")}</svg></div><div class="timeline-legend"><span class="total">Total · N=${formatNumber(model.total.at(-1) ?? 0)} · 100,0 %</span>${POPULATIONS.map((population) => `<span style="--legend:${COLORS[population]}">${LABELS[population]} · N=${formatNumber(model.cumulative[population].at(-1) ?? 0)} · ${formatPct((model.total.at(-1) ?? 0) ? (model.cumulative[population].at(-1) ?? 0) / (model.total.at(-1) ?? 1) * 100 : 0)}</span>`).join("")}</div>`;
  return panel("Evolución temporal del relevamiento", "Cantidad acumulada de respuestas con fecha válida · escala proporcional al tiempo", chart, "panorama-full");
}

function sourceCuts(payloads: PopulationData): string {
  return `<section class="source-cuts" aria-label="Fecha de los datos por población">${POPULATIONS.map((population) => {
    const generatedAt = payloads[population].generatedAt;
    const stale = isDataStale(generatedAt);
    return `<article class="${stale ? "stale" : ""}"><span>${LABELS[population]}</span><strong>${formatCutDate(generatedAt)}</strong><small>hace ${formatDataAge(generatedAt)}</small></article>`;
  }).join("")}</section>`;
}

function freshnessBanner(payloads: PopulationData): string {
  const stale = POPULATIONS.filter((population) => isDataStale(payloads[population].generatedAt));
  if (!stale.length) return "";
  return `<div class="warning freshness-warning">Datos desactualizados durante el horario operativo: ${stale.map((population) => LABELS[population]).join(", ")}. Se muestra el último corte disponible.</div>`;
}

function filteredDates(payload: DashboardPayload, school: SchoolSummary | null): string[] {
  return payload.monitoringRows.filter((row) => /^\d{4}-\d{2}-\d{2}$/.test(row.date) && (!school || rowMatchesSchool(row.resolvedSchool, row.managementType, school, row.inSanMartin))).map((row) => row.date);
}

function rowMatchesSchool(label: string, managementType: ManagementType, school: SchoolSummary, inSanMartin?: boolean | null): boolean {
  return officialSchoolId({ school: label, schoolNumber: null, managementType, inSanMartin }) === schoolId(school);
}

function populationLegend(): string {
  return `<div class="population-legend">${POPULATIONS.map((population) => `<span style="--legend:${COLORS[population]}">${LABELS[population]}</span>`).join("")}</div>`;
}

function emptyChart(message: string): string {
  return `<p class="panorama-empty">${message}</p>`;
}

function fold(value: string): string {
  return value.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase("es-AR").replace(/[^a-z0-9]+/g, " ").trim();
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("es-AR").format(value);
}

function formatPct(value: number): string {
  return `${new Intl.NumberFormat("es-AR", { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(value)} %`;
}

function formatDate(value: string): string {
  const [year, month, day] = value.split("-");
  return `${day}/${month}/${year}`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character] ?? character);
}
