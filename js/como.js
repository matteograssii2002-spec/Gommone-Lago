/* Dati del Lario ricavati dalle carte nautiche ufficiali del Consorzio
   dell'Adda (rilievo 2004, tavole 1-9) e dagli scandagli riportati su di esse. */

/* ---------- approdi pubblici ----------
   Coordinate stampate sulle tavole, in gradi e minuti decimali. */
const A = (nome, lat, lon, tipo, note) => ({ nome, lat, lon, tipo, note });
const dm = (g, m) => g + m / 60;

export const APPRODI = [
  // Ramo di Lecco — casa tua
  A('Mandello del Lario', dm(45, 54.702), dm(9, 19.324), 'porto', 'Porto di Pizza Gera'),
  A('Abbadia Lariana', dm(45, 53.968), dm(9, 19.876), 'porto'),
  A('Lierna', dm(45, 56.925), dm(9, 18.150), 'porto', 'Località Grumo'),
  A('Vassena', dm(45, 55.877), dm(9, 17.099), 'porto', 'Oliveto Lario'),
  A('Oliveto Lario', dm(45, 54.161), dm(9, 18.127), 'porto', 'Onno – La Piana'),
  A('Onno', dm(45, 54.697), dm(9, 17.652), 'porto'),
  A('Parè di Valmadrera', dm(45, 51.666), dm(9, 22.531), 'porto'),
  A('Lecco', dm(45, 51.112), dm(9, 23.203), 'porto', 'Canottieri, porto privato'),

  // Centro lago
  A('Bellagio', dm(45, 59.467), dm(9, 15.915), 'porto'),
  A('Varenna', dm(46, 0.666), dm(9, 16.975), 'porto'),
  A('Menaggio', dm(46, 1.157), dm(9, 14.313), 'porto'),
  A('Tremezzo', dm(45, 58.889), dm(9, 13.105), 'porto'),
  A('Lenno', dm(45, 58.424), dm(9, 12.419), 'porto', 'Baia di Venere'),
  A('Ossuccio', dm(45, 58.000), dm(9, 11.004), 'porto'),
  A('Sala Comacina', dm(45, 57.942), dm(9, 10.227), 'porto'),
  A('Lezzeno', dm(45, 56.863), dm(9, 12.174), 'porto', 'Sostra'),
  A('Argegno', dm(45, 56.624), dm(9, 7.749), 'porto'),

  // Ramo di Como
  A('Nesso Coatesa', dm(45, 54.671), dm(9, 9.265), 'porto'),
  A('Careno', dm(45, 53.745), dm(9, 9.208), 'porto'),
  A('Brienno', dm(45, 54.652), dm(9, 7.903), 'porto'),
  A('Pognana Lario', dm(45, 52.678), dm(9, 9.358), 'porto'),
  A('Laglio', dm(45, 52.808), dm(9, 8.336), 'porto'),
  A('Carate Urio', dm(45, 52.361), dm(9, 7.621), 'porto'),
  A('Faggeto Lario', dm(45, 51.857), dm(9, 8.956), 'porto'),
  A('Moltrasio', dm(45, 51.657), dm(9, 6.169), 'porto'),
  A('Torno', dm(45, 51.305), dm(9, 6.815), 'porto', 'Pontile nuovo'),
  A('Blevio', dm(45, 50.387), dm(9, 6.129), 'porto', 'Porto vecchio'),
  A('Cernobbio', dm(45, 50.415), dm(9, 4.721), 'porto'),
  A('Tavernola', dm(45, 49.893), dm(9, 4.349), 'porto'),
  A('Como', dm(45, 48.897), dm(9, 4.869), 'porto', 'Como Marina'),

  // Alto Lario
  A('Bellano', dm(46, 2.659), dm(9, 18.171), 'porto'),
  A('Dervio', dm(46, 4.110), dm(9, 18.332), 'porto', 'Porto S. Cecilia'),
  A('Corenno Plinio', dm(46, 5.531), dm(9, 18.588), 'porto'),
  A('Colico', dm(46, 8.254), dm(9, 22.199), 'porto'),
  A('Gera Lario', dm(46, 10.061), dm(9, 22.252), 'porto'),
  A('Domaso', dm(46, 9.030), dm(9, 19.510), 'porto'),
  A('Gravedona', dm(46, 8.666), dm(9, 18.308), 'porto'),
  A('Dongo', dm(46, 7.330), dm(9, 16.796), 'porto'),
  A('Piona', dm(46, 7.491), dm(9, 20.700), 'porto'),
  A('Pianello del Lario', dm(46, 6.335), dm(9, 16.703), 'porto'),
  A('Nobiallo', dm(46, 2.011), dm(9, 14.270), 'porto'),
];

