// Main Frontend Application Logic
let appState = {
  activeCountry: 'República Dominicana',
  diaCampo: 1,
  allPoints: [],
  filteredPoints: [],
  selectedExtraIds: new Set(),
  auditors: [],
  lastProcessData: null,
  map: null,
  markersLayer: null,
  tileLayer: null,
  tileSources: {
    streets: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    satellite: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
  }
};

document.addEventListener('DOMContentLoaded', () => {
  initMap();
  loadConfig();
  loadPoints();
});

/* Map Initialization */
function initMap() {
  appState.map = L.map('map').setView([18.4861, -69.9312], 11);
  
  appState.tileLayer = L.tileLayer(appState.tileSources.streets, {
    attribution: '&copy; OpenStreetMap / Esri World Imagery'
  }).addTo(appState.map);

  appState.markersLayer = L.layerGroup().addTo(appState.map);
}

function setTileLayer(type) {
  if (appState.tileSources[type]) {
    appState.map.removeLayer(appState.tileLayer);
    appState.tileLayer = L.tileLayer(appState.tileSources[type]).addTo(appState.map);
  }
}

function fitMapBounds() {
  if (appState.filteredPoints.length === 0) return;
  const bounds = appState.filteredPoints
    .filter(p => p.lat && p.lng && p.lat !== 0)
    .map(p => [p.lat, p.lng]);
  if (bounds.length > 0) {
    appState.map.fitBounds(bounds, { padding: [30, 30] });
  }
}

/* API Data Fetching */
async function loadConfig() {
  try {
    const res = await fetch('/api/config');
    const config = await res.json();
    
    document.getElementById('country-select').value = config.active_country;
    document.getElementById('dia-campo-input').value = config.dia_campo;
    appState.diaCampo = config.dia_campo;
    appState.auditors = config.auditors || [];

    populateAuditorFilter();
  } catch (err) {
    console.error("Error loading config:", err);
  }
}

async function loadPoints() {
  try {
    const res = await fetch('/api/points');
    const data = await res.json();
    
    appState.allPoints = data.points || [];
    document.getElementById('stat-total-puntos').innerText = data.total || 0;

    populateCanalFilter();
    populateExtraDaysFilter();
    applyFilters();
    renderExtraPointsTable();
  } catch (err) {
    console.error("Error loading points:", err);
  }
}

/* Filter Population */
function populateAuditorFilter() {
  const select = document.getElementById('filter-auditor');
  select.innerHTML = '<option value="ALL">Todos los Auditores</option>';
  appState.auditors.forEach(a => {
    select.innerHTML += `<option value="${a.name}">${a.name}</option>`;
  });
}

function populateCanalFilter() {
  const select = document.getElementById('filter-canal');
  const canales = new Set();
  appState.allPoints.forEach(p => {
    if (p.canal) canales.add(p.canal);
  });
  
  select.innerHTML = '<option value="ALL">Todos los Canales</option>';
  Array.from(canales).sort().forEach(c => {
    select.innerHTML += `<option value="${c}">${c}</option>`;
  });
}

function populateExtraDaysFilter() {
  const select = document.getElementById('filter-extra-day');
  const days = new Set();
  appState.allPoints.forEach(p => {
    if (p.dia && p.dia !== 999) days.add(p.dia);
  });

  select.innerHTML = '<option value="ALL">Todos los Días</option>';
  Array.from(days).sort((a,b) => a-b).forEach(d => {
    select.innerHTML += `<option value="${d}">Día ${d}</option>`;
  });
}

