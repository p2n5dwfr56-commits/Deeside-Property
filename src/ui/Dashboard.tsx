// Dashboard: filters, headline figures and property cards.
import { useState } from 'react';
import type { Ctx } from './App';
import type { Db, Property, PropertyType, Status } from '../domain/types';
import { STATUS_LABEL, TYPES } from '../domain/types';
import { daysBetween, fmtMoney } from '../domain/parse';
import { dashboard, hasEvent, priceChange } from '../domain/stats';
import { daysOnMarket } from '../domain/engine';
import { addDemo } from '../domain/demo';
import { LastCheck } from './Monitoring';
import { Changes } from './Changes';
import { ChangeBadge, DemoPill, StatusPill, pct } from './components';

export interface Filters { town: string; q: string; minPrice: string; maxPrice: string; minBeds: string; type: string; status: string; move: string; seen: string; watched: boolean; sort: string }
export const NO_FILTERS: Filters = { town: 'area', q: '', minPrice: '', maxPrice: '', minBeds: '', type: '', status: 'all', move: '', seen: '', watched: false, sort: 'recent' };
const KEY = 'dpw.filters';
const loadF = (): Filters => { try { return { ...NO_FILTERS, ...JSON.parse(sessionStorage.getItem(KEY) || '{}') }; } catch { return NO_FILTERS; } };

export function applyFilters(db: Db, f: Filters, area: string[], now: string): Property[] {
  const num = (s: string) => (s.trim() === '' ? null : Number(s.replace(/[£,k]/gi, '')) * (/k$/i.test(s.trim()) ? 1000 : 1));
  const lo = num(f.minPrice), hi = num(f.maxPrice), beds = num(f.minBeds), q = f.q.trim().toLowerCase();
  const out = db.properties.filter((p) => {
    if (f.town === 'area' && !area.some((t) => t.toLowerCase() === p.town.toLowerCase())) return false;
    if (f.town !== 'area' && f.town !== 'all' && p.town !== f.town) return false;
    if (q && !`${p.address} ${p.town} ${p.postcode ?? ''} ${p.agent ?? ''} ${p.notes}`.toLowerCase().includes(q)) return false;
    if (lo != null && (p.askingPrice == null || p.askingPrice < lo)) return false;
    if (hi != null && (p.askingPrice == null || p.askingPrice > hi)) return false;
    if (beds != null && (p.bedrooms == null || p.bedrooms < beds)) return false;
    if (f.type && p.propertyType !== f.type) return false;
    if (f.status === 'active' && !['for_sale', 'closing_date'].includes(p.status)) return false;
    if (f.status && !['all', 'active'].includes(f.status) && p.status !== f.status) return false;
    if (f.move === 'reduced' && !hasEvent(db, p, 'price_reduction')) return false;
    if (f.move === 'increased' && !hasEvent(db, p, 'price_increase')) return false;
    if (f.move === 'unchanged' && priceChange(db, p)) return false;
    if (f.seen && daysBetween(p.dateFirstAdvertised || p.dateFirstObserved, now) > Number(f.seen)) return false;
    if (f.watched && !p.watched) return false;
    return true;
  });
  const by: Record<string, (a: Property, b: Property) => number> = {
    recent: (a, b) => b.dateFirstObserved.localeCompare(a.dateFirstObserved),
    priceAsc: (a, b) => (a.askingPrice ?? Infinity) - (b.askingPrice ?? Infinity),
    priceDesc: (a, b) => (b.askingPrice ?? -1) - (a.askingPrice ?? -1),
    reduction: (a, b) => (priceChange(db, a)?.pct ?? 0) - (priceChange(db, b)?.pct ?? 0),
    days: (a, b) => daysOnMarket(db, b, now) - daysOnMarket(db, a, now),
  };
  return out.sort(by[f.sort] || by.recent);
}

