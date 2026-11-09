// CSV import and export. Column names are flexible ("Asking price", "price", "Price (£)" all work).
import type { Db, Property } from './types';
import type { Observation } from './engine';
import { STATUS_LABEL } from './types';
import { parseArea, parseBasis, parseDate, parseEpc, parseInt0, parsePrice, parseStatus, parseType, postcodeOf } from './parse';

/** RFC 4180 CSV reader: quoted fields, commas and line breaks inside quotes, "" escapes. */
export function readCsv(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = [], field = '', q = false;
  const s = text.replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { if (c === '"') { if (s[i + 1] === '"') { field += '"'; i++; } else q = false; } else field += c; continue; }
    if (c === '"') q = true; else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && s[i + 1] === '\n') i++; row.push(field); field = ''; if (row.some((x) => x.trim())) rows.push(row); row = []; }
    else field += c;
  }
  row.push(field); if (row.some((x) => x.trim())) rows.push(row);
  return rows;
}

const ALIASES: Record<string, string[]> = {
  address: ['address', 'property address', 'street address', 'property'],
  town: ['town', 'location', 'area', 'village'],
  postcode: ['postcode', 'post code', 'postal code'],
  price: ['price', 'asking price', 'current price', 'current asking price', 'price (£)', 'price £'],
  basis: ['pricing basis', 'price basis', 'price type', 'price qualifier', 'basis'],
  status: ['status', 'marketing status', 'availability'],
  bedrooms: ['bedrooms', 'beds', 'bedroom count', 'no. of bedrooms'],
  bathrooms: ['bathrooms', 'baths', 'bathroom count'],
  propertyType: ['property type', 'type'],
  floorAreaSqm: ['floor area', 'floor area sqm', 'floor area (sq m)', 'floor area m2', 'size', 'area sqm'],
  landSize: ['land size', 'garden', 'garden size', 'land', 'plot size'],
  epc: ['epc', 'epc rating', 'energy rating'],
  homeReportValuation: ['home report valuation', 'home report', 'valuation'],
  agent: ['agent', 'selling agent', 'estate agent', 'solicitor'],
  url: ['url', 'link', 'listing url', 'original url'],
  listingId: ['listing id', 'id', 'reference', 'ref', 'property reference'],
  dateFirstAdvertised: ['date first advertised', 'first advertised', 'date listed', 'listed date', 'date added'],
  date: ['observed date', 'date observed', 'date seen', 'as at', 'snapshot date'],
  closingDate: ['closing date'],
  photoUrl: ['photo url', 'photo', 'image', 'image url'],
  photoPermitted: ['photo permitted', 'photo allowed', 'display photo'],
};

export function mapHeaders(header: string[]): { map: Record<string, number>; unknown: string[] } {
  const map: Record<string, number> = {}; const unknown: string[] = [];
  header.forEach((h, i) => {
    const k = h.trim().toLowerCase().replace(/\s+/g, ' ');
    const f = Object.keys(ALIASES).find((key) => ALIASES[key].includes(k));
    if (f && map[f] === undefined) map[f] = i; else if (k) unknown.push(h.trim());
  });
  return { map, unknown };
}