/* Map & Filtering Logic */
function applyFilters() {
  const audFilter = document.getElementById('filter-auditor').value;
  const canalFilter = document.getElementById('filter-canal').value;
  const fijoFilter = document.getElementById('filter-fijo').value;
  const selFilter = document.getElementById('filter-seleccion').value;
  const currentDia = parseInt(document.getElementById('dia-campo-input').value) || 1;

  appState.filteredPoints = appState.allPoints.filter(p => {
    // Base Eligibility Rule (MUESTRA CUMPL = Cargar & export.Estado empty)
    if (p.muestra_cumpl !== 'Cargar') return false;
    if (p.estado && p.estado !== '') return false;

    // Day or Extra requested check
    const isDayValid = p.dia <= currentDia;
    const isExtra = appState.selectedExtraIds.has(p.id);
    if (!isDayValid && !isExtra) return false;

    // Sidebar Filters
    if (audFilter !== 'ALL' && p.auditor !== audFilter) return false;
    if (canalFilter !== 'ALL' && p.canal !== canalFilter) return false;
    if (fijoFilter === 'SI' && !p.fijo) return false;
    if (fijoFilter === 'NO' && p.fijo) return false;
    if (selFilter !== 'ALL' && p.seleccion !== selFilter) return false;

    return true;
  });

  document.getElementById('stat-filtrados').innerText = appState.filteredPoints.length;
  renderMapMarkers();
}

function renderMapMarkers() {
  appState.markersLayer.clearLayers();
  const bounds = [];

  // Color Map palette based on Segment/Canal/Auditor
  appState.filteredPoints.forEach(p => {
    if (!p.lat || !p.lng || p.lat === 0) return;

    let strokeColor = p.fijo ? '#10b981' : '#ffffff'; // Emerald if PDV Fijo
    let fillColor = p.seleccion === 'T' ? '#00f2fe' : '#f59e0b'; // Cyan for T, Amber for S
    if (appState.selectedExtraIds.has(p.id)) {
      fillColor = '#8b5cf6'; // Purple for client-requested extra points
    }

    const circle = L.circleMarker([p.lat, p.lng], {
      radius: p.fijo ? 7 : 5,
      fillColor: fillColor,
      color: strokeColor,
      weight: p.fijo ? 2.5 : 1,
      opacity: 1,
      fillOpacity: 0.85
    });

    const popupHtml = `
      <div style="font-family: sans-serif; font-size: 0.85rem; color: #1e293b;">
        <h4 style="margin: 0 0 4px 0; color: #0f172a;">${p.name}</h4>
        <div><b>ID:</b> ${p.pdv_id} | <b>Auditor:</b> ${p.auditor}</div>
        <div><b>Dirección:</b> ${p.direccion || 'N/A'} (${p.sector})</div>
        <div><b>Día Programado:</b> Día ${p.dia} ${appState.selectedExtraIds.has(p.id) ? '<span style="color:#8b5cf6;">(Extra Cliente)</span>' : ''}</div>
        <div style="margin-top: 4px;">
          <span style="background: #e0f2fe; color: #0369a1; padding: 2px 6px; border-radius: 4px; font-size: 0.75rem;">${p.canal}</span>
          <span style="background: #fef3c7; color: #b45309; padding: 2px 6px; border-radius: 4px; font-size: 0.75rem;">SELECCION ${p.seleccion}</span>
          ${p.fijo ? '<span style="background: #dcfce7; color: #15803d; padding: 2px 6px; border-radius: 4px; font-size: 0.75rem;">PDV FIJO</span>' : ''}
        </div>
      </div>
    `;

    circle.bindPopup(popupHtml);
    appState.markersLayer.addLayer(circle);
    bounds.push([p.lat, p.lng]);
  });

  if (bounds.length > 0) {
    appState.map.fitBounds(bounds, { padding: [30, 30] });
  }
}

