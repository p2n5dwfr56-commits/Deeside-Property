// Turning messy text (from CSV files, emails or the form) into clean values.
// Anything that cannot be read reliably becomes null ("Unknown"), never a guess.
import type { PricingBasis, PropertyType, Status, Town } from './types';

/** "Offers over £495,000" -> { price: 495000, basis: "Offers over" } */
export function parsePrice(text: unknown): { price: number | null; basis: PricingBasis | null } {
  const s = String(text ?? '').trim();
  if (!s) return { price: null, basis: null };
  const basis = parseBasis(s);
  const m = s.replace(/,/g, '').match(/£?\s*(\d+(?:\.\d+)?)\s*(k|m)?\b/i);
  let price: number | null = null;
  if (m) { price = parseFloat(m[1]); if (/k/i.test(m[2] || '')) price *= 1000; if (/m/i.test(m[2] || '')) price *= 1_000_000; price = Math.round(price); }
  if (price !== null && price < 1000) price = null; // "3 bedrooms" etc. are not prices
  return { price, basis };
}

export function parseBasis(text: unknown): PricingBasis | null {
  const s = String(text ?? '').toLowerCase();
  if (!s.trim()) return null;
  if (/offers?\s+over|^o\/?o\b|\boo\b/.test(s)) return 'Offers over';
  if (/fixed\s*price|^fp\b/.test(s)) return 'Fixed price';
  if (/in\s+the\s+region\s+of|\bo\.?i\.?r\.?o\b|oiro/.test(s)) return 'Offers in the region of';
  if (/offers?\s+around/.test(s)) return 'Offers around';
  if (/guide\s*price/.test(s)) return 'Guide price';
  if (/price\s+on\s+application|\bpoa\b/.test(s)) return 'Price on application';
  return null;
}

/** Status words as they appear in listings and spreadsheets. Unknown words return null (no change). */
export function parseStatus(text: unknown): Status | null {
  const s = String(text ?? '').toLowerCase().trim();
  if (!s) return null;
  if (/missives/.test(s)) return 'missives';
  if (/under\s*offer|offer\s+accepted|sale\s+agreed|\bsstc\b|sold\s+subject/.test(s)) return 'under_offer';
  if (/closing\s*date/.test(s)) return 'closing_date';
  if (/^sold$|completed|sale\s+completed|sold\s*\(confirmed\)/.test(s)) return 'sold';
  if (/withdrawn|off\s+the\s+market/.test(s)) return 'withdrawn';
  if (/for\s*sale|available|new\s+listing|on\s+the\s+market|^active$|reduced|new/.test(s)) return 'for_sale';
  return null;
}

export function parseType(text: unknown): PropertyType | null {
  const s = String(text ?? '').toLowerCase();
  if (!s.trim()) return null;
  if (/semi/.test(s)) return 'Semi-detached';
  if (/bungalow/.test(s)) return 'Bungalow';
  if (/cottage/.test(s)) return 'Cottage';
  if (/flat|apartment|maisonette/.test(s)) return 'Flat';
  if (/terrace|townhouse|mid[-\s]?terr|end[-\s]?terr/.test(s)) return 'Terraced';
  if (/plot|land|site/.test(s)) return 'Plot / land';
  if (/detached|villa|house|farmhouse/.test(s)) return 'Detached';
  return 'Other';
}

export function parseInt0(text: unknown): number | null {
  const m = String(text ?? '').match(/\d+/); if (!m) return null; const n = parseInt(m[0], 10); return Number.isFinite(n) ? n : null;
}

export function parseArea(text: unknown): number | null {
  const s = String(text ?? '').replace(/,/g, '').toLowerCase(); const m = s.match(/(\d+(?:\.\d+)?)/); if (!m) return null;
  let v = parseFloat(m[1]); if (/sq\.?\s*ft|square\s*feet|ft2|ft²/.test(s)) v = v * 0.092903; // convert square feet
  return Math.round(v * 10) / 10;
}

export function parseEpc(text: unknown): string | null { const m = String(text ?? '').toUpperCase().match(/\b([A-G])\b/); return m ? m[1] : null; }

/** Accepts 2026-03-01, 01/03/2026, 1 March 2026. Returns ISO date (YYYY-MM-DD) or null. */
export function parseDate(text: unknown): string | null {
  const s = String(text ?? '').trim(); if (!s) return null;
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/); if (m) return iso(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/); if (m) return iso(m[3].length === 2 ? 2000 + +m[3] : +m[3], +m[2], +m[1]); // UK day/month/year
  const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  m = s.toLowerCase().match(/(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]+)\s+(\d{4})/); if (m) { const mo = months.indexOf(m[2].slice(0, 3)); if (mo >= 0) return iso(+m[3], mo + 1, +m[1]); }
  return null;
}
function iso(y: number, mo: number, d: number): string | null {
  if (!(y > 1990 && mo >= 1 && mo <= 12 && d >= 1 && d <= 31)) return null;
  const dt = new Date(Date.UTC(y, mo - 1, d)); if (dt.getUTCMonth() !== mo - 1) return null;
  return dt.toISOString().slice(0, 10);
}

/** Address key for matching duplicates: lower case, standard abbreviations, no punctuation. */
export function addressKey(address: string, town: string, postcode?: string | null): string {
  const abbrev: Record<string, string> = { rd: 'road', st: 'street', ave: 'avenue', av: 'avenue', dr: 'drive', cres: 'crescent', pl: 'place', gdns: 'gardens', terr: 'terrace', ter: 'terrace', ct: 'court', sq: 'square', ln: 'lane', pk: 'park' };
  const words = `${address} ${town}`.toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, ' ').trim().split(' ').map((w) => abbrev[w] || w);
  const pc = (postcode || '').toUpperCase().replace(/\s+/g, '');
  // the town word may already be in the address: keep each word once, in order
  const seen = new Set<string>(); const out = words.filter((w) => (seen.has(w) ? false : (seen.add(w), true)));
  return out.join(' ') + (pc ? ' ' + pc : '');
}

export function postcodeOf(text: string): string | null {
  const m = text.toUpperCase().match(/\b(AB\d{1,2}\s?\d[A-Z]{2})\b/); // Aberdeen postcode area
  return m ? m[1].replace(/\s?(\d[A-Z]{2})$/, ' $1') : null;
}

/** Straight-line distance between two points in km. */
export function distanceKm(a: Town, b: Town): number {
  const R = 6371, toRad = (x: number) => (x * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat), dLon = toRad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export const today = () => new Date().toISOString().slice(0, 10);
export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
export const fmtMoney = (n: number | null | undefined) => (n == null ? 'Unknown' : '£' + Math.round(n).toLocaleString('en-GB'));
export const fmtDate = (d: string | null | undefined) => (d ? new Date(d + (d.length === 10 ? 'T12:00:00Z' : '')).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : 'Unknown');
export const daysBetween = (a: string, b: string) => Math.round((Date.parse(b.slice(0, 10)) - Date.parse(a.slice(0, 10))) / 86400000);
