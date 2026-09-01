import { Store } from './store.js';
import {
  NM, haversine, bearing, compassName, Shore,
  loadWeather, WX, weatherWarnings, depthAt,
  litersPerHour, bestCruise, economyCruise, maxSpeed, planTrip,
} from './marine.js';
import { APPRODI, EMERGENZE, profonditaLario, riconosciVento } from './como.js';

const S = {
  set: null, fix: null, speed: 0,
  riva: null, fondo: null, fondoMax: null, aTerra: false,
  meteo: null, vento: null,
  giro: null, benzinaUsata: 0,
  mob: null, ancora: null,
  avvisi: new Map(),
};

const shore = new Shore();
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
/* Leaflet scrive i colori come attributi SVG, dove var() non viene risolto */
const C = n => getComputedStyle(document.documentElement).getPropertyValue('--' + n).trim() || '#000';

/* ---------- formati ---------- */
const kmh = ms => (ms || 0) * 3.6;
const vel = ms => {
  const v = S.set.units === 'kn' ? (ms || 0) * 1.94384 : kmh(ms);
  return v < 10 ? v.toFixed(1) : Math.round(v).toString();
};
const unita = () => S.set.units === 'kn' ? 'nodi' : 'km/h';
const dist = m => m == null ? '—'
  : m < 1000 ? `${Math.round(m)}<i>m</i>`
  : `${(m / 1000).toFixed(1)}<i>km</i>`;
const durata = ms => {
  const min = Math.round(ms / 60000);
  return min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')}`;
};
const ora = t => new Date(t).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
const giorno = t => new Date(t).toLocaleDateString('it-IT', { day: 'numeric', month: 'long' });

/* ---------- tema ---------- */
let temaAttuale = null;
function applicaTema() {
  let t = S.set.theme;
  if (t === 'auto') { const h = new Date().getHours(); t = (h >= 20 || h < 6) ? 'notte' : 'giorno'; }
  if (t === temaAttuale) return;
  temaAttuale = t;
  document.documentElement.dataset.theme = t;
  const m = document.querySelector('meta[name=theme-color]');
  if (m) m.content = t === 'notte' ? '#0A1B20' : '#FFFCF5';
  ricoloraMappa();
}

/* ---------- suono ---------- */
let actx = null;
function bip(n = 2) {
  if (!S.set.alertSound) return;
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    for (let i = 0; i < n; i++) {
      const o = actx.createOscillator(), g = actx.createGain();
      o.type = 'triangle'; o.frequency.value = 780 + i * 120;
      const t0 = actx.currentTime + i * 0.26;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.24, t0 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.2);
      o.connect(g); g.connect(actx.destination); o.start(t0); o.stop(t0 + 0.22);
    }
  } catch (e) {}
  if (navigator.vibrate) navigator.vibrate([170, 80, 170]);
}

/* ---------- avvisi ---------- */
function avvisa(id, grave, titolo, testo) {
  if (S.avvisi.has(id)) return;
  S.avvisi.set(id, { grave, titolo, testo });
  mostraAvvisi();
  bip(grave ? 3 : 1);
}
function togliAvviso(id) { if (S.avvisi.delete(id)) mostraAvvisi(); }

function mostraAvvisi() {
  const el = $('#avvisi'); el.innerHTML = '';
  for (const [id, a] of S.avvisi) {
    const d = document.createElement('div');
    d.className = 'avviso' + (a.grave ? ' grave' : '');
    d.innerHTML = `<div><b></b><p></p></div><button aria-label="Ho capito">×</button>`;
    d.querySelector('b').textContent = a.titolo;
    d.querySelector('p').textContent = a.testo || '';
    d.querySelector('button').onclick = () => togliAvviso(id);
    el.appendChild(d);
  }
}

/* ---------- mappa ---------- */
let map, barca, cerchio, scia, zone, approdi, punti, segnoMob, segnoCasa, cerchioAncora;
let segui = true;

function creaMappa() {
  map = L.map('map', { zoomControl: false, tap: false });
  map.setView([45.9127, 9.3213], 13);   // Mandello
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, attribution: '© OpenStreetMap · carte del Consorzio dell\u2019Adda',
  }).addTo(map);

  approdi = L.layerGroup().addTo(map);
  punti = L.layerGroup().addTo(map);
  scia = L.polyline([], { color: C('corallo'), weight: 5, opacity: .9, lineCap: 'round' }).addTo(map);
  cerchio = L.circle([0, 0], { radius: 0, color: C('lago'), weight: 2, fillOpacity: .1, opacity: .35 }).addTo(map);
  barca = L.marker([0, 0], {
    icon: L.divIcon({ className: '', html: disegnoBarca(), iconSize: [40, 40], iconAnchor: [20, 20] }),
    interactive: false, zIndexOffset: 1000,
  }).addTo(map);

  map.on('dragstart', () => { segui = false; $('#t-centro').classList.remove('acceso'); });
  map.on('moveend', programmaZone);
  map.on('contextmenu', e => salvaPunto(e.latlng.lat, e.latlng.lng));

  disegnaApprodi();
  caricaPunti();
}

function disegnoBarca() {
  return `<svg width="40" height="40" viewBox="0 0 40 40" style="overflow:visible">
    <circle cx="20" cy="20" r="13" style="fill:var(--carta);stroke:var(--inchiostro);stroke-width:3"/>
    <g id="prua" style="transform-origin:20px 20px">
      <path d="M20 3.5 L26 14 L20 11.5 L14 14 Z" style="fill:var(--corallo);stroke:var(--inchiostro);stroke-width:2.4;stroke-linejoin:round"/>
    </g>
    <circle cx="20" cy="20" r="5" style="fill:var(--lago);stroke:var(--inchiostro);stroke-width:2.6"/>
  </svg>`;
}

function ricoloraMappa() {
  if (!map) return;
  scia.setStyle({ color: C('corallo') });
  cerchio.setStyle({ color: C('lago') });
  if (cerchioAncora) cerchioAncora.setStyle({ color: C('sole') });
  disegnaZone();
}

