/* Motore nautico: geometria, linea di costa, isolinee di distanza,
   meteo, fondale, modello consumi. */
import { Store } from './store.js';

export const NM = 1852;              // metri in un miglio nautico
const R = 6371008.8;

/* ---------- geometria ---------- */
export function haversine(a, b) {
  const φ1 = a.lat * Math.PI / 180, φ2 = b.lat * Math.PI / 180;
  const dφ = φ2 - φ1, dλ = (b.lon - a.lon) * Math.PI / 180;
  const s = Math.sin(dφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(dλ / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

export function bearing(a, b) {
  const φ1 = a.lat * Math.PI / 180, φ2 = b.lat * Math.PI / 180;
  const dλ = (b.lon - a.lon) * Math.PI / 180;
  const y = Math.sin(dλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(dλ);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

export function compassName(deg) {
  const n = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSO', 'SO', 'OSO', 'O', 'ONO', 'NO', 'NNO'];
  return n[Math.round(deg / 22.5) % 16];
}

function mPerDeg(lat) {
  return { x: 111320 * Math.cos(lat * Math.PI / 180), y: 110540 };
}

function pointSegDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const l2 = dx * dx + dy * dy;
  let t = l2 === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / l2;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx, cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}

/* ---------- linea di costa da OpenStreetMap ---------- */
const OVERPASS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

export class Shore {
  constructor() {
    this.rings = [];      // anelli chiusi (specchi d'acqua) [[{lat,lon}...]]
    this.lines = [];      // linee di costa aperte
    this.cell = 0.01;     // ~1 km
    this.index = new Map();
    this.bbox = null;
    this.loading = false;
    this.error = null;
  }

  key(i, j) { return i + ':' + j; }

  build() {
    this.index.clear();
    const add = (seg) => {
      const [a, b] = seg;
      const i0 = Math.floor(Math.min(a.lat, b.lat) / this.cell), i1 = Math.floor(Math.max(a.lat, b.lat) / this.cell);
      const j0 = Math.floor(Math.min(a.lon, b.lon) / this.cell), j1 = Math.floor(Math.max(a.lon, b.lon) / this.cell);
      for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
        const k = this.key(i, j);
        if (!this.index.has(k)) this.index.set(k, []);
        this.index.get(k).push(seg);
      }
    };
    const walk = (poly) => { for (let n = 0; n < poly.length - 1; n++) add([poly[n], poly[n + 1]]); };
    this.rings.forEach(walk);
    this.lines.forEach(walk);
    this.buildBands();
  }

  /** indice dei lati degli specchi d'acqua per fasce di latitudine:
      senza, il test "sono in acqua" diventa lentissimo su un lago vero */
  buildBands() {
    this.bands = null;
    if (!this.rings.length) return;
    let mn = 90, mx = -90;
    for (const r of this.rings) for (const p of r) { if (p.lat < mn) mn = p.lat; if (p.lat > mx) mx = p.lat; }
    const NB = 400, h = (mx - mn) / NB || 1e-6;
    const b = Array.from({ length: NB }, () => []);
    for (const r of this.rings) {
      for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
        const a = r[i], c = r[j];
        let i0 = Math.floor((Math.min(a.lat, c.lat) - mn) / h);
        let i1 = Math.floor((Math.max(a.lat, c.lat) - mn) / h);
        i0 = Math.max(0, Math.min(NB - 1, i0)); i1 = Math.max(0, Math.min(NB - 1, i1));
        for (let k = i0; k <= i1; k++) b[k].push([a, c]);
      }
    }
    this.bands = { mn, h, NB, b };
  }

  /** distanza in metri dalla costa più vicina; null se non ci sono dati */
  distance(lat, lon) {
    if (!this.index.size) return null;
    const m = mPerDeg(lat);
    const px = lon * m.x, py = lat * m.y;
    const ci = Math.floor(lat / this.cell), cj = Math.floor(lon / this.cell);
    let best = Infinity;
    for (let r = 0; r <= 12; r++) {
      for (let i = ci - r; i <= ci + r; i++) for (let j = cj - r; j <= cj + r; j++) {
        if (r > 0 && Math.abs(i - ci) !== r && Math.abs(j - cj) !== r) continue;
        const segs = this.index.get(this.key(i, j));
        if (!segs) continue;
        for (const [a, b] of segs) {
          const d = pointSegDist(px, py, a.lon * m.x, a.lat * m.y, b.lon * m.x, b.lat * m.y);
          if (d < best) best = d;
        }
      }
      // se ho già trovato qualcosa entro il raggio esplorato, posso fermarmi
      if (best < r * this.cell * 110000) break;
    }
    return isFinite(best) ? best : null;
  }

  /** punto della costa più vicino (per tracciare la linea) */
  nearestPoint(lat, lon) {
    if (!this.index.size) return null;
    const m = mPerDeg(lat);
    const px = lon * m.x, py = lat * m.y;
    const ci = Math.floor(lat / this.cell), cj = Math.floor(lon / this.cell);
    let best = Infinity, bp = null;
    for (let r = 0; r <= 12; r++) {
      for (let i = ci - r; i <= ci + r; i++) for (let j = cj - r; j <= cj + r; j++) {
        if (r > 0 && Math.abs(i - ci) !== r && Math.abs(j - cj) !== r) continue;
        const segs = this.index.get(this.key(i, j));
        if (!segs) continue;
        for (const [a, b] of segs) {
          const ax = a.lon * m.x, ay = a.lat * m.y, bx = b.lon * m.x, by = b.lat * m.y;
          const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
          let t = l2 === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / l2;
          t = Math.max(0, Math.min(1, t));
          const cx = ax + t * dx, cy = ay + t * dy;
          const d = Math.hypot(px - cx, py - cy);
          if (d < best) { best = d; bp = { lat: cy / m.y, lon: cx / m.x }; }
        }
      }
      if (best < r * this.cell * 110000) break;
    }
    return bp;
  }

  /** true se il punto è dentro uno specchio d'acqua mappato, null se non lo so */
  inWater(lat, lon) {
    const B = this.bands;
    if (!B) return null;
    const k = Math.floor((lat - B.mn) / B.h);
    if (k < 0 || k >= B.NB) return false;
    let dentro = false;
    for (const [a, c] of B.b[k]) {
      if ((a.lat > lat) !== (c.lat > lat) &&
          lon < (c.lon - a.lon) * (lat - a.lat) / (c.lat - a.lat) + a.lon) dentro = !dentro;
    }
    return dentro;
  }

  covers(lat, lon) {
    if (!this.bbox) return false;
    const b = this.bbox;
    return lat > b.s + 0.01 && lat < b.n - 0.01 && lon > b.w + 0.015 && lon < b.e - 0.015;
  }

  async load(lat, lon, radiusKm = 12) {
    if (this.loading) return;
    this.loading = true; this.error = null;
    const dLat = radiusKm / 111, dLon = radiusKm / (111 * Math.cos(lat * Math.PI / 180));
    const b = { s: +(lat - dLat).toFixed(3), n: +(lat + dLat).toFixed(3), w: +(lon - dLon).toFixed(3), e: +(lon + dLon).toFixed(3) };
    const ck = `shore:${b.s},${b.w},${b.n},${b.e}`;
    try {
      let data = await Store.cacheGet(ck, 1000 * 60 * 60 * 24 * 60);
      if (!data) {
        const q = `[out:json][timeout:40];(
way["natural"="water"](${b.s},${b.w},${b.n},${b.e});
relation["natural"="water"](${b.s},${b.w},${b.n},${b.e});
way["natural"="coastline"](${b.s},${b.w},${b.n},${b.e});
);out geom;`;
        data = await this.fetchOverpass(q);
        await Store.cacheSet(ck, data);
      }
      this.parse(data);
      this.bbox = b;
      this.build();
    } catch (e) {
      this.error = e.message || 'costa non disponibile';
    } finally {
      this.loading = false;
    }
  }

  async fetchOverpass(q) {
    let last;
    for (const url of OVERPASS) {
      try {
        const r = await fetch(url, { method: 'POST', body: 'data=' + encodeURIComponent(q), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return await r.json();
      } catch (e) { last = e; }
    }
    throw last || new Error('rete non raggiungibile');
  }

  parse(data) {
    this.rings = []; this.lines = [];
    const push = (geom, closed) => {
      if (!geom || geom.length < 2) return;
      const p = geom.map(g => ({ lat: g.lat, lon: g.lon }));
      const isClosed = p[0].lat === p[p.length - 1].lat && p[0].lon === p[p.length - 1].lon;
      if (isClosed && closed !== false) this.rings.push(p); else this.lines.push(p);
    };
    for (const el of (data.elements || [])) {
      if (el.type === 'way') push(el.geometry, el.tags && el.tags.natural === 'coastline' ? false : true);
      else if (el.type === 'relation') for (const m of (el.members || [])) push(m.geometry, true);
    }
  }
}

/* ---------- punti d'interesse ---------- */
export async function loadPOI(lat, lon, radiusKm = 12) {
  const dLat = radiusKm / 111, dLon = radiusKm / (111 * Math.cos(lat * Math.PI / 180));
  const b = [(lat - dLat).toFixed(3), (lon - dLon).toFixed(3), (lat + dLat).toFixed(3), (lon + dLon).toFixed(3)].join(',');
  const ck = 'poi:' + b;
  let data = await Store.cacheGet(ck, 1000 * 60 * 60 * 24 * 30);
  if (!data) {
    const q = `[out:json][timeout:30];(
node["leisure"="marina"](${b});way["leisure"="marina"](${b});
node["seamark:type"="harbour"](${b});
way["waterway"="slipway"](${b});node["waterway"="slipway"](${b});
node["amenity"="boat_rental"](${b});
node["seamark:type"="mooring"](${b});
node["amenity"="fuel"]["boat"="yes"](${b});
node["amenity"="drinking_water"](${b});
node["leisure"="slipway"](${b});
);out center 200;`;
    const s = new Shore();
    data = await s.fetchOverpass(q);
    await Store.cacheSet(ck, data);
  }
  const kind = (t = {}) => {
    if (t.leisure === 'marina' || t['seamark:type'] === 'harbour') return { k: 'porto', label: 'Porto' };
    if (t.waterway === 'slipway' || t.leisure === 'slipway') return { k: 'scivolo', label: 'Scivolo di alaggio' };
    if (t['seamark:type'] === 'mooring') return { k: 'ormeggio', label: 'Ormeggio' };
    if (t.amenity === 'fuel') return { k: 'carburante', label: 'Carburante' };
    if (t.amenity === 'boat_rental') return { k: 'noleggio', label: 'Noleggio' };
    if (t.amenity === 'drinking_water') return { k: 'acqua', label: 'Acqua potabile' };
    return { k: 'altro', label: 'Punto' };
  };
  return (data.elements || []).map(el => {
    const la = el.lat ?? el.center?.lat, lo = el.lon ?? el.center?.lon;
    if (la == null) return null;
    const t = el.tags || {}, ki = kind(t);
    return { lat: la, lon: lo, name: t.name || ki.label, kind: ki.k, label: ki.label };
  }).filter(Boolean);
}

/* ---------- meteo (Open-Meteo, senza chiave) ---------- */
export async function loadWeather(lat, lon) {
  const ck = `wx:${lat.toFixed(2)},${lon.toFixed(2)}`;
  const cached = await Store.cacheGet(ck, 1000 * 60 * 20);
  if (cached) return cached;
  const u = new URL('https://api.open-meteo.com/v1/forecast');
  u.search = new URLSearchParams({
    latitude: lat, longitude: lon,
    current: 'temperature_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m,wind_direction_10m,wind_gusts_10m,pressure_msl,cloud_cover',
    hourly: 'temperature_2m,precipitation_probability,weather_code,wind_speed_10m,wind_gusts_10m,wind_direction_10m,pressure_msl',
    daily: 'sunrise,sunset,uv_index_max',
    wind_speed_unit: 'kn', forecast_days: 2, timezone: 'auto',
  }).toString();
  const r = await fetch(u);
  if (!r.ok) throw new Error('meteo non disponibile');
  const d = await r.json();
  await Store.cacheSet(ck, d);
  return d;
}

export const WX = {
  0: 'Sereno', 1: 'Poco nuvoloso', 2: 'Parzialmente nuvoloso', 3: 'Coperto',
  45: 'Nebbia', 48: 'Nebbia gelata', 51: 'Pioviggine', 53: 'Pioviggine', 55: 'Pioviggine intensa',
  61: 'Pioggia debole', 63: 'Pioggia', 65: 'Pioggia forte', 66: 'Pioggia gelata', 67: 'Pioggia gelata',
  71: 'Neve', 73: 'Neve', 75: 'Neve forte', 77: 'Nevischio',
  80: 'Rovesci', 81: 'Rovesci', 82: 'Rovesci violenti', 85: 'Rovesci di neve', 86: 'Rovesci di neve',
  95: 'Temporale', 96: 'Temporale con grandine', 99: 'Temporale con grandine',
};

/** avvisi meteo pensati per un gommone di 2,7 m */
export function weatherWarnings(d) {
  const out = [];
  if (!d || !d.current) return out;
  const c = d.current, h = d.hourly || {};
  const now = new Date();
  const idx = (h.time || []).findIndex(t => new Date(t) > now);
  const next6 = i => (h[i] || []).slice(Math.max(0, idx), Math.max(0, idx) + 6);

  if (c.wind_gusts_10m >= 22) out.push({ lv: 'danger', t: `Raffiche ${Math.round(c.wind_gusts_10m)} nodi`, s: 'Mare/lago formato. Con 2,7 m di scafo è oltre il ragionevole: resta a terra.' });
  else if (c.wind_gusts_10m >= 15) out.push({ lv: 'warn', t: `Raffiche ${Math.round(c.wind_gusts_10m)} nodi`, s: 'Onda corta e spruzzi. Naviga sottocosta e riduci l\u2019andatura.' });
  if (c.wind_speed_10m >= 12 && c.wind_gusts_10m < 15) out.push({ lv: 'warn', t: `Vento ${Math.round(c.wind_speed_10m)} nodi`, s: 'Condizioni impegnative per un tender.' });

  const gustMax = Math.max(...next6('wind_gusts_10m'), 0);
  if (gustMax >= 18 && gustMax > c.wind_gusts_10m + 4) out.push({ lv: 'warn', t: `Vento in aumento: fino a ${Math.round(gustMax)} nodi`, s: 'Rinforza nelle prossime ore. Pianifica il rientro presto.' });

  const codes = next6('weather_code');
  if ([95, 96, 99].includes(c.weather_code)) out.push({ lv: 'danger', t: 'Temporale in corso', s: 'Rientra subito. Il temporale porta raffiche improvvise e fulmini.' });
  else if (codes.some(k => [95, 96, 99].includes(k))) out.push({ lv: 'danger', t: 'Temporale previsto entro 6 ore', s: 'Sui laghi arriva in fretta dalle valli. Programma un rientro anticipato.' });

  const p = (h.pressure_msl || []).slice(Math.max(0, idx), Math.max(0, idx) + 4);
  if (p.length >= 4 && p[0] - p[3] >= 2) out.push({ lv: 'warn', t: 'Pressione in calo rapido', s: 'Peggioramento in arrivo nelle prossime ore.' });

  if ([45, 48].includes(c.weather_code)) out.push({ lv: 'danger', t: 'Nebbia', s: 'Visibilità ridotta: senza radar, non allontanarti dalla costa.' });

  const sunset = d.daily && d.daily.sunset && d.daily.sunset[0];
  if (sunset) {
    const min = (new Date(sunset) - now) / 60000;
    if (min > 0 && min < 60) out.push({ lv: 'warn', t: `Tramonto tra ${Math.round(min)} minuti`, s: 'La navigazione notturna richiede fanali regolamentari.' });
  }
  return out;
}

/* ---------- fondale ---------- */
let bathy = null;   // GeoJSON importato dall'utente
export function setBathymetry(geojson) { bathy = geojson; }
export function hasBathymetry() { return !!bathy; }

function bathyDepth(lat, lon) {
  if (!bathy) return null;
  const m = mPerDeg(lat), px = lon * m.x, py = lat * m.y;
  let best = Infinity, val = null;
  const key = p => {
    for (const k of ['depth', 'DEPTH', 'profondita', 'elevation', 'ele', 'level', 'value', 'z']) {
      if (p && p[k] != null && !isNaN(+p[k])) return Math.abs(+p[k]);
    }
    return null;
  };
  const scan = (coords, v) => {
    const walk = c => {
      if (typeof c[0] === 'number') {
        const d = Math.hypot(c[0] * m.x - px, c[1] * m.y - py);
        if (d < best) { best = d; val = v; }
      } else c.forEach(walk);
    };
    walk(coords);
  };
  for (const f of (bathy.features || [])) {
    const v = key(f.properties);
    if (v == null || !f.geometry) continue;
    scan(f.geometry.coordinates, v);
  }
  return val != null && best < 800 ? { depth: val, source: 'batimetria importata' } : null;
}

const depthCache = new Map();
export async function depthAt(lat, lon) {
  const local = bathyDepth(lat, lon);
  if (local) return local;
  const k = lat.toFixed(3) + ',' + lon.toFixed(3);
  if (depthCache.has(k)) return depthCache.get(k);
  try {
    const r = await fetch(`https://rest.emodnet-bathymetry.eu/depth_sample?geom=POINT(${lon.toFixed(5)}%20${lat.toFixed(5)})`);
    if (!r.ok) throw 0;
    const j = await r.json();
    const raw = j.avg ?? j.depth ?? j.value ?? (Array.isArray(j) ? j[0] : null);
    const res = (raw != null && !isNaN(+raw)) ? { depth: Math.abs(+raw), source: 'EMODnet' } : null;
    depthCache.set(k, res);
    return res;
  } catch (e) {
    depthCache.set(k, null);
    return null;
  }
}

/* ---------- consumi: Mercury F10 4T su Cape Horn 270 ----------
   Curva litri/ora in funzione della velocità sul fondo, un occupante,
   mare calmo. Da calibrare con il consumo reale (fattore in impostazioni). */
const CURVE = [
  [0, 0.35], [3, 0.55], [6, 0.90], [8, 1.40], [10, 2.00],
  [12, 2.50], [15, 2.90], [18, 3.30], [21, 3.70], [24, 4.00], [28, 4.35],
];

/** velocità massima realistica in base al carico: in tre non plana */
export function maxSpeed(people = 1) {
  return [24, 19, 11][Math.min(2, Math.max(0, (people || 1) - 1))];
}
export function planes(people = 1) { return maxSpeed(people) >= 15; }

export function litersPerHour(kmh, people = 1, calib = 1) {
  const v = Math.max(0, kmh || 0);
  let lph;
  if (v >= CURVE[CURVE.length - 1][0]) lph = CURVE[CURVE.length - 1][1];
  else {
    let i = 0;
    while (i < CURVE.length - 2 && CURVE[i + 1][0] < v) i++;
    const [x1, y1] = CURVE[i], [x2, y2] = CURVE[i + 1];
    lph = y1 + (y2 - y1) * (v - x1) / (x2 - x1);
  }
  const load = 1 + 0.13 * Math.max(0, (people || 1) - 1);
  return lph * load * (calib || 1);
}

export function litersPerKm(kmh, people, calib) {
  if (!kmh || kmh < 0.5) return null;
  return litersPerHour(kmh, people, calib) / kmh;
}

/** l'andatura di crociera più sensata: la più lenta che resta vicina
    al minimo consumo per km in planata */
export function bestCruise(people = 1, calib = 1) {
  const vmax = maxSpeed(people);
  if (!planes(people)) {
    let best = { kmh: 6, lkm: litersPerKm(6, people, calib) };
    for (let v = 4; v <= vmax; v += 0.5) {
      const l = litersPerKm(v, people, calib);
      if (l < best.lkm) best = { kmh: v, lkm: l };
    }
    return best;
  }
  let min = Infinity;
  for (let v = 14; v <= vmax; v += 0.5) min = Math.min(min, litersPerKm(v, people, calib));
  for (let v = 14; v <= vmax; v += 0.5) {
    const l = litersPerKm(v, people, calib);
    if (l <= min * 1.12) return { kmh: v, lkm: l };
  }
  return { kmh: vmax, lkm: min };
}

/** l'andatura più economica in assoluto, in dislocamento */
export function economyCruise(people = 1, calib = 1) {
  let best = { kmh: 5, lkm: Infinity };
  for (let v = 3; v <= 9; v += 0.5) {
    const l = litersPerKm(v, people, calib);
    if (l < best.lkm) best = { kmh: v, lkm: l };
  }
  return best;
}

/** stima di una traversata */
export function planTrip(distanceKm, people, calib, cruiseKmh) {
  const v = Math.min(cruiseKmh || bestCruise(people, calib).kmh, maxSpeed(people));
  const hours = distanceKm / v;
  const liters = litersPerHour(v, people, calib) * hours;
  return { kmh: v, hours, liters, roundTrip: liters * 2, withReserve: liters * 2 * 1.5 };
}
