import { canonicalizePayload } from "./payload";
import { formatDataAge, isDataStale } from "./freshness";
import { loadPopulationTarget, savePopulationTarget } from "./targets";
import { officialSchoolId, officialSchoolName, schoolLocation, type SchoolLocation } from "./school-catalog";
import type { GeoJSONSource, Map as MapLibreMap, MapLayerMouseEvent, Marker as MapLibreMarker } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import "./style.css";
import "./panorama.css";
import demoData from "./data/demo.json";
import unsamLogoUrl from "./assets/unsam_logo_3d.png";
import type { DashboardPayload, ManagementType, SchoolSummary } from "./types";
import { renderPanoramaGeneral } from "./panorama";

const REFRESH_MS = 60_000;
const DATA_MODE = import.meta.env.VITE_DATA_MODE ?? "api";
const API_BASE = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/$/, "");
const COLORS = [
  "#A855F7", "#22D3EE", "#34D399", "#FB923C", "#FACC15", "#F472B6", "#60A5FA",
  "#E879F9", "#2DD4BF", "#A3E635", "#FDBA74", "#FDE047", "#FB7185", "#818CF8",
  "#C084FC", "#67E8F9", "#6EE7B7", "#F59E0B", "#D9F99D", "#FDA4AF", "#93C5FD", "#F0ABFC",
];

let data: DashboardPayload | null = null;
let studentData: DashboardPayload | null = null;
let teacherData: DashboardPayload | null = null;
let familyData: DashboardPayload | null = null;
let activePopulation: Population = "students";
let activeSection: "panorama" | "population" = "panorama";
let activeDashboardView: DashboardView = "tracking";
let lastSuccessfulFetch = 0;
let warning = "";
let maplibreModule: typeof import("maplibre-gl") | null = null;
let map: MapLibreMap | null = null;
let mapLoaded = false;
let schoolMarkers: MapLibreMarker[] = [];
let authHeader = sessionStorage.getItem("dashboard-authorization") ?? "";
let mapMode: "points" | "heatmap" = "points";
let showThreads = true;
let filtersInitialized = false;
const selectedSchoolIds = new Set<string>();

type Population = "students" | "teachers" | "families";
type DashboardView = "tracking" | "map" | "monitoring";
type MonitoringRow = DashboardPayload["monitoringRows"][number];
type MonitoringSortKey = "date" | "time" | "school" | "schoolIdentifier" | "resolvedSchool" | "role" | "managementType" | "courseYear" | "inSanMartin" | "complete" | "requiredCompletionPct";

const POPULATION_LABELS: Record<Population, string> = {
  students: "ESTUDIANTES",
  teachers: "DOCENTES",
  families: "FAMILIAS",
};
let monitoringSort: { key: MonitoringSortKey; direction: "asc" | "desc" } = { key: "date", direction: "desc" };

interface ResolvedMapPoint {
  schoolId: string;
  school: string;
  managementType: ManagementType;
  complete: boolean;
  lat: number;
  lon: number;
  color: string;
  location: SchoolLocation | null;
}

class AuthenticationError extends Error {}

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("No se encontró #app");
document.body.dataset.population = activePopulation;
document.body.dataset.section = activeSection;

app.innerHTML = `
  <header class="topbar">
    <div class="brand"><span class="brand-mark"></span><div><p id="brand-survey-label">ITED 2026 · PANORAMA GENERAL DE LA ENCUESTA</p><h1>Seguimiento del trabajo de campo</h1></div><img class="header-logo" src="${unsamLogoUrl}" alt="Logo UNSAM"></div>
    <div class="top-actions"><div class="sync"><span class="pulse"></span><span id="sync-label">Iniciando enlace…</span></div><button id="logout" class="logout hidden" type="button">Cerrar sesión</button></div>
  </header>
  <section class="population-bar" aria-labelledby="population-title">
    <span id="population-title">Vista</span>
    <div class="population-switcher" role="group" aria-label="Población de la encuesta">
      <button id="panorama-button" class="population-button active" type="button">Panorama general</button>
      <button class="population-button" data-population="students" type="button">Estudiantes <b id="students-count">0</b></button>
      <button class="population-button" data-population="teachers" type="button">Docentes <b id="teachers-count">0</b></button>
      <button class="population-button" data-population="families" type="button">Familias <b id="families-count">0</b></button>
    </div>
  </section>
  <nav id="population-tabs" class="tabs hidden" aria-label="Vistas del panel">
    <button class="tab active" data-tab="tracking">Seguimiento</button>
    <button class="tab" data-tab="map">Mapa <span id="map-count" class="tab-count">0</span></button>
    <button class="tab" data-tab="monitoring">Monitoreo de carga <span id="monitoring-count" class="tab-count">0</span></button>
  </nav>
  <main>
    <section id="panorama-view" class="view"><div class="loading">Conectando con la fuente de datos…</div></section>
    <section id="tracking-view" class="view hidden"><div id="warning-slot"></div><div class="loading">Conectando con la fuente de datos…</div></section>
    <section id="map-view" class="view hidden">
      <div class="map-shell">
        <aside class="map-legend"><div><p class="eyebrow">FILTROS DE ESCUELAS</p><h2>Escuelas encuestadas</h2><p id="legend-summary" class="legend-summary"></p></div><div id="legend-items"></div></aside>
        <div class="map-stage">
          <div class="map-toolbar"><button id="points-mode" class="map-tool active" type="button">Matrícula</button><button id="heatmap-mode" class="map-tool" type="button">Mapa de calor</button><button id="threads-toggle" class="map-tool active" type="button">Hilos</button></div>
          <div id="map-status" class="map-status"></div>
          <div id="map"></div>
        </div>
      </div>
    </section>
    <section id="monitoring-view" class="view hidden"></section>
  </main>
  <div id="auth-overlay" class="auth-overlay hidden">
    <form id="login-form" class="login-card">
      <img class="login-logo" src="${unsamLogoUrl}" alt="Logo UNSAM" />
      <p class="eyebrow">ACCESO RESTRINGIDO</p>
      <h2>Seguimiento ITED 2026</h2>
      <p>Ingresá tus credenciales para visualizar respuestas y ubicaciones.</p>
      <label>Usuario<input id="login-username" name="username" autocomplete="username" value="${escapeHtml(localStorage.getItem("dashboard-username") ?? "")}" required></label>
      <label>Contraseña<input id="login-password" name="password" type="password" autocomplete="current-password" required></label>
      <label class="remember-option"><input id="login-remember" type="checkbox" ${localStorage.getItem("dashboard-username") ? "checked" : ""}><span>Recordar solamente mi usuario</span></label>
      <p id="login-error" class="login-error" role="alert"></p>
      <button type="submit">Ingresar</button>
    </form>
  </div>
  <dialog id="school-modal" class="school-modal" aria-labelledby="school-modal-title">
    <div class="school-modal-shell">
      <button id="school-modal-close" class="school-modal-close" type="button" aria-label="Cerrar detalle">×</button>
      <div id="school-modal-content"></div>
    </div>
  </dialog>
`;

