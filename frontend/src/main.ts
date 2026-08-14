import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import "./style.css";
import demoData from "./data/demo.json";
import stateSchoolsData from "./data/state-schools.json";
import schoolMarkerUrl from "./assets/school-marker.svg";
import type { DashboardPayload, SchoolSummary } from "./types";

const REFRESH_MS = 60_000;
const DATA_MODE = import.meta.env.VITE_DATA_MODE ?? "api";
const API_BASE = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/$/, "");
const COLORS = [
  "#A855F7", "#22D3EE", "#34D399", "#FB923C", "#FACC15", "#F472B6", "#60A5FA",
  "#E879F9", "#2DD4BF", "#A3E635", "#FDBA74", "#FDE047", "#FB7185", "#818CF8",
  "#C084FC", "#67E8F9", "#6EE7B7", "#F59E0B", "#D9F99D", "#FDA4AF", "#93C5FD", "#F0ABFC",
];

let data: DashboardPayload | null = null;
let lastSuccessfulFetch = 0;
let warning = "";
let map: maplibregl.Map | null = null;
let mapLoaded = false;
let schoolMarkers: maplibregl.Marker[] = [];
let activeTab: "tracking" | "map" = "tracking";

interface StateSchool {
  schoolNumber: number;
  name: string;
  cue: string;
  locality: string;
  address: string;
  coordinates: [number, number];
}

const STATE_SCHOOLS: StateSchool[] = stateSchoolsData.features.map((feature) => ({
  schoolNumber: feature.properties.schoolNumber,
  name: feature.properties.name,
  cue: feature.properties.cue,
  locality: feature.properties.locality,
  address: feature.properties.address,
  coordinates: [feature.geometry.coordinates[0], feature.geometry.coordinates[1]],
}));

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("No se encontró #app");

app.innerHTML = `
  <header class="topbar">
    <div class="brand"><span class="brand-mark"></span><div><p>ITED 2026 · ENCUESTA A ESTUDIANTES</p><h1>Seguimiento del trabajo de campo</h1></div></div>
    <div class="sync"><span class="pulse"></span><span id="sync-label">Iniciando enlace…</span></div>
  </header>
  <nav class="tabs" aria-label="Vistas del panel">
    <button class="tab active" data-tab="tracking">Seguimiento</button>
    <button class="tab" data-tab="map">Mapa <span id="map-count" class="tab-count">0</span></button>
  </nav>
  <main>
    <section id="tracking-view" class="view"><div id="warning-slot"></div><div class="loading">Conectando con la fuente de datos…</div></section>
    <section id="map-view" class="view hidden">
      <div class="map-shell">
        <aside class="map-legend"><div><p class="eyebrow">CAPA TERRITORIAL</p><h2>Escuelas estatales</h2><p id="legend-summary" class="legend-summary"></p></div><div id="legend-items"></div></aside>
        <div id="map"></div>
      </div>
    </section>
  </main>
`;

app.querySelectorAll<HTMLButtonElement>(".tab").forEach((button) => {
  button.addEventListener("click", () => switchTab(button.dataset.tab === "map" ? "map" : "tracking"));
});

void refresh();
setInterval(() => void refresh(), REFRESH_MS);
setInterval(updateSyncLabel, 1_000);

async function refresh(): Promise<void> {
  try {
    const fresh = DATA_MODE === "demo" ? demoPayload() : await fetchApi();
    validatePayload(fresh);
    data = fresh;
    lastSuccessfulFetch = Date.now();
    warning = "";
    render();
  } catch (error) {
    warning = error instanceof Error ? error.message : "No se pudo actualizar";
    renderWarning();
  }
}

function demoPayload(): DashboardPayload {
  return { ...(structuredClone(demoData) as DashboardPayload), generatedAt: new Date().toISOString() };
}

async function fetchApi(): Promise<DashboardPayload> {
  if (!API_BASE) throw new Error("El Worker de LimeSurvey todavía no está configurado");
  const response = await fetch(`${API_BASE}/api/dashboard`, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`Actualización interrumpida (HTTP ${response.status})`);
  return response.json() as Promise<DashboardPayload>;
}

function validatePayload(payload: DashboardPayload): void {
  if (!payload?.summary || !Array.isArray(payload.schools) || !Array.isArray(payload.mapPoints)) {
    throw new Error("El endpoint devolvió un formato inesperado");
  }
  if (payload.summary.complete + payload.summary.incomplete !== payload.summary.total) {
    throw new Error("Los totales del endpoint son inconsistentes");
  }
}

