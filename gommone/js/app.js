import { Store } from './store.js';
import {
  NM, haversine, bearing, compassName, Shore, distanceContours, loadPOI,
  loadWeather, WX, weatherWarnings, depthAt, setBathymetry, hasBathymetry,
  litersPerHour, litersPerKm, bestCruise, economyCruise, maxSpeed, planes, planTrip,
} from './marine.js';

/* ================= stato ================= */
const S = {
  set: null,
  fix: null,            // {lat,lon,acc,t,speed(m/s),heading}
  prev: null,
  speed: 0,             // m/s filtrata
  shoreDist: null,
  depth: null,
  depthSrc: null,
  wx: null,
  trip: null,           // viaggio in corso
  fuelUsed: 0,
  mob: null,
  anchor: null,         // {lat,lon,r}
  poi: [],
  view: 'bordo',
  alerts: new Map(),
  lastContour: 0,
  wakeLock: null,
};

const shore = new Shore();
const $ = s => document.querySelector(s);
/* Leaflet scrive i colori come attributi SVG, dove var() non viene risolto:
   leggo i valori reali dal foglio di stile. */
const C = n => getComputedStyle(document.documentElement).getPropertyValue('--' + n).trim() || '#000';
const $$ = s => [...document.querySelectorAll(s)];

/* ================= formattazione ================= */
const kmh = ms => (ms || 0) * 3.6;
const fmtSpeed = ms => {
  const v = S.set.units === 'kn' ? (ms || 0) * 1.94384 : kmh(ms);
  return v < 10 ? v.toFixed(1) : Math.round(v).toString();
};
const speedUnit = () => S.set.units === 'kn' ? 'nodi' : 'km/h';

function fmtDist(m) {
  if (m == null) return '—';
  if (m < 1000) return `${Math.round(m)}<i>m</i>`;
  if (m < 20000) return `${(m / 1000).toFixed(1)}<i>km</i>`;
  return `${Math.round(m / 1000)}<i>km</i>`;
}
const fmtNM = m => (m / NM).toFixed(2) + ' M';
function fmtDur(ms) {
  const min = Math.round(ms / 60000);
  return min < 60 ? `${min} min` : `${Math.floor(min / 60)}h ${String(min % 60).padStart(2, '0')}`;
}
const fmtTime = t => new Date(t).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
const fmtDate = t => new Date(t).toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' });

/* ================= tema ================= */
let curTheme = null;
function applyTheme() {
  let t = S.set.theme;
  if (t === 'auto') {
    const h = new Date().getHours();
    t = (h >= 20 || h < 6) ? 'notte' : 'giorno';
  }
  if (t === curTheme) return;
  curTheme = t;
  document.documentElement.dataset.theme = t;
  const m = document.querySelector('meta[name=theme-color]');
  if (m) m.content = t === 'notte' ? '#05090B' : '#E9E5D6';
  restyleMap();
}

/* ================= suono ================= */
let actx = null;
function beep(times = 2) {
  if (!S.set.alertSound) return;
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    for (let i = 0; i < times; i++) {
      const o = actx.createOscillator(), g = actx.createGain();
      o.type = 'square'; o.frequency.value = 880;
      const t0 = actx.currentTime + i * 0.32;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.22, t0 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.2);
      o.connect(g); g.connect(actx.destination);
      o.start(t0); o.stop(t0 + 0.22);
    }
  } catch (e) { /* silenzio */ }
  if (navigator.vibrate) navigator.vibrate([180, 90, 180]);
}

/* ================= avvisi ================= */
function alert_(id, lv, title, sub, sticky = true) {
  if (S.alerts.has(id)) return;
  S.alerts.set(id, { lv, title, sub, sticky });
  renderBanners();
  if (lv === 'danger') beep(3); else if (lv === 'warn') beep(1);
}
function clearAlert(id) { if (S.alerts.delete(id)) renderBanners(); }

function renderBanners() {
  const el = $('#banners');
  el.innerHTML = '';
  for (const [id, a] of S.alerts) {
    const d = document.createElement('div');
    d.className = 'banner ' + (a.lv === 'danger' ? '' : a.lv);
    d.innerHTML = `<div><b></b><p></p></div><button aria-label="Chiudi">×</button>`;
    d.querySelector('b').textContent = a.title;
    d.querySelector('p').textContent = a.sub || '';
    d.querySelector('button').onclick = () => clearAlert(id);
    el.appendChild(d);
  }
}

/* ================= mappa ================= */
let map, boatMarker, accCircle, trackLine, shoreLine, contourGroup, poiGroup,
    mobMarker, homeMarker, anchorCircle, wpGroup, seamark;
let follow = true;

function initMap() {
  map = L.map('map', { zoomControl: false, attributionControl: true, tap: false });
  map.setView([45.9, 8.6], 12);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, attribution: '© OpenStreetMap',
  }).addTo(map);
  seamark = L.tileLayer('https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png', { maxZoom: 18, opacity: .9 });

  contourGroup = L.layerGroup().addTo(map);
  poiGroup = L.layerGroup().addTo(map);
  wpGroup = L.layerGroup().addTo(map);
  trackLine = L.polyline([], { color: C('magenta'), weight: 3.5, opacity: .85 }).addTo(map);
  shoreLine = L.polyline([], { color: C('ink-2'), weight: 1.2, dashArray: '3 4', opacity: .8 }).addTo(map);

  accCircle = L.circle([0, 0], { radius: 0, color: C('deep'), weight: 1, fillOpacity: .07, opacity: .3 }).addTo(map);
  boatMarker = L.marker([0, 0], {
    icon: L.divIcon({ className: 'boat-dot', html: boatSVG(), iconSize: [34, 34], iconAnchor: [17, 17] }),
    interactive: false, zIndexOffset: 1000,
  }).addTo(map);

  map.on('dragstart', () => { follow = false; $('#t-center').classList.remove('on'); });
  map.on('moveend', () => scheduleContours());
  map.on('contextmenu', e => addWaypointAt(e.latlng.lat, e.latlng.lng));
}

