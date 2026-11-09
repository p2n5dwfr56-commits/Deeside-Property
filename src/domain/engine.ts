// The tracking engine: compares each new observation of a property with what is stored, records every change as a
// dated event (old and new values kept), avoids duplicates, and raises alerts. Pure functions: easy to test.
import type { Alert, Db, EventType, ImportRecord, PricingBasis, Property, PropertyEvent, PropertyType, Status } from './types';
import { ACTIVE } from './types';
import { addressKey, daysBetween, today, uid } from './parse';

/** One sighting of a listing: what a source (or you) said about a property on a given date. Missing = null. */
export interface Observation {
  address: string;
  town: string;
  postcode?: string | null;
  price?: number | null;
  basis?: PricingBasis | null;
  status?: Status | null;          // null = not stated (a listing is taken to mean "currently advertised")
  bedrooms?: number | null;
  bathrooms?: number | null;
  propertyType?: PropertyType | null;
  floorAreaSqm?: number | null;
  landSize?: string | null;
  epc?: string | null;
  homeReportValuation?: number | null;
  agent?: string | null;
  url?: string | null;
  listingId?: string | null;
  dateFirstAdvertised?: string | null;
  closingDate?: string | null;
  photoUrl?: string | null;
  photoPermitted?: boolean | null;
  date?: string | null;            // when it was observed (defaults to today)
}

export interface ImportOptions { origin: string; source: string; kind: ImportRecord['kind']; label: string; snapshot?: boolean; snapshotTowns?: string[]; isDemo?: boolean; now?: string }

const ON_MARKET: Status[] = ['for_sale', 'closing_date', 'under_offer', 'missives'];
const DETAIL_FIELDS = ['bedrooms', 'bathrooms', 'propertyType', 'floorAreaSqm', 'landSize', 'epc', 'homeReportValuation', 'agent', 'postcode', 'dateFirstAdvertised', 'closingDate'] as const;

export function findMatch(db: Db, o: Observation, source: string): Property | undefined {
  const url = o.url?.trim();
  return db.properties.find((p) => p.sources.some((s) => (o.listingId && s.source === source && s.listingId === o.listingId) || (url && s.url === url)))
    || db.properties.find((p) => addressKey(p.address, p.town, p.postcode) === addressKey(o.address, o.town, o.postcode)
      || (!(p.postcode && o.postcode) && addressKey(p.address, p.town) === addressKey(o.address, o.town)));
}

function event(p: Property, date: string, type: EventType, origin: string, importId: string | null, extra: Partial<PropertyEvent> = {}): PropertyEvent {
  return { id: uid(), propertyId: p.id, date, recordedAt: new Date().toISOString(), type, priceBefore: null, priceAfter: null, basisBefore: null, basisAfter: null, statusBefore: null, statusAfter: null, changes: [], origin, importId, ...extra };
}

/** Which event a status change means. */
export function statusEventType(before: Status, after: Status): EventType | null {
  if (before === after) return null;
  if (after === 'for_sale') return before === 'withdrawn' || before === 'not_seen' || before === 'sold' ? 'relisted' : 'returned_to_market';
  return ({ closing_date: 'closing_date', under_offer: 'under_offer', missives: 'missives', sold: 'sold', withdrawn: 'withdrawn', not_seen: 'not_seen' } as Record<Status, EventType>)[after];
}