function aggiornaBarca() {
  if (!S.fix) return;
  const p = [S.fix.lat, S.fix.lon];
  barca.setLatLng(p);
  cerchio.setLatLng(p).setRadius(Math.min(S.fix.acc || 0, 250));
  const g = barca.getElement()?.querySelector('#prua');
  if (g) g.style.transform = S.fix.heading != null && !isNaN(S.fix.heading) ? `rotate(${S.fix.heading}deg)` : '';
  if (segui) map.setView(p, Math.max(map.getZoom(), 14), { animate: false });
}

function etichetta(lat, lon, testo, classe, popup) {
  const m = L.marker([lat, lon], {
    icon: L.divIcon({ className: '', html: `<span class="etichetta ${classe || ''}">${testo}</span>`, iconSize: [0, 0] }),
  });
  if (popup) m.bindPopup(popup);
  return m;
}

function disegnaApprodi() {
  approdi.clearLayers();
  if (!S.set.showPOI) return;
  for (const a of APPRODI) {
    etichetta(a.lat, a.lon, '⚓ ' + a.nome, '',
      `<b>${a.nome}</b><br>Approdo pubblico${a.note ? '<br>' + a.note : ''}<br>
       <span class="nota">${a.lat.toFixed(5)}, ${a.lon.toFixed(5)}</span>`).addTo(approdi);
  }
  for (const e of EMERGENZE) {
    etichetta(e.lat, e.lon, '🆘 ' + e.nome, 'emergenza',
      `<b>${e.nome}</b><br>Approdo di emergenza segnalato sulle carte del Lario`).addTo(approdi);
  }
}

async function caricaPunti() {
  punti.clearLayers();
  for (const w of (await Store.all('waypoints') || [])) {
    etichetta(w.lat, w.lon, '⭐ ' + w.nome, '',
      `<b>${w.nome}</b><br><button onclick="window.__togli('${w.id}')">Cancella</button>`).addTo(punti);
  }
}
window.__togli = async id => { await Store.del('waypoints', id); caricaPunti(); map.closePopup(); };

let ultimoPunto = 0;
async function salvaPunto(lat, lon) {
  if (Date.now() - ultimoPunto < 1500) return;
  ultimoPunto = Date.now();
  const nome = prompt('Come lo chiami?', 'Bel posto');
  if (!nome) return;
  await Store.put('waypoints', { id: 'w' + Date.now(), lat, lon, nome, t: Date.now() });
  caricaPunti();
}

/* ---------- fasce di distanza dalla riva ----------
   Disegnate come velo di colore invece che come righe: oltre il miglio
   il rosso si vede da lontano, i 300 metri restano un accenno giallo. */
let timerZone = null;
const programmaZone = () => { clearTimeout(timerZone); timerZone = setTimeout(disegnaZone, 380); };

function disegnaZone() {
  if (!map) return;
  if (zone) { map.removeLayer(zone); zone = null; }
  if (!S.set.showZones || !shore.index.size || map.getZoom() < 10) return;

  const b = map.getBounds();
  const s = b.getSouth(), n = b.getNorth(), w = b.getWest(), e = b.getEast();
  const N = 96;
  const cv = document.createElement('canvas');
  cv.width = N; cv.height = N;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(N, N);
  const px = img.data;
  const noto = shore.rings.length > 0;

  for (let i = 0; i < N; i++) {
    const lat = n - (i + 0.5) * (n - s) / N;
    for (let j = 0; j < N; j++) {
      const lon = w + (j + 0.5) * (e - w) / N;
      const k = (i * N + j) * 4;
      if (noto && shore.inWater(lat, lon) === false) continue;   // a terra: niente
      const d = shore.distance(lat, lon);
      if (d == null) continue;
      if (d > NM) { px[k] = 255; px[k + 1] = 107; px[k + 2] = 87; px[k + 3] = 92; }
      else if (d < 300) { px[k] = 255; px[k + 1] = 201; px[k + 2] = 60; px[k + 3] = 40; }
    }
  }
  ctx.putImageData(img, 0, 0);
  zone = L.imageOverlay(cv.toDataURL(), b, { interactive: false, opacity: 1 }).addTo(map);
  zone.setZIndex(250);
}

/* ---------- GPS ---------- */
function avviaGPS() {
  if (!navigator.geolocation) {
    avvisa('nogps', true, 'Niente GPS', 'Il browser non dà la posizione. Serve un indirizzo https.');
    return;
  }
  navigator.geolocation.watchPosition(nuovaPosizione, erroreGPS,
    { enableHighAccuracy: true, maximumAge: 1000, timeout: 20000 });
}

function erroreGPS(e) {
  if (e.code === 1) avvisa('gps-no', true, 'Posizione bloccata', 'Vai nelle impostazioni del browser e dai il permesso.');
  else avvisa('gps-debole', false, 'Il GPS fatica', 'Metti il telefono dove vede il cielo.');
}

function nuovaPosizione(pos) {
  togliAvviso('gps-debole');
  const c = pos.coords, t = pos.timestamp || Date.now();
  const fix = { lat: c.latitude, lon: c.longitude, acc: c.accuracy, t, heading: c.heading };

  let v = (c.speed != null && !isNaN(c.speed) && c.speed >= 0) ? c.speed : null;
  if (v == null && S.fix) {
    const dt = (t - S.fix.t) / 1000;
    if (dt > 0.3 && dt < 20) v = haversine(S.fix, fix) / dt;
  }
  if (v == null || v < 0.4) v = 0;
  S.speed = S.speed ? S.speed * 0.55 + v * 0.45 : v;

  if (fix.heading == null && S.fix && haversine(S.fix, fix) > 4) fix.heading = bearing(S.fix, fix);
  else if (fix.heading == null) fix.heading = S.fix?.heading ?? null;

  S.fix = fix;
  aggiornaBarca();
  dopoLaPosizione();
  disegnaQuadro();
}