function boatSVG() {
  return `<svg width="34" height="34" viewBox="0 0 34 34" style="overflow:visible">
    <circle cx="17" cy="17" r="9" style="fill:var(--paper);stroke:var(--deep);stroke-width:2"/>
    <g id="bhead" style="transform-origin:17px 17px">
      <path d="M17 2.5 L21.8 12 L12.2 12 Z" style="fill:var(--magenta)"/>
    </g>
    <circle cx="17" cy="17" r="3.4" style="fill:var(--deep)"/>
  </svg>`;
}

/** riapplica i colori alle geometrie quando cambia il tema */
function restyleMap() {
  if (!map) return;
  trackLine.setStyle({ color: C('magenta') });
  shoreLine.setStyle({ color: C('ink-2') });
  accCircle.setStyle({ color: C('deep') });
  if (anchorCircle) anchorCircle.setStyle({ color: C('amber') });
  drawContours();
}

function updateBoat() {
  if (!S.fix) return;
  const p = [S.fix.lat, S.fix.lon];
  boatMarker.setLatLng(p);
  accCircle.setLatLng(p).setRadius(Math.min(S.fix.acc || 0, 300));
  const hd = S.fix.heading;
  const g = boatMarker.getElement()?.querySelector('#bhead');
  if (g) g.style.transform = hd != null && !isNaN(hd) ? `rotate(${hd}deg)` : 'rotate(0deg)';
  if (follow) map.setView(p, Math.max(map.getZoom(), 14), { animate: false });
}

/* --- isolinee --- */
let contourTimer = null;
function scheduleContours() {
  clearTimeout(contourTimer);
  contourTimer = setTimeout(drawContours, 420);
}

function drawContours() {
  contourGroup.clearLayers();
  if (!S.set.showContours || !shore.index.size || map.getZoom() < 11) return;
  const b = map.getBounds();
  const bounds = { s: b.getSouth(), w: b.getWest(), n: b.getNorth(), e: b.getEast() };
  const styles = {
    300: { color: C('amber'), weight: 1.6, dashArray: '2 5' },
    [NM]: { color: C('magenta'), weight: 2, dashArray: '9 6' },
    [3 * NM]: { color: C('magenta'), weight: 1.4, dashArray: '3 7', opacity: .7 },
  };
  let sets;
  try { sets = distanceContours(shore, bounds, [300, NM, 3 * NM]); }
  catch (e) { return; }
  for (const { level, segments } of sets) {
    if (!segments.length) continue;
    const lines = segments.map(([a, b2]) => [[a[0], a[1]], [b2[0], b2[1]]]);
    L.polyline(lines, Object.assign({ interactive: false }, styles[level])).addTo(contourGroup);
    // etichetta sul primo segmento visibile
    const s0 = segments[Math.floor(segments.length / 2)];
    if (s0) {
      L.marker([s0[0][0], s0[0][1]], {
        interactive: false,
        icon: L.divIcon({ className: '', html: `<span class="poi-lbl">${level === 300 ? '300 m' : level === NM ? '1 M' : '3 M'}</span>`, iconSize: [0, 0] }),
      }).addTo(contourGroup);
    }
  }
}

/* --- punti d'interesse --- */
const POI_ICON = { porto: '⚓', scivolo: '⛴', ormeggio: '⚓', carburante: '⛽', noleggio: '⛵', acqua: '🚰', altro: '•' };
function drawPOI() {
  poiGroup.clearLayers();
  if (!S.set.showPOI) return;
  for (const p of S.poi) {
    L.marker([p.lat, p.lon], {
      icon: L.divIcon({ className: '', html: `<span class="poi-lbl">${POI_ICON[p.kind] || '•'} ${p.name}</span>`, iconSize: [0, 0], iconAnchor: [0, 8] }),
    }).addTo(poiGroup).bindPopup(`<b>${p.name}</b><br>${p.label}<br><span class="note">${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}</span>`);
  }
}

async function drawWaypoints() {
  wpGroup.clearLayers();
  const wps = await Store.all('waypoints') || [];
  for (const w of wps) {
    L.marker([w.lat, w.lon], {
      icon: L.divIcon({ className: '', html: `<span class="poi-lbl">◈ ${w.name}</span>`, iconSize: [0, 0] }),
    }).addTo(wpGroup).bindPopup(`<b>${w.name}</b><br><button onclick="window.__delWp('${w.id}')">Elimina</button>`);
  }
}
window.__delWp = async id => { await Store.del('waypoints', id); drawWaypoints(); map.closePopup(); };

let lastWp = 0;
async function addWaypointAt(lat, lon) {
  if (Date.now() - lastWp < 1500) return;
  lastWp = Date.now();
  const name = prompt('Nome del punto', 'Punto ' + new Date().toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }));
  if (!name) return;
  await Store.put('waypoints', { id: 'w' + Date.now(), lat, lon, name, t: Date.now() });
  drawWaypoints();
}

/* ================= GPS ================= */
function startGPS() {
  if (!navigator.geolocation) {
    alert_('nogps', 'danger', 'GPS non disponibile', 'Il browser non espone la posizione. Serve una connessione sicura (https).');
    return;
  }
  navigator.geolocation.watchPosition(onFix, onGPSError, {
    enableHighAccuracy: true, maximumAge: 1000, timeout: 20000,
  });
}

function onGPSError(e) {
  if (e.code === 1) alert_('gpsden', 'danger', 'Posizione negata', 'Concedi l\u2019accesso alla posizione nelle impostazioni del browser.');
  else alert_('gpslost', 'warn', 'Segnale GPS debole', 'Metti il telefono dove vede il cielo.');
}

