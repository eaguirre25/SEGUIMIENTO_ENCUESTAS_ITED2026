import type { AgeGroup, DashboardPayload, DemographicSummary, ManagementType, SchoolSummary } from "./types";

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
  const allDemographics = demographicFor(payloads, selectedSchool, "all");
  const studentYears = studentYearCounts(payloads.students, selectedSchool?.schools.students ?? null);
  const timeline = timelineMarkup(payloads, selectedSchool);

  root.innerHTML = `
    <div id="panorama-warning-slot"></div>
    <section class="panorama-heading">
      <div><p class="eyebrow">SÍNTESIS TRANSVERSAL</p><h2>Panorama general de la encuesta</h2><p>Cobertura, composición y avance de Estudiantes, Docentes y Familias.</p></div>
      <label class="panorama-filter">Escuela
        <select id="panorama-school-filter">
          <option value="all">Todas las escuelas</option>
          ${schools.map((school) => `<option value="${escapeHtml(school.id)}"${school.id === selectedSchoolId ? " selected" : ""}>${escapeHtml(school.label)}</option>`).join("")}
        </select>
      </label>
    </section>
    <section class="panorama-kpis" aria-label="Indicadores generales">
      ${kpi("Total de encuestas realizadas", total, `${formatNumber(complete)} completas · ${formatNumber(total - complete)} incompletas`, "total")}
      ${kpi("Estudiantes", totals.students, percentCaption(totals.students, total), "students")}
      ${kpi("Docentes", totals.teachers, percentCaption(totals.teachers, total), "teachers")}
      ${kpi("Familias", totals.families, percentCaption(totals.families, total), "families")}
      ${kpi("Escuelas con respuestas", visibleSchools.filter((school) => school.total > 0).length, selectedSchool ? "en la selección actual" : "establecimientos identificados", "schools")}
    </section>
    <section class="panorama-grid panorama-grid-wide">
      ${panel("Encuestas por escuela", "Total y composición por población", schoolBars(visibleSchools))}
      ${panel("Composición total por población", "Cantidad y porcentaje sobre el total", populationBars(totals))}
    </section>
    <section class="panorama-grid">
      ${panel("Encuestas de estudiantes por año", "Respuestas capturadas · orden de 1.º a 7.º", simpleBars(studentYears.map((count, index) => ({ label: `${index + 1}.º`, count })), totals.students, "#a855f7"))}
      ${panel("Edad de quienes respondieron", `${formatNumber(demographics.validAges)} respuestas con edad válida`, `${ageSelector()}${simpleBars(AGE_GROUPS.map((label) => ({ label, count: demographics.ageGroups[label] })), demographics.validAges, "#22d3ee")}`)}
      ${panel("Género", `${formatNumber(allDemographics.validGenders)} respuestas con dato válido`, simpleBars(allDemographics.genders, allDemographics.validGenders, "#f472b6"))}
    </section>
    ${panel("Cobertura por escuela y población", "La intensidad representa la cantidad de respuestas", coverageMatrix(visibleSchools), "panorama-full")}
    ${coverageCards(schools, selectedSchool)}
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
}

function combineSchools(payloads: PopulationData): CombinedSchool[] {
  const combined = new Map<string, CombinedSchool>();
  for (const population of POPULATIONS) {
    for (const school of payloads[population].schools) {
      const id = schoolId(school);
      const isEps47 = id === "state:47" || id === "institution:eps-47-408" || school.schoolNumber === 47 || fold(school.school) === "eps 408 es47";
      const canonicalLabel = isEps47 ? "EPS 408 (ES47)" : school.school;
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
      if (isEps47) {
        current.label = "EPS 408 (ES47)";
      } else if (school.managementType === "state" && current.managementType !== "state") {
        current.label = school.school;
        current.managementType = "state";
      }
      combined.set(id, current);
    }
  }
  return [...combined.values()].sort((left, right) => right.total - left.total || left.label.localeCompare(right.label, "es"));
}

function schoolId(school: SchoolSummary): string {
  const f = fold(school.school);
  if (school.schoolNumber === 47 || f === "eps 408 es47" || f === "eps 47 408" || f === "ees 47 408" || f === "ees47 408" || f === "ees 47") return "state:47";
  if (school.schoolNumber !== null) return `state:${school.schoolNumber}`;
  return `${school.managementType}:${fold(school.school)}`;
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
    ${coverageKpi("Cobertura completa", complete, "Estudiantes + docentes + familias")}
  </section>`;
}

