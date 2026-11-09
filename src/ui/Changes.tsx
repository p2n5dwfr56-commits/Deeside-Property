// "What's changed": the morning view. Lists what the app recorded since your last visit (or the last day / week).
import { useState } from 'react';
import type { Ctx } from './App';
import type { EventType } from '../domain/types';
import { EVENT_LABEL } from '../domain/types';
import { fmtDate, fmtMoney } from '../domain/parse';

const KEY = 'dpw.lastVisit';
const SHOW: EventType[] = ['listed', 'price_reduction', 'price_increase', 'closing_date', 'under_offer', 'missives', 'returned_to_market', 'relisted', 'withdrawn', 'sold'];

function previousVisit(): string | null {
  try { const prev = localStorage.getItem(KEY); localStorage.setItem(KEY, new Date().toISOString()); return prev; } catch { return null; }
}
const [firstPrev] = [typeof window === 'undefined' ? null : previousVisit()]; // read once per page load

export function Changes({ ctx }: { ctx: Ctx }) {
  const [range, setRange] = useState<'visit' | '1' | '7' | '30'>(firstPrev ? 'visit' : '7');
  const since = range === 'visit' && firstPrev ? firstPrev : new Date(Date.now() - Number(range === 'visit' ? 7 : range) * 86400000).toISOString();
  const props = new Map(ctx.db.properties.map((p) => [p.id, p]));
  const evs = ctx.db.events.filter((e) => SHOW.includes(e.type) && e.recordedAt >= since && props.get(e.propertyId) && props.get(e.propertyId)!.demoKind !== 'example')
    .sort((a, b) => b.recordedAt.localeCompare(a.recordedAt));
  const count = (t: EventType[]) => evs.filter((e) => t.includes(e.type)).length;
  return (
    <div className="card stack" data-testid="changes">
      <div className="row"><h2 style={{ margin: 0 }}>What's changed</h2><span className="sp" />
        <label className="inline">Since<select value={range} onChange={(e) => setRange(e.target.value as typeof range)} style={{ width: 'auto' }}>
          {firstPrev && <option value="visit">your last visit ({fmtDate(firstPrev.slice(0, 10))})</option>}<option value="1">the last day</option><option value="7">the last 7 days</option><option value="30">the last 30 days</option></select></label></div>
      <div className="row small">
        <span className="pill st-for_sale">{count(['listed', 'relisted'])} new or relisted</span><span className="pill chg-down">{count(['price_reduction'])} reduced</span>
        <span className="pill chg-up">{count(['price_increase'])} increased</span><span className="pill st-under_offer">{count(['under_offer', 'missives', 'closing_date'])} under offer / closing date</span>
        <span className="pill st-closing_date">{count(['returned_to_market'])} back on market</span>
      </div>
      {evs.length ? <div className="tablewrap"><table><tbody>{evs.slice(0, 30).map((e) => { const p = props.get(e.propertyId)!; return (
        <tr key={e.id}><td className="small">{fmtDate(e.date)}</td><td><b className={e.type === 'price_reduction' ? 'down' : ''}>{EVENT_LABEL[e.type]}</b>{e.type.startsWith('price') && e.priceBefore != null && e.priceAfter != null && <span className="small"> {fmtMoney(e.priceBefore)} → {fmtMoney(e.priceAfter)}</span>}</td>
          <td><a href={`#p-${p.id}`}>{p.address}</a>, {p.town}{p.demoKind === 'simulated' && <span className="small muted"> (simulated test)</span>}</td><td className="small muted">{e.source ?? ''}</td></tr>); })}</tbody></table></div>
        : <p className="muted small">Nothing new recorded in this period.</p>}
      {evs.length > 30 && <p className="small muted">Showing the latest 30 of {evs.length}.</p>}
    </div>
  );
}