async function dopoLaPosizione() {
  const f = S.fix;

  if (!shore.covers(f.lat, f.lon) && !shore.loading) {
    shore.load(f.lat, f.lon, 14).then(() => { disegnaZone(); calcolaRiva(); });
  }
  calcolaRiva();
  calcolaFondo();

  if (!S._meteoDove || haversine(S._meteoDove, f) > 8000 || Date.now() - (S._meteoQuando || 0) > 1200000) {
    S._meteoDove = { lat: f.lat, lon: f.lon }; S._meteoQuando = Date.now();
    loadWeather(f.lat, f.lon).then(w => {
      S.meteo = w;
      S.vento = riconosciVento(f.lat, f.lon, w.current?.wind_direction_10m, new Date().getHours());
      disegnaCielo(); controllaMeteo(); disegnaQuadro();
    }).catch(() => {});
  }

  registra();
  controllaAncora();
  controllaBenzina();
}

function calcolaRiva() {
  if (!S.fix) return;
  const acqua = shore.rings.length ? shore.inWater(S.fix.lat, S.fix.lon) : null;
  S.aTerra = acqua === false;
  if (S.aTerra) {
    S.riva = null; S.fondo = null;
    togliAvviso('limite'); togliAvviso('basso');
    return;
  }
  const d = shore.distance(S.fix.lat, S.fix.lon);
  S.riva = d;
  if (d == null) return;
  const lim = S.set.limitAlert;
  if (lim > 0) {
    if (d > lim * 1.03) {
      avvisa('limite', false, lim === 300 ? 'Più di 300 metri dalla riva' : 'Hai passato il miglio',
        lim === 300 ? 'Sei fuori dalla fascia dei 300 metri. Occhio ai bagnanti quando rientri.'
                    : 'Da qui in poi serve la dotazione di sicurezza completa.');
    } else if (d < lim * 0.9) togliAvviso('limite');
  }
  if (S.giro) S.giro.maxShore = Math.max(S.giro.maxShore || 0, d);
}

function calcolaFondo() {
  const f = S.fix;
  if (!f || S.aTerra || S.riva == null) return;
  const lario = profonditaLario(f.lat, f.lon, S.riva);
  if (lario) {
    S.fondo = lario.depth; S.fondoMax = lario.max;
    if (S.giro) S.giro.maxDepth = Math.max(S.giro.maxDepth || 0, S.fondo);
    const soglia = S.set.shallowAlert || 0;
    if (soglia > 0 && S.fondo < soglia) {
      avvisa('basso', false, 'Acqua bassa', `Sotto di te ci sono circa ${S.fondo.toFixed(1)} metri. Alza il piede o allontanati dalla riva.`);
    } else if (S.fondo > soglia * 1.6) togliAvviso('basso');
    return;
  }
  if (!S._fondoDove || haversine(S._fondoDove, f) > 100) {
    S._fondoDove = { lat: f.lat, lon: f.lon };
    depthAt(f.lat, f.lon).then(d => {
      S.fondo = d ? d.depth : null; S.fondoMax = null; disegnaQuadro();
    });
  }
}

function controllaBenzina() {
  const restano = S.set.fuelStart - S.benzinaUsata;
  const q = restano / (S.set.tank || 12);
  if (q <= 0.25 && q > 0.12) avvisa('benzina25', false, 'Sei a un quarto di serbatoio', 'È il momento di puntare verso casa.');
  if (q <= 0.12) avvisa('benzina12', true, 'Benzina agli sgoccioli', `Restano circa ${restano.toFixed(1)} litri. Cerca l\u2019approdo più vicino.`);
}

/* ---------- registrazione ---------- */
function iniziaGiro() {
  S.giro = {
    id: 'g' + Date.now(), start: Date.now(), end: null, points: [],
    distance: 0, maxSpeed: 0, maxDepth: 0, maxShore: 0, fuel: 0,
    people: S.set.people, moving: 0,
  };
  S.benzinaUsata = 0;
  scia.setLatLngs([]);
  $('#t-rec').classList.add('registra');
  $('#t-rec').textContent = '⏹';
  registra();
}

function registra() {
  if (!S.giro || !S.fix) return;
  const g = S.giro, f = S.fix, ult = g.points[g.points.length - 1];
  if (ult) {
    const d = haversine(ult, f), dt = (f.t - ult.t) / 1000;
    if (d < 3 && dt < 30) return;
    if (dt > 0 && dt < 120) {
      g.distance += d;
      g.fuel += litersPerHour(kmh(S.speed), g.people, S.set.calib) * (dt / 3600);
      if (S.speed > 0.5) g.moving += dt * 1000;
    }
  }
  g.maxSpeed = Math.max(g.maxSpeed, S.speed);
  g.points.push({ lat: f.lat, lon: f.lon, t: f.t, v: S.speed });
  S.benzinaUsata = g.fuel;
  scia.addLatLng([f.lat, f.lon]);
}

async function chiudiGiro() {
  const g = S.giro;
  if (!g) return;
  g.end = Date.now();
  g.avgSpeed = g.moving > 0 ? g.distance / (g.moving / 1000) : 0;
  g.nome = titoloGiro(g);
  S.giro = null;
  $('#t-rec').classList.remove('registra');
  $('#t-rec').textContent = '⏺';
  if (g.points.length > 1 && g.distance > 50) {
    await Store.put('trips', g);
    disegnaDiario();
    mostraRiassunto(g);
  } else {
    disegnaQuadro();
    apriPannello(`<h2>Giro troppo corto</h2>
      <p class="nota">Non l\u2019ho salvato: sono meno di cinquanta metri, sembra una prova da fermo.</p>
      <button class="bottone" style="margin-top:14px" onclick="document.getElementById('pannello').classList.remove('on')">Va bene</button>`);
  }
}

/** dà un nome al giro guardando dove è passato */
function titoloGiro(g) {
  let lontano = null, dmax = 0;
  const p0 = g.points[0];
  for (const p of g.points) {
    for (const a of APPRODI) {
      const d = haversine(p, { lat: a.lat, lon: a.lon });
      if (d < 900) {
        const dp = haversine(p0, p);
        if (dp > dmax) { dmax = dp; lontano = a.nome; }
      }
    }
  }
  return lontano ? `Fino a ${lontano}` : `Giro del ${giorno(g.start)}`;
}