app.querySelectorAll<HTMLButtonElement>(".tab").forEach((button) => {
  button.addEventListener("click", () => switchTab((button.dataset.tab as DashboardView) ?? "tracking"));
});
app.querySelectorAll<HTMLButtonElement>(".population-button").forEach((button) => {
  if (button.dataset.population) button.addEventListener("click", () => selectPopulation(button.dataset.population as Population));
});
document.querySelector<HTMLButtonElement>("#panorama-button")?.addEventListener("click", selectPanorama);
document.querySelector<HTMLFormElement>("#login-form")?.addEventListener("submit", handleLogin);
document.querySelector<HTMLButtonElement>("#logout")?.addEventListener("click", logout);
document.querySelector<HTMLButtonElement>("#points-mode")?.addEventListener("click", () => setMapMode("points"));
document.querySelector<HTMLButtonElement>("#heatmap-mode")?.addEventListener("click", () => setMapMode("heatmap"));
document.querySelector<HTMLButtonElement>("#threads-toggle")?.addEventListener("click", toggleThreads);
document.querySelector<HTMLButtonElement>("#school-modal-close")?.addEventListener("click", closeSchoolModal);
document.querySelector<HTMLDialogElement>("#school-modal")?.addEventListener("click", (event) => {
  if (event.target === event.currentTarget) closeSchoolModal();
});

void refresh();
setInterval(() => void refresh(), REFRESH_MS);
setInterval(updateSyncLabel, 1_000);

async function refresh(): Promise<void> {
  if (DATA_MODE !== "demo" && !authHeader) {
    showLogin();
    return;
  }
  try {
    const [studentRaw, teacherRaw, familyRaw] = DATA_MODE === "demo"
      ? [demoPayload(), emptyPayload(), emptyPayload()]
      : await Promise.all([fetchApi("students"), fetchApi("teachers"), fetchApi("families")]);
    const students = canonicalizePayload(studentRaw);
    const teachers = canonicalizePayload(teacherRaw);
    const families = canonicalizePayload(familyRaw);
    validatePayload(students);
    validatePayload(teachers);
    validatePayload(families);
    studentData = students;
    teacherData = teachers;
    familyData = families;
    data = payloadForPopulation(activePopulation);
    lastSuccessfulFetch = Date.now();
    warning = "";
    hideLogin();
    render();
  } catch (error) {
    if (error instanceof AuthenticationError) {
      authHeader = "";
      sessionStorage.removeItem("dashboard-authorization");
      showLogin("Usuario o contraseña incorrectos.");
      return;
    }
    warning = error instanceof Error ? error.message : "No se pudo actualizar";
    renderWarning();
  }
}

function demoPayload(): DashboardPayload {
  const demo = structuredClone(demoData) as Omit<DashboardPayload, "demographics">;
  return { ...demo, demographics: emptyDemographics(), generatedAt: new Date().toISOString() };
}

async function fetchApi(population: Population = "students"): Promise<DashboardPayload> {
  if (!API_BASE) throw new Error("El Worker de LimeSurvey todavía no está configurado");
  const response = await fetch(`${API_BASE}/api/dashboard?population=${population}`, {
    headers: { Accept: "application/json", Authorization: authHeader },
  });
  if (response.status === 401) throw new AuthenticationError("Credenciales inválidas");
  if (!response.ok) throw new Error(`Actualización interrumpida (HTTP ${response.status})`);
  return response.json() as Promise<DashboardPayload>;
}

async function handleLogin(event: SubmitEvent): Promise<void> {
  event.preventDefault();
  const username = document.querySelector<HTMLInputElement>("#login-username")?.value ?? "";
  const password = document.querySelector<HTMLInputElement>("#login-password")?.value ?? "";
  const remember = document.querySelector<HTMLInputElement>("#login-remember")?.checked ?? false;
  authHeader = `Basic ${encodeCredentials(username, password)}`;
  const submit = document.querySelector<HTMLButtonElement>("#login-form button[type='submit']");
  if (submit) { submit.disabled = true; submit.textContent = "Verificando…"; }
  try {
    const [studentRaw, teacherRaw, familyRaw] = await Promise.all([
      fetchApi("students"),
      fetchApi("teachers"),
      fetchApi("families"),
    ]);
    const students = canonicalizePayload(studentRaw);
    const teachers = canonicalizePayload(teacherRaw);
    const families = canonicalizePayload(familyRaw);
    validatePayload(students);
    validatePayload(teachers);
    validatePayload(families);
    studentData = students;
    teacherData = teachers;
    familyData = families;
    data = payloadForPopulation(activePopulation);
    lastSuccessfulFetch = Date.now();
    warning = "";
    sessionStorage.setItem("dashboard-authorization", authHeader);
    if (remember) {
      localStorage.setItem("dashboard-username", username);
    } else {
      localStorage.removeItem("dashboard-username");
    }
    hideLogin();
    render();
  } catch (error) {
    authHeader = "";
    sessionStorage.removeItem("dashboard-authorization");
    showLogin(error instanceof AuthenticationError ? "Usuario o contraseña incorrectos." : "No se pudo validar el acceso.");
  } finally {
    if (submit) { submit.disabled = false; submit.textContent = "Ingresar"; }
  }
}

function encodeCredentials(username: string, password: string): string {
  const bytes = new TextEncoder().encode(`${username}:${password}`);
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary);
}

function showLogin(message = ""): void {
  document.querySelector("#auth-overlay")?.classList.remove("hidden");
  document.querySelector("#logout")?.classList.add("hidden");
  document.body.classList.add("auth-locked");
  const error = document.querySelector<HTMLElement>("#login-error");
  if (error) error.textContent = message;
}

function hideLogin(): void {
  document.querySelector("#auth-overlay")?.classList.add("hidden");
  document.querySelector("#logout")?.classList.remove("hidden");
  document.body.classList.remove("auth-locked");
}