function onFix(pos) {
  clearAlert('gpslost');
  const c = pos.coords;
  const now = pos.timestamp || Date.now();
  const fix = { lat: c.latitude, lon: c.longitude, acc: c.accuracy, t: now, heading: c.heading };

  // velocità: preferisci quella del ricevitore, altrimenti derivala
  let v = (c.speed != null && !isNaN(c.speed) && c.speed >= 0) ? c.speed : null;
  if (v == null && S.fix) {
    const dt = (now - S.fix.t) / 1000;
    if (dt > 0.3 && dt < 20) v = haversine(S.fix, fix) / dt;
  }
  if (v == null) v = 0;
  if (v < 0.4) v = 0;                              // sotto la soglia è rumore
  S.speed = S.speed ? S.speed * 0.55 + v * 0.45 : v;

  if (fix.heading == null && S.fix && haversine(S.fix, fix) > 4) fix.heading = bearing(S.fix, fix);
  else if (fix.heading == null) fix.heading = S.fix?.heading ?? null;

  S.prev = S.fix;
  S.fix = fix;

  updateBoat();
  onNewPosition();
  renderHUD();
}

async function onNewPosition() {
  const f = S.fix;

  if (!shore.covers(f.lat, f.lon) && !shore.loading) {
    shore.load(f.lat, f.lon).then(() => { drawContours(); computeShore(); });
  }
  computeShore();

  // fondale ogni ~80 m
  if (!S._lastDepthAt || haversine(S._lastDepthAt, f) > 80) {
    S._lastDepthAt = { lat: f.lat, lon: f.lon };
    depthAt(f.lat, f.lon).then(d => {
      S.depth = d ? d.depth : null;
      S.depthSrc = d ? d.source : null;
      renderHUD();
      if (S.trip && S.depth != null) S.trip.maxDepth = Math.max(S.trip.maxDepth || 0, S.depth);
    });
  }

  // punti d'interesse
  if (!S._poiAt || haversine(S._poiAt, f) > 6000) {
    S._poiAt = { lat: f.lat, lon: f.lon };
    loadPOI(f.lat, f.lon).then(p => { S.poi = p; drawPOI(); }).catch(() => {});
  }

  // meteo
  if (!S._wxAt || haversine(S._wxAt, f) > 8000 || Date.now() - (S._wxT || 0) > 1200000) {
    S._wxAt = { lat: f.lat, lon: f.lon }; S._wxT = Date.now();
    loadWeather(f.lat, f.lon).then(w => { S.wx = w; renderWeather(); checkWeather(); }).catch(() => {});
  }

  recordPoint();
  checkAnchor();
  checkFuel();
}

function computeShore() {
  if (!S.fix) return;
  const d = shore.distance(S.fix.lat, S.fix.lon);
  S.shoreDist = d;
  if (d != null) {
    const np = shore.nearestPoint(S.fix.lat, S.fix.lon);
    if (np) shoreLine.setLatLngs([[S.fix.lat, S.fix.lon], [np.lat, np.lon]]);
    const lim = S.set.limitAlert;
    if (lim > 0) {
      if (d > lim * 1.02) {
        const name = lim === 300 ? '300 metri' : lim === NM ? '1 miglio' : '3 miglia';
        alert_('limit', 'warn', `Sei oltre ${name} dalla costa`,
          `Distanza attuale ${fmtNM(d)}. Verifica di avere a bordo la dotazione prevista per questa fascia.`);
      } else if (d < lim * 0.92) clearAlert('limit');
    }
    if (S.trip) S.trip.maxShore = Math.max(S.trip.maxShore || 0, d);
  }
  renderHUD();
}

/* ================= consumi ================= */
function checkFuel() {
  const left = S.set.fuelStart - S.fuelUsed;
  const pct = left / (S.set.tank || 12);
  if (pct <= 0.25 && pct > 0.12) alert_('fuel25', 'warn', 'Carburante al 25%', 'Con la regola dei terzi è il momento di rientrare.');
  if (pct <= 0.12) alert_('fuel12', 'danger', 'Carburante quasi esaurito', `Restano circa ${left.toFixed(1)} litri. Dirigi verso il punto di sbarco più vicino.`);
}

/* ================= registrazione viaggio ================= */
function startTrip() {
  S.trip = {
    id: 't' + Date.now(), start: Date.now(), end: null,
    points: [], distance: 0, maxSpeed: 0, maxDepth: 0, maxShore: 0,
    fuel: 0, people: S.set.people, moving: 0,
  };
  S.fuelUsed = 0;
  trackLine.setLatLngs([]);
  $('#t-rec').classList.add('rec');
  $('#t-rec').textContent = '■';
  recordPoint();
}

function recordPoint() {
  if (!S.trip || !S.fix) return;
  const t = S.trip, f = S.fix;
  const last = t.points[t.points.length - 1];
  if (last) {
    const d = haversine(last, f);
    const dt = (f.t - last.t) / 1000;
    if (d < 3 && dt < 30) return;                        // fermo: non registrare
    if (dt > 0 && dt < 120) {
      t.distance += d;
      t.fuel += litersPerHour(kmh(S.speed), t.people, S.set.calib) * (dt / 3600);
      if (S.speed > 0.5) t.moving += dt * 1000;
    }
  }
  t.maxSpeed = Math.max(t.maxSpeed, S.speed);
  t.points.push({ lat: f.lat, lon: f.lon, t: f.t, v: S.speed });
  S.fuelUsed = t.fuel;
  trackLine.addLatLng([f.lat, f.lon]);
}