/* approdi di emergenza segnalati con la E gialla sulle tavole */
export const EMERGENZE = [
  A('Mandello del Lario', dm(45, 54.70), dm(9, 19.32), 'emergenza'),
  A('Abbadia Lariana', dm(45, 53.97), dm(9, 19.88), 'emergenza'),
  A('Pescallo', dm(45, 58.95), dm(9, 15.83), 'emergenza'),
  A('Varenna', dm(46, 0.67), dm(9, 16.98), 'emergenza'),
  A('Tremezzo', dm(45, 58.89), dm(9, 13.11), 'emergenza'),
  A('Nobiallo', dm(46, 2.01), dm(9, 14.27), 'emergenza'),
  A('Argegno', dm(45, 56.62), dm(9, 7.75), 'emergenza'),
  A('Cernobbio', dm(45, 50.60), dm(9, 4.90), 'emergenza'),
  A('Gravedona', dm(46, 8.67), dm(9, 18.31), 'emergenza'),
  A('Bellano', dm(46, 2.66), dm(9, 18.17), 'emergenza'),
];

/* ---------- asse profondo del lago ----------
   [lat, lon, profondità massima in metri sull'asse].
   Ricostruito dagli scandagli delle tavole: 174 m davanti a Mandello,
   ~180 m nell'Alto Lario, oltre 400 m fra Nesso e Argegno. */
export const ASSE = [
  // ramo di Como, da Como a Bellagio
  [[45.8165, 9.0820, 8], [45.8330, 9.0870, 40], [45.8480, 9.1000, 90],
   [45.8620, 9.1130, 150], [45.8760, 9.1330, 230], [45.8920, 9.1440, 310],
   [45.9060, 9.1490, 370], [45.9200, 9.1500, 410], [45.9330, 9.1620, 400],
   [45.9450, 9.1810, 380], [45.9530, 9.1980, 355], [45.9620, 9.2170, 325],
   [45.9700, 9.2340, 295], [45.9780, 9.2490, 255], [45.9860, 9.2570, 225]],
  // ramo di Colico, da Bellagio a Gera Lario
  [[45.9860, 9.2570, 225], [45.9950, 9.2560, 255], [46.0060, 9.2530, 300],
   [46.0130, 9.2560, 345], [46.0200, 9.2600, 380], [46.0300, 9.2680, 390],
   [46.0420, 9.2810, 370], [46.0530, 9.2870, 330], [46.0650, 9.2900, 290],
   [46.0780, 9.2960, 240], [46.0900, 9.3010, 210], [46.1000, 9.3010, 190],
   [46.1100, 9.3000, 180], [46.1200, 9.3050, 178], [46.1300, 9.3160, 170],
   [46.1400, 9.3280, 145], [46.1480, 9.3400, 105], [46.1560, 9.3520, 65],
   [46.1650, 9.3650, 32], [46.1720, 9.3760, 12]],
  // ramo di Lecco, da Bellagio a Lecco
  [[45.9860, 9.2620, 210], [45.9700, 9.2820, 200], [45.9560, 9.2960, 192],
   [45.9420, 9.3070, 182], [45.9280, 9.3150, 174], [45.9130, 9.3210, 162],
   [45.9000, 9.3270, 150], [45.8880, 9.3350, 120], [45.8760, 9.3480, 80],
   [45.8660, 9.3620, 45], [45.8580, 9.3760, 25], [45.8520, 9.3860, 12]],
];

export const LARIO_BOX = { s: 45.80, n: 46.19, w: 9.04, e: 9.42 };
export const nelLario = (lat, lon) =>
  lat > LARIO_BOX.s && lat < LARIO_BOX.n && lon > LARIO_BOX.w && lon < LARIO_BOX.e;

/* profondità massima dell'asse nel punto più vicino */
function assePiuVicino(lat, lon) {
  const mx = 111320 * Math.cos(lat * Math.PI / 180), my = 110540;
  const px = lon * mx, py = lat * my;
  let best = Infinity, val = 0;
  for (const ramo of ASSE) {
    for (let i = 0; i < ramo.length - 1; i++) {
      const [la, lo, da] = ramo[i], [lb, lob, db] = ramo[i + 1];
      const ax = lo * mx, ay = la * my, bx = lob * mx, by = lb * my;
      const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
      let t = l2 === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / l2;
      t = Math.max(0, Math.min(1, t));
      const d = Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
      if (d < best) { best = d; val = da + (db - da) * t; }
    }
  }
  return { dMax: val, distAsse: best };
}

/**
 * Stima della profondità sotto la barca.
 * Le sponde del Lario scendono quasi a picco: la curva parte piatta sulla
 * piana costiera e raggiunge il fondo dell'asse dopo circa ottocento metri.
 * Volutamente prudente: sottostima vicino a riva.
 */
export function profonditaLario(lat, lon, distCosta) {
  if (!nelLario(lat, lon) || distCosta == null) return null;
  const { dMax } = assePiuVicino(lat, lon);
  if (!dMax) return null;
  const L = 420;
  const f = 1 - Math.exp(-Math.pow(distCosta / L, 2));
  const d = dMax * f;
  return { depth: d, max: dMax, fonte: 'carte del Lario' };
}