/** Apply one observation to a property: returns the events it produced (property updated in place). */
function applyTo(p: Property, o: Observation, date: string, origin: string, importId: string | null): PropertyEvent[] {
  const ev: PropertyEvent[] = [];
  // price and pricing basis
  const newBasis = o.basis ?? null;
  if (o.price != null && p.askingPrice != null && o.price !== p.askingPrice) {
    ev.push(event(p, date, o.price < p.askingPrice ? 'price_reduction' : 'price_increase', origin, importId, { priceBefore: p.askingPrice, priceAfter: o.price, basisBefore: p.pricingBasis, basisAfter: newBasis ?? p.pricingBasis }));
    p.askingPrice = o.price; if (newBasis) p.pricingBasis = newBasis;
  } else if (o.price != null && p.askingPrice == null) {
    p.askingPrice = o.price; if (p.originalAskingPrice == null) p.originalAskingPrice = o.price; if (newBasis) p.pricingBasis = newBasis;
    ev.push(event(p, date, 'details_changed', origin, importId, { changes: [{ field: 'askingPrice', before: null, after: o.price }] }));
  } else if (newBasis && newBasis !== 'Unknown' && newBasis !== p.pricingBasis) {
    ev.push(event(p, date, 'basis_change', origin, importId, { basisBefore: p.pricingBasis, basisAfter: newBasis, priceBefore: p.askingPrice, priceAfter: p.askingPrice }));
    p.pricingBasis = newBasis;
  }
  // status: a listing with no status is taken as "currently advertised" only when it had dropped off the market
  let next: Status | null = o.status ?? null;
  if (next == null && (p.status === 'not_seen' || p.status === 'withdrawn')) next = 'for_sale';
  if (next && next !== p.status) {
    const t = statusEventType(p.status, next);
    if (t) ev.push(event(p, date, t, origin, importId, { statusBefore: p.status, statusAfter: next, priceAfter: p.askingPrice, basisAfter: p.pricingBasis }));
    p.status = next;
  }
  // other details: fill in unknowns, record any real change (old value kept in the event)
  const changes: PropertyEvent['changes'] = [];
  for (const f of DETAIL_FIELDS) {
    const v = (o as unknown as Record<string, unknown>)[f];
    if (v == null || v === '' || (f === 'propertyType' && v === 'Unknown')) continue;
    const cur = (p as unknown as Record<string, unknown>)[f];
    if (cur !== v) { changes.push({ field: f, before: cur ?? null, after: v }); (p as unknown as Record<string, unknown>)[f] = v; }
  }
  if (o.photoUrl && o.photoUrl !== p.photoUrl) { changes.push({ field: 'photoUrl', before: p.photoUrl, after: o.photoUrl }); p.photoUrl = o.photoUrl; }
  if (o.photoPermitted != null && o.photoPermitted !== p.photoPermitted) p.photoPermitted = o.photoPermitted;
  if (changes.length) ev.push(event(p, date, 'details_changed', origin, importId, { changes }));
  if (date > p.lastVerified) p.lastVerified = date;
  return ev;
}

function newProperty(o: Observation, date: string, isDemo: boolean): Property {
  return {
    id: uid(), isDemo, address: o.address.trim(), town: o.town.trim(), postcode: o.postcode ?? null,
    askingPrice: o.price ?? null, originalAskingPrice: o.price ?? null, pricingBasis: o.basis ?? 'Unknown',
    bedrooms: o.bedrooms ?? null, bathrooms: o.bathrooms ?? null, propertyType: o.propertyType ?? 'Unknown', floorAreaSqm: o.floorAreaSqm ?? null,
    landSize: o.landSize ?? null, epc: o.epc ?? null, homeReportValuation: o.homeReportValuation ?? null, agent: o.agent ?? null, sources: [],
    dateFirstAdvertised: o.dateFirstAdvertised ?? null, dateFirstObserved: date, lastVerified: date, status: o.status ?? 'for_sale', closingDate: o.closingDate ?? null,
    photoUrl: o.photoUrl ?? null, photoPermitted: !!o.photoPermitted, notes: '', watched: false,
  };
}