function coverageKpi(label: string, value: number, caption: string): string {
  return `<article><p>${label}</p><strong>${formatNumber(value)}</strong><span>${caption}</span></article>`;
}

function timelineMarkup(payloads: PopulationData, school: CombinedSchool | null): string {
  const datesByPopulation = Object.fromEntries(POPULATIONS.map((population) => [population, filteredDates(payloads[population], school?.schools[population] ?? null)])) as Record<Population, string[]>;
  const dates = [...new Set(POPULATIONS.flatMap((population) => datesByPopulation[population]))].sort();
  if (!dates.length) return "";
  const cumulative = Object.fromEntries(POPULATIONS.map((population) => {
    const frequencies = new Map<string, number>();
    for (const date of datesByPopulation[population]) frequencies.set(date, (frequencies.get(date) ?? 0) + 1);
    let running = 0;
    return [population, dates.map((date) => (running += frequencies.get(date) ?? 0))];
  })) as Record<Population, number[]>;
  const totalSeries = dates.map((_, index) => POPULATIONS.reduce((sum, population) => sum + cumulative[population][index], 0));
  const maximum = Math.max(...totalSeries, 1);
  const width = 960;
  const height = 260;
  const point = (value: number, index: number) => `${dates.length === 1 ? width / 2 : index / (dates.length - 1) * width},${height - value / maximum * (height - 20)}`;
  const series: Array<{ label: string; color: string; values: number[] }> = [
    { label: "Total", color: "#f4f6fa", values: totalSeries },
    ...POPULATIONS.map((population) => ({ label: LABELS[population], color: COLORS[population], values: cumulative[population] })),
  ];
  const chart = `<div class="timeline-chart"><svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Evolución acumulada de respuestas">${[0, .25, .5, .75, 1].map((ratio) => `<line x1="0" x2="${width}" y1="${height - ratio * (height - 20)}" y2="${height - ratio * (height - 20)}"/>`).join("")}${series.map((item) => `<polyline points="${item.values.map(point).join(" ")}" style="stroke:${item.color}"/>${item.values.map((value, index) => `<circle cx="${point(value, index).split(",")[0]}" cy="${point(value, index).split(",")[1]}" r="3" style="fill:${item.color}"><title>${item.label} · ${formatDate(dates[index])}: N=${value} · ${formatPct(totalSeries[index] ? value / totalSeries[index] * 100 : 0)}</title></circle>`).join("")}`).join("")}</svg><div class="timeline-axis"><span>${formatDate(dates[0])}</span><span>${formatDate(dates.at(-1) ?? dates[0])}</span></div></div><div class="timeline-legend"><span class="total">Total · N=${formatNumber(totalSeries.at(-1) ?? 0)} · 100,0 %</span>${POPULATIONS.map((population) => `<span style="--legend:${COLORS[population]}">${LABELS[population]} · N=${formatNumber(cumulative[population].at(-1) ?? 0)} · ${formatPct((totalSeries.at(-1) ?? 0) ? (cumulative[population].at(-1) ?? 0) / (totalSeries.at(-1) ?? 1) * 100 : 0)}</span>`).join("")}</div>`;
  return panel("Evolución temporal del relevamiento", "Cantidad acumulada de respuestas con fecha válida", chart, "panorama-full");
}

function filteredDates(payload: DashboardPayload, school: SchoolSummary | null): string[] {
  return payload.monitoringRows.filter((row) => /^\d{4}-\d{2}-\d{2}$/.test(row.date) && (!school || rowMatchesSchool(row.school, row.managementType, school))).map((row) => row.date);
}

function rowMatchesSchool(label: string, managementType: ManagementType, school: SchoolSummary): boolean {
  const sf = fold(school.school);
  if (sf === "eps 408 es47" || sf === "eps 47 408" || sf === "ees 47 408" || sf === "ees47 408" || sf === "ees 47") {
    const lf = fold(label);
    return /408/.test(lf) || /^eps(?: |$)/.test(lf) || /^(?:ees|es|media)? ?47(?: |$)/.test(lf) || /^escuela (?:profesional|secundaria)/.test(lf);
  }
  if (school.schoolNumber !== null) return managementType === "state" && singleSchoolNumber(label) === school.schoolNumber;
  return managementType === school.managementType && fold(label) === fold(school.school);
}

function singleSchoolNumber(value: string): number | null {
  const matches = value.match(/\d+/g);
  if (!matches || matches.length !== 1) return null;
  const number = Number(matches[0]);
  return number >= 1 && number <= 99 ? number : null;
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