/* Process Route Button Trigger */
async function processRoute() {
  const diaCampo = parseInt(document.getElementById('dia-campo-input').value) || 1;
  const extraIds = Array.from(appState.selectedExtraIds);
  const btn = document.getElementById('btn-cargar-ruta');

  btn.disabled = true;
  btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Procesando...`;

  try {
    const res = await fetch('/api/process-route', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        dia_campo: diaCampo,
        extra_point_ids: extraIds
      })
    });

    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Error procesando ruta');

    appState.lastProcessData = data;
    document.getElementById('last-updated-text').innerText = `Última actualización: ${data.last_updated}`;
    document.getElementById('stat-auditores').innerText = data.total_auditors || 0;
    document.getElementById('btn-download-zip').disabled = false;

    renderCSVTableSummary(data);
    renderAuditorLinksModal(data.auditor_routes);
    applyFilters();

    alert(`¡Proceso completado exitosamente!\nSe generaron ${data.generated_files.length} archivos CSV para ${data.total_auditors} auditores.`);

  } catch (err) {
    console.error("Error processing route:", err);
    alert("Error procesando ruta: " + err.message);
  } finally {
    btn.disabled = false;
    btn.innerHTML = `<i class="fa-solid fa-play"></i> CARGAR Y GENERAR`;
  }
}

/* CSV Table Summary Renderer */
function renderCSVTableSummary(data) {
  const tbody = document.getElementById('csv-summary-tbody');
  const routes = data.auditor_routes || {};
  
  if (Object.keys(routes).length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; color: var(--text-muted);">No hay datos cargados para el día seleccionado.</td></tr>`;
    return;
  }

  let html = `
    <tr style="background: rgba(245, 158, 11, 0.15); border-bottom: 2px solid var(--accent-amber);">
      <td><strong style="color: var(--accent-amber);"><i class="fa-solid fa-star"></i> CONSOLIDADO MASTER (TODOS)</strong></td>
      <td><span class="badge badge-amber">${data.total_filtered_points} PUNTOS</span></td>
      <td colspan="5" style="text-align: center;">
        <span style="font-size: 0.8rem; color: var(--text-muted);">Archivo completo para Google My Maps segmentado</span>
      </td>
      <td>
        <a href="/api/download-csv/MASTER_GOOGLE_MYMAPS_TODOS.csv" class="btn btn-emerald" style="padding: 0.3rem 0.6rem; font-size: 0.75rem; text-decoration: none;">
          <i class="fa-solid fa-download"></i> Descargar CSV Master
        </a>
      </td>
    </tr>
  `;

  html += Object.values(routes).map(aud => {
    const points = aud.points || [];
    const t_count = points.filter(p => p.seleccion === 'T').length;
    const t_on_count = points.filter(p => p.seleccion === 'T' && p.canal.toUpperCase().includes('ON PREMISE')).length;
    const t_fijos_count = points.filter(p => p.seleccion === 'T' && p.fijo).length;
    const s_count = points.filter(p => p.seleccion === 'S').length;
    const s_fijos_count = points.filter(p => p.seleccion === 'S' && p.fijo).length;

    return `
      <tr>
        <td>
          <strong>${aud.auditor_name}</strong>
          ${aud.fijos_count > 0 ? `<br><small style="color: var(--accent-emerald);"><i class="fa-solid fa-shield-halved"></i> ${aud.fijos_count} Fijos Obligatorios</small>` : ''}
        </td>
        <td><span class="badge badge-cyan">${aud.total_points}</span></td>
        <td>${t_count > 0 ? `<a href="/api/download-csv/${aud.slug}_T.csv" class="badge badge-cyan" style="text-decoration:none;"><i class="fa-solid fa-download"></i> ${t_count}</a>` : '-'}</td>
        <td>${t_on_count > 0 ? `<a href="/api/download-csv/${aud.slug}_T_ON.csv" class="badge badge-purple" style="text-decoration:none;"><i class="fa-solid fa-download"></i> ${t_on_count}</a>` : '-'}</td>
        <td>${t_fijos_count > 0 ? `<a href="/api/download-csv/${aud.slug}_T_FIJOS.csv" class="badge badge-emerald" style="text-decoration:none;"><i class="fa-solid fa-download"></i> ${t_fijos_count}</a>` : '-'}</td>
        <td>${s_count > 0 ? `<a href="/api/download-csv/${aud.slug}_S.csv" class="badge badge-amber" style="text-decoration:none;"><i class="fa-solid fa-download"></i> ${s_count}</a>` : '-'}</td>
        <td>${s_fijos_count > 0 ? `<a href="/api/download-csv/${aud.slug}_S_FIJOS.csv" class="badge badge-rose" style="text-decoration:none;"><i class="fa-solid fa-download"></i> ${s_fijos_count}</a>` : '-'}</td>
        <td>
          <a href="/auditor/${aud.slug}" target="_blank" class="btn btn-secondary" style="padding: 0.3rem 0.6rem; font-size: 0.75rem;">
            <i class="fa-solid fa-mobile-screen"></i> Ver Móvil
          </a>
        </td>
      </tr>
    `;
  }).join('');

  tbody.innerHTML = html;
}