/** Import a batch of observations (CSV rows, email listings, a manual entry). Returns a new Db and an honest report. */
export function importObservations(db0: Db, rows: { obs: Observation | null; error?: string }[], opt: ImportOptions): { db: Db; report: ImportRecord; touched: string[] } {
  const db: Db = structuredClone(db0);
  const now = opt.now || today();
  const report: ImportRecord = { id: uid(), at: new Date().toISOString(), kind: opt.kind, label: opt.label, source: opt.source, snapshot: !!opt.snapshot, rows: rows.length, created: 0, updated: 0, unchanged: 0, notSeen: 0, errors: [], ok: true };
  const seen = new Set<string>(); const newEvents: PropertyEvent[] = [];
  rows.forEach((r, i) => {
    if (!r.obs) { report.errors.push(`Row ${i + 1}: ${r.error || 'could not be read'}`); return; }
    const o = r.obs;
    if (!o.address?.trim() || !o.town?.trim()) { report.errors.push(`Row ${i + 1}: address and town are required`); return; }
    const date = o.date || now;
    let p = findMatch(db, o, opt.source);
    if (!p) {
      p = newProperty(o, date, !!opt.isDemo); db.properties.push(p); report.created++;
      newEvents.push(event(p, date, 'listed', opt.origin, report.id, { priceAfter: p.askingPrice, basisAfter: p.pricingBasis, statusAfter: p.status }));
      if (p.status !== 'for_sale') { const t = statusEventType('for_sale', p.status); if (t) newEvents.push(event(p, date, t, opt.origin, report.id, { statusBefore: 'for_sale', statusAfter: p.status })); }
    } else if (seen.has(p.id)) {
      report.errors.push(`Row ${i + 1}: same property as an earlier row (${p.address}); skipped`); return;
    } else {
      const ev = applyTo(p, o, date, opt.origin, report.id);
      newEvents.push(...ev); ev.length ? report.updated++ : report.unchanged++;
    }
    seen.add(p.id);
    const ref = p.sources.find((s) => s.source === opt.source && ((o.listingId && s.listingId === o.listingId) || (o.url && s.url === o.url) || (!s.url && !s.listingId)));
    if (ref) { ref.lastSeen = date > ref.lastSeen ? date : ref.lastSeen; ref.url = o.url || ref.url; ref.listingId = o.listingId || ref.listingId; }
    else p.sources.push({ source: opt.source, url: o.url || null, listingId: o.listingId || null, firstSeen: date, lastSeen: date });
  });
  // A complete listing from a source: anything from that source (in those towns) that is missing is "no longer seen",
  // which is UNVERIFIED. It is never treated as sold or withdrawn.
  if (opt.snapshot && report.errors.length < rows.length) {
    const towns = (opt.snapshotTowns || []).map((t) => t.toLowerCase());
    for (const p of db.properties) {
      if (seen.has(p.id) || !ON_MARKET.includes(p.status)) continue;
      if (!p.sources.some((s) => s.source === opt.source)) continue;
      if (towns.length && !towns.includes(p.town.toLowerCase())) continue;
      newEvents.push(event(p, now, 'not_seen', opt.origin, report.id, { statusBefore: p.status, statusAfter: 'not_seen', priceAfter: p.askingPrice, basisAfter: p.pricingBasis }));
      p.status = 'not_seen'; report.notSeen++;
    }
  }
  report.ok = report.errors.length === 0 || report.created + report.updated + report.unchanged > 0;
  db.events.push(...newEvents); db.imports.unshift(report);
  db.alerts.unshift(...alertsFor(db, newEvents));
  return { db, report, touched: [...seen] };
}

/** A manual edit from the property page: same rules as an import, so every change is kept. */
export function editProperty(db0: Db, id: string, o: Partial<Observation> & { date?: string }, origin = 'Manual edit'): Db {
  const db: Db = structuredClone(db0); const p = db.properties.find((x) => x.id === id); if (!p) return db0;
  const date = o.date || today();
  const ev = applyTo(p, { address: p.address, town: p.town, ...o } as Observation, date, origin, null);
  if (o.address && o.address !== p.address) { ev.push(event(p, date, 'details_changed', origin, null, { changes: [{ field: 'address', before: p.address, after: o.address }] })); p.address = o.address; }
  if (o.town && o.town !== p.town) { ev.push(event(p, date, 'details_changed', origin, null, { changes: [{ field: 'town', before: p.town, after: o.town }] })); p.town = o.town; }
  db.events.push(...ev); db.alerts.unshift(...alertsFor(db, ev));
  return db;
}