/* ---------- i venti del Lario ----------
   Nomi e orari come riportati sulle tavole: freccia grigia piena il vento
   mattutino, tratteggiata quello pomeridiano, rosa le perturbazioni. */
export const VENTI = {
  tivano: {
    nome: 'Tivano', da: 'nord',
    quando: 'Dalla notte fino a metà mattina',
    cosa: 'Scende dalla Valassina e dalla Valtellina. Aria fredda, lago liscio con onda corta. È il vento dei mattinieri: alle 10 di solito è già finito.',
  },
  breva: {
    nome: 'Breva', da: 'sud',
    quando: 'Da mezzogiorno al tramonto',
    cosa: 'Sale da Como e da Lecco, si rinforza col caldo. In estate arriva a 15-20 nodi e alza un\u2019onda corta e ripida che per un due metri e settanta è fastidiosa.',
  },
  bergamasca: {
    nome: 'Bergamasca', da: 'sud-est',
    quando: 'Pomeriggio, ramo di Lecco',
    cosa: 'Entra dalla Valle San Martino verso Mandello e Abbadia. Spesso porta nuvole basse dalle Grigne.',
  },
  traversone: {
    nome: 'Traversone', da: 'ovest',
    quando: 'Ramo di Lecco, fra Onno e Mandello',
    cosa: 'Taglia il lago di traverso proprio davanti a Mandello. Corto e improvviso: è quello che ti prende al largo quando pensavi di stare tranquillo.',
  },
  menaggino: { nome: 'Menaggino', da: 'ovest', quando: 'Centro lago', cosa: 'Scende dalla Val Sanagra su Menaggio, spesso con le perturbazioni.' },
  argegnino: { nome: 'Argegnino', da: 'ovest', quando: 'Ramo di Como', cosa: 'Esce dalla Val d\u2019Intelvi ad Argegno, raffiche secche.' },
  ventone: { nome: 'Ventone', da: 'nord', quando: 'Alto Lario', cosa: 'Scende da Colico, il più forte del lago. È quello che fa felici i windsurfisti a Gera Lario.' },
  breva_laghetti: { nome: 'Breva dei Laghetti', da: 'sud', quando: 'Pomeriggio a Lecco', cosa: 'La breva che risale dal ramo di Lecco passando da Malgrate.' },
};

/** riconosce il vento locale da posizione, direzione e ora */
export function riconosciVento(lat, lon, dirDaGradi, ora) {
  if (!nelLario(lat, lon) || dirDaGradi == null) return null;
  const d = ((dirDaGradi % 360) + 360) % 360;
  const nord = d >= 315 || d < 45;
  const est = d >= 45 && d < 135;
  const sud = d >= 135 && d < 225;
  const ovest = d >= 225 && d < 315;
  const ramoLecco = lon > 9.26 && lat < 45.99;
  const altoLario = lat > 46.08;

  if (nord) return altoLario ? VENTI.ventone : (ora < 12 ? VENTI.tivano : VENTI.ventone);
  if (sud) {
    if (ramoLecco && lat < 45.90) return VENTI.breva_laghetti;
    return VENTI.breva;
  }
  if (est && ramoLecco) return VENTI.bergamasca;
  if (ovest) {
    if (ramoLecco) return VENTI.traversone;
    if (lat > 45.99) return VENTI.menaggino;
    return VENTI.argegnino;
  }
  return null;
}

/* ---------- distintivi ---------- */
export const DISTINTIVI = [
  { id: 'primo', nome: 'Prima uscita', icona: '🚤', come: 'Registra il tuo primo giro', test: t => t.length >= 1 },
  { id: 'cinque', nome: 'Habitué del Lario', icona: '🏅', come: 'Cinque uscite registrate', test: t => t.length >= 5 },
  { id: 'tivano', nome: 'In piedi col Tivano', icona: '🌅', come: 'Parti prima delle otto del mattino', test: t => t.some(x => new Date(x.start).getHours() < 8) },
  { id: 'bellagio', nome: 'Punta Spartivento', icona: '🧭', come: 'Passa davanti a Bellagio', test: t => t.some(x => (x.points || []).some(p => Math.hypot((p.lat - 45.9877) * 111, (p.lon - 9.2596) * 78) < 1.2)) },
  { id: 'venticinque', nome: 'Venticinque chilometri', icona: '🌊', come: 'Venticinque km in totale', test: t => t.reduce((s, x) => s + x.distance, 0) > 25000 },
  { id: 'cento', nome: 'Cento nel Lario', icona: '👑', come: 'Cento km in totale', test: t => t.reduce((s, x) => s + x.distance, 0) > 100000 },
  { id: 'abisso', nome: 'Sopra l\u2019abisso', icona: '🕳️', come: 'Passa dove il fondo supera i 200 metri', test: t => t.some(x => (x.maxDepth || 0) > 200) },
  { id: 'lungo', nome: 'Gita lunga', icona: '⛽', come: 'Un\u2019uscita di almeno quindici km', test: t => t.some(x => x.distance > 15000) },
];