async function stopTrip() {
  if (!S.trip) return;
  const t = S.trip;
  t.end = Date.now();
  t.avgSpeed = t.moving > 0 ? t.distance / (t.moving / 1000) : 0;
  t.name = 'Uscita del ' + new Date(t.start).toLocaleDateString('it-IT', { day: 'numeric', month: 'short' });
  if (t.points.length > 1 && t.distance > 50) await Store.put('trips', t);
  S.trip = null;
  $('#t-rec').classList.remove('rec');
  $('#t-rec').textContent = '●';
  renderTrips();
  renderHUD();
}

/* ================= uomo in mare e ancora ================= */
function toggleMOB() {
  if (S.mob) {
    if (!confirm('Cancellare il punto uomo in mare?')) return;
    S.mob = null;
    if (mobMarker) { map.removeLayer(mobMarker); mobMarker = null; }
    clearAlert('mob');
    $('#t-mob').classList.remove('on');
    return;
  }
  if (!S.fix) return;
  S.mob = { lat: S.fix.lat, lon: S.fix.lon, t: Date.now() };
  mobMarker = L.marker([S.mob.lat, S.mob.lon], {
    icon: L.divIcon({ className: '', html: `<span class="poi-lbl" style="border-color:var(--magenta);color:var(--magenta)">⚑ Uomo in mare</span>`, iconSize: [0, 0] }),
  }).addTo(map);
  $('#t-mob').classList.add('on');
  beep(3);
  alert_('mob', 'danger', 'Punto uomo in mare segnato', 'Rotta e distanza compaiono sotto la velocità. Chiama il 112.');
}

function checkAnchor() {
  if (!S.anchor || !S.fix) return;
  const d = haversine(S.anchor, S.fix);
  if (d > S.anchor.r) alert_('anchor', 'danger', 'L\u2019ancora sta arando', `Ti sei spostato di ${Math.round(d)} m dal punto di fonda.`);
  else clearAlert('anchor');
}

function setAnchor() {
  if (!S.fix) return;
  if (S.anchor) {
    S.anchor = null;
    if (anchorCircle) { map.removeLayer(anchorCircle); anchorCircle = null; }
    clearAlert('anchor');
    return false;
  }
  const r = 40;
  S.anchor = { lat: S.fix.lat, lon: S.fix.lon, r };
  anchorCircle = L.circle([S.fix.lat, S.fix.lon], { radius: r, color: C('amber'), weight: 1.5, dashArray: '4 4', fillOpacity: .06 }).addTo(map);
  return true;
}

function shoreZone(d) {
  if (d < 300) return 'Sotto i 300 m dalla costa';
  if (d < NM) return 'Nella fascia entro 1 miglio';
  if (d < 3 * NM) return 'Oltre 1 miglio, entro 3';
  return 'Oltre 3 miglia dalla costa';
}

/* ================= interfaccia: bordo ================= */
function renderHUD() {
  $('#spd').textContent = S.fix ? fmtSpeed(S.speed) : '—';
  $('#spd-u').textContent = speedUnit();

  const vmax = maxSpeed(S.set.people);
  const cruise = bestCruise(S.set.people, S.set.calib).kmh;
  $('#gauge-fill').style.width = Math.min(100, kmh(S.speed) / vmax * 100) + '%';
  $('#gauge-mark').style.left = Math.min(100, cruise / vmax * 100) + '%';

  // riga sotto la velocità
  const bits = [];
  if (S.fix?.heading != null) bits.push(`Rotta ${compassName(S.fix.heading)} ${Math.round(S.fix.heading)}°`);
  if (S.mob && S.fix) {
    const d = haversine(S.fix, S.mob), b = bearing(S.fix, S.mob);
    bits.unshift(`Uomo in mare a ${Math.round(d)} m verso ${compassName(b)}`);
  } else if (S.set.home && S.fix) {
    const d = haversine(S.fix, S.set.home), b = bearing(S.fix, S.set.home);
    bits.push(`Rientro ${compassName(b)} · ${d < 1000 ? Math.round(d) + ' m' : (d / 1000).toFixed(1) + ' km'}`);
  }
  if (!S.fix) bits.push('In attesa del segnale GPS');
  else if (S.fix.acc > 30) bits.push(`Precisione ±${Math.round(S.fix.acc)} m`);
  if (S.trip) bits.push(`Registrazione · ${(S.trip.distance / 1000).toFixed(1)} km`);
  if (!bits.length && S.shoreDist != null) bits.push(shoreZone(S.shoreDist));
  if (!bits.length) bits.push('Segnale acquisito');
  $('#hud-sub').textContent = bits.join(' · ');

  // strumenti
  const sh = $('#s-shore');
  if (S.shoreDist == null) {
    sh.innerHTML = shore.loading ? '<i style="font-size:14px">carico…</i>' : '—';
    sh.classList.remove('alarm');
  } else {
    sh.innerHTML = fmtDist(S.shoreDist);
    sh.classList.toggle('alarm', S.set.limitAlert > 0 && S.shoreDist > S.set.limitAlert);
  }

  const dp = $('#s-depth');
  dp.innerHTML = S.depth == null ? '—' : `${S.depth < 10 ? S.depth.toFixed(1) : Math.round(S.depth)}<i>m</i>`;

  const left = Math.max(0, S.set.fuelStart - S.fuelUsed);
  const lph = litersPerHour(kmh(S.speed), S.set.people, S.set.calib);
  $('#s-fuel').innerHTML = S.trip
    ? `${left.toFixed(1)}<i>ℓ · ${lph.toFixed(1)} ℓ/h</i>`
    : `${lph.toFixed(1)}<i>ℓ/h</i>`;
}

/* ================= interfaccia: meteo ================= */
function checkWeather() {
  const w = weatherWarnings(S.wx);
  for (const a of w) alert_('wx:' + a.t, a.lv, a.t, a.s);
}

