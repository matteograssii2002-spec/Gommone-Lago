/* Archivio locale: viaggi, waypoint, impostazioni, cache dati. */
const DB_NAME = 'gommone';
const DB_VER = 1;
let _db = null;

function openDB() {
  if (_db) return Promise.resolve(_db);
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, DB_VER);
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains('trips')) {
        db.createObjectStore('trips', { keyPath: 'id' }).createIndex('start', 'start');
      }
      if (!db.objectStoreNames.contains('waypoints')) db.createObjectStore('waypoints', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
      if (!db.objectStoreNames.contains('cache')) db.createObjectStore('cache');
    };
    r.onsuccess = () => { _db = r.result; res(_db); };
    r.onerror = () => rej(r.error);
  });
}

function tx(store, mode, fn) {
  return openDB().then(db => new Promise((res, rej) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    let out;
    try { out = fn(s); } catch (e) { rej(e); return; }
    t.oncomplete = () => res(out && out.result !== undefined ? out.result : out);
    t.onerror = () => rej(t.error);
  }));
}

export const Store = {
  async put(store, val, key) { return tx(store, 'readwrite', s => s.put(val, key)); },
  async get(store, key) { return tx(store, 'readonly', s => s.get(key)); },
  async del(store, key) { return tx(store, 'readwrite', s => s.delete(key)); },
  async all(store) {
    return tx(store, 'readonly', s => s.getAll());
  },

  // --- impostazioni ---
  async settings() {
    const v = await this.get('kv', 'settings');
    return Object.assign({
      units: 'kmh',            // kmh | kn
      theme: 'auto',           // auto | giorno | notte
      tank: 12,                // litri
      fuelStart: 12,           // litri a bordo a inizio viaggio
      people: 1,
      calib: 1.0,              // fattore di calibrazione consumo
      limitAlert: 300,         // soglia allarme distanza costa (m)
      shallowAlert: 3,         // avvisa sotto questi metri di fondale
      alertSound: true,
      keepAwake: true,
      showZones: true,
      mappaPulita: true,
      showPOI: true,
      home: null,              // {lat,lon,name} punto di alaggio abituale
    }, v || {});
  },
  async saveSettings(s) { return this.put('kv', s, 'settings'); },

  // --- cache generica con scadenza ---
  async cacheGet(key, maxAgeMs) {
    const v = await this.get('cache', key);
    if (!v) return null;
    if (maxAgeMs && Date.now() - v.t > maxAgeMs) return null;
    return v.d;
  },
  async cacheSet(key, d) { return this.put('cache', { t: Date.now(), d }, key); },
};
