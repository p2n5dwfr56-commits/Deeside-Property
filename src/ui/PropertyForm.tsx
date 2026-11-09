// Add a property by hand, or edit one. Every change goes through the tracking engine, so history is kept.
import { useState } from 'react';
import type { Ctx } from './App';
import type { PricingBasis, PropertyType, Status } from '../domain/types';
import { BASES, STATUS_LABEL, TYPES } from '../domain/types';
import type { Observation } from '../domain/engine';
import { editProperty, findMatch, importObservations } from '../domain/engine';
import { parseDate, parseEpc, parsePrice, today } from '../domain/parse';

type F = Record<string, string | boolean>;
const numOrNull = (s: string) => { const t = s.replace(/[£,\s]/g, ''); if (!t) return null; const n = Number(t); return Number.isFinite(n) ? n : NaN; };

export function PropertyForm({ ctx, id }: { ctx: Ctx; id?: string }) {
  const { db } = ctx; const p = id ? db.properties.find((x) => x.id === id) : undefined;
  const s = (v: unknown) => (v == null ? '' : String(v));
  const [f, setF] = useState<F>(() => ({
    address: s(p?.address), town: p?.town ?? ctx.areaTowns[0] ?? '', postcode: s(p?.postcode), price: s(p?.askingPrice), basis: p?.pricingBasis ?? 'Offers over',
    status: p?.status ?? 'for_sale', bedrooms: s(p?.bedrooms), bathrooms: s(p?.bathrooms), propertyType: p?.propertyType ?? 'Unknown', floorAreaSqm: s(p?.floorAreaSqm),
    landSize: s(p?.landSize), epc: s(p?.epc), homeReportValuation: s(p?.homeReportValuation), agent: s(p?.agent), source: p?.sources[0]?.source ?? 'Manual',
    url: s(p?.sources[0]?.url), dateFirstAdvertised: s(p?.dateFirstAdvertised), closingDate: s(p?.closingDate), photoUrl: s(p?.photoUrl), photoPermitted: !!p?.photoPermitted, date: today(),
  }));
  const [errors, setErrors] = useState<string[]>([]);
  const [dupOf, setDupOf] = useState<{ id: string; label: string; obs: Observation } | null>(null);
  const u = (k: string) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const str = (k: string) => String(f[k] ?? '');
  const towns = [...new Set([...db.settings.towns.map((t) => t.name), ...(p ? [p.town] : [])])];

  const submit = (e: React.FormEvent) => {
    e.preventDefault(); const errs: string[] = [];
    if (!str('address').trim()) errs.push('Enter the address.'); if (!str('town').trim()) errs.push('Choose the town.');
    const priceTxt = str('price'); const price = priceTxt.trim() ? (parsePrice(priceTxt).price ?? numOrNull(priceTxt)) : null;
    if (price != null && (Number.isNaN(price) || price < 1000)) errs.push('The asking price should be a number in pounds, e.g. 275000.');
    const nums: Record<string, number | null> = {};
    for (const k of ['bedrooms', 'bathrooms', 'floorAreaSqm', 'homeReportValuation']) { const n = numOrNull(str(k)); if (Number.isNaN(n)) errs.push(`"${k}" should be a number.`); nums[k] = n; }
    for (const k of ['dateFirstAdvertised', 'closingDate', 'date']) if (str(k) && !parseDate(str(k))) errs.push(`"${k}" is not a valid date.`);
    if (str('epc') && !parseEpc(str('epc'))) errs.push('EPC rating should be a letter from A to G.');
    setErrors(errs); if (errs.length) return;
    const obs: Observation = {
      address: str('address').trim(), town: str('town').trim(), postcode: str('postcode').trim().toUpperCase() || null, price, basis: (str('basis') || 'Unknown') as PricingBasis,
      status: str('status') as Status, bedrooms: nums.bedrooms, bathrooms: nums.bathrooms, propertyType: str('propertyType') as PropertyType, floorAreaSqm: nums.floorAreaSqm,
      landSize: str('landSize').trim() || null, epc: str('epc') ? parseEpc(str('epc')) : null, homeReportValuation: nums.homeReportValuation, agent: str('agent').trim() || null,
      url: str('url').trim() || null, dateFirstAdvertised: str('dateFirstAdvertised') || null, closingDate: str('closingDate') || null,
      photoUrl: str('photoUrl').trim() || null, photoPermitted: !!f.photoPermitted, date: str('date') || today(),
    };
    if (p) {
      let next = editProperty(db, p.id, { ...obs, date: obs.date || undefined }, 'Manual edit');
      if (obs.url && !p.sources.some((x) => x.url === obs.url)) next = { ...next, properties: next.properties.map((x) => x.id === p.id ? { ...x, sources: [...x.sources, { source: str('source') || 'Manual', url: obs.url!, listingId: null, firstSeen: obs.date!, lastSeen: obs.date! }] } : x) };
      if (ctx.commit(next)) ctx.go(`p-${p.id}`);
    } else {
      const dup = findMatch(db, obs, str('source') || 'Manual');
      if (dup && !dupOf) { setDupOf({ id: dup.id, label: `${dup.address}, ${dup.town}`, obs }); return; }
      setDupOf(null);
      const { db: next, touched } = importObservations(db, [{ obs }], { origin: 'Manual entry', source: str('source') || 'Manual', kind: 'manual', label: 'Manual entry' });
      if (ctx.commit(next)) ctx.go(`p-${touched[0]}`);
    }
  };

  const T = (k: string, l: string, extra: object = {}) => <label>{l}<input value={str(k)} onChange={u(k)} {...extra} /></label>;
  return (
    <form className="card stack" onSubmit={submit} style={{ maxWidth: 860 }} noValidate>
      <h1>{p ? `Edit ${p.address}` : 'Add a property'}</h1>
      <p className="small muted">Leave anything you don't know blank: it will show as "Unknown". Nothing is guessed. {p && 'Changing the price or status here is recorded in the history with the date below.'}</p>
      {dupOf && <div className="banner info" role="alert">This looks like a property you already track: <b>{dupOf.label}</b>. Saving will update that property (any price or status change goes into its history) rather than add a duplicate.
        <div className="row" style={{ marginTop: 8 }}><button type="submit" className="primary">Update the existing property</button><a className="btn" href={`#p-${dupOf.id}`}>View it first</a></div></div>}
      {errors.length > 0 && <div className="banner err" role="alert">{errors.map((e) => <div key={e}>{e}</div>)}</div>}
      <div className="filters">
        {T('address', 'Address *', { required: true, autoFocus: !p })}
        <label>Town *<select value={str('town')} onChange={u('town')}>{towns.map((t) => <option key={t}>{t}</option>)}</select></label>
        {T('postcode', 'Postcode')}
        {T('price', 'Asking price (£)', { inputMode: 'numeric', placeholder: 'e.g. 275000' })}
        <label>Pricing basis<select value={str('basis')} onChange={u('basis')}>{BASES.map((b) => <option key={b}>{b}</option>)}</select></label>
        <label>Status<select value={str('status')} onChange={u('status')}>{(Object.keys(STATUS_LABEL) as Status[]).filter((x) => x !== 'not_seen').map((x) => <option key={x} value={x}>{STATUS_LABEL[x]}</option>)}</select></label>
        {T('bedrooms', 'Bedrooms', { inputMode: 'numeric' })}{T('bathrooms', 'Bathrooms', { inputMode: 'numeric' })}
        <label>Property type<select value={str('propertyType')} onChange={u('propertyType')}>{TYPES.map((t) => <option key={t}>{t}</option>)}</select></label>
        {T('floorAreaSqm', 'Floor area (m²)', { inputMode: 'decimal' })}{T('landSize', 'Land / garden size')}{T('epc', 'EPC rating (A to G)')}
        {T('homeReportValuation', 'Home Report valuation (£)', { inputMode: 'numeric', title: 'Only if you obtained the Home Report by authorised means' })}
        {T('agent', 'Selling agent')}{T('source', 'Listing source', { placeholder: 'e.g. ASPC, agent website' })}{T('url', 'Listing link (URL)', { type: 'url' })}
        <label>Date first advertised<input type="date" value={str('dateFirstAdvertised')} onChange={u('dateFirstAdvertised')} title="Only if you can verify it" /></label>
        <label>Closing date<input type="date" value={str('closingDate')} onChange={u('closingDate')} /></label>
        {T('photoUrl', 'Photo link (URL)', { type: 'url' })}
        <label className="inline"><input type="checkbox" checked={!!f.photoPermitted} onChange={(e) => setF({ ...f, photoPermitted: e.target.checked })} /> I have permission to display this photo</label>
        <label>{p ? 'Date of this change' : 'Date observed'}<input type="date" value={str('date')} onChange={u('date')} /></label>
      </div>
      <div className="row"><button className="primary" type="submit">{p ? 'Save changes' : 'Add property'}</button><a className="btn" href={p ? `#p-${p.id}` : '#dashboard'}>Cancel</a></div>
    </form>
  );
}