/* Extra Points Modal Table Logic */
function renderExtraPointsTable() {
  const tbody = document.getElementById('extra-points-tbody');
  const currentDia = parseInt(document.getElementById('dia-campo-input').value) || 1;
  const search = (document.getElementById('search-extra-input').value || '').toLowerCase();
  const dayFilter = document.getElementById('filter-extra-day').value;

  // Show points scheduled for OTHER days (dia > currentDia)
  const candidatePoints = appState.allPoints.filter(p => {
    if (p.muestra_cumpl !== 'Cargar') return false;
    if (p.estado && p.estado !== '') return false;
    if (p.dia <= currentDia && !appState.selectedExtraIds.has(p.id)) return false; // Hide points already in today's base route unless selected

    if (dayFilter !== 'ALL' && p.dia !== parseInt(dayFilter)) return false;

    if (search) {
      const targetStr = `${p.name} ${p.pdv_id} ${p.direccion} ${p.sector} ${p.auditor}`.toLowerCase();
      if (!targetStr.includes(search)) return false;
    }

    return true;
  });

  if (candidatePoints.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; color: var(--text-muted); padding: 1.5rem;">No se encontraron puntos para los criterios de búsqueda.</td></tr>`;
    return;
  }

  tbody.innerHTML = candidatePoints.slice(0, 100).map(p => {
    const isChecked = appState.selectedExtraIds.has(p.id);
    return `
      <tr style="${isChecked ? 'background: rgba(139, 92, 246, 0.15);' : ''}">
        <td style="text-align:center;">
          <input type="checkbox" onchange="toggleExtraPoint(${p.id}, this.checked)" ${isChecked ? 'checked' : ''}>
        </td>
        <td><span class="badge badge-amber">Día ${p.dia}</span></td>
        <td><strong>${p.name}</strong><br><small style="color:var(--text-muted);">ID: ${p.pdv_id}</small></td>
        <td>${p.auditor}</td>
        <td>${p.direccion || 'N/A'}<br><small style="color:var(--text-muted);">${p.sector}</small></td>
        <td><span class="badge badge-purple">${p.canal}</span></td>
        <td>${p.fijo ? '<span class="badge badge-emerald">SI</span>' : 'NO'}</td>
      </tr>
    `;
  }).join('');
}

function filterExtraPointsTable() {
  renderExtraPointsTable();
}

function toggleExtraPoint(id, checked) {
  if (checked) {
    appState.selectedExtraIds.add(id);
  } else {
    appState.selectedExtraIds.delete(id);
  }
  document.getElementById('stat-extra').innerText = appState.selectedExtraIds.size;
  document.getElementById('extra-badge-count').innerText = appState.selectedExtraIds.size;
}

function confirmExtraPoints() {
  closeModal('extra-modal');
  applyFilters();
}