function mostraRiassunto(g) {
  apriPannello(`
    <h2>Bel giro 🎉</h2>
    <p class="nota">${g.nome} · ${durata(g.end - g.start)} · salvato nel diario</p>
    <div class="due" style="margin-top:14px">
      <div class="dato"><small>Hai fatto</small><b class="num">${(g.distance / 1000).toFixed(1)}<i> km</i></b></div>
      <div class="dato"><small>Punta massima</small><b class="num">${(g.maxSpeed * 3.6).toFixed(1)}<i> km/h</i></b></div>
      <div class="dato"><small>Benzina</small><b class="num">${g.fuel.toFixed(1)}<i> ℓ</i></b></div>
      <div class="dato"><small>Fondo più profondo</small><b class="num">${g.maxDepth ? Math.round(g.maxDepth) : '—'}<i> m</i></b></div>
    </div>
    <button class="bottone" style="margin-top:16px" onclick="document.getElementById('pannello').classList.remove('on')">Va bene</button>`);
}

/* ---------- uomo in acqua e ancora ---------- */
function mob() {
  if (S.mob) {
    if (!confirm('Tolgo il segnale?')) return;
    S.mob = null;
    if (segnoMob) { map.removeLayer(segnoMob); segnoMob = null; }
    togliAvviso('mob');
    $('#t-mob').classList.remove('acceso');
    return;
  }
  if (!S.fix) return;
  S.mob = { lat: S.fix.lat, lon: S.fix.lon };
  segnoMob = etichetta(S.mob.lat, S.mob.lon, '🆘 Qui', 'mob').addTo(map);
  $('#t-mob').classList.add('acceso');
  bip(4);
  avvisa('mob', true, 'Punto segnato', 'Rotta e distanza le trovi sotto la velocità. Chiama il 112.');
}

function controllaAncora() {
  if (!S.ancora || !S.fix) return;
  const d = haversine(S.ancora, S.fix);
  if (d > S.ancora.r) avvisa('ancora', true, 'L\u2019ancora sta scarrocciando', `Ti sei spostato di ${Math.round(d)} metri.`);
  else togliAvviso('ancora');
}

function ancora() {
  if (!S.fix) return;
  if (S.ancora) {
    S.ancora = null;
    if (cerchioAncora) { map.removeLayer(cerchioAncora); cerchioAncora = null; }
    togliAvviso('ancora');
    return;
  }
  S.ancora = { lat: S.fix.lat, lon: S.fix.lon, r: 40 };
  cerchioAncora = L.circle([S.fix.lat, S.fix.lon],
    { radius: 40, color: C('sole'), weight: 3, dashArray: '6 6', fillOpacity: .12 }).addTo(map);
}

/* ---------- quadro di bordo ---------- */
function disegnaQuadro() {
  const v = kmh(S.speed);
  $('#spd').textContent = S.fix ? vel(S.speed) : '—';
  $('#spd-u').textContent = unita();
  $('#tacho').classList.toggle('veloce', v > maxSpeed(S.set.people) * 0.82);
  $('#onda').classList.toggle('ferma', v < 2);

  // pillole
  const p = [];
  if (!S.fix) p.push({ t: '🛰️ Cerco il GPS' });
  if (S.aTerra) p.push({ t: '🚗 Sei a terra' });
  if (S.mob && S.fix) {
    const d = haversine(S.fix, S.mob), b = bearing(S.fix, S.mob);
    p.push({ t: `🆘 ${Math.round(d)} m verso ${compassName(b)}`, c: 'forte' });
  } else if (S.set.home && S.fix) {
    const d = haversine(S.fix, S.set.home), b = bearing(S.fix, S.set.home);
    p.push({ t: `🏠 ${compassName(b)} · ${d < 1000 ? Math.round(d) + ' m' : (d / 1000).toFixed(1) + ' km'}` });
  }
  if (S.vento && S.meteo?.current) {
    const g = Math.round(S.meteo.current.wind_gusts_10m);
    p.push({ t: `💨 ${S.vento.nome} · ${Math.round(S.meteo.current.wind_speed_10m)} nodi`, c: g >= 15 ? 'forte' : 'vento' });
  }
  if (S.giro) p.push({ t: `⏺ ${(S.giro.distance / 1000).toFixed(1)} km registrati` });
  if (S.fix && S.fix.acc > 30) p.push({ t: `±${Math.round(S.fix.acc)} m` });
  $('#pillbox').innerHTML = p.map(x => `<span class="pill ${x.c || ''}">${x.t}</span>`).join('');

  // quadranti
  const riva = $('#s-riva');
  riva.innerHTML = S.aTerra ? '<i style="font-size:14px">a terra</i>'
    : S.riva == null ? (shore.loading ? '<i style="font-size:14px">un attimo…</i>' : '—')
    : dist(S.riva);
  $('#q-riva').classList.toggle('allarme', !S.aTerra && S.set.limitAlert > 0 && S.riva > S.set.limitAlert);

  const fondo = $('#s-fondo');
  fondo.innerHTML = (S.aTerra || S.fondo == null) ? '—'
    : `${S.fondo < 10 ? S.fondo.toFixed(1) : Math.round(S.fondo)}<i>m</i>`;
  $('#s-fondo-bar').style.width = (S.aTerra || S.fondo == null) ? '0'
    : Math.min(100, S.fondo / 410 * 100) + '%';
  $('#q-fondo').classList.toggle('allarme', !S.aTerra && S.fondo != null && S.set.shallowAlert > 0 && S.fondo < S.set.shallowAlert);

  const restano = Math.max(0, S.set.fuelStart - S.benzinaUsata);
  const lph = litersPerHour(v, S.set.people, S.set.calib);
  $('#s-benzina').innerHTML = S.giro ? `${restano.toFixed(1)}<i>ℓ</i>` : `${lph.toFixed(1)}<i>ℓ/h</i>`;
  $('#s-benzina-bar').style.width = Math.min(100, restano / (S.set.tank || 12) * 100) + '%';
}

/* ---------- cielo ---------- */
function controllaMeteo() {
  for (const a of weatherWarnings(S.meteo)) avvisa('wx:' + a.t, a.lv === 'danger', a.t, a.s);
}