export function FilterBar({ ctx, f, set }: { ctx: Ctx; f: Filters; set: (f: Filters) => void }) {
  const towns = [...new Set([...ctx.db.settings.towns.map((t) => t.name), ...ctx.db.properties.map((p) => p.town)])].sort();
  const u = (k: keyof Filters) => (e: { target: { value: string } }) => set({ ...f, [k]: e.target.value });
  const [more, setMore] = useState(() => typeof innerWidth === 'undefined' || innerWidth > 600);
  const active = (Object.keys(NO_FILTERS) as (keyof Filters)[]).filter((k) => !['q', 'town', 'sort'].includes(k) && f[k] !== NO_FILTERS[k]).length;
  return (
    <div className="card filters" role="search" aria-label="Filters">
      <label>Search<input value={f.q} onChange={u('q')} placeholder="Address, agent, notes" /></label>
      <label>Town<select value={f.town} onChange={u('town')}><option value="area">My area ({ctx.areaTowns.length} towns)</option><option value="all">Everything tracked</option>{towns.map((t) => <option key={t}>{t}</option>)}</select></label>
      {!more && <button onClick={() => setMore(true)} aria-expanded={false}>More filters{active ? ` (${active} on)` : ''}</button>}
      {more && <>
      <label>Min price<input inputMode="numeric" value={f.minPrice} onChange={u('minPrice')} placeholder="e.g. 200k" /></label>
      <label>Max price<input inputMode="numeric" value={f.maxPrice} onChange={u('maxPrice')} placeholder="e.g. 400k" /></label>
      <label>Bedrooms (min)<select value={f.minBeds} onChange={u('minBeds')}><option value="">Any</option>{[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}+</option>)}</select></label>
      <label>Type<select value={f.type} onChange={u('type')}><option value="">Any</option>{TYPES.map((t) => <option key={t}>{t}</option>)}</select></label>
      <label>Status<select value={f.status} onChange={u('status')}><option value="all">Any status</option><option value="active">On the market</option>{(Object.keys(STATUS_LABEL) as Status[]).map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}</select></label>
      <label>Price movement<select value={f.move} onChange={u('move')}><option value="">Any</option><option value="reduced">Has been reduced</option><option value="increased">Has been increased</option><option value="unchanged">No change</option></select></label>
      <label>First seen<select value={f.seen} onChange={u('seen')}><option value="">Any time</option><option value="7">Last 7 days</option><option value="30">Last 30 days</option><option value="90">Last 90 days</option></select></label>
      <label>Sort<select value={f.sort} onChange={u('sort')}><option value="recent">Newest first</option><option value="priceAsc">Price, low to high</option><option value="priceDesc">Price, high to low</option><option value="reduction">Biggest reduction</option><option value="days">Longest on market</option></select></label>
      <label className="inline"><input type="checkbox" checked={f.watched} onChange={(e) => set({ ...f, watched: e.target.checked })} /> Watchlist only</label>
      <button onClick={() => set(NO_FILTERS)}>Clear filters</button>
      </>}
    </div>
  );
}

export function useFilters(): [Filters, (f: Filters) => void] {
  const [f, setF] = useState<Filters>(loadF);
  return [f, (n) => { setF(n); try { sessionStorage.setItem(KEY, JSON.stringify(n)); } catch { /* not essential */ } }];
}

export function PropertyCard({ ctx, p }: { ctx: Ctx; p: Property }) {
  const c = priceChange(ctx.db, p);
  return (
    <a className={`card pcard ${c && c.diff < 0 ? 'reduced' : ''}`} href={`#p-${p.id}`} data-testid="property-card">
      <div className="ph">{p.photoUrl && p.photoPermitted ? <img src={p.photoUrl} alt="" loading="lazy" /> : <span>{p.photoUrl ? 'Photo hidden (display not confirmed as permitted)' : 'No photo'}</span>}</div>
      <div className="bd">
        <div className="row"><StatusPill s={p.status} />{p.isDemo && <DemoPill kind={p.demoKind} />}{p.watched && <span className="pill st-for_sale" title="On your watchlist">★ Watching</span>}</div>
        <div><span className="muted small">{p.pricingBasis !== 'Unknown' ? p.pricingBasis : ''}</span> <span className="price">{fmtMoney(p.askingPrice)}</span></div>
        <ChangeBadge db={ctx.db} p={p} />
        <div><b>{p.address}</b><br /><span className="muted">{p.town}{p.postcode ? ` ${p.postcode}` : ''}</span></div>
        <div className="small muted">{p.bedrooms != null ? `${p.bedrooms} bed` : 'Beds unknown'} · {p.propertyType === 'Unknown' ? 'Type unknown' : p.propertyType} · {daysOnMarket(ctx.db, p, ctx.now)} days observed</div>
      </div>
    </a>
  );
}