function logout(): void {
  authHeader = "";
  data = null;
  studentData = null;
  teacherData = null;
  familyData = null;
  sessionStorage.removeItem("dashboard-authorization");
  showLogin();
}

function validatePayload(payload: DashboardPayload): void {
  if (!payload?.summary || !payload.demographics || !Array.isArray(payload.demographics.genders) || !Array.isArray(payload.schools) || !Array.isArray(payload.mapPoints) || !Array.isArray(payload.monitoringRows)) {
    throw new Error("El endpoint devolvió un formato inesperado");
  }
  if (payload.summary.complete + payload.summary.incomplete !== payload.summary.total) {
    throw new Error("Los totales del endpoint son inconsistentes");
  }
  if (payload.monitoringRows.length !== payload.summary.total) {
    throw new Error("El monitoreo de carga no coincide con el total de respuestas");
  }
}

function payloadForPopulation(population: Population): DashboardPayload | null {
  if (population === "students") return studentData;
  if (population === "teachers") return teacherData;
  return familyData;
}

function emptyPayload(): DashboardPayload {
  return {
    generatedAt: studentData?.generatedAt ?? new Date().toISOString(),
    surveyId: "",
    summary: { total: 0, complete: 0, incomplete: 0, completePct: 0 },
    demographics: emptyDemographics(),
    schools: [],
    mapPoints: [],
    monitoringRows: [],
  };
}

function emptyDemographics(): DashboardPayload["demographics"] {
  return {
    validAges: 0,
    ageGroups: { "Hasta 15": 0, "16–18": 0, "19–29": 0, "30–39": 0, "40–49": 0, "50–59": 0, "60 o más": 0 },
    validGenders: 0,
    genders: [],
  };
}

function selectPanorama(): void {
  if (activeSection === "panorama") return;
  activeSection = "panorama";
  document.body.dataset.section = "panorama";
  document.querySelector("#panorama-button")?.classList.add("active");
  document.querySelectorAll<HTMLButtonElement>("[data-population]").forEach((button) => {
    button.classList.remove("active");
    button.setAttribute("aria-pressed", "false");
  });
  document.querySelector("#population-tabs")?.classList.add("hidden");
  document.querySelectorAll("#tracking-view, #map-view, #monitoring-view").forEach((view) => view.classList.add("hidden"));
  document.querySelector("#panorama-view")?.classList.remove("hidden");
  const brandLabel = document.querySelector<HTMLElement>("#brand-survey-label");
  if (brandLabel) brandLabel.textContent = "ITED 2026 · PANORAMA GENERAL DE LA ENCUESTA";
  closeSchoolModal();
  render();
}

function selectPopulation(population: Population): void {
  if (!POPULATION_LABELS[population] || (activeSection === "population" && activePopulation === population)) return;
  activeSection = "population";
  activePopulation = population;
  document.body.dataset.population = population;
  document.body.dataset.section = "population";
  data = payloadForPopulation(population);
  filtersInitialized = false;
  selectedSchoolIds.clear();
  document.querySelectorAll<HTMLButtonElement>(".population-button").forEach((button) => {
    const selected = button.dataset.population === population;
    button.classList.toggle("active", selected);
    button.setAttribute("aria-pressed", String(selected));
  });
  document.querySelector("#panorama-button")?.classList.remove("active");
  document.querySelector("#population-tabs")?.classList.remove("hidden");
  document.querySelector("#panorama-view")?.classList.add("hidden");
  const brandLabel = document.querySelector<HTMLElement>("#brand-survey-label");
  if (brandLabel) brandLabel.textContent = `ITED 2026 · ENCUESTA A ${POPULATION_LABELS[population]}`;
  const pointsMode = document.querySelector<HTMLElement>("#points-mode");
  if (pointsMode) pointsMode.textContent = population === "students" ? "Matrícula" : "Respuestas";
  const mapTab = document.querySelector<HTMLButtonElement>('[data-tab="map"]');
  mapTab?.classList.toggle("hidden", population !== "students");
  if (population !== "students" && activeDashboardView === "map") activeDashboardView = "tracking";
  switchTab(activeDashboardView);
  closeSchoolModal();
  render();
}

function render(): void {
  if (!data) return;
  const studentsCount = document.querySelector<HTMLElement>("#students-count");
  if (studentsCount) studentsCount.textContent = String(studentData?.summary.total ?? 0);
  const teachersCount = document.querySelector<HTMLElement>("#teachers-count");
  if (teachersCount) teachersCount.textContent = String(teacherData?.summary.total ?? 0);
  const familiesCount = document.querySelector<HTMLElement>("#families-count");
  if (familiesCount) familiesCount.textContent = String(familyData?.summary.total ?? 0);
  if (activeSection === "panorama" && studentData && teacherData && familyData) {
    const panorama = document.querySelector<HTMLElement>("#panorama-view");
    if (panorama) renderPanoramaGeneral(panorama, { students: studentData, teachers: teacherData, families: familyData });
    updateSyncLabel();
    return;
  }
  initializeFilters();
  const target = loadPopulationTarget(localStorage, activePopulation);
  const progress = Math.min((data.summary.total / target) * 100, 100);
  const tracking = document.querySelector<HTMLElement>("#tracking-view");
  if (!tracking) return;
  tracking.innerHTML = `
    <div id="warning-slot">${warningMarkup()}${freshnessWarningMarkup(data)}</div>
    <section class="hero-grid">
      <article class="vessel-card panel">
        <div class="section-heading"><div><p class="eyebrow">AVANCE DE CAMPO</p><h2>Recipiente de respuestas</h2></div><span class="live-badge">EN CURSO</span></div>
        <div class="vessel-layout">
          ${vesselSvg(progress)}
          <div class="vessel-copy">
            <p class="big-progress"><strong>${formatNumber(data.summary.total)}</strong><span>/ ${formatNumber(target)}</span></p>
            <p class="progress-pct">${formatPct((data.summary.total / target) * 100)}</p>
            <p class="muted">respuestas capturadas · incluye completas e incompletas</p>
            <label for="target">Meta de ${POPULATION_LABELS[activePopulation].toLocaleLowerCase("es-AR")}</label>
            <div class="target-control"><input id="target" type="number" min="1" step="50" value="${target}"><button id="save-target">Aplicar</button></div>
          </div>
        </div>
      </article>
      <section class="metrics" aria-label="Indicadores generales">
        ${metric("Respuestas registradas", data.summary.total, "violet", "↗")}
        ${metric("Completas", data.summary.complete, "green", "✓")}
        ${metric("Incompletas", data.summary.incomplete, "orange", "◒")}
        ${metric("Completitud", formatPct(data.summary.completePct), "cyan", "≈")}
        ${metric("Escuelas con encuestas aplicadas", data.schools.length, "pink", "⌂")}
        ${metric(isDataStale(data.generatedAt) ? "Último corte · desactualizado" : "Corte de LimeSurvey", formatDateTime(data.generatedAt), "blue", "◷")}
      </section>
    </section>
    <section class="schools-panel panel">
      <div class="section-heading school-title"><div><p class="eyebrow">COMPOSICIÓN DE LA MUESTRA</p><h2>Seguimiento por escuela</h2></div><span>${data.schools.length} establecimientos</span></div>
      <div class="table-head"><span>Escuela</span><span>Total</span><span>Completas</span><span>Incompletas</span><span>% completas</span><span></span></div>
      <div class="school-list">${data.schools.map(schoolRow).join("")}</div>
    </section>
  `;
  tracking.querySelector<HTMLButtonElement>("#save-target")?.addEventListener("click", saveTarget);
  tracking.querySelectorAll<HTMLButtonElement>(".school-summary").forEach((button) => button.addEventListener("click", () => {
    const id = button.dataset.schoolId;
    if (id) openSchoolModal(id);
  }));
  document.querySelector<HTMLElement>("#map-count")!.textContent = String(data.mapPoints.length);
  document.querySelector<HTMLElement>("#monitoring-count")!.textContent = String(data.monitoringRows.length);
  renderMonitoring();
  renderLegend();
  renderMapStatus();
  if (mapLoaded) updateMap();
  updateSyncLabel();
}