function disegnaCielo() {
  const el = $('#cielo-corpo');
  const w = S.meteo;
  if (!w || !w.current) return;
  const c = w.current, h = w.hourly, d = w.daily;
  const av = weatherWarnings(w);
  const adesso = new Date();
  const i0 = Math.max(0, (h.time || []).findIndex(t => new Date(t) > adesso));

  const ore = (h.time || []).slice(i0, i0 + 10).map((t, k) => {
    const j = i0 + k;
    return `<div>
      <div class="h">${new Date(t).getHours()}</div>
      <div class="n num">${Math.round(h.wind_speed_10m[j])}</div>
      <div class="fr" style="transform:rotate(${h.wind_direction_10m[j] + 180}deg)">↑</div>
      <div class="r num">${Math.round(h.wind_gusts_10m[j])} raff</div>
    </div>`;
  }).join('');

  const gusto = c.wind_gusts_10m;
  const verdetto = gusto >= 22 ? { f: '🙅', t: 'Oggi no', s: 'Con queste raffiche un due metri e settanta non ci sta.' }
    : gusto >= 15 ? { f: '😬', t: 'Solo sottoriva', s: 'Onda corta e spruzzi al largo. Resta vicino alla costa.' }
    : gusto >= 9 ? { f: '🙂', t: 'Si può fare', s: 'Un po\u2019 di movimento, niente di preoccupante.' }
    : { f: '😎', t: 'Lago come l\u2019olio', s: 'Giornata perfetta per staccare.' };

  el.innerHTML = `
    <h1 class="titolo">Che aria tira</h1>
    <p class="occhiello">${WX[c.weather_code] || ''} · aggiornato alle ${ora(Date.now())}</p>

    <div class="sez">
      <div class="riquadro ${gusto >= 15 ? 'corallo' : gusto >= 9 ? 'sole' : 'azzurro'}">
        <div style="font-size:40px;line-height:1">${verdetto.f}</div>
        <div style="font-size:22px;font-weight:800;letter-spacing:-.03em;margin-top:4px">${verdetto.t}</div>
        <p style="font-size:14px;font-weight:600;margin-top:2px">${verdetto.s}</p>
      </div>
    </div>

    ${S.vento ? `<div class="sez">
      <h2>Adesso soffia ${S.vento.nome === 'Breva' || S.vento.nome === 'Bergamasca' ? 'la' : 'il'} ${S.vento.nome}</h2>
      <div class="riquadro crema">
        <p style="font-size:14.5px;font-weight:650">Da ${S.vento.da} · ${S.vento.quando.toLowerCase()}</p>
        <p class="nota" style="margin-top:6px">${S.vento.cosa}</p>
      </div>
    </div>` : ''}

    <div class="sez">
      <div class="due">
        <div class="dato"><small>Vento medio</small><b class="num">${Math.round(c.wind_speed_10m)}<i> nodi</i></b></div>
        <div class="dato" ${gusto >= 15 ? 'style="background:var(--corallo);color:#FFF4E2"' : ''}><small>Raffiche</small><b class="num">${Math.round(gusto)}<i> nodi</i></b></div>
        <div class="dato"><small>Viene da</small><b>${compassName(c.wind_direction_10m)}</b></div>
        <div class="dato"><small>Aria</small><b class="num">${Math.round(c.temperature_2m)}<i>°</i></b></div>
      </div>
    </div>

    ${av.length ? `<div class="sez"><h2>Occhio a queste</h2>
      ${av.map(a => `<div class="riquadro ${a.lv === 'danger' ? 'corallo' : 'sole'}">
        <b style="font-size:15.5px">${a.t}</b><p style="font-size:13.5px;font-weight:600;margin-top:3px">${a.s}</p></div>`).join('')}
    </div>` : ''}

    <div class="sez">
      <h2>Le prossime ore, vento in nodi</h2>
      <div class="ore">${ore}</div>
    </div>

    <div class="sez">
      <div class="due">
        <div class="dato"><small>Alba</small><b>${ora(d.sunrise[0])}</b></div>
        <div class="dato"><small>Tramonto</small><b>${ora(d.sunset[0])}</b></div>
      </div>
    </div>

    <div class="sez">
      <h2>Come funziona il Lario</h2>
      <div class="riquadro crema">
        <p class="nota">Il lago respira due volte al giorno. Di notte e fino a metà mattina scende il
        <b>Tivano</b> da nord, aria fredda e lago liscio. Verso mezzogiorno gira e sale la <b>Breva</b> da sud,
        che col caldo si rinforza fino a 15-20 nodi e alza un\u2019onda corta e ripida.
        Nel ramo di Lecco, davanti a Mandello, ci si mette anche il <b>Traversone</b>: taglia il lago
        di traverso e arriva senza avviso.</p>
        <p class="nota" style="margin-top:8px">Regola pratica: esci presto col Tivano, rientra prima
        che la Breva prenda forza.</p>
      </div>
    </div>`;
}

/* ---------- diario ---------- */
async function disegnaDiario() {
  const giri = (await Store.all('trips') || []).sort((x, y) => y.start - x.start);
  const km = giri.reduce((s, g) => s + g.distance, 0) / 1000;
  $('#diario-totale').textContent = giri.length
    ? `${giri.length} ${giri.length === 1 ? 'uscita' : 'uscite'} · ${km.toFixed(1)} km in tutto. Restano salvati sul telefono anche se chiudi l\u2019app.`
    : 'I giri restano salvati sul telefono, anche se chiudi l\u2019app.';

  const el = $('#elenco-viaggi');
  if (!giri.length) {
    el.innerHTML = `<div class="vuoto"><div class="faccia">🚤</div><b>Nessun giro ancora</b>
      <span>Premi il tasto rosso sulla mappa quando parti e ripremilo quando torni.
      Sotto i cinquanta metri non lo salvo, così le prove da fermo non intasano il diario.</span></div>`;
    return;
  }
  el.innerHTML = giri.map(g => `
    <div class="cartolina" data-id="${g.id}">
      <h3>${g.nome || 'Giro'}</h3>
      <div class="quando">${giorno(g.start)} · ${ora(g.start)}–${ora(g.end)} · ${durata(g.end - g.start)}</div>
      <div class="cifre num">
        <div><small>km</small><b>${(g.distance / 1000).toFixed(1)}</b></div>
        <div><small>media</small><b>${(g.avgSpeed * 3.6).toFixed(1)}</b></div>
        <div><small>punta</small><b>${(g.maxSpeed * 3.6).toFixed(1)}</b></div>
        <div><small>litri</small><b>${(g.fuel || 0).toFixed(1)}</b></div>
      </div>
    </div>`).join('');
  $$('#elenco-viaggi .cartolina').forEach(c => c.onclick = () => apriGiro(c.dataset.id));
}

