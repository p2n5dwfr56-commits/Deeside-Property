// Collected data: the daily collector publishes its results as one encrypted file next to the website
// (collected.enc, made with: openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -md sha256 -salt). The data is only
// readable with the passphrase, so the published site shows nothing to anyone else.
import type { Db } from './domain/types';
import { restore } from './domain/store';

export const collectedMode = !!import.meta.env.VITE_COLLECTED;
const PASS_KEY = 'dpw.passphrase';

export async function decryptOpenSsl(buf: ArrayBuffer, pass: string): Promise<string> {
  const b = new Uint8Array(buf);
  if (new TextDecoder().decode(b.slice(0, 8)) !== 'Salted__') throw new Error('The data file is not in the expected format.');
  const salt = b.slice(8, 16), data = b.slice(16);
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveBits']);
  const bits = new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: 200000, hash: 'SHA-256' }, base, 384));
  const key = await crypto.subtle.importKey('raw', bits.slice(0, 32), 'AES-CBC', false, ['decrypt']);
  try { return new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-CBC', iv: bits.slice(32, 48) }, key, data)); }
  catch { throw new Error('That passphrase is not right.'); }
}

/** Fetch and open the collected data. Your own notes and watchlist (kept in this browser) are laid over it. */
export async function loadCollected(pass: string, mine: Db): Promise<Db> {
  const r = await fetch('./collected.enc', { cache: 'no-store' });
  if (!r.ok) throw new Error('No collected data has been published yet.');
  const db = restore(await decryptOpenSsl(await r.arrayBuffer(), pass));
  const own = new Map(mine.properties.map((p) => [p.id, p]));
  db.properties = db.properties.map((p) => { const o = own.get(p.id); return o ? { ...p, notes: o.notes, watched: o.watched } : p; });
  db.settings = { ...db.settings, ...mine.settings };
  return db;
}

export const savedPass = () => { try { return localStorage.getItem(PASS_KEY); } catch { return null; } };
export const rememberPass = (p: string | null) => { try { if (p) localStorage.setItem(PASS_KEY, p); else localStorage.removeItem(PASS_KEY); } catch { /* storage blocked */ } };