function vesselSvg(progress: number): string {
  const y = 220 - progress * 1.8;
  const nearGoal = progress >= 85 ? " near-goal" : "";
  return `<div class="vessel${nearGoal}">
    <svg viewBox="0 0 180 260" role="img" aria-label="Avance ${formatPct(progress)}">
      <defs>
        <linearGradient id="liquid" x1="0" y1="1" x2="1" y2="0"><stop stop-color="#6D28D9"/><stop offset=".52" stop-color="#A855F7"/><stop offset="1" stop-color="#22D3EE"/></linearGradient>
        <filter id="glow"><feGaussianBlur stdDeviation="5" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
        <clipPath id="tank"><path d="M34 20h112v188c0 25-20 45-45 45H79c-25 0-45-20-45-45z"/></clipPath>
      </defs>
      <g class="marks">${[25, 50, 75, 100].map((mark) => `<path d="M149 ${220 - mark * 1.8}h9"/><text x="162" y="${224 - mark * 1.8}">${mark}%</text>`).join("")}</g>
      <g clip-path="url(#tank)"><rect class="liquid" x="31" y="${y}" width="118" height="240" fill="url(#liquid)"/>
        <path class="wave wave-a" d="M20 ${y} Q45 ${y - 8} 70 ${y} T120 ${y} T170 ${y}"/><path class="wave wave-b" d="M15 ${y + 6} Q45 ${y + 14} 75 ${y + 6} T135 ${y + 6} T190 ${y + 6}"/>
      </g>
      <path class="tank-outline" d="M34 20h112v188c0 25-20 45-45 45H79c-25 0-45-20-45-45z"/>
      <path class="tank-shine" d="M48 36v163c0 18 8 29 20 36"/>
    </svg></div>`;
}

function metric(label: string, value: string | number, color: string, icon: string): string {
  return `<article class="metric ${color}"><div class="metric-icon">${icon}</div><div><p>${label}</p><strong>${value}</strong></div></article>`;
}

function schoolRow(school: SchoolSummary): string {
  const name = escapeHtml(schoolDisplayName(school));
  const id = escapeHtml(schoolIdForSummary(school));
  return `<div class="school-row">
    <button type="button" class="school-summary" data-school-id="${id}"><span class="school-name"><i style="--school-color:${colorFor(school.school)}"></i>${name}</span><strong>${school.total}</strong><span class="complete">${school.complete}</span><span class="incomplete">${school.incomplete}</span><span class="pct"><b>${formatPct(school.completePct)}</b><i><em style="width:${school.completePct}%"></em></i></span><span class="chevron" aria-hidden="true">↗</span></button>
  </div>`;
}

function openSchoolModal(schoolId: string): void {
  const school = data?.schools.find((candidate) => schoolIdForSummary(candidate) === schoolId);
  const dialog = document.querySelector<HTMLDialogElement>("#school-modal");
  const content = document.querySelector<HTMLElement>("#school-modal-content");
  if (!school || !dialog || !content) return;
  const name = escapeHtml(schoolDisplayName(school));
  const populationDescription = activePopulation === "students"
    ? "Estudiantes · seguimiento de respuestas por año"
    : activePopulation === "teachers"
      ? "Docentes y equipos de conducción · resumen de respuestas"
      : "Familias y responsables · seguimiento de respuestas por año";
  content.innerHTML = `
    <header class="modal-school-header">
      <div><p class="eyebrow">DETALLE DE LA ESCUELA</p><h2 id="school-modal-title"><i style="--school-color:${colorFor(school.school)}"></i>${name}</h2><p>${populationDescription}</p></div>
      <div class="modal-school-total"><span>Total</span><strong>${school.total}</strong></div>
    </header>
    <section class="modal-stats" aria-label="Resumen de respuestas">
      <article><span>Completas</span><strong class="complete">${school.complete}</strong></article>
      <article><span>Incompletas</span><strong class="incomplete">${school.incomplete}</strong></article>
      <article><span>Completitud</span><strong>${formatPct(school.completePct)}</strong></article>
    </section>
    ${activePopulation !== "teachers" ? `<section class="modal-years">${Object.values(school.roles.student.years).map((year) => `
      <article class="modal-year">
        <div class="modal-year-heading"><strong>${year.year}.º año</strong><span>${year.total} respuestas</span></div>
        <div class="modal-year-bar"><i style="width:${year.completePct}%"></i></div>
        <div class="modal-year-counts"><span><b class="complete">${year.complete}</b> completas</span><span><b class="incomplete">${year.incomplete}</b> incompletas</span></div>
        <strong class="modal-year-pct">${formatPct(year.completePct)}</strong>
      </article>`).join("")}</section>` : ""}`;
  dialog.showModal();
}

function closeSchoolModal(): void {
  document.querySelector<HTMLDialogElement>("#school-modal")?.close();
}