async function apriGiro(id) {
  const g = await Store.get('trips', id);
  if (!g) return;
  apriPannello(`
    <h2>${g.nome}</h2>
    <p class="nota">${giorno(g.start)} · ${ora(g.start)}–${ora(g.end)}</p>
    <div id="minimappa" style="height:190px;margin:14px 0;border-radius:18px;overflow:hidden;border:3px solid var(--inchiostro)"></div>
    <div class="due">
      <div class="dato"><small>Percorso</small><b class="num">${(g.distance / 1000).toFixed(1)}<i> km</i></b></div>
      <div class="dato"><small>Durata</small><b>${durata(g.end - g.start)}</b></div>
      <div class="dato"><small>Media</small><b class="num">${(g.avgSpeed * 3.6).toFixed(1)}<i> km/h</i></b></div>
      <div class="dato"><small>Punta</small><b class="num">${(g.maxSpeed * 3.6).toFixed(1)}<i> km/h</i></b></div>
      <div class="dato"><small>Benzina</small><b class="num">${(g.fuel || 0).toFixed(1)}<i> ℓ</i></b></div>
      <div class="dato"><small>Fondo massimo</small><b class="num">${g.maxDepth ? Math.round(g.maxDepth) : '—'}<i> m</i></b></div>
    </div>
    <button class="bottone chiaro" style="margin-top:14px" id="x-gpx">Esporta in GPX</button>
    <button class="bottone chiaro" id="x-del">Cancella questo giro</button>`);
  setTimeout(() => {
    const m = L.map('minimappa', { zoomControl: false, attributionControl: false, dragging: false, scrollWheelZoom: false });
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18 }).addTo(m);
    const pl = L.polyline(g.points.map(p => [p.lat, p.lon]), { color: C('corallo'), weight: 4 }).addTo(m);
    m.fitBounds(pl.getBounds(), { padding: [16, 16] });
  }, 60);
  $('#x-gpx').onclick = () => esportaGPX([g]);
  $('#x-del').onclick = async () => {
    if (!confirm('Lo cancello davvero?')) return;
    await Store.del('trips', id); chiudiPannello(); disegnaDiario();
  };
}

function esportaGPX(giri) {
  const esc = s => String(s).replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
  const trk = giri.map(g => `<trk><name>${esc(g.nome)}</name><trkseg>${
    g.points.map(p => `<trkpt lat="${p.lat}" lon="${p.lon}"><time>${new Date(p.t).toISOString()}</time></trkpt>`).join('')
  }</trkseg></trk>`).join('');
  scarica(new Blob([`<?xml version="1.0" encoding="UTF-8"?><gpx version="1.1" creator="Gommone" xmlns="http://www.topografix.com/GPX/1/1">${trk}</gpx>`],
    { type: 'application/gpx+xml' }), (giri.length === 1 ? giri[0].nome : 'giri') + '.gpx');
}

function scarica(blob, nome) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = nome; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

/* ---------- pannello ---------- */
function apriPannello(html) { $('#pannello-corpo').innerHTML = html; $('#pannello').classList.add('on'); }
function chiudiPannello() { $('#pannello').classList.remove('on'); }

/* ---------- lista di controllo ---------- */
const CONTROLLI = [
  'Giubbotti per tutti quelli che salgono',
  'Remi o pagaia, che il 10 cv può fermarsi',
  'Ancora con abbastanza cima',
  'Benzina per andare, tornare e sbagliare',
  'Telefono carico, nella busta stagna',
  'Qualcuno a casa sa dove vai',
  'Tappo di scarico chiuso',
  'Cavo di arresto motore al polso',
];

async function disegnaControlli() {
  const stato = (await Store.get('kv', 'checks')) || {};
  const el = $('#lista-controllo');
  el.innerHTML = CONTROLLI.map((c, i) =>
    `<div class="voce${stato[i] ? ' fatta' : ''}" data-i="${i}"><div class="casella">✓</div><span>${c}</span></div>`).join('');
  $$('#lista-controllo .voce').forEach(v => v.onclick = async () => {
    const i = v.dataset.i;
    stato[i] = !stato[i];
    v.classList.toggle('fatta', !!stato[i]);
    await Store.put('kv', stato, 'checks');
  });
}

/* ---------- dove vado oggi ---------- */
function riempiMete() {
  const sel = $('#pl-meta');
  const da = S.fix || S.set.home || { lat: 45.9127, lon: 9.3213 };
  const lista = APPRODI.map(a => ({ a, d: haversine(da, { lat: a.lat, lon: a.lon }) }))
    .filter(x => x.d > 300).sort((x, y) => x.d - y.d);
  sel.innerHTML = lista.map(x =>
    `<option value="${x.d}">${x.a.nome} · ${(x.d / 1000).toFixed(1)} km</option>`).join('');
  sel.onchange = disegnaPiano;
}

