// Market figures. All of them are about ASKING prices and what this app has observed; none of them are sold prices
// or valuations, and price reductions are not evidence that values are falling.
import type { Db, Property, Status } from './types';
import { ACTIVE } from './types';
import { daysOnMarket, eventsOf } from './engine';
import { daysBetween, today } from './parse';

export const median = (xs: number[]) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
export const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

export function hasEvent(db: Db, p: Property, type: string) { return db.events.some((e) => e.propertyId === p.id && e.type === type); }
export function priceChange(_db: Db, p: Property) {
  if (p.originalAskingPrice == null || p.askingPrice == null || p.originalAskingPrice === p.askingPrice) return null;
  const diff = p.askingPrice - p.originalAskingPrice; return { diff, pct: (diff / p.originalAskingPrice) * 100 };
}
/** The latest price change event (for "reduced by" badges). */
export function lastPriceEvent(db: Db, p: Property) { return eventsOf(db, p.id).filter((e) => e.type === 'price_reduction' || e.type === 'price_increase').pop() || null; }

export function dashboard(db: Db, props: Property[], now = today()) {
  const active = props.filter((p) => ACTIVE.includes(p.status));
  const prices = active.map((p) => p.askingPrice).filter((x): x is number => x != null);
  const ppsm = active.filter((p) => p.askingPrice != null && p.floorAreaSqm).map((p) => p.askingPrice! / p.floorAreaSqm!);
  const firstSeen = (p: Property) => p.dateFirstAdvertised || p.dateFirstObserved;
  const count = (s: Status) => props.filter((p) => p.status === s).length;
  return {
    forSale: active.length,
    new7: props.filter((p) => daysBetween(firstSeen(p), now) <= 7).length,
    new30: props.filter((p) => daysBetween(firstSeen(p), now) <= 30).length,
    reduced: props.filter((p) => hasEvent(db, p, 'price_reduction')).length,
    increased: props.filter((p) => hasEvent(db, p, 'price_increase')).length,
    underOffer: count('under_offer') + count('missives'),
    returned: props.filter((p) => hasEvent(db, p, 'returned_to_market')).length,
    withdrawn: count('withdrawn'),
    notSeen: count('not_seen'),
    medianPrice: median(prices), meanPrice: mean(prices),
    medianDays: median(props.map((p) => daysOnMarket(db, p, now))),
    medianPpsm: median(ppsm), ppsmCount: ppsm.length,
    reducedShare: props.length ? (props.filter((p) => hasEvent(db, p, 'price_reduction')).length / props.length) * 100 : null,
  };
}

export function byTown(db: Db, props: Property[], now = today()) {
  const towns = [...new Set(props.map((p) => p.town))].sort();
  return towns.map((t) => {
    const ps = props.filter((p) => p.town === t), active = ps.filter((p) => ACTIVE.includes(p.status));
    const toOffer = ps.map((p) => { const e = eventsOf(db, p.id).find((x) => x.type === 'under_offer'); return e ? daysBetween(p.dateFirstAdvertised || p.dateFirstObserved, e.date) : null; }).filter((x): x is number => x != null);
    return { town: t, tracked: ps.length, forSale: active.length, medianPrice: median(active.map((p) => p.askingPrice).filter((x): x is number => x != null)),
      reducedPct: ps.length ? (ps.filter((p) => hasEvent(db, p, 'price_reduction')).length / ps.length) * 100 : null,
      medianDaysToOffer: median(toOffer), offers: toOffer.length, medianDays: median(ps.map((p) => daysOnMarket(db, p, now))) };
  });
}

export const BANDS: [number, number, string][] = [[0, 200000, 'Under £200k'], [200000, 300000, '£200k to £300k'], [300000, 400000, '£300k to £400k'], [400000, 500000, '£400k to £500k'], [500000, Infinity, '£500k and over']];
export function byPriceBand(db: Db, props: Property[], now = today()) {
  return BANDS.map(([lo, hi, label]) => { const ps = props.filter((p) => (p.originalAskingPrice ?? p.askingPrice) != null && (p.originalAskingPrice ?? p.askingPrice)! >= lo && (p.originalAskingPrice ?? p.askingPrice)! < hi); return { label, count: ps.length, medianDays: median(ps.map((p) => daysOnMarket(db, p, now))) }; });
}

/** Number of properties on the market at the end of each week, rebuilt from the recorded history. */
export function inventoryOverTime(db: Db, props: Property[], weeks = 16, now = today()) {
  const ids = new Set(props.map((p) => p.id)); const out: { date: string; count: number }[] = [];
  for (let w = weeks - 1; w >= 0; w--) {
    const d = new Date(Date.parse(now) - w * 7 * 86400000).toISOString().slice(0, 10); let n = 0;
    for (const p of db.properties) {
      if (!ids.has(p.id) || (p.dateFirstObserved > d)) continue;
      const evs = eventsOf(db, p.id).filter((e) => e.date <= d && e.statusAfter); const st = evs.length ? evs[evs.length - 1].statusAfter! : 'for_sale';
      if (ACTIVE.includes(st)) n++;
    }
    out.push({ date: d, count: n });
  }
  return out;
}

/** Asking-price steps for one property's chart. */
export function priceSeries(db: Db, p: Property) {
  const pts: { date: string; price: number }[] = [];
  for (const e of eventsOf(db, p.id)) {
    if (e.type === 'listed' && e.priceAfter != null) pts.push({ date: e.date, price: e.priceAfter });
    if ((e.type === 'price_reduction' || e.type === 'price_increase') && e.priceAfter != null) pts.push({ date: e.date, price: e.priceAfter });
    if (e.type === 'details_changed' && e.changes.some((c) => c.field === 'askingPrice')) pts.push({ date: e.date, price: Number(e.changes.find((c) => c.field === 'askingPrice')!.after) });
  }
  return pts;
}