function renderWeather() {
  const el = $('#wx-body');
  if (!S.wx || !S.wx.current) return;
  const c = S.wx.current, h = S.wx.hourly, d = S.wx.daily;
  const warns = weatherWarnings(S.wx);
  const now = new Date();
  const i0 = Math.max(0, (h.time || []).findIndex(t => new Date(t) > now));

  const hours = (h.time || []).slice(i0, i0 + 10).map((t, k) => {
    const j = i0 + k;
    return `<div>
      <div class="h">${new Date(t).getHours()}</div>
      <div class="w num">${Math.round(h.wind_speed_10m[j])}</div>
      <div class="arrow" style="transform:rotate(${h.wind_direction_10m[j] + 180}deg)">↑</div>
      <div class="g num">${Math.round(h.wind_gusts_10m[j])} raff.</div>
    </div>`;
  }).join('');

  el.innerHTML = `
    <h1 class="title">Meteo</h1>
    <p class="lede">${WX[c.weather_code] || '—'} · aggiornato alle ${fmtTime(Date.now())}</p>

    ${warns.length ? `<div class="sec"><h2>Attenzione</h2>${warns.map(w2 => `
      <div class="card" style="border-color:${w2.lv === 'danger' ? 'var(--magenta)' : 'var(--amber)'}">
        <b style="color:${w2.lv === 'danger' ? 'var(--magenta)' : 'var(--amber)'}">${w2.t}</b>
        <p class="note" style="margin-top:3px">${w2.s}</p>
      </div>`).join('')}</div>`
      : `<div class="sec"><div class="card"><b class="pill ok">Condizioni gestibili</b>
         <p class="note" style="margin-top:8px">Niente di rilevante per un gommone di 2,7 m. Ricontrolla prima di allontanarti.</p></div></div>`}

    <div class="sec">
      <div class="wx-now">
        <div class="t num">${Math.round(c.temperature_2m)}°</div>
        <div style="padding-top:6px">
          <div>Percepiti ${Math.round(c.apparent_temperature)}°</div>
          <div class="note">Nuvolosità ${Math.round(c.cloud_cover)}% · ${Math.round(c.pressure_msl)} hPa</div>
        </div>
      </div>
    </div>

    <div class="sec">
      <h2>Vento adesso</h2>
      <div class="grid2">
        <div class="stat"><small>Medio</small><b class="num">${Math.round(c.wind_speed_10m)}<i>nodi</i></b></div>
        <div class="stat"><small>Raffiche</small><b class="num" style="${c.wind_gusts_10m >= 15 ? 'color:var(--magenta)' : ''}">${Math.round(c.wind_gusts_10m)}<i>nodi</i></b></div>
      </div>
      <div class="stat" style="margin-top:8px"><small>Direzione</small><b>Da ${compassName(c.wind_direction_10m)} <i>${Math.round(c.wind_direction_10m)}°</i></b></div>
    </div>

    <div class="sec">
      <h2>Vento nelle prossime ore, in nodi</h2>
      <div class="hours">${hours}</div>
    </div>

    <div class="sec">
      <h2>Luce</h2>
      <div class="grid2">
        <div class="stat"><small>Alba</small><b>${fmtTime(d.sunrise[0])}</b></div>
        <div class="stat"><small>Tramonto</small><b>${fmtTime(d.sunset[0])}</b></div>
      </div>
    </div>

    <p class="note" style="margin-top:26px">Sui laghi prealpini il vento gira due volte al giorno: la brezza di valle sale verso mezzogiorno, quella di monte scende al mattino presto e dopo il tramonto. Un pomeriggio calmo può diventare mosso in mezz'ora, soprattutto nei bacini stretti.</p>
    <p class="note" style="margin-top:10px">Dati Open-Meteo, modello ad area limitata. Per le uscite in mare consulta anche il bollettino della Guardia Costiera.</p>`;
}

/* ================= interfaccia: viaggi ================= */
async function renderTrips() {
  const list = $('#trips-list');
  const trips = (await Store.all('trips') || []).sort((a, b) => b.start - a.start);
  if (!trips.length) {
    list.innerHTML = `<div class="empty"><b>Ancora nessuna uscita</b>Premi il tasto tondo sulla mappa per registrare il prossimo giro.</div>`;
    return;
  }
  list.innerHTML = trips.map(t => `
    <div class="trip" data-id="${t.id}">
      <h3>${t.name || 'Uscita'}</h3>
      <div class="when">${fmtDate(t.start)} · ${fmtTime(t.start)}–${fmtTime(t.end)} · ${fmtDur(t.end - t.start)}</div>
      <div class="figs num">
        <div><small>Percorso</small><b>${(t.distance / 1000).toFixed(1)} km</b></div>
        <div><small>Media</small><b>${(t.avgSpeed * 3.6).toFixed(1)}</b></div>
        <div><small>Massima</small><b>${(t.maxSpeed * 3.6).toFixed(1)}</b></div>
        <div><small>Consumo</small><b>${t.fuel.toFixed(1)} ℓ</b></div>
      </div>
    </div>`).join('');
  $$('#trips-list .trip').forEach(el => el.onclick = () => openTrip(el.dataset.id));
}

