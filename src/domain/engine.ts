// The tracking engine: compares each new observation of a property with what is stored, records every change as a
// dated event (old and new values kept, with its source and how sure we are), avoids duplicates, flags uncertain
// matches for review instead of merging them, and raises alerts. Pure functions: easy to test.
import type { Alert, Confidence, Db, EventType, ImportRecord, PricingBasis, Property, PropertyEvent, PropertyType, ReviewItem, Status } from './types';
import { ACTIVE } from './types';
import { addressKey, daysBetween, today, uid } from './parse';

/** One sighting of a listing: what a source (or you) said about a property on a given date. Missing = null. */
export interface Observation {
  address: string;
  town: string;
  postcode?: string | null;
  price?: number | null;
  previousPrice?: number | null;   // when the source itself says "reduced from £X"
  basis?: PricingBasis | null;
  status?: Status | null;          // null = not stated (a listing is taken to mean "currently advertised")
  statusWording?: string | null;   // the source's own words, e.g. "Sold STC"
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

export interface ImportOptions {
  origin: string; source: string; kind: ImportRecord['kind']; label: string;
  snapshot?: boolean; snapshotTowns?: string[]; isDemo?: boolean; demoKind?: 'example' | 'simulated'; now?: string;
  evidence?: string; messageId?: string;
}

const ON_MARKET: Status[] = ['for_sale', 'closing_date', 'under_offer', 'missives'];
const DETAIL_FIELDS = ['bedrooms', 'bathrooms', 'propertyType', 'floorAreaSqm', 'landSize', 'epc', 'homeReportValuation', 'agent', 'postcode', 'dateFirstAdvertised', 'closingDate'] as const;
const STREET_WORDS = /\b(road|street|lane|avenue|drive|crescent|place|gardens|terrace|court|square|park|way|close|brae|wynd|row|view|grove|walk|gate|hill|rise|green|loan|vennel)\b/;

interface Ctx { origin: string; importId: string | null; source: string | null; evidence: string | null; messageId: string | null; manual: boolean }

/** Does the address identify one building (a house number or a house name), rather than just a street? */
export function identifiesBuilding(address: string): boolean {
  const first = address.split(',')[0].toLowerCase().trim();
  if (/\d/.test(first)) return true;
  if (!first) return false;
  return !STREET_WORDS.test(first.split(/\s+/).pop() || '') || /\b(house|cottage|farm|lodge|mill|steading|croft|manse|schoolhouse|villa)\b/.test(first);
}
const streetOf = (address: string) => address.split(',')[0].toLowerCase().replace(/^(flat|apartment)\s+\S+\s*/, '').replace(/[\d/]+[a-z]?\b/g, '').replace(/[^a-z ]/g, ' ').replace(/\b(rd)\b/g, 'road').replace(/\b(st)\b/g, 'street').replace(/\s+/g, ' ').trim();

/** Confident match: same listing (source + ID, or same link), or the same building address. */
export function findMatch(db: Db, o: Observation, source: string): Property | undefined {
  const url = o.url?.trim();
  const byListing = db.properties.find((p) => p.sources.some((s) => (o.listingId && s.source === source && s.listingId === o.listingId) || (url && s.url === url)));
  if (byListing) return byListing;
  if (!identifiesBuilding(o.address)) return undefined; // "Station Road, Torphins" could be any house on the street
  return db.properties.find((p) => identifiesBuilding(p.address) && (addressKey(p.address, p.town, p.postcode) === addressKey(o.address, o.town, o.postcode)
    || (!(p.postcode && o.postcode) && addressKey(p.address, p.town) === addressKey(o.address, o.town))));
}

/** Properties that look like the observation but can't be matched confidently. Used to flag for review. */
export function possibleMatches(db: Db, o: Observation, exclude?: string): { p: Property; reasons: string[] }[] {
  const out: { p: Property; reasons: string[] }[] = [];
  for (const p of db.properties) {
    if (p.id === exclude || p.town.toLowerCase() !== o.town.toLowerCase()) continue;
    const reasons: string[] = []; let place = false;
    if (o.postcode && p.postcode && o.postcode.replace(/\s/g, '') === p.postcode.replace(/\s/g, '')) { reasons.push(`same postcode ${p.postcode}`); place = true; }
    const so = streetOf(o.address), sp = streetOf(p.address);
    if (so && so === sp) { reasons.push(`same street (${p.address.split(',')[0]})`); place = true; }
    if (!place) continue;
    let fit = 0;
    if (o.bedrooms != null && p.bedrooms != null) { if (o.bedrooms !== p.bedrooms) continue; reasons.push(`${p.bedrooms} bedrooms`); fit++; }
    const price = o.price, pp = p.askingPrice;
    if (price != null && pp != null) { if (Math.abs(price - pp) / pp > 0.06) continue; reasons.push(`similar asking price`); fit++; }
    if (o.propertyType && o.propertyType !== 'Unknown' && p.propertyType !== 'Unknown') { if (o.propertyType !== p.propertyType) continue; reasons.push(p.propertyType.toLowerCase()); fit++; }
    if (fit >= 1) out.push({ p, reasons });
  }
  return out;
}

function event(p: Property, date: string, type: EventType, ctx: Ctx, confidence: Confidence, extra: Partial<PropertyEvent> = {}): PropertyEvent {
  return { id: uid(), propertyId: p.id, date, recordedAt: new Date().toISOString(), type, priceBefore: null, priceAfter: null, basisBefore: null, basisAfter: null, statusBefore: null, statusAfter: null, changes: [], origin: ctx.origin, importId: ctx.importId, source: ctx.source, confidence: ctx.manual ? 'manual' : confidence, evidence: ctx.evidence, messageId: ctx.messageId, ...extra };
}

/** Which event a status change means. */
export function statusEventType(before: Status, after: Status): EventType | null {
  if (before === after) return null;
  if (after === 'for_sale') return before === 'withdrawn' || before === 'not_seen' || before === 'sold' ? 'relisted' : 'returned_to_market';
  return ({ closing_date: 'closing_date', under_offer: 'under_offer', missives: 'missives', sold: 'sold', withdrawn: 'withdrawn', not_seen: 'not_seen' } as Record<Status, EventType>)[after];
}

/** Apply one observation to a property: returns the events it produced (property updated in place). */
function applyTo(p: Property, o: Observation, date: string, ctx: Ctx): PropertyEvent[] {
  const ev: PropertyEvent[] = [];
  // Observations can arrive out of order (an older email processed late): never let an older one overwrite newer facts.
  if (date < p.lastVerified && !ctx.manual) {
    fillDetails(p, o, date, ctx, ev, true);
    return ev;
  }
  // price and pricing basis
  const newBasis = o.basis ?? null;
  if (o.price != null && p.askingPrice != null && o.price !== p.askingPrice) {
    ev.push(event(p, date, o.price < p.askingPrice ? 'price_reduction' : 'price_increase', ctx, 'detected', { priceBefore: p.askingPrice, priceAfter: o.price, basisBefore: p.pricingBasis, basisAfter: newBasis ?? p.pricingBasis }));
    p.askingPrice = o.price; if (newBasis) p.pricingBasis = newBasis;
  } else if (o.price != null && p.askingPrice == null) {
    p.askingPrice = o.price; if (p.originalAskingPrice == null) p.originalAskingPrice = o.price; if (newBasis) p.pricingBasis = newBasis;
    ev.push(event(p, date, 'details_changed', ctx, 'reported', { changes: [{ field: 'askingPrice', before: null, after: o.price }] }));
  } else if (newBasis && newBasis !== 'Unknown' && newBasis !== p.pricingBasis) {
    ev.push(event(p, date, 'basis_change', ctx, 'reported', { basisBefore: p.pricingBasis, basisAfter: newBasis, priceBefore: p.askingPrice, priceAfter: p.askingPrice }));
    p.pricingBasis = newBasis;
  }
  // status: a listing with no status is taken as "currently advertised" only when it had dropped off the market
  let next: Status | null = o.status ?? null; let conf: Confidence = 'reported';
  if (next == null && (p.status === 'not_seen' || p.status === 'withdrawn')) { next = 'for_sale'; conf = 'assumed'; }
  if (next && next !== p.status) {
    const t = statusEventType(p.status, next);
    if (t) ev.push(event(p, date, t, ctx, conf, { statusBefore: p.status, statusAfter: next, priceAfter: p.askingPrice, basisAfter: p.pricingBasis, ...(o.statusWording ? { evidence: `${ctx.evidence ?? ctx.origin}: "${o.statusWording}"` } : {}) }));
    p.status = next;
  }
  fillDetails(p, o, date, ctx, ev, false);
  if (date > p.lastVerified) p.lastVerified = date;
  return ev;
}

/** Other details: fill in unknowns, record any real change (old value kept). Older observations only fill gaps. */
function fillDetails(p: Property, o: Observation, date: string, ctx: Ctx, ev: PropertyEvent[], gapsOnly: boolean) {
  const changes: PropertyEvent['changes'] = [];
  const rec = p as unknown as Record<string, unknown>;
  for (const f of DETAIL_FIELDS) {
    const v = (o as unknown as Record<string, unknown>)[f];
    if (v == null || v === '' || (f === 'propertyType' && v === 'Unknown')) continue;
    const cur = rec[f];
    if (gapsOnly && cur != null && cur !== 'Unknown') continue;
    if (cur !== v) { changes.push({ field: f, before: cur ?? null, after: v }); rec[f] = v; }
  }
  if (o.photoUrl && o.photoUrl !== p.photoUrl && !(gapsOnly && p.photoUrl)) { changes.push({ field: 'photoUrl', before: p.photoUrl, after: o.photoUrl }); p.photoUrl = o.photoUrl; }
  if (o.photoPermitted != null && o.photoPermitted !== p.photoPermitted) p.photoPermitted = o.photoPermitted;
  if (changes.length) ev.push(event(p, date, 'details_changed', ctx, 'reported', { changes }));
}

function newProperty(o: Observation, date: string, opt: ImportOptions): Property {
  return {
    id: uid(), isDemo: !!opt.isDemo, ...(opt.isDemo ? { demoKind: opt.demoKind ?? 'example' } : {}), address: o.address.trim(), town: o.town.trim(), postcode: o.postcode ?? null,
    askingPrice: o.price ?? null, originalAskingPrice: o.previousPrice ?? o.price ?? null, pricingBasis: o.basis ?? 'Unknown',
    bedrooms: o.bedrooms ?? null, bathrooms: o.bathrooms ?? null, propertyType: o.propertyType ?? 'Unknown', floorAreaSqm: o.floorAreaSqm ?? null,
    landSize: o.landSize ?? null, epc: o.epc ?? null, homeReportValuation: o.homeReportValuation ?? null, agent: o.agent ?? null, sources: [],
    dateFirstAdvertised: o.dateFirstAdvertised ?? null, dateFirstObserved: date, lastVerified: date, status: o.status ?? 'for_sale', closingDate: o.closingDate ?? null,
    photoUrl: o.photoUrl ?? null, photoPermitted: !!o.photoPermitted, notes: '', watched: false,
  };
}

const pairKey = (a: string, b: string) => [a, b].sort().join('|');

/** Import a batch of observations (CSV rows, email listings, a manual entry). Returns a new Db and an honest report. */
export function importObservations(db0: Db, rows: { obs: Observation | null; error?: string }[], opt: ImportOptions): { db: Db; report: ImportRecord & { flagged: number }; touched: string[] } {
  const db: Db = structuredClone(db0);
  db.reviews ??= [];
  const now = opt.now || today();
  const report: ImportRecord & { flagged: number } = { id: uid(), at: new Date().toISOString(), kind: opt.kind, label: opt.label, source: opt.source, snapshot: !!opt.snapshot, rows: rows.length, created: 0, updated: 0, unchanged: 0, notSeen: 0, errors: [], ok: true, flagged: 0 };
  const ctx: Ctx = { origin: opt.origin, importId: report.id, source: opt.source, evidence: opt.evidence ?? null, messageId: opt.messageId ?? null, manual: opt.kind === 'manual' };
  const seen = new Set<string>(); const newEvents: PropertyEvent[] = []; const newReviews: ReviewItem[] = [];
  const known = new Set(db.reviews.map((r) => pairKey(r.aId, r.bId)));
  rows.forEach((r, i) => {
    if (!r.obs) { report.errors.push(`Row ${i + 1}: ${r.error || 'could not be read'}`); return; }
    const o = r.obs;
    if (!o.address?.trim() || !o.town?.trim()) { report.errors.push(`Row ${i + 1}: address and town are required`); return; }
    const date = o.date || now;
    let p = findMatch(db, o, opt.source);
    if (!p) {
      p = newProperty(o, date, opt); report.created++;
      const candidates = possibleMatches(db, o).filter((c) => c.p.isDemo === !!opt.isDemo);
      db.properties.push(p);
      if (o.previousPrice != null && o.price != null && o.previousPrice !== o.price) {
        // The source says it was reduced from an earlier price we never saw ourselves.
        newEvents.push(event(p, date, 'listed', ctx, 'reported', { priceAfter: o.previousPrice, basisAfter: p.pricingBasis, statusAfter: p.status, evidence: `${ctx.evidence ?? ctx.origin} (earlier price as stated by the source; date of that price unknown)` }));
        newEvents.push(event(p, date, o.price < o.previousPrice ? 'price_reduction' : 'price_increase', ctx, 'reported', { priceBefore: o.previousPrice, priceAfter: o.price, basisBefore: p.pricingBasis, basisAfter: p.pricingBasis }));
      } else newEvents.push(event(p, date, 'listed', ctx, 'reported', { priceAfter: p.askingPrice, basisAfter: p.pricingBasis, statusAfter: p.status }));
      if (p.status !== 'for_sale') { const t = statusEventType('for_sale', p.status); if (t) newEvents.push(event(p, date, t, ctx, 'reported', { statusBefore: 'for_sale', statusAfter: p.status, ...(o.statusWording ? { evidence: `${ctx.evidence ?? ctx.origin}: "${o.statusWording}"` } : {}) })); }
      for (const c of candidates.slice(0, 3)) {
        if (known.has(pairKey(p.id, c.p.id))) continue;
        const rv: ReviewItem = { id: uid(), at: new Date().toISOString(), aId: p.id, bId: c.p.id, reasons: c.reasons, status: 'open', resolvedAt: null };
        newReviews.push(rv); known.add(pairKey(p.id, c.p.id)); report.flagged++;
      }
    } else if (seen.has(p.id)) {
      report.errors.push(`Row ${i + 1}: same property as an earlier row (${p.address}); skipped`); return;
    } else {
      const ev = applyTo(p, o, date, ctx);
      newEvents.push(...ev); ev.length ? report.updated++ : report.unchanged++;
      if (identifiesBuilding(o.address) && !identifiesBuilding(p.address)) p.address = o.address.trim(); // learn a fuller address
      if (!p.postcode && o.postcode) p.postcode = o.postcode;
      if (date < p.dateFirstObserved) p.dateFirstObserved = date; // an older notification processed late
    }
    seen.add(p.id);
    const ref = p.sources.find((s) => s.source === opt.source && ((o.listingId && s.listingId === o.listingId) || (o.url && s.url === o.url) || (!s.url && !s.listingId) || (!o.listingId && !o.url)));
    if (ref) { ref.lastSeen = date > ref.lastSeen ? date : ref.lastSeen; ref.firstSeen = date < ref.firstSeen ? date : ref.firstSeen; ref.url = o.url || ref.url; ref.listingId = o.listingId || ref.listingId; }
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
      newEvents.push(event(p, now, 'not_seen', ctx, 'assumed', { statusBefore: p.status, statusAfter: 'not_seen', priceAfter: p.askingPrice, basisAfter: p.pricingBasis }));
      p.status = 'not_seen'; report.notSeen++;
    }
  }
  report.ok = report.errors.length === 0 || report.created + report.updated + report.unchanged > 0;
  db.events.push(...newEvents); db.imports.unshift(report); db.imports = db.imports.slice(0, 500);
  db.reviews.push(...newReviews);
  db.alerts.unshift(...alertsFor(db, newEvents));
  for (const rv of newReviews) {
    const a = db.properties.find((x) => x.id === rv.aId)!, b = db.properties.find((x) => x.id === rv.bId)!;
    if (!a.isDemo || !b.isDemo || a.demoKind === 'simulated') db.alerts.unshift({ id: uid(), at: new Date().toISOString(), propertyId: a.id, kind: 'review_needed', message: `${a.demoKind === 'simulated' ? '[Simulated test] ' : ''}Possible duplicate: "${a.address}, ${a.town}" (${opt.source}) may be the same as "${b.address}, ${b.town}". Please check.`, read: false });
  }
  return { db, report, touched: [...seen] };
}

/** A manual edit from the property page: same rules as an import, so every change is kept. */
export function editProperty(db0: Db, id: string, o: Partial<Observation> & { date?: string }, origin = 'Manual edit'): Db {
  const db: Db = structuredClone(db0); const p = db.properties.find((x) => x.id === id); if (!p) return db0;
  const date = o.date || today(); const ctx: Ctx = { origin, importId: null, source: 'Manual', evidence: null, messageId: null, manual: true };
  const ev = applyTo(p, { address: p.address, town: p.town, ...o } as Observation, date, ctx);
  if (o.address && o.address !== p.address) { ev.push(event(p, date, 'details_changed', ctx, 'manual', { changes: [{ field: 'address', before: p.address, after: o.address }] })); p.address = o.address; }
  if (o.town && o.town !== p.town) { ev.push(event(p, date, 'details_changed', ctx, 'manual', { changes: [{ field: 'town', before: p.town, after: o.town }] })); p.town = o.town; }
  db.events.push(...ev); db.alerts.unshift(...alertsFor(db, ev));
  return db;
}

/** You confirmed two records are the same property: combine them, keeping every observation and its source. */
export function mergeProperties(db0: Db, idA: string, idB: string): Db {
  const db: Db = structuredClone(db0);
  const a = db.properties.find((p) => p.id === idA), b = db.properties.find((p) => p.id === idB); if (!a || !b || a === b) return db0;
  const [keep, drop] = a.dateFirstObserved <= b.dateFirstObserved ? [a, b] : [b, a];
  const newer = keep.lastVerified >= drop.lastVerified ? keep : drop;
  for (const s of drop.sources) if (!keep.sources.some((k) => k.source === s.source && k.listingId === s.listingId && k.url === s.url)) keep.sources.push(s);
  const rec = keep as unknown as Record<string, unknown>, dr = drop as unknown as Record<string, unknown>;
  for (const f of [...DETAIL_FIELDS, 'photoUrl'] as string[]) if ((rec[f] == null || rec[f] === 'Unknown') && dr[f] != null) rec[f] = dr[f];
  if (!identifiesBuilding(keep.address) && identifiesBuilding(drop.address)) keep.address = drop.address;
  keep.askingPrice = newer.askingPrice ?? keep.askingPrice; keep.pricingBasis = newer.pricingBasis; keep.status = newer.status;
  keep.lastVerified = newer.lastVerified; keep.watched = keep.watched || drop.watched;
  keep.notes = [keep.notes, drop.notes].filter(Boolean).join('\n\n');
  for (const e of db.events) if (e.propertyId === drop.id) e.propertyId = keep.id;
  for (const al of db.alerts) if (al.propertyId === drop.id) al.propertyId = keep.id;
  db.events.push({ id: uid(), propertyId: keep.id, date: today(), recordedAt: new Date().toISOString(), type: 'merged', priceBefore: null, priceAfter: null, basisBefore: null, basisAfter: null, statusBefore: null, statusAfter: null, changes: [{ field: 'merged with', before: null, after: `${drop.address}, ${drop.town} (${drop.sources.map((s) => s.source).join(', ')})` }], origin: 'You confirmed these are the same property', importId: null, source: 'Manual', confidence: 'manual', evidence: null, messageId: null });
  db.properties = db.properties.filter((p) => p.id !== drop.id);
  db.reviews = (db.reviews || []).map((r) => {
    const aId = r.aId === drop.id ? keep.id : r.aId, bId = r.bId === drop.id ? keep.id : r.bId;
    if (aId === bId) return { ...r, aId, bId, status: 'merged' as const, resolvedAt: r.resolvedAt ?? new Date().toISOString() };
    return { ...r, aId, bId };
  });
  return db;
}

export function resolveReview(db: Db, reviewId: string, decision: 'merge' | 'separate'): Db {
  const r = db.reviews.find((x) => x.id === reviewId); if (!r) return db;
  if (decision === 'merge') return mergeProperties(db, r.aId, r.bId);
  return { ...db, reviews: db.reviews.map((x) => (x.id === reviewId ? { ...x, status: 'separate' as const, resolvedAt: new Date().toISOString() } : x)) };
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

/** An active listing that no source has mentioned for a while. Its status is NOT changed: we simply don't know. */
export function isStale(db: Db, p: Property, now = today()): boolean {
  return ACTIVE.includes(p.status) && !p.isDemo && daysBetween(p.lastVerified, now) > (db.settings.staleDays ?? 30);
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
    if (p.isDemo && p.demoKind !== 'simulated') continue; // fictional examples never raise alerts
    const a = (kind: Alert['kind'], message: string) => out.push({ id: uid(), at, propertyId: p.id, kind, message: (p.demoKind === 'simulated' ? '[Simulated test] ' : '') + message, read: false });
    if (e.type === 'price_reduction' && e.priceBefore != null && e.priceAfter != null) a('price_reduction', `${p.address}, ${p.town}: reduced by £${(e.priceBefore - e.priceAfter).toLocaleString('en-GB')} (${(((e.priceBefore - e.priceAfter) / e.priceBefore) * 100).toFixed(1)}%) to £${e.priceAfter.toLocaleString('en-GB')}`);
    if ((e.type === 'under_offer' || e.type === 'missives') && p.watched) a('watched_under_offer', `${p.address}, ${p.town} (on your watchlist) is now ${e.type === 'missives' ? 'at missives concluded' : 'under offer'}`);
    if (e.type === 'returned_to_market' && (e.statusBefore === 'under_offer' || e.statusBefore === 'missives')) a('back_on_market', `${p.address}, ${p.town} has come back on the market after being under offer`);
    if (e.type === 'listed' && matchesCriteria(db, p) && hasCriteria(db)) a('new_match', `New listing matching your criteria: ${p.address}, ${p.town}`);
  }
  return out;
}
const hasCriteria = (db: Db) => { const c = db.settings.criteria; return !!(c.towns.length || c.minPrice != null || c.maxPrice != null || c.minBeds != null || c.types.length); };

/** Raise one "long on the market" alert per property once it passes your threshold (run whenever data changes). */
export function checkLongOnMarket(db0: Db, now = today()): Db {
  const db = db0; const add: Alert[] = [];
  for (const p of db.properties) {
    if (p.isDemo || !ACTIVE.includes(p.status) || db.alerts.some((a) => a.propertyId === p.id && a.kind === 'long_on_market')) continue;
    const d = daysOnMarket(db, p, now);
    if (d >= db.settings.longOnMarketDays) add.push({ id: uid(), at: new Date().toISOString(), propertyId: p.id, kind: 'long_on_market', message: `${p.address}, ${p.town} has been on the market ${d} days (your threshold: ${db.settings.longOnMarketDays})`, read: false });
  }
  return add.length ? { ...db, alerts: [...add, ...db.alerts] } : db;
}