function render(): void {
  if (!data) return;
  const target = loadTarget();
  const progress = Math.min((data.summary.total / target) * 100, 100);
  const tracking = document.querySelector<HTMLElement>("#tracking-view");
  if (!tracking) return;
  tracking.innerHTML = `
    <div id="warning-slot">${warningMarkup()}</div>
    <section class="hero-grid">
      <article class="vessel-card panel">
        <div class="section-heading"><div><p class="eyebrow">AVANCE DE CAMPO</p><h2>Recipiente de respuestas</h2></div><span class="live-badge">EN CURSO</span></div>
        <div class="vessel-layout">
          ${vesselSvg(progress)}
          <div class="vessel-copy">
            <p class="big-progress"><strong>${formatNumber(data.summary.total)}</strong><span>/ ${formatNumber(target)}</span></p>
            <p class="progress-pct">${formatPct((data.summary.total / target) * 100)}</p>
            <p class="muted">respuestas capturadas · incluye completas e incompletas</p>
            <label for="target">Meta operativa</label>
            <div class="target-control"><input id="target" type="number" min="1" step="50" value="${target}"><button id="save-target">Aplicar</button></div>
          </div>
        </div>
      </article>
      <section class="metrics" aria-label="Indicadores generales">
        ${metric("Total respuestas", data.summary.total, "violet", "↗")}
        ${metric("Completas", data.summary.complete, "green", "✓")}
        ${metric("Incompletas", data.summary.incomplete, "orange", "◒")}
        ${metric("Completitud", formatPct(data.summary.completePct), "cyan", "≈")}
        ${metric("Escuelas activas", data.schools.length, "pink", "⌂")}
        ${metric("Último corte", formatTime(data.generatedAt), "blue", "◷")}
      </section>
    </section>
    <section class="schools-panel panel">
      <div class="section-heading school-title"><div><p class="eyebrow">DESPLIEGUE TERRITORIAL</p><h2>Seguimiento por escuela</h2></div><span>${data.schools.length} establecimientos</span></div>
      <div class="table-head"><span>Escuela</span><span>Total</span><span>Completas</span><span>Incompletas</span><span>% completas</span><span></span></div>
      <div class="school-list">${data.schools.map(schoolRow).join("")}</div>
    </section>
  `;
  tracking.querySelector<HTMLButtonElement>("#save-target")?.addEventListener("click", saveTarget);
  document.querySelector<HTMLElement>("#map-count")!.textContent = String(activeStateSchools().length);
  renderLegend();
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
  return `<details class="school-row">
    <summary><span class="school-name"><i style="--school-color:${colorFor(school.school)}"></i>${name}</span><strong>${school.total}</strong><span class="complete">${school.complete}</span><span class="incomplete">${school.incomplete}</span><span class="pct"><b>${formatPct(school.completePct)}</b><i><em style="width:${school.completePct}%"></em></i></span><span class="chevron">⌄</span></summary>
    <div class="school-detail">
      <div class="role-summary"><div><p class="eyebrow">ROL ACTIVO</p><h3>Estudiantes</h3></div><div><span>Total <b>${school.roles.student.total}</b></span><span>Completas <b>${school.roles.student.complete}</b></span><span>Incompletas <b>${school.roles.student.incomplete}</b></span></div></div>
      <div class="years">${Object.values(school.roles.student.years).map((year) => `<div class="year"><div><strong>${year.year}.º año</strong><span>${year.total} respuestas</span></div><div class="microbar"><i style="width:${year.completePct}%"></i></div><div class="year-counts"><span>${year.complete} completas</span><span>${year.incomplete} incompletas</span><b>${formatPct(year.completePct)}</b></div></div>`).join("")}</div>
    </div>
  </details>`;
}

function switchTab(tab: "tracking" | "map"): void {
  activeTab = tab;
  document.querySelectorAll(".tab").forEach((element) => element.classList.toggle("active", (element as HTMLElement).dataset.tab === tab));
  document.querySelector("#tracking-view")?.classList.toggle("hidden", tab !== "tracking");
  document.querySelector("#map-view")?.classList.toggle("hidden", tab !== "map");
  if (tab === "map") window.setTimeout(initMap, 0);
}

function initMap(): void {
  if (map) { map.resize(); return; }
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
    updateSchoolMarkers();
    fitMap();
  });
}

function updateMap(): void {
  if (!map || !mapLoaded) return;
  updateSchoolMarkers();
  if (activeTab === "map") fitMap();
}