async function openTrip(id) {
  const t = await Store.get('trips', id);
  if (!t) return;
  openSheet(`
    <h2>${t.name}</h2>
    <p class="note">${fmtDate(t.start)} · ${fmtTime(t.start)}–${fmtTime(t.end)}</p>
    <div id="tmap" style="height:190px;margin:14px 0;border-radius:10px;overflow:hidden;border:1px solid var(--rule)"></div>
    <div class="grid2">
      <div class="stat"><small>Percorso</small><b class="num">${(t.distance / 1000).toFixed(1)}<i>km</i></b></div>
      <div class="stat"><small>Durata</small><b>${fmtDur(t.end - t.start)}</b></div>
      <div class="stat"><small>Velocità media</small><b class="num">${(t.avgSpeed * 3.6).toFixed(1)}<i>km/h</i></b></div>
      <div class="stat"><small>Velocità massima</small><b class="num">${(t.maxSpeed * 3.6).toFixed(1)}<i>km/h</i></b></div>
      <div class="stat"><small>Consumo stimato</small><b class="num">${t.fuel.toFixed(1)}<i>ℓ</i></b></div>
      <div class="stat"><small>Consumo per km</small><b class="num">${t.distance > 100 ? (t.fuel / (t.distance / 1000)).toFixed(2) : '—'}<i>ℓ/km</i></b></div>
      <div class="stat"><small>Fondale massimo</small><b class="num">${t.maxDepth ? Math.round(t.maxDepth) + '<i>m</i>' : '—'}</b></div>
      <div class="stat"><small>Max dalla costa</small><b class="num">${t.maxShore ? fmtDist(t.maxShore) : '—'}</b></div>
    </div>
    <button class="btn ghost" style="margin-top:14px" id="tx-gpx">Esporta in GPX</button>
    <button class="btn ghost" id="tx-del">Elimina questa uscita</button>
  `);
  setTimeout(() => {
    const m = L.map('tmap', { zoomControl: false, attributionControl: false, dragging: false, scrollWheelZoom: false });
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18 }).addTo(m);
    const pl = L.polyline(t.points.map(p => [p.lat, p.lon]), { color: C('magenta'), weight: 3 }).addTo(m);
    m.fitBounds(pl.getBounds(), { padding: [18, 18] });
  }, 60);
  $('#tx-gpx').onclick = () => exportGPX([t]);
  $('#tx-del').onclick = async () => {
    if (!confirm('Eliminare questa uscita?')) return;
    await Store.del('trips', id); closeSheet(); renderTrips();
  };
}

function exportGPX(trips) {
  const trk = trips.map(t => `<trk><name>${t.name}</name><trkseg>${
    t.points.map(p => `<trkpt lat="${p.lat}" lon="${p.lon}"><time>${new Date(p.t).toISOString()}</time></trkpt>`).join('')
  }</trkseg></trk>`).join('');
  const gpx = `<?xml version="1.0" encoding="UTF-8"?><gpx version="1.1" creator="Gommone" xmlns="http://www.topografix.com/GPX/1/1">${trk}</gpx>`;
  download(new Blob([gpx], { type: 'application/gpx+xml' }), (trips.length === 1 ? trips[0].name : 'viaggi') + '.gpx');
}

function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

/* ================= pannello ================= */
function openSheet(html) {
  $('#sheet-body').innerHTML = html;
  $('#sheet').classList.add('on');
}
function closeSheet() { $('#sheet').classList.remove('on'); }

/* ================= lista di controllo ================= */
const CHECKS = [
  'Giubbotti di salvataggio per tutti a bordo',
  'Kit di sicurezza per la fascia entro un miglio',
  'Remi o pagaia di riserva',
  'Ancora con cima adeguata',
  'Carburante per andata, ritorno e riserva',
  'Telefono carico e in busta stagna',
  'Qualcuno a terra sa dove vai e quando torni',
  'Meteo e vento controllati',
  'Tappo di scarico chiuso',
  'Cavo di arresto motore indossato',
];

async function renderChecklist() {
  const state = (await Store.get('kv', 'checks')) || {};
  const el = $('#checklist');
  el.innerHTML = CHECKS.map((c, i) => `
    <div class="check${state[i] ? ' done' : ''}" data-i="${i}">
      <div class="box">✓</div><span>${c}</span>
    </div>`).join('');
  $$('#checklist .check').forEach(d => d.onclick = async () => {
    const i = d.dataset.i;
    state[i] = !state[i];
    d.classList.toggle('done', !!state[i]);
    await Store.put('kv', state, 'checks');
  });
}

/* ================= pianificatore ================= */
function renderPlan() {
  const km = +$('#pl-km').value || 0;
  const pax = Math.min(3, +$('#pl-pax').value || 1);
  const best = bestCruise(pax, S.set.calib);
  const eco = economyCruise(pax, S.set.calib);
  const vmax = maxSpeed(pax);
  let v = +$('#pl-kmh').value;
  if (!v || v < 3) { v = Math.round(best.kmh * 2) / 2; $('#pl-kmh').value = v; }
  if (v > vmax) { v = vmax; $('#pl-kmh').value = v; }
  $('#pl-hint').textContent = ` · crociera consigliata ${best.kmh.toFixed(0)} km/h, massima ${vmax}`;

  const p = planTrip(km, pax, S.set.calib, v);
  const slow = planTrip(km, pax, S.set.calib, eco.kmh);
  const left = S.set.fuelStart;
  const ok = p.withReserve <= left;

  $('#pl-out').innerHTML = `
    <div class="grid2">
      <div class="stat"><small>Tempo, sola andata</small><b>${fmtDur(p.hours * 3600000)}</b></div>
      <div class="stat"><small>Andata e ritorno</small><b class="num">${p.roundTrip.toFixed(1)}<i>ℓ</i></b></div>
    </div>
    <p class="note" style="margin-top:10px">Con la regola dei terzi ti servono <strong>${p.withReserve.toFixed(1)} litri</strong> a bordo: uno per andare, uno per tornare, uno di riserva.
    Hai dichiarato ${left} ℓ: <span class="pill ${ok ? 'ok' : 'mag'}">${ok ? 'bastano' : 'non bastano'}</span></p>
    <p class="note" style="margin-top:8px">In dislocamento a ${eco.kmh.toFixed(0)} km/h lo stesso tragitto costa ${(slow.liters * 2).toFixed(1)} ℓ ma dura ${fmtDur(slow.hours * 3600000)} all'andata.</p>
    ${pax >= 3 ? `<p class="note" style="margin-top:8px;color:var(--amber)">Con tre persone il 10 cv non riesce a mandare in planata uno scafo di 2,7 m: metti in conto un'andatura di dislocamento e tempi molto più lunghi.</p>` : ''}`;
}