/* Auditor Links Modal Renderer */
function renderAuditorLinksModal(routesData) {
  const container = document.getElementById('auditor-links-list');
  const routes = routesData || (appState.lastProcessData ? appState.lastProcessData.auditor_routes : {});

  if (!routes || Object.keys(routes).length === 0) {
    container.innerHTML = `<div style="text-align: center; color: var(--text-muted); padding: 1rem;">No hay enlaces disponibles. Ejecute la carga primero.</div>`;
    return;
  }

  container.innerHTML = Object.values(routes).map(aud => {
    const fullUrl = `${window.location.origin}/auditor/${aud.slug}`;
    return `
      <div class="auditor-link-item">
        <div>
          <strong style="color: #fff; font-size: 0.95rem;">${aud.auditor_name}</strong>
          <div style="font-size: 0.75rem; color: var(--accent-cyan);">${aud.total_points} Puntos Asignados Hoy</div>
          <div style="font-size: 0.75rem; color: var(--text-muted); text-overflow: ellipsis; overflow: hidden; max-width: 380px;">${fullUrl}</div>
        </div>
        <div style="display: flex; gap: 0.5rem;">
          <button class="btn btn-secondary" style="padding: 0.35rem 0.75rem; font-size: 0.8rem;" onclick="navigator.clipboard.writeText('${fullUrl}'); alert('Enlace copiado al portapapeles');">
            <i class="fa-solid fa-copy"></i> Copiar
          </button>
          <a href="${fullUrl}" target="_blank" class="btn btn-primary" style="padding: 0.35rem 0.75rem; font-size: 0.8rem;">
            <i class="fa-solid fa-external-link"></i> Abrir
          </a>
        </div>
      </div>
    `;
  }).join('');
}

/* Downloads & Actions */
function downloadZip() {
  window.location.href = '/api/download-zip';
}