function renderMonitoring(): void {
  const view = document.querySelector<HTMLElement>("#monitoring-view");
  if (!view || !data) return;
  const rows = sortedMonitoringRows(data.monitoringRows);
  const teacherGrid = activePopulation === "teachers";
  const familyGrid = activePopulation === "families";
  const headers = teacherGrid
    ? `${sortHeader("Fecha", "date")}${sortHeader("Hora", "time")}${sortHeader("Rol", "role")}${sortHeader("Escuela con mayor carga horaria", "resolvedSchool")}${sortHeader("Preguntas obligatorias", "requiredCompletionPct")}${sortHeader("Encuesta completa o incompleta", "complete")}`
    : familyGrid
      ? `${sortHeader("Fecha", "date")}${sortHeader("Hora", "time")}${sortHeader("Vínculo", "role")}${sortHeader("Escuela oficial", "resolvedSchool")}${sortHeader("General San Martín", "inSanMartin")}${sortHeader("Año", "courseYear")}${sortHeader("Preguntas obligatorias", "requiredCompletionPct")}${sortHeader("Encuesta completa", "complete")}`
    : `${sortHeader("Fecha", "date")}${sortHeader("Hora", "time")}${sortHeader("Escuela asignada", "resolvedSchool")}${sortHeader("Respuesta recibida", "school")}${sortHeader("ID escuela", "schoolIdentifier")}${sortHeader("Gestión", "managementType")}${sortHeader("Año", "courseYear")}${sortHeader("Preguntas obligatorias", "requiredCompletionPct")}${sortHeader("Encuesta completa", "complete")}`;
  view.innerHTML = `
    <section class="monitoring-panel panel">
      <div class="monitoring-heading section-heading">
        <div><p class="eyebrow">REGISTRO DE RESPUESTAS</p><h2>Monitoreo de carga · ${POPULATION_LABELS[activePopulation].toLocaleLowerCase("es-AR")}</h2></div>
        <span>${formatNumber(rows.length)} registros</span>
      </div>
      ${rows.length ? `<div class="monitoring-table-wrap"><table class="monitoring-table">
        <thead><tr>${headers}</tr></thead>
        <tbody>${rows.map((row) => teacherGrid ? `<tr>
          <td>${formatDate(row.date)}</td><td>${escapeHtml(row.time || "—")}</td><td>${escapeHtml(row.role || "Sin informar")}</td><td>${escapeHtml(monitoringResolvedName(row))}</td>
          ${requiredProgressCell(row)}
          <td><span class="completion-badge ${row.complete ? "yes" : "no"}">${row.complete ? "COMPLETA" : "INCOMPLETA"}</span></td>
        </tr>` : familyGrid ? `<tr>
          <td>${formatDate(row.date)}</td><td>${escapeHtml(row.time || "—")}</td><td>${escapeHtml(row.role || "Sin informar")}</td><td>${escapeHtml(monitoringResolvedName(row))}</td>
          <td>${row.inSanMartin === null ? "Sin informar" : row.inSanMartin ? "Sí" : "No"}</td><td>${row.courseYear === null ? "Sin informar" : `${row.courseYear}.º año`}</td>
          ${requiredProgressCell(row)}
          <td><span class="completion-badge ${row.complete ? "yes" : "no"}">${row.complete ? "SI" : "NO"}</span></td>
        </tr>` : `<tr>
          <td>${formatDate(row.date)}</td><td>${escapeHtml(row.time || "—")}</td><td><strong>${escapeHtml(monitoringResolvedName(row))}</strong>${row.classificationMethod === "time_window" ? "<small>Inferida por fecha y horario</small>" : row.classificationMethod === "requires_review" ? `<small>${row.reviewReason === "conflict" ? "ID y respuesta contradictorios" : "Sin datos suficientes"}</small>` : ""}</td><td>${escapeHtml(row.school)}</td><td>${escapeHtml(row.schoolIdentifier)}</td>
          <td><span class="management-badge ${row.managementType}">${managementLabel(row.managementType)}</span></td><td>${row.courseYear === null ? "Sin informar" : `${row.courseYear}.º año`}</td>
          ${requiredProgressCell(row)}
          <td><span class="completion-badge ${row.complete ? "yes" : "no"}">${row.complete ? "SI" : "NO"}</span></td>
        </tr>`).join("")}</tbody>
      </table></div>` : `<div class="monitoring-empty"><strong>Sin cargas registradas</strong><p>Los resultados de ${POPULATION_LABELS[activePopulation].toLocaleLowerCase("es-AR")} se mostrarán aquí cuando la encuesta esté conectada.</p></div>`}
    </section>`;
  view.querySelectorAll<HTMLButtonElement>(".sort-button").forEach((button) => {
    button.addEventListener("click", () => changeMonitoringSort(button.dataset.sort as MonitoringSortKey));
  });
}

function sortHeader(label: string, key: MonitoringSortKey): string {
  const active = monitoringSort.key === key;
  const ariaSort = active ? (monitoringSort.direction === "asc" ? "ascending" : "descending") : "none";
  const indicator = active ? (monitoringSort.direction === "asc" ? "↑" : "↓") : "↕";
  return `<th aria-sort="${ariaSort}"><button class="sort-button${active ? " active" : ""}" type="button" data-sort="${key}">${label}<span aria-hidden="true">${indicator}</span></button></th>`;
}

function changeMonitoringSort(key: MonitoringSortKey): void {
  monitoringSort = monitoringSort.key === key
    ? { key, direction: monitoringSort.direction === "asc" ? "desc" : "asc" }
    : { key, direction: "asc" };
  renderMonitoring();
}

function sortedMonitoringRows(rows: MonitoringRow[]): MonitoringRow[] {
  return [...rows].sort((left, right) => {
    const leftValue = monitoringSortValue(left, monitoringSort.key);
    const rightValue = monitoringSortValue(right, monitoringSort.key);
    const leftMissing = leftValue === null || leftValue === "";
    const rightMissing = rightValue === null || rightValue === "";
    if (leftMissing !== rightMissing) return leftMissing ? 1 : -1;
    const comparison = typeof leftValue === "number" && typeof rightValue === "number"
      ? leftValue - rightValue
      : String(leftValue).localeCompare(String(rightValue), "es-AR", { numeric: true, sensitivity: "base" });
    return monitoringSort.direction === "asc" ? comparison : -comparison;
  });
}