/* ================= impostazioni ================= */
function bindSettings() {
  const s = S.set;
  const save = async () => { await Store.saveSettings(S.set); renderHUD(); };

  $('#set-tank').value = s.tank;
  $('#set-fuel').value = s.fuelStart;
  $('#set-pax').value = s.people;
  $('#set-calib').value = s.calib;
  $('#calib-v').textContent = (+s.calib).toFixed(2);
  $('#set-limit').value = String(s.limitAlert);

  $('#set-tank').oninput = e => { s.tank = +e.target.value || 12; save(); };
  $('#set-fuel').oninput = e => { s.fuelStart = +e.target.value || 0; save(); renderPlan(); };
  $('#set-pax').oninput = e => {
    s.people = Math.min(3, +e.target.value || 1);
    $('#pl-pax').value = s.people; save(); renderPlan();
  };
  $('#set-calib').oninput = e => { s.calib = +e.target.value; $('#calib-v').textContent = s.calib.toFixed(2); save(); renderPlan(); };
  $('#set-limit').onchange = e => { s.limitAlert = +e.target.value; clearAlert('limit'); save(); };

  const sw = (id, key, after) => {
    const el = $(id);
    el.classList.toggle('on', !!s[key]);
    el.onclick = () => { s[key] = !s[key]; el.classList.toggle('on', s[key]); save(); after && after(); };
  };
  sw('#set-sound', 'alertSound');
  sw('#set-contours', 'showContours', drawContours);
  sw('#set-poi', 'showPOI', drawPOI);
  sw('#set-awake', 'keepAwake', keepAwake);

  const seg = (id, key, after) => {
    $$(`${id} button`).forEach(b => {
      b.classList.toggle('on', s[key] === b.dataset.v);
      b.onclick = () => {
        s[key] = b.dataset.v;
        $$(`${id} button`).forEach(x => x.classList.toggle('on', x.dataset.v === s[key]));
        save(); after && after();
      };
    });
  };
  seg('#set-units', 'units', renderHUD);
  seg('#set-theme', 'theme', () => { applyTheme(); drawContours(); });

  ['#pl-km', '#pl-kmh'].forEach(i => $(i).oninput = renderPlan);
  $('#pl-pax').oninput = e => {
    s.people = Math.min(3, +e.target.value || 1);
    $('#set-pax').value = s.people; save(); renderPlan();
  };
  $('#pl-pax').value = s.people;

  $('#bathy-state').textContent = hasBathymetry()
    ? `Batimetria caricata: ${s.bathyName}.`
    : 'Nessuna batimetria locale caricata.';
  $('#bathy-file').onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    try {
      const j = JSON.parse(await f.text());
      setBathymetry(j);
      await Store.put('kv', j, 'bathy');
      s.bathyName = f.name; save();
      $('#bathy-state').textContent = `Batimetria caricata: ${f.name}.`;
      S._lastDepthAt = null;
    } catch (err) {
      $('#bathy-state').textContent = 'Il file non è un GeoJSON valido.';
    }
  };

  $('#btn-home').onclick = async () => {
    if (!S.fix) return alert('Serve prima una posizione GPS.');
    s.home = { lat: S.fix.lat, lon: S.fix.lon };
    await save();
    if (homeMarker) map.removeLayer(homeMarker);
    homeMarker = L.marker([s.home.lat, s.home.lon], {
      icon: L.divIcon({ className: '', html: '<span class="poi-lbl">⌂ Alaggio</span>', iconSize: [0, 0] }),
    }).addTo(map);
    $('#home-state').textContent = `Punto di alaggio: ${s.home.lat.toFixed(5)}, ${s.home.lon.toFixed(5)}`;
  };
  $('#home-state').textContent = s.home ? `Punto di alaggio: ${s.home.lat.toFixed(5)}, ${s.home.lon.toFixed(5)}` : 'Nessun punto di alaggio salvato.';

  $('#btn-export').onclick = async () => {
    const t = await Store.all('trips');
    if (!t || !t.length) return alert('Non c\u2019è ancora nessun viaggio.');
    exportGPX(t);
  };

  $('#btn-sos').onclick = () => {
    if (!S.fix) return alert('Serve prima una posizione GPS.');
    const { lat, lon } = S.fix;
    const dm = (v, pos, neg) => {
      const d = Math.floor(Math.abs(v)), m = (Math.abs(v) - d) * 60;
      return `${d}° ${m.toFixed(3)}' ${v >= 0 ? pos : neg}`;
    };
    openSheet(`
      <h2>Posizione per i soccorsi</h2>
      <p class="note">Leggi queste coordinate a chi ti risponde.</p>
      <div class="card" style="margin-top:12px">
        <div class="row"><label>Gradi e minuti</label><b class="mono">${dm(lat, 'N', 'S')}<br>${dm(lon, 'E', 'O')}</b></div>
        <div class="row"><label>Decimali</label><b class="mono">${lat.toFixed(5)}<br>${lon.toFixed(5)}</b></div>
        <div class="row"><label>Precisione</label><span>±${Math.round(S.fix.acc)} m</span></div>
      </div>
      <a class="btn alert" style="margin-top:14px;text-decoration:none;line-height:1.6" href="tel:112">Chiama il 112</a>
      <a class="btn ghost" style="text-decoration:none;line-height:1.6" href="tel:1530">Chiama il 1530, Guardia Costiera</a>
      <p class="note" style="margin-top:12px">Descrivi anche: quante persone a bordo, il colore del gommone, se qualcuno è in acqua.</p>`);
  };

  $('#btn-share').onclick = async () => {
    if (!S.fix) return alert('Serve prima una posizione GPS.');
    const txt = `Sono qui: https://www.openstreetmap.org/?mlat=${S.fix.lat.toFixed(5)}&mlon=${S.fix.lon.toFixed(5)}#map=16/${S.fix.lat.toFixed(5)}/${S.fix.lon.toFixed(5)}`;
    if (navigator.share) { try { await navigator.share({ text: txt }); } catch (e) {} }
    else { await navigator.clipboard.writeText(txt); alert('Posizione copiata negli appunti.'); }
  };
}