export function csvToObservations(text: string): { rows: { obs: Observation | null; error?: string }[]; unknownColumns: string[]; missing: string[] } {
  const all = readCsv(text);
  if (!all.length) return { rows: [], unknownColumns: [], missing: ['address', 'town'] };
  const { map, unknown } = mapHeaders(all[0]);
  const missing = ['address', 'town'].filter((f) => map[f] === undefined);
  if (missing.length) return { rows: [], unknownColumns: unknown, missing };
  const get = (r: string[], f: string) => (map[f] === undefined ? '' : (r[map[f]] ?? '').trim());
  const rows = all.slice(1).map((r) => {
    const address = get(r, 'address'), town = get(r, 'town');
    if (!address || !town) return { obs: null, error: 'address or town is empty' };
    const pr = parsePrice(get(r, 'price')); const basisCol = parseBasis(get(r, 'basis'));
    const statusText = get(r, 'status'); const status = parseStatus(statusText);
    if (statusText && !status) return { obs: null, error: `status "${statusText}" not recognised` };
    const dateText = get(r, 'date'); const date = parseDate(dateText);
    if (dateText && !date) return { obs: null, error: `observed date "${dateText}" not recognised (use YYYY-MM-DD or DD/MM/YYYY)` };
    const obs: Observation = {
      address, town, postcode: get(r, 'postcode') || postcodeOf(address), price: pr.price, basis: basisCol || pr.basis, status,
      bedrooms: parseInt0(get(r, 'bedrooms')), bathrooms: parseInt0(get(r, 'bathrooms')), propertyType: parseType(get(r, 'propertyType')),
      floorAreaSqm: parseArea(get(r, 'floorAreaSqm')), landSize: get(r, 'landSize') || null, epc: parseEpc(get(r, 'epc')),
      homeReportValuation: parsePrice(get(r, 'homeReportValuation')).price, agent: get(r, 'agent') || null, url: get(r, 'url') || null,
      listingId: get(r, 'listingId') || null, dateFirstAdvertised: parseDate(get(r, 'dateFirstAdvertised')), closingDate: parseDate(get(r, 'closingDate')),
      photoUrl: get(r, 'photoUrl') || null, photoPermitted: /^(y|yes|true|1)$/i.test(get(r, 'photoPermitted')), date,
    };
    return { obs };
  });
  return { rows, unknownColumns: unknown, missing };
}

const esc = (v: unknown) => { const s = v == null ? '' : String(v); return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
export const toCsv = (rows: unknown[][]) => rows.map((r) => r.map(esc).join(',')).join('\r\n') + '\r\n';

export const TEMPLATE_HEADER = ['Address', 'Town', 'Postcode', 'Asking price', 'Pricing basis', 'Status', 'Bedrooms', 'Bathrooms', 'Property type', 'Floor area (sq m)', 'Land size', 'EPC', 'Home Report valuation', 'Agent', 'URL', 'Listing ID', 'Date first advertised', 'Observed date', 'Closing date', 'Photo URL', 'Photo permitted'];

/** Current state of every property (same columns as the import template, plus tracking fields). */
export function exportProperties(db: Db): string {
  const head = [...TEMPLATE_HEADER, 'Original asking price', 'Date first observed', 'Last verified', 'Watched', 'Notes', 'Demo'];
  const rows = db.properties.map((p: Property) => [p.address, p.town, p.postcode, p.askingPrice, p.pricingBasis, STATUS_LABEL[p.status], p.bedrooms, p.bathrooms, p.propertyType, p.floorAreaSqm, p.landSize, p.epc, p.homeReportValuation, p.agent, p.sources[0]?.url, p.sources[0]?.listingId, p.dateFirstAdvertised, p.lastVerified, p.closingDate, p.photoUrl, p.photoPermitted ? 'yes' : 'no', p.originalAskingPrice, p.dateFirstObserved, p.lastVerified, p.watched ? 'yes' : 'no', p.notes, p.isDemo ? 'yes' : 'no']);
  return toCsv([head, ...rows]);
}

/** Every recorded change, oldest first. */
export function exportHistory(db: Db): string {
  const byId = new Map(db.properties.map((p) => [p.id, p]));
  const rows = [...db.events].sort((a, b) => a.date.localeCompare(b.date)).map((e) => { const p = byId.get(e.propertyId); return [e.date, p?.address, p?.town, e.type, e.priceBefore, e.priceAfter, e.basisBefore, e.basisAfter, e.statusBefore, e.statusAfter, e.changes.map((c) => `${c.field}: ${c.before ?? 'Unknown'} -> ${c.after}`).join('; '), e.origin, e.recordedAt]; });
  return toCsv([['Date', 'Address', 'Town', 'Change', 'Price before', 'Price after', 'Basis before', 'Basis after', 'Status before', 'Status after', 'Other changes', 'Origin', 'Recorded at'], ...rows]);
}