function updateSchoolMarkers(): void {
  if (!map) return;
  schoolMarkers.forEach((marker) => marker.remove());
  schoolMarkers = [];
  const summaries = new Map(activeStateSchools().map((school) => [school.schoolNumber, school]));
  for (const school of STATE_SCHOOLS) {
    const summary = summaries.get(school.schoolNumber);
    const element = document.createElement("button");
    element.type = "button";
    element.className = `school-map-marker${summary ? " active" : ""}`;
    element.title = `${school.name}${summary ? ` · ${summary.total} respuestas` : " · sin respuestas"}`;
    element.setAttribute("aria-label", element.title);
    const image = document.createElement("img");
    image.src = schoolMarkerUrl;
    image.alt = "";
    element.append(image);
    if (summary) {
      const badge = document.createElement("span");
      badge.textContent = String(summary.total);
      element.append(badge);
    }
    const popup = new maplibregl.Popup({ offset: 32, closeButton: false }).setHTML(`
      <div class="school-popup">
        <p>EES ${school.schoolNumber} · CUE ${escapeHtml(school.cue)}</p>
        <h3>${escapeHtml(school.name)}</h3>
        <span>${escapeHtml(school.address)} · ${escapeHtml(school.locality)}</span>
        <strong>${summary ? `${summary.total} respuestas · ${summary.complete} completas · ${summary.incomplete} incompletas` : "Sin respuestas registradas"}</strong>
      </div>
    `);
    schoolMarkers.push(new maplibregl.Marker({ element, anchor: "bottom" })
      .setLngLat(school.coordinates)
      .setPopup(popup)
      .addTo(map));
  }
}

function fitMap(): void {
  if (!map || !STATE_SCHOOLS.length) return;
  const bounds = new maplibregl.LngLatBounds();
  STATE_SCHOOLS.forEach((school) => bounds.extend(school.coordinates));
  map.fitBounds(bounds, { padding: 70, maxZoom: 14, duration: 900 });
}

function renderLegend(): void {
  const legend = document.querySelector<HTMLElement>("#legend-items");
  if (!legend || !data) return;
  const active = activeStateSchools();
  const summary = document.querySelector<HTMLElement>("#legend-summary");
  if (summary) summary.textContent = `${active.length} con respuestas · ${STATE_SCHOOLS.length} establecimientos en la capa`;
  legend.innerHTML = active.map((school) => `<div class="legend-item"><img src="${schoolMarkerUrl}" alt=""><span>${escapeHtml(schoolDisplayName(school))}</span><b>${school.total}</b></div>`).join("")
    || `<p class="legend-empty">Todavía no hay respuestas estatales identificadas.</p>`;
}

function activeStateSchools(): Array<SchoolSummary & { schoolNumber: number }> {
  return (data?.schools ?? []).filter((school): school is SchoolSummary & { schoolNumber: number } => school.schoolNumber !== null);
}

function schoolDisplayName(school: SchoolSummary): string {
  if (school.schoolNumber === null) return school.school;
  return STATE_SCHOOLS.find((candidate) => candidate.schoolNumber === school.schoolNumber)?.name ?? school.school;
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
  if (Number.isFinite(value) && value > 0) {
    localStorage.setItem("dashboard-target", String(Math.round(value)));
    render();
  }
}

function loadTarget(): number {
  const stored = Number(localStorage.getItem("dashboard-target"));
  return Number.isFinite(stored) && stored > 0 ? stored : 1500;
}

function updateSyncLabel(): void {
  const label = document.querySelector<HTMLElement>("#sync-label");
  if (!label) return;
  if (!lastSuccessfulFetch) { label.textContent = "Iniciando enlace…"; return; }
  const seconds = Math.floor((Date.now() - lastSuccessfulFetch) / 1000);
  label.textContent = warning ? `Último dato válido hace ${seconds} s` : `Actualizado hace ${seconds} s`;
}

function renderWarning(): void {
  let slot = document.querySelector<HTMLElement>("#warning-slot");
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

function formatNumber(value: number): string { return new Intl.NumberFormat("es-AR").format(value); }
function formatPct(value: number): string { return `${new Intl.NumberFormat("es-AR", { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(value)} %`; }
function formatTime(value: string): string { return new Intl.DateTimeFormat("es-AR", { hour: "2-digit", minute: "2-digit" }).format(new Date(value)); }
function escapeHtml(value: string): string { return value.replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]!); }