function disegnaPiano() {
  const km = (+$('#pl-meta').value || 0) / 1000;
  const pax = Math.min(3, +$('#pl-pax').value || 1);
  const cr = bestCruise(pax, S.set.calib), eco = economyCruise(pax, S.set.calib), vmax = maxSpeed(pax);
  let v = +$('#pl-kmh').value;
  if (!v || v < 3) { v = Math.round(cr.kmh * 2) / 2; $('#pl-kmh').value = v; }
  if (v > vmax) { v = vmax; $('#pl-kmh').value = v; }
  $('#pl-nota').textContent = `Consigliata ${cr.kmh.toFixed(0)}, massima ${vmax}`;

  const p = planTrip(km, pax, S.set.calib, v);
  const lento = planTrip(km, pax, S.set.calib, eco.kmh);
  const bordo = S.set.fuelStart;
  const ok = p.withReserve <= bordo;

  $('#pl-esito').innerHTML = `
    <div style="font-size:19px;font-weight:800;letter-spacing:-.03em">
      ${durata(p.hours * 3600000)} all\u2019andata, ${p.roundTrip.toFixed(1)} litri per il giro completo
    </div>
    <p class="nota" style="margin-top:8px">Con la regola dei terzi ne vuoi <b>${p.withReserve.toFixed(1)}</b> nel serbatoio:
    uno per andare, uno per tornare, uno che non si tocca.
    Ne hai dichiarati ${bordo}, quindi ${ok ? '<b>ci stai dentro</b> 👍' : '<b>non bastano</b> ⛽'}</p>
    <p class="nota" style="margin-top:6px">Andando piano a ${eco.kmh.toFixed(0)} km/h spenderesti
    ${(lento.liters * 2).toFixed(1)} litri, ma ci metteresti ${durata(lento.hours * 3600000)} solo per arrivare.</p>
    ${pax >= 3 ? `<p class="nota" style="margin-top:6px"><b>In tre non si plana.</b> Il 10 cv non riesce
    a tirare su lo scafo: metti in conto andatura da dislocamento e il doppio del tempo.</p>` : ''}
    ${km > 12 ? `<p class="nota" style="margin-top:6px">Sono ${km.toFixed(0)} km di sola andata: parti col Tivano
    la mattina presto, così torni prima che la Breva si alzi.</p>` : ''}`;
}

/* ---------- impostazioni ---------- */
function collegaImpostazioni() {
  const s = S.set;
  const salva = async () => { await Store.saveSettings(S.set); disegnaQuadro(); };

  $('#set-tank').value = s.tank;
  $('#set-fuel').value = s.fuelStart;
  $('#set-pax').value = s.people;
  $('#set-calib').value = s.calib;
  $('#calib-v').textContent = (+s.calib).toFixed(2);
  $('#set-limit').value = String(s.limitAlert);
  $('#set-shallow').value = s.shallowAlert;
  $('#pl-pax').value = s.people;

  $('#set-tank').oninput = e => { s.tank = +e.target.value || 12; salva(); };
  $('#set-fuel').oninput = e => { s.fuelStart = +e.target.value || 0; salva(); disegnaPiano(); };
  $('#set-pax').oninput = e => { s.people = Math.min(3, +e.target.value || 1); $('#pl-pax').value = s.people; salva(); disegnaPiano(); };
  $('#pl-pax').oninput = e => { s.people = Math.min(3, +e.target.value || 1); $('#set-pax').value = s.people; salva(); disegnaPiano(); };
  $('#pl-kmh').oninput = disegnaPiano;
  $('#set-calib').oninput = e => { s.calib = +e.target.value; $('#calib-v').textContent = s.calib.toFixed(2); salva(); disegnaPiano(); };
  $('#set-limit').onchange = e => { s.limitAlert = +e.target.value; togliAvviso('limite'); salva(); };
  $('#set-shallow').oninput = e => { s.shallowAlert = +e.target.value || 0; togliAvviso('basso'); salva(); };

  const interr = (id, k, poi) => {
    const el = $(id);
    el.classList.toggle('on', !!s[k]);
    el.onclick = () => { s[k] = !s[k]; el.classList.toggle('on', s[k]); salva(); poi && poi(); };
  };
  interr('#set-sound', 'alertSound');
  interr('#set-awake', 'keepAwake', tieniAcceso);

  const gruppo = (id, k, poi) => $$(`${id} button`).forEach(b => {
    b.classList.toggle('on', s[k] === b.dataset.v);
    b.onclick = () => {
      s[k] = b.dataset.v;
      $$(`${id} button`).forEach(x => x.classList.toggle('on', x.dataset.v === s[k]));
      salva(); poi && poi();
    };
  });
  gruppo('#set-units', 'units', disegnaQuadro);
  gruppo('#set-theme', 'theme', applicaTema);

  $('#btn-casa').onclick = async () => {
    if (!S.fix) return alert('Aspetta che arrivi il GPS.');
    s.home = { lat: S.fix.lat, lon: S.fix.lon };
    await salva();
    if (segnoCasa) map.removeLayer(segnoCasa);
    segnoCasa = etichetta(s.home.lat, s.home.lon, '🏠 Casa', 'casa').addTo(map);
    $('#casa-stato').textContent = `Scivolo salvato: ${s.home.lat.toFixed(5)}, ${s.home.lon.toFixed(5)}`;
    riempiMete(); disegnaPiano();
  };
  $('#casa-stato').textContent = s.home
    ? `Scivolo salvato: ${s.home.lat.toFixed(5)}, ${s.home.lon.toFixed(5)}`
    : 'Non hai ancora salvato dove metti in acqua.';

  $('#btn-esporta').onclick = async () => {
    const t = await Store.all('trips');
    if (!t || !t.length) return alert('Non c\u2019è ancora niente da esportare.');
    esportaGPX(t);
  };

  $('#btn-sos').onclick = () => {
    if (!S.fix) return alert('Aspetta che arrivi il GPS.');
    const { lat, lon } = S.fix;
    const gm = (v, a, b) => { const g = Math.floor(Math.abs(v)); return `${g}° ${((Math.abs(v) - g) * 60).toFixed(3)}' ${v >= 0 ? a : b}`; };
    let vicino = null, dv = Infinity;
    for (const a of [...APPRODI, ...EMERGENZE]) {
      const d = haversine(S.fix, { lat: a.lat, lon: a.lon });
      if (d < dv) { dv = d; vicino = a; }
    }
    apriPannello(`
      <h2>Dove sei</h2>
      <p class="nota">Questa schermata non chiama e non manda niente da sola.
      Ti dà solo i numeri da leggere a voce a chi risponde al telefono.</p>
      <div class="riquadro sole" style="margin-top:12px">
        <div class="riga"><label>Gradi e minuti</label><b class="mono">${gm(lat, 'N', 'S')}<br>${gm(lon, 'E', 'O')}</b></div>
        <div class="riga"><label>Decimali</label><b class="mono">${lat.toFixed(5)}<br>${lon.toFixed(5)}</b></div>
      </div>
      ${vicino ? `<div class="riquadro azzurro" style="margin-top:12px">
        <b>Approdo più vicino</b>
        <p style="font-size:15px;font-weight:700;margin-top:2px">${vicino.nome}, a ${dv < 1000 ? Math.round(dv) + ' m' : (dv / 1000).toFixed(1) + ' km'}
        verso ${compassName(bearing(S.fix, { lat: vicino.lat, lon: vicino.lon }))}</p></div>` : ''}
      <a class="bottone rosso" style="margin-top:14px" href="tel:112">Chiama il 112</a>
      <p class="nota" style="margin-top:12px">Digli quante persone siete, di che colore è il gommone
      e se c\u2019è qualcuno in acqua.</p>`);
  };

  $('#btn-condividi').onclick = async () => {
    if (!S.fix) return alert('Aspetta che arrivi il GPS.');
    const t = `Sono qui: https://www.openstreetmap.org/?mlat=${S.fix.lat.toFixed(5)}&mlon=${S.fix.lon.toFixed(5)}#map=16/${S.fix.lat.toFixed(5)}/${S.fix.lon.toFixed(5)}`;
    if (navigator.share) { try { await navigator.share({ text: t }); } catch (e) {} }
    else { await navigator.clipboard.writeText(t); alert('Copiato negli appunti.'); }
  };
}