export function Dashboard({ ctx }: { ctx: Ctx }) {
  const [f, set] = useFilters();
  const { db } = ctx;
  if (!db.properties.length) return (
    <div className="stack" style={{ maxWidth: 720 }}><LastCheck ctx={ctx} /><div className="card stack">
      <h1>No properties yet</h1>
      <p>Properties appear here automatically when the property alert emails you have set up arrive in the alert inbox. The automatic check reads them every 3 hours; see <a href="#monitor">Monitoring</a> for what has been received.</p>
      <p className="small">You can also add a property by hand or import a spreadsheet. Every change is kept as history.</p>
      <div className="row"><a className="btn primary" href="#add">Add a property</a><a className="btn" href="#import">Import a spreadsheet</a>
        <button onClick={() => ctx.commit(addDemo(db, ctx.now))}>Load example data</button></div>
      <p className="small muted">Example data is fictional, labelled "Example" everywhere, and can be removed in one click from Settings &amp; data.</p>
    </div></div>
  );
  const props = applyFilters(db, f, ctx.areaTowns, ctx.now);
  const d = dashboard(db, props, ctx.now);
  const k = (v: string | number, l: string, s?: string, test?: string) => <div className="card kpi" data-testid={test}><div className="v">{v}</div><div className="l">{l}</div>{s && <div className="s">{s}</div>}</div>;
  const demo = db.properties.some((p) => p.isDemo && p.demoKind !== 'simulated');
  return (
    <div className="stack">
      {demo && <div className="banner demo">This includes <b>fictional example properties</b> (marked "Example"). Remove them any time in <a href="#data">Settings &amp; data</a>.</div>}
      <LastCheck ctx={ctx} />
      <Changes ctx={ctx} />
      <div className="row"><h1>Dashboard</h1><span className="sp" /><span className="muted small">{props.length} of {db.properties.length} properties shown</span></div>
      <FilterBar ctx={ctx} f={f} set={set} />
      <div className="grid kpis">
        {k(d.forSale, 'For sale now', 'incl. closing date set', 'kpi-forsale')}
        {k(d.new7, 'New, last 7 days')}{k(d.new30, 'New, last 30 days')}
        {k(d.reduced, 'Have been reduced', d.reducedShare == null ? undefined : `${pct(d.reducedShare)} of shown`, 'kpi-reduced')}
        {k(d.increased, 'Have been increased')}
        {k(d.underOffer, 'Under offer', 'incl. missives concluded', 'kpi-underoffer')}
        {k(d.returned, 'Returned to market')}{k(d.withdrawn, 'Withdrawn')}
        {d.notSeen > 0 && k(d.notSeen, 'No longer seen', 'unverified, not counted as sold')}
        {k(fmtMoney(d.medianPrice), 'Median asking price', `Average ${fmtMoney(d.meanPrice)}`)}
        {k(d.medianDays == null ? 'Unknown' : `${Math.round(d.medianDays)} days`, 'Median days on market', 'as observed by this app')}
        {k(d.medianPpsm == null ? 'Unknown' : `£${Math.round(d.medianPpsm).toLocaleString('en-GB')}`, 'Typical asking price per m²', `from ${d.ppsmCount} with known floor area`)}
      </div>
      <p className="small muted">All figures are <b>asking prices</b> recorded by this app, not sold prices or valuations. A reduction in asking price is not by itself evidence that local values are falling.</p>
      {props.length ? <div className="grid cards">{props.map((p) => <PropertyCard key={p.id} ctx={ctx} p={p} />)}</div> : <div className="card">No properties match these filters. <button onClick={() => set(NO_FILTERS)}>Clear filters</button></div>}
    </div>
  );
}
export type { PropertyType };