/* ================= schermo acceso ================= */
async function keepAwake() {
  try {
    if (S.set.keepAwake && 'wakeLock' in navigator) {
      S.wakeLock = await navigator.wakeLock.request('screen');
    } else if (S.wakeLock) { S.wakeLock.release(); S.wakeLock = null; }
  } catch (e) { /* non supportato */ }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') keepAwake();
});

/* ================= navigazione fra le viste ================= */
function go(v) {
  S.view = v;
  $$('.view').forEach(s => s.classList.toggle('on', s.id === 'v-' + v));
  $$('nav button').forEach(b => b.classList.toggle('on', b.dataset.v === v));
  if (v === 'bordo') setTimeout(() => map.invalidateSize(), 60);
  if (v === 'viaggi') renderTrips();
  if (v === 'meteo' && S.wx) renderWeather();
}

/* ================= livelli ================= */
function openLayers() {
  const anchored = !!S.anchor;
  openSheet(`
    <h2>Mappa</h2>
    <div class="card">
      <div class="row"><label>Simbologia nautica<span class="hint">OpenSeaMap: boe, fari, secche</span></label><div class="sw${map.hasLayer(seamark) ? ' on' : ''}" id="l-sea"><i></i></div></div>
      <div class="row"><label>Isolinee 300 m, 1 M, 3 M</label><div class="sw${S.set.showContours ? ' on' : ''}" id="l-cont"><i></i></div></div>
      <div class="row"><label>Porti, scivoli e ormeggi</label><div class="sw${S.set.showPOI ? ' on' : ''}" id="l-poi"><i></i></div></div>
    </div>
    <h2 style="margin-top:22px">Alla fonda</h2>
    <button class="btn ${anchored ? 'alert' : 'ghost'}" id="l-anchor">${anchored ? 'Togli l\u2019allarme di ancoraggio' : 'Attiva l\u2019allarme di ancoraggio'}</button>
    <p class="note" style="margin-top:8px">Suona se ti allontani di più di 40 metri dal punto in cui hai calato l'ancora.</p>
    <h2 style="margin-top:22px">Punti salvati</h2>
    <button class="btn ghost" id="l-wp">Segna qui un punto</button>
    <p class="note" style="margin-top:8px">Sulla mappa puoi anche tenere premuto in un punto qualsiasi per salvarlo.</p>`);

  $('#l-sea').onclick = e => {
    if (map.hasLayer(seamark)) map.removeLayer(seamark); else seamark.addTo(map);
    e.currentTarget.classList.toggle('on');
  };
  $('#l-cont').onclick = async e => {
    S.set.showContours = !S.set.showContours;
    e.currentTarget.classList.toggle('on', S.set.showContours);
    await Store.saveSettings(S.set); drawContours();
  };
  $('#l-poi').onclick = async e => {
    S.set.showPOI = !S.set.showPOI;
    e.currentTarget.classList.toggle('on', S.set.showPOI);
    await Store.saveSettings(S.set); drawPOI();
  };
  $('#l-anchor').onclick = () => { setAnchor(); closeSheet(); };
  $('#l-wp').onclick = () => { if (S.fix) { closeSheet(); addWaypointAt(S.fix.lat, S.fix.lon); } };
}

/* ================= avvio ================= */
async function boot() {
  S.set = await Store.settings();
  applyTheme();
  setInterval(applyTheme, 300000);

  const b = await Store.get('kv', 'bathy');
  if (b) setBathymetry(b);

  initMap();
  bindSettings();
  renderChecklist();
  renderPlan();
  renderHUD();
  renderTrips();
  drawWaypoints();
  keepAwake();

  if (S.set.home) {
    homeMarker = L.marker([S.set.home.lat, S.set.home.lon], {
      icon: L.divIcon({ className: '', html: '<span class="poi-lbl">⌂ Alaggio</span>', iconSize: [0, 0] }),
    }).addTo(map);
    map.setView([S.set.home.lat, S.set.home.lon], 13);
  }

  $$('nav button').forEach(b2 => b2.onclick = () => go(b2.dataset.v));
  $('#t-center').classList.add('on');
  $('#t-center').onclick = () => {
    follow = !follow;
    $('#t-center').classList.toggle('on', follow);
    if (follow && S.fix) map.setView([S.fix.lat, S.fix.lon], Math.max(map.getZoom(), 15));
  };
  $('#t-layers').onclick = openLayers;
  $('#t-mob').onclick = toggleMOB;
  $('#t-rec').onclick = () => S.trip ? stopTrip() : startTrip();
  $('#sheet .veil').onclick = closeSheet;

  // pressione prolungata sulla mappa: salva un punto
  let lt;
  map.on('mousedown', e => {
    if (!e.latlng) return;
    const { lat, lng } = e.latlng;
    lt = setTimeout(() => addWaypointAt(lat, lng), 700);
  });
  map.on('mouseup dragstart move zoomstart', () => clearTimeout(lt));

  startGPS();
  setInterval(renderHUD, 1000);

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

boot();