export function eventsOf(db: Db, id: string): PropertyEvent[] {
  return db.events.filter((e) => e.propertyId === id).sort((a, b) => a.date.localeCompare(b.date) || a.recordedAt.localeCompare(b.recordedAt));
}

/** Days on market as observed by this app: from first advertised (if verified) or first observed, to going under offer / off market, or today. */
export function daysOnMarket(db: Db, p: Property, now = today()): number {
  const start = p.dateFirstAdvertised || p.dateFirstObserved;
  if (ACTIVE.includes(p.status)) return Math.max(0, daysBetween(start, now));
  const ev = eventsOf(db, p.id).filter((e) => e.statusAfter && !ACTIVE.includes(e.statusAfter)).pop();
  return Math.max(0, daysBetween(start, ev ? ev.date : now));
}

export function matchesCriteria(db: Db, p: Property): boolean {
  const c = db.settings.criteria;
  if (c.towns.length && !c.towns.some((t) => t.toLowerCase() === p.town.toLowerCase())) return false;
  if (c.minPrice != null && (p.askingPrice == null || p.askingPrice < c.minPrice)) return false;
  if (c.maxPrice != null && (p.askingPrice == null || p.askingPrice > c.maxPrice)) return false;
  if (c.minBeds != null && (p.bedrooms == null || p.bedrooms < c.minBeds)) return false;
  if (c.types.length && !c.types.includes(p.propertyType)) return false;
  return true;
}

function alertsFor(db: Db, events: PropertyEvent[]): Alert[] {
  const out: Alert[] = []; const at = new Date().toISOString();
  for (const e of events) {
    const p = db.properties.find((x) => x.id === e.propertyId); if (!p) continue;
    const a = (kind: Alert['kind'], message: string) => out.push({ id: uid(), at, propertyId: p.id, kind, message, read: false });
    if (e.type === 'price_reduction' && e.priceBefore != null && e.priceAfter != null) a('price_reduction', `${p.address}, ${p.town}: reduced by £${(e.priceBefore - e.priceAfter).toLocaleString('en-GB')} to £${e.priceAfter.toLocaleString('en-GB')}`);
    if (e.type === 'under_offer' && p.watched) a('watched_under_offer', `${p.address}, ${p.town} (on your watchlist) is now under offer`);
    if (e.type === 'returned_to_market' && (e.statusBefore === 'under_offer' || e.statusBefore === 'missives')) a('back_on_market', `${p.address}, ${p.town} has come back on the market after being under offer`);
    if (e.type === 'listed' && !p.isDemo && matchesCriteria(db, p) && hasCriteria(db)) a('new_match', `New listing matching your criteria: ${p.address}, ${p.town}`);
  }
  return out;
}
const hasCriteria = (db: Db) => { const c = db.settings.criteria; return !!(c.towns.length || c.minPrice != null || c.maxPrice != null || c.minBeds != null || c.types.length); };

/** Raise one "long on the market" alert per property once it passes your threshold (run whenever data changes). */
export function checkLongOnMarket(db0: Db, now = today()): Db {
  const db = db0; const add: Alert[] = [];
  for (const p of db.properties) {
    if (!ACTIVE.includes(p.status) || db.alerts.some((a) => a.propertyId === p.id && a.kind === 'long_on_market')) continue;
    const d = daysOnMarket(db, p, now);
    if (d >= db.settings.longOnMarketDays) add.push({ id: uid(), at: new Date().toISOString(), propertyId: p.id, kind: 'long_on_market', message: `${p.address}, ${p.town} has been on the market ${d} days (your threshold: ${db.settings.longOnMarketDays})`, read: false });
  }
  return add.length ? { ...db, alerts: [...add, ...db.alerts] } : db;
}