function monitoringSortValue(row: MonitoringRow, key: MonitoringSortKey): string | number | null {
  if (key === "date") return `${row.date} ${row.time}`;
  if (key === "managementType") return managementLabel(row.managementType);
  if (key === "inSanMartin") return row.inSanMartin === null ? null : row.inSanMartin ? 1 : 0;
  if (key === "complete") return row.complete ? 1 : 0;
  return row[key];
}

function switchTab(tab: DashboardView): void {
  if (!(["tracking", "map", "monitoring"] as DashboardView[]).includes(tab)) tab = "tracking";
  activeDashboardView = tab;
  document.querySelectorAll(".tab").forEach((element) => element.classList.toggle("active", (element as HTMLElement).dataset.tab === tab));
  document.querySelector("#tracking-view")?.classList.toggle("hidden", tab !== "tracking");
  document.querySelector("#map-view")?.classList.toggle("hidden", tab !== "map");
  document.querySelector("#monitoring-view")?.classList.toggle("hidden", tab !== "monitoring");
  if (tab === "map") window.setTimeout(() => void initMap(), 0);
}

async function initMap(): Promise<void> {
  if (map) { map.resize(); return; }
  maplibreModule = await import("maplibre-gl");
  const maplibregl = maplibreModule;
  map = new maplibregl.Map({
    container: "map",
    center: [-58.45, -34.61],
    zoom: 10,
    style: {
      version: 8,
      sources: { osm: { type: "raster", tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"], tileSize: 256, attribution: "© OpenStreetMap contributors" } },
      layers: [{ id: "osm", type: "raster", source: "osm", paint: { "raster-brightness-max": 0.45, "raster-saturation": -0.7, "raster-contrast": 0.15 } }],
    },
    attributionControl: false,
  });
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
  map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-right");
  map.on("load", () => {
    mapLoaded = true;
    map!.addImage("private-triangle", createTriangleImage(), { sdf: true, pixelRatio: 2 });
    map!.addSource("matricula", { type: "geojson", data: responseGeoJson() });
    map!.addSource("threads", { type: "geojson", data: threadsGeoJson() });
    map!.addLayer({ id: "heatmap", type: "heatmap", source: "matricula", layout: { visibility: "none" }, paint: {
      "heatmap-weight": 1,
      "heatmap-intensity": ["interpolate", ["linear"], ["zoom"], 9, 0.7, 14, 2.2],
      "heatmap-radius": ["interpolate", ["linear"], ["zoom"], 9, 18, 14, 38],
      "heatmap-opacity": 0.88,
      "heatmap-color": ["interpolate", ["linear"], ["heatmap-density"], 0, "rgba(9,11,16,0)", 0.2, "#22D3EE", 0.45, "#60A5FA", 0.7, "#A855F7", 0.9, "#F472B6", 1, "#FACC15"],
    } });
    map!.addLayer({ id: "threads", type: "line", source: "threads", paint: { "line-color": ["get", "color"], "line-width": 1.5, "line-opacity": 0.48, "line-dasharray": [2, 2] } });
    map!.addLayer({ id: "state-points", type: "circle", source: "matricula", filter: ["==", ["get", "managementType"], "state"], paint: { "circle-radius": 6.5, "circle-color": ["get", "color"], "circle-stroke-color": "#F4F6FA", "circle-stroke-width": 1.4, "circle-opacity": 0.94 } });
    map!.addLayer({ id: "private-points", type: "symbol", source: "matricula", filter: ["==", ["get", "managementType"], "private"], layout: { "icon-image": "private-triangle", "icon-size": 0.7, "icon-allow-overlap": true }, paint: { "icon-color": ["get", "color"], "icon-halo-color": "#F4F6FA", "icon-halo-width": 1.2 } });
    map!.addLayer({ id: "unknown-points", type: "circle", source: "matricula", filter: ["==", ["get", "managementType"], "unknown"], paint: { "circle-radius": 6, "circle-color": "#919AAC", "circle-stroke-color": "#F4F6FA", "circle-stroke-width": 1.2 } });
    for (const layer of ["state-points", "private-points", "unknown-points"]) {
      map!.on("click", layer, (event) => showResponsePopup(event));
      map!.on("mouseenter", layer, () => { map!.getCanvas().style.cursor = "pointer"; });
      map!.on("mouseleave", layer, () => { map!.getCanvas().style.cursor = ""; });
    }
    updateSchoolMarkers();
    updateLayerVisibility();
    fitMap();
  });
}

function updateMap(): void {
  if (!map || !mapLoaded) return;
  (map.getSource("matricula") as GeoJSONSource).setData(responseGeoJson());
  (map.getSource("threads") as GeoJSONSource).setData(threadsGeoJson());
  updateSchoolMarkers();
  updateLayerVisibility();
}

function updateSchoolMarkers(): void {
  if (!map || !maplibreModule) return;
  schoolMarkers.forEach((marker) => marker.remove());
  schoolMarkers = [];
  for (const { location: school, summary } of visibleSurveyedSchools()) {
    const color = colorFor(school.id);
    const element = document.createElement("button");
    element.type = "button";
    element.className = `school-map-marker ${school.managementType} active`;
    element.style.setProperty("--school-color", color);
    element.title = `${schoolDisplayName(summary)} · ${summary.total} respuestas`;
    element.setAttribute("aria-label", element.title);
    const glyph = document.createElement("i");
    glyph.className = "marker-glyph";
    element.append(glyph);
    const badge = document.createElement("span");
    badge.textContent = String(summary.total);
    element.append(badge);
    const popup = new maplibreModule.Popup({ offset: 32, closeButton: false }).setHTML(`
      <div class="school-popup">
        <p>${school.managementType === "state" ? "GESTIÓN ESTATAL" : "GESTIÓN PRIVADA"}${school.cue ? ` · CUE ${escapeHtml(school.cue)}` : ""}</p>
        <h3>${escapeHtml(school.name)}</h3>
        <span>${escapeHtml(school.address)} · ${escapeHtml(school.locality)}</span>
        <strong>${summary.total} respuestas · ${summary.complete} completas · ${summary.incomplete} incompletas</strong>
      </div>
    `);
    const sharedBuildingOffset: [number, number] = school.id === "state:47" ? [-12, 0]
      : school.id === "state:eps-408" ? [12, 0] : [0, 0];
    schoolMarkers.push(new maplibreModule.Marker({ element, anchor: "bottom", offset: sharedBuildingOffset })
      .setLngLat(school.coordinates)
      .setPopup(popup)
      .addTo(map));
  }
}

function fitMap(): void {
  if (!map || !maplibreModule) return;
  const bounds = new maplibreModule.LngLatBounds();
  const visible = visibleMapPoints();
  if (visible.length) visible.forEach((point) => {
    bounds.extend([point.lon, point.lat]);
    if (point.location) bounds.extend(point.location.coordinates);
  });
  else surveyedSchools().forEach(({ location }) => bounds.extend(location.coordinates));
  if (bounds.isEmpty()) return;
  map.fitBounds(bounds, { padding: { top: 120, right: 70, bottom: 80, left: 70 }, maxZoom: 14, duration: 900 });
}

function renderLegend(): void {
  const legend = document.querySelector<HTMLElement>("#legend-items");
  if (!legend || !data) return;
  const groups: Array<{ type: ManagementType; label: string; shape: string; schools: SchoolSummary[] }> = [
    { type: "state", label: "Escuelas secundarias (G. Estatal)", shape: "▥", schools: data.schools.filter((school) => school.managementType === "state" && schoolLocationForSummary(school)) },
    { type: "private", label: "Escuelas secundarias (G. Privadas)", shape: "▥", schools: data.schools.filter((school) => school.managementType === "private" && schoolLocationForSummary(school)) },
  ];
  const summary = document.querySelector<HTMLElement>("#legend-summary");
  if (summary) summary.textContent = activePopulation === "students"
    ? `${data.mapPoints.length} puntos de matrícula · ${surveyedSchools().length} escuelas encuestadas ubicadas`
    : `${data.mapPoints.length} ubicaciones individuales · ${surveyedSchools().length} escuelas encuestadas ubicadas`;
  legend.innerHTML = groups.map((group) => {
    const ids = group.schools.map(schoolIdForSummary);
    const checked = ids.length > 0 && ids.every((id) => selectedSchoolIds.has(id));
    return `<section class="filter-group"><label class="filter-group-title"><input type="checkbox" data-group="${group.type}" ${checked ? "checked" : ""}><span class="shape ${group.type}">${group.shape}</span><strong>${group.label}</strong></label>
      <div>${group.schools.map((school) => {
        const id = schoolIdForSummary(school);
        return `<label class="school-filter"><input type="checkbox" data-school-id="${id}" ${selectedSchoolIds.has(id) ? "checked" : ""}><i style="--school-color:${colorFor(id)}"></i><span>${escapeHtml(schoolDisplayName(school))}</span><b>${school.total}</b></label>`;
      }).join("") || `<p class="legend-empty">Sin respuestas identificadas.</p>`}</div></section>`;
  }).join("") + (resolvedMapPoints().some((point) => point.schoolId === "review-required")
    ? `<label class="school-filter unknown-filter"><input type="checkbox" data-school-id="review-required" ${selectedSchoolIds.has("review-required") ? "checked" : ""}><i></i><span>Requieren revisión</span></label>` : "");
  legend.querySelectorAll<HTMLInputElement>("[data-school-id]").forEach((input) => input.addEventListener("change", () => {
    const id = input.dataset.schoolId;
    if (id) input.checked ? selectedSchoolIds.add(id) : selectedSchoolIds.delete(id);
    updateMapAfterFilter();
  }));
  legend.querySelectorAll<HTMLInputElement>("[data-group]").forEach((input) => input.addEventListener("change", () => {
    const type = input.dataset.group as ManagementType;
    data!.schools.filter((school) => school.managementType === type).map(schoolIdForSummary).forEach((id) => input.checked ? selectedSchoolIds.add(id) : selectedSchoolIds.delete(id));
    renderLegend();
    updateMapAfterFilter();
  }));
}

function initializeFilters(): void {
  if (filtersInitialized || !data) return;
  data.schools.map(schoolIdForSummary).forEach((id) => selectedSchoolIds.add(id));
  if (data.mapPoints.some((point) => point.school === "Requieren revisión")) selectedSchoolIds.add("review-required");
  filtersInitialized = true;
}

function schoolDisplayName(school: SchoolSummary): string {
  return officialSchoolName(school);
}

function requiredProgressCell(row: MonitoringRow): string {
  if (row.requiredCompletionPct === null || row.requiredQuestions === null || row.answeredRequiredQuestions === null || row.missingRequiredQuestions === null) {
    return `<td class="required-progress"><span>—</span><small>No disponible</small></td>`;
  }
  return `<td class="required-progress"><strong>${formatPct(row.requiredCompletionPct)}</strong><small>${row.answeredRequiredQuestions} de ${row.requiredQuestions} · ${row.missingRequiredQuestions} sin responder</small></td>`;
}

function monitoringResolvedName(row: MonitoringRow): string {
  return officialSchoolName({ school: row.resolvedSchool, schoolNumber: null, managementType: row.managementType, inSanMartin: row.inSanMartin });
}

function schoolLocationForSummary(school: SchoolSummary): SchoolLocation | null {
  return schoolLocation(school);
}

function schoolIdForSummary(school: SchoolSummary): string {
  return officialSchoolId(school);
}

function surveyedSchools(): Array<{ location: SchoolLocation; summary: SchoolSummary; id: string }> {
  return (data?.schools ?? []).flatMap((summary) => {
    const location = schoolLocationForSummary(summary);
    return location ? [{ location, summary, id: location.id }] : [];
  });
}

function visibleSurveyedSchools(): Array<{ location: SchoolLocation; summary: SchoolSummary; id: string }> {
  return surveyedSchools().filter(({ id }) => selectedSchoolIds.has(id));
}

function resolvedMapPoints(): ResolvedMapPoint[] {
  return (data?.mapPoints ?? []).map((point) => {
    const location = schoolLocation(point);
    const schoolId = officialSchoolId(point);
    return { ...point, school: officialSchoolName(point), schoolId, color: colorFor(schoolId), location };
  });
}

function visibleMapPoints(): ResolvedMapPoint[] {
  return resolvedMapPoints().filter((point) => selectedSchoolIds.has(point.schoolId));
}

function responseGeoJson() {
  return { type: "FeatureCollection" as const, features: visibleMapPoints().map((point) => ({
    type: "Feature" as const,
    properties: { schoolId: point.schoolId, school: point.school, managementType: point.managementType, complete: point.complete, color: point.color },
    geometry: { type: "Point" as const, coordinates: [point.lon, point.lat] },
  })) };
}

function threadsGeoJson() {
  return { type: "FeatureCollection" as const, features: visibleMapPoints().flatMap((point) => point.location ? [{
    type: "Feature" as const,
    properties: { schoolId: point.schoolId, color: point.color },
    geometry: { type: "LineString" as const, coordinates: [[point.lon, point.lat], point.location.coordinates] },
  }] : []) };
}

function createTriangleImage(): ImageData {
  const canvas = document.createElement("canvas");
  canvas.width = 48; canvas.height = 48;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("No se pudo crear el símbolo triangular");
  context.fillStyle = "#FFFFFF";
  context.beginPath(); context.moveTo(24, 4); context.lineTo(44, 42); context.lineTo(4, 42); context.closePath(); context.fill();
  return context.getImageData(0, 0, 48, 48);
}

function showResponsePopup(event: MapLayerMouseEvent): void {
  const feature = event.features?.[0];
  if (!feature || feature.geometry.type !== "Point") return;
  const properties = feature.properties as { school: string; managementType: ManagementType; complete: boolean | string };
  const coordinates = feature.geometry.coordinates as [number, number];
  const management = properties.managementType === "state" ? "Gestión estatal · círculo" : properties.managementType === "private" ? "Gestión privada · triángulo" : "Gestión no identificada";
  const complete = properties.complete === true || properties.complete === "true";
  if (!maplibreModule) return;
  new maplibreModule.Popup({ closeButton: false }).setLngLat(coordinates).setHTML(`<div class="school-popup"><p>PUNTO DE MATRÍCULA</p><h3>${escapeHtml(properties.school)}</h3><span>${management}</span><strong>${complete ? "Respuesta completa" : "Respuesta incompleta"}</strong></div>`).addTo(map!);
}

function updateMapAfterFilter(): void {
  updateMap(); renderMapStatus(); fitMap();
}

function setMapMode(mode: "points" | "heatmap"): void {
  mapMode = mode;
  document.querySelector("#points-mode")?.classList.toggle("active", mode === "points");
  document.querySelector("#heatmap-mode")?.classList.toggle("active", mode === "heatmap");
  updateLayerVisibility();
}

function toggleThreads(): void {
  showThreads = !showThreads;
  document.querySelector("#threads-toggle")?.classList.toggle("active", showThreads);
  updateLayerVisibility();
}

function updateLayerVisibility(): void {
  if (!map || !mapLoaded) return;
  const pointsVisibility = mapMode === "points" ? "visible" : "none";
  for (const layer of ["state-points", "private-points", "unknown-points"]) if (map.getLayer(layer)) map.setLayoutProperty(layer, "visibility", pointsVisibility);
  if (map.getLayer("threads")) map.setLayoutProperty("threads", "visibility", mapMode === "points" && showThreads ? "visible" : "none");
  if (map.getLayer("heatmap")) map.setLayoutProperty("heatmap", "visibility", mapMode === "heatmap" ? "visible" : "none");
}

function renderMapStatus(): void {
  const status = document.querySelector<HTMLElement>("#map-status");
  if (!status || !data) return;
  const visible = visibleMapPoints().length;
  const missingCoordinates = data.summary.total - data.mapPoints.length;
  const pointLabel = activePopulation === "students" ? "puntos de matrícula" : "ubicaciones individuales";
  status.textContent = `${visible} de ${data.mapPoints.length} ${pointLabel} visibles · ${surveyedSchools().length} escuelas encuestadas ubicadas · ${data.summary.total} respuestas recibidas (${data.summary.complete} completas y ${data.summary.incomplete} incompletas) · ${missingCoordinates} sin ubicación válida en General San Martín`;
}

function colorFor(school: string): string {
  let hash = 2166136261;
  for (const char of school.normalize("NFKC").toLocaleLowerCase("es-AR")) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return COLORS[(hash >>> 0) % COLORS.length];
}

function saveTarget(): void {
  const input = document.querySelector<HTMLInputElement>("#target");
  const value = Number(input?.value);
  if (savePopulationTarget(localStorage, activePopulation, value)) render();
}

function updateSyncLabel(): void {
  const label = document.querySelector<HTMLElement>("#sync-label");
  if (!label) return;
  if (!lastSuccessfulFetch) { label.textContent = "Iniciando enlace…"; return; }
  const seconds = Math.floor((Date.now() - lastSuccessfulFetch) / 1000);
  const payloads = [studentData, teacherData, familyData].filter((payload): payload is DashboardPayload => payload !== null);
  const oldest = payloads.sort((left, right) => Date.parse(left.generatedAt) - Date.parse(right.generatedAt))[0];
  const dataStatus = oldest ? ` · corte más antiguo hace ${formatDataAge(oldest.generatedAt)}` : "";
  label.textContent = warning
    ? `Última conexión válida hace ${seconds} s${dataStatus}`
    : `Conexión comprobada hace ${seconds} s${dataStatus}`;
}

function formatDateTime(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Sin informar";
  return new Intl.DateTimeFormat("es-AR", {
    timeZone: "America/Argentina/Buenos_Aires",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(parsed);
}

function renderWarning(): void {
  let slot = document.querySelector<HTMLElement>(activeSection === "panorama" ? "#panorama-warning-slot" : "#warning-slot");
  if (!slot) {
    const tracking = document.querySelector<HTMLElement>("#tracking-view");
    if (tracking) {
      slot = document.createElement("div");
      slot.id = "warning-slot";
      tracking.prepend(slot);
    }
  }
  slot?.replaceChildren(warningElement());
  updateSyncLabel();
}

function warningElement(): HTMLElement {
  const element = document.createElement("div");
  element.className = "warning";
  element.textContent = `Enlace inestable: ${warning}. Se conservan los últimos datos y se reintentará automáticamente.`;
  return element;
}

function warningMarkup(): string {
  return warning ? `<div class="warning">Enlace inestable: ${escapeHtml(warning)}. Se conservan los últimos datos y se reintentará automáticamente.</div>` : "";
}

function freshnessWarningMarkup(payload: DashboardPayload): string {
  return isDataStale(payload.generatedAt)
    ? `<div class="warning">El corte de ${POPULATION_LABELS[activePopulation].toLocaleLowerCase("es-AR")} tiene más de cinco minutos durante el horario operativo. Se muestra el último dato disponible.</div>`
    : "";
}

function formatNumber(value: number): string { return new Intl.NumberFormat("es-AR").format(value); }
function formatPct(value: number): string { return `${new Intl.NumberFormat("es-AR", { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(value)} %`; }
function formatDate(value: string): string {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : escapeHtml(value || "—");
}
function managementLabel(value: ManagementType): string {
  return value === "state" ? "Estatal" : value === "private" ? "Privada" : "Sin informar";
}
function escapeHtml(value: string): string { return value.replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]!); }