/* ---------- livelli ---------- */
function apriLivelli() {
  const anc = !!S.ancora;
  apriPannello(`
    <h2>Sulla mappa</h2>
    <div class="riquadro">
      <div class="riga"><label>Approdi e punti di emergenza<span class="sotto">Dalle carte del Lario</span></label><div class="interr${S.set.showPOI ? ' on' : ''}" id="l-poi"><i></i></div></div>
      <div class="riga"><label>Fasce di distanza dalla riva</label><div class="interr${S.set.showZones ? ' on' : ''}" id="l-iso"><i></i></div></div>
    </div>
    <div class="riquadro crema" style="margin-top:12px">
      <div class="legenda">
        <div><i style="background:rgba(255,107,87,.55)"></i> Oltre un miglio dalla riva</div>
        <div><i style="background:rgba(255,201,60,.35)"></i> Entro i 300 metri, occhio ai bagnanti</div>
        <div><i style="background:var(--carta)"></i> In mezzo, la fascia in cui stai di solito</div>
      </div>
    </div>
    <h2 style="margin-top:22px">All\u2019ancora</h2>
    <button class="bottone ${anc ? 'rosso' : 'chiaro'}" id="l-anc">${anc ? 'Spegni la guardia all\u2019ancora' : 'Accendi la guardia all\u2019ancora'}</button>
    <p class="nota" style="margin-top:8px">Suona se ti allontani di più di quaranta metri dal punto in cui hai calato.</p>
    <h2 style="margin-top:22px">Posti tuoi</h2>
    <button class="bottone chiaro" id="l-punto">Segna questo posto</button>
    <p class="nota" style="margin-top:8px">Sulla mappa puoi anche tenere premuto dove vuoi.</p>`);

  $('#l-poi').onclick = async e => {
    S.set.showPOI = !S.set.showPOI; e.currentTarget.classList.toggle('on', S.set.showPOI);
    await Store.saveSettings(S.set); disegnaApprodi();
  };
  $('#l-iso').onclick = async e => {
    S.set.showZones = !S.set.showZones; e.currentTarget.classList.toggle('on', S.set.showZones);
    await Store.saveSettings(S.set); disegnaZone();
  };
  $('#l-anc').onclick = () => { ancora(); chiudiPannello(); };
  $('#l-punto').onclick = () => { if (S.fix) { chiudiPannello(); salvaPunto(S.fix.lat, S.fix.lon); } };
}

/* ---------- schermo acceso ---------- */
let lock = null;
async function tieniAcceso() {
  try {
    if (S.set.keepAwake && 'wakeLock' in navigator) lock = await navigator.wakeLock.request('screen');
    else if (lock) { lock.release(); lock = null; }
  } catch (e) {}
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') tieniAcceso(); });

/* ---------- navigazione ---------- */
function vai(v) {
  $$('.view').forEach(s => s.classList.toggle('on', s.id === 'v-' + v));
  $$('nav button').forEach(b => b.classList.toggle('on', b.dataset.v === v));
  if (v === 'lago') setTimeout(() => map.invalidateSize(), 60);
  if (v === 'diario') disegnaDiario();
  if (v === 'barca') { riempiMete(); disegnaPiano(); }
  if (v === 'cielo' && S.meteo) disegnaCielo();
}

/* ---------- avvio ---------- */
async function avvia() {
  S.set = await Store.settings();
  if (S.set.shallowAlert == null) S.set.shallowAlert = 3;
  if (S.set.showZones == null) S.set.showZones = S.set.showContours !== false;
  if (S.set.limitAlert === 5556) S.set.limitAlert = 1852;
  applicaTema();
  setInterval(applicaTema, 300000);

  creaMappa();
  collegaImpostazioni();
  disegnaControlli();
  riempiMete();
  disegnaPiano();
  disegnaQuadro();
  disegnaDiario();
  tieniAcceso();

  if (S.set.home) {
    segnoCasa = etichetta(S.set.home.lat, S.set.home.lon, '🏠 Casa', 'casa').addTo(map);
    map.setView([S.set.home.lat, S.set.home.lon], 14);
  }

  $$('nav button').forEach(b => b.onclick = () => vai(b.dataset.v));
  $('#t-centro').onclick = () => {
    segui = !segui;
    $('#t-centro').classList.toggle('acceso', segui);
    if (segui && S.fix) map.setView([S.fix.lat, S.fix.lon], Math.max(map.getZoom(), 15));
  };
  $('#t-livelli').onclick = apriLivelli;
  $('#t-mob').onclick = mob;
  $('#t-rec').onclick = () => S.giro ? chiudiGiro() : iniziaGiro();
  $('#pannello .velo').onclick = chiudiPannello;

  let lp;
  map.on('mousedown', e => {
    if (!e.latlng) return;
    const { lat, lng } = e.latlng;
    lp = setTimeout(() => salvaPunto(lat, lng), 700);
  });
  map.on('mouseup dragstart move zoomstart', () => clearTimeout(lp));

  avviaGPS();
  setInterval(disegnaQuadro, 1000);

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
}

avvia();
