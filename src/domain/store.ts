// Saving data. This first version keeps everything in this browser's local storage (it survives refreshes and
// restarts). A Supabase back end for private login and use across devices plugs in behind the same load/save calls.
import type { Db, Settings } from './types';

export const KEY = 'deeside-property-watch.v1';

// Town centres (approximate, for the optional radius filter around Torphins)
export const DEFAULT_TOWNS = [
  { name: 'Torphins', lat: 57.1064, lon: -2.6233 },
  { name: 'Banchory', lat: 57.0513, lon: -2.4904 },
  { name: 'Aboyne', lat: 57.0757, lon: -2.7809 },
  { name: 'Ballater', lat: 57.0497, lon: -3.0392 },
  { name: "Kincardine O'Neil", lat: 57.0866, lon: -2.6782 },
  { name: 'Lumphanan', lat: 57.1253, lon: -2.6902 },
];

export const defaultSettings = (): Settings => ({ towns: DEFAULT_TOWNS.map((t) => ({ ...t })), radiusKm: null, criteria: { towns: [], minPrice: null, maxPrice: null, minBeds: null, types: [] }, longOnMarketDays: 90 });
export const emptyDb = (): Db => ({ version: 1, properties: [], events: [], imports: [], alerts: [], settings: defaultSettings() });

export function load(storage: Storage = localStorage): Db {
  try { const s = storage.getItem(KEY); if (!s) return emptyDb(); const db = JSON.parse(s) as Db; return validate(db) ? db : emptyDb(); } catch { return emptyDb(); }
}
export function save(db: Db, storage: Storage = localStorage): { ok: boolean; error?: string } {
  try { storage.setItem(KEY, JSON.stringify(db)); return { ok: true }; }
  catch (e) { return { ok: false, error: 'Could not save in this browser (storage full or blocked): ' + String((e as Error).message || e) }; }
}
export function validate(db: unknown): db is Db {
  const d = db as Db; return !!d && d.version === 1 && Array.isArray(d.properties) && Array.isArray(d.events) && Array.isArray(d.imports) && Array.isArray(d.alerts) && !!d.settings;
}
/** Full backup (everything, including history and notes) as one JSON file. */
export const backup = (db: Db) => JSON.stringify({ app: 'Deeside Property Watch', exportedAt: new Date().toISOString(), db }, null, 1);
export function restore(text: string): Db { const o = JSON.parse(text); const db = o?.db ?? o; if (!validate(db)) throw new Error('This is not a Deeside Property Watch backup file.'); return db; }