async function uploadExcel(event) {
  event.preventDefault();
  const fileInput = document.getElementById('excel-file-input');
  const country = document.getElementById('upload-country').value;
  if (!fileInput.files[0]) return;

  const formData = new FormData();
  formData.append('file', fileInput.files[0]);
  formData.append('country', country);

  try {
    const res = await fetch('/api/upload-excel', {
      method: 'POST',
      body: formData
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Error al subir');

    alert(data.message);
    closeModal('upload-modal');
    loadConfig();
    loadPoints();

  } catch (err) {
    alert("Error al subir archivo: " + err.message);
  }
}

/* Modal Generic Helpers */
function openModal(id) {
  const modal = document.getElementById(id);
  if (modal) modal.classList.add('active');
  if (id === 'links-modal') renderAuditorLinksModal();
  if (id === 'mymaps-modal') loadSavedMyMapsUrl();
}

function closeModal(id) {
  const modal = document.getElementById(id);
  if (modal) modal.classList.remove('active');
}

/* Custom Google My Maps Link Persistence */
function saveCustomMyMapsUrl() {
  const url = document.getElementById('custom-mymaps-url').value.trim();
  if (!url) return;
  localStorage.setItem('custom_mymaps_url', url);
  document.getElementById('btn-open-mymaps-link').href = url;
  alert('¡Enlace de Google My Maps guardado con éxito!');
}

function loadSavedMyMapsUrl() {
  const saved = localStorage.getItem('custom_mymaps_url');
  if (saved) {
    document.getElementById('custom-mymaps-url').value = saved;
    document.getElementById('btn-open-mymaps-link').href = saved;
  }
}

/* View Switcher (Map vs Dashboard) */
function switchView(viewName) {
  const mapBtn = document.getElementById('tab-map-btn');
  const dashBtn = document.getElementById('tab-dash-btn');
  const mapContainer = document.getElementById('map-view-container');
  const dashContainer = document.getElementById('dashboard-view-container');

  if (viewName === 'dashboard') {
    mapBtn.classList.remove('active');
    dashBtn.classList.add('active');
    mapContainer.style.display = 'none';
    dashContainer.style.display = 'block';
    loadDashboardAnalytics();
  } else {
    dashBtn.classList.remove('active');
    mapBtn.classList.add('active');
    dashContainer.style.display = 'none';
    mapContainer.style.display = 'grid';
    if (appState.map) {
      setTimeout(() => appState.map.invalidateSize(), 200);
    }
  }
}

/* Dashboard Analytics Loader & Renderer */
async function loadDashboardAnalytics() {
  try {
    const res = await fetch('/api/dashboard-analytics');
    const data = await res.json();

    // 1. Global KPIs
    const g = data.global || {};
    document.getElementById('dash-global-pct').innerText = `${g.pct || 0}%`;
    document.getElementById('dash-global-visited').innerText = g.visited || 0;
    document.getElementById('dash-global-pending').innerText = g.pending || 0;
    document.getElementById('dash-global-total').innerText = g.total || 0;
    document.getElementById('dash-global-bar').style.width = `${g.pct || 0}%`;

    // 2. Seleccion T vs S
    const selT = (data.by_seleccion || {}).T || {};
    document.getElementById('dash-sel-t-pct').innerText = `${selT.pct || 0}%`;
    document.getElementById('dash-sel-t-bar').style.width = `${selT.pct || 0}%`;
    document.getElementById('dash-sel-t-visited').innerText = selT.visited || 0;
    document.getElementById('dash-sel-t-pending').innerText = selT.pending || 0;
    document.getElementById('dash-sel-t-total').innerText = selT.total || 0;

    const selS = (data.by_seleccion || {}).S || {};
    document.getElementById('dash-sel-s-pct').innerText = `${selS.pct || 0}%`;
    document.getElementById('dash-sel-s-bar').style.width = `${selS.pct || 0}%`;
    document.getElementById('dash-sel-s-visited').innerText = selS.visited || 0;
    document.getElementById('dash-sel-s-pending').innerText = selS.pending || 0;
    document.getElementById('dash-sel-s-total').innerText = selS.total || 0;

    // 3. Auditor Table
    const audTbody = document.getElementById('dash-auditor-tbody');
    const auditors = data.by_auditor || [];

    if (auditors.length === 0) {
      audTbody.innerHTML = `<tr><td colspan="6" style="text-align:center; color: var(--text-muted);">No hay datos de auditores disponibles.</td></tr>`;
    } else {
      audTbody.innerHTML = auditors.map(aud => `
        <tr>
          <td><strong>${aud.auditor}</strong></td>
          <td>${aud.total}</td>
          <td><span class="badge badge-emerald">${aud.visited}</span></td>
          <td><span class="badge badge-amber">${aud.pending}</span></td>
          <td>
            <span class="badge badge-purple">
              <i class="fa-solid fa-shield-halved"></i> ${aud.fijos_visited} / ${aud.fijos_total} Fijos
            </span>
          </td>
          <td>
            <div style="display: flex; align-items: center; gap: 0.75rem;">
              <div class="progress-bar-container" style="flex: 1;">
                <div class="progress-bar-fill" style="width: ${aud.pct}%;"></div>
              </div>
              <span style="font-weight: 700; font-size: 0.8rem; width: 45px; text-align: right; color: var(--accent-cyan);">${aud.pct}%</span>
            </div>
          </td>
        </tr>
      `).join('');
    }

    // 4. Day Table
    const dayTbody = document.getElementById('dash-day-tbody');
    const days = data.by_day || [];

    if (days.length === 0) {
      dayTbody.innerHTML = `<tr><td colspan="5" style="text-align:center; color: var(--text-muted);">No hay datos de días disponibles.</td></tr>`;
    } else {
      dayTbody.innerHTML = days.map(d => `
        <tr>
          <td><strong><i class="fa-solid fa-calendar-day" style="color: var(--accent-cyan);"></i> Día ${d.dia}</strong></td>
          <td>${d.total}</td>
          <td><span class="badge badge-emerald">${d.visited}</span></td>
          <td><span class="badge badge-amber">${d.pending}</span></td>
          <td>
            <div style="display: flex; align-items: center; gap: 0.75rem;">
              <div class="progress-bar-container" style="flex: 1;">
                <div class="progress-bar-fill amber" style="width: ${d.pct}%;"></div>
              </div>
              <span style="font-weight: 700; font-size: 0.8rem; width: 45px; text-align: right; color: var(--accent-amber);">${d.pct}%</span>
            </div>
          </td>
        </tr>
      `).join('');
    }

  } catch (err) {
    console.error("Error loading dashboard analytics:", err);
  }
}

