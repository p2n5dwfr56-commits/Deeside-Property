// One property: details, price graph, status timeline, sources and notes.
import { useState } from 'react';
import type { Ctx } from './App';
import type { PropertyEvent, Status } from '../domain/types';
import { EVENT_LABEL, STATUS_LABEL } from '../domain/types';
import { daysBetween, fmtDate, fmtMoney, today } from '../domain/parse';
import { daysOnMarket, editProperty, eventsOf } from '../domain/engine';
import { priceSeries } from '../domain/stats';
import { ChangeBadge, DemoPill, LineChart, StatusPill, Val } from './components';

function describe(e: PropertyEvent) {
  if ((e.type === 'price_reduction' || e.type === 'price_increase') && e.priceBefore != null && e.priceAfter != null) {
    const diff = e.priceAfter - e.priceBefore;
    return `${fmtMoney(e.priceBefore)} → ${fmtMoney(e.priceAfter)} (${diff < 0 ? '−' : '+'}${fmtMoney(Math.abs(diff))}, ${diff < 0 ? '−' : '+'}${Math.abs((diff / e.priceBefore) * 100).toFixed(1)}%)`;
  }
  if (e.type === 'listed') return e.priceAfter != null ? `${e.basisAfter && e.basisAfter !== 'Unknown' ? e.basisAfter + ' ' : ''}${fmtMoney(e.priceAfter)}` : 'Price unknown';
  if (e.type === 'basis_change') return `${e.basisBefore} → ${e.basisAfter}`;
  if (e.type === 'details_changed') return e.changes.map((c) => `${c.field}: ${c.before ?? 'Unknown'} → ${c.after ?? 'Unknown'}`).join('; ');
  if (e.statusBefore && e.statusAfter) return `${STATUS_LABEL[e.statusBefore]} → ${STATUS_LABEL[e.statusAfter]}`;
  return '';
}

export function Detail({ ctx, id }: { ctx: Ctx; id: string }) {
  const { db } = ctx; const p = db.properties.find((x) => x.id === id);
  const [notes, setNotes] = useState(p?.notes ?? ''); const [savedNote, setSavedNote] = useState(false);
  const [newStatus, setNewStatus] = useState<Status>(p?.status ?? 'for_sale'); const [statusDate, setStatusDate] = useState(today());
  if (!p) return <div className="card">This property was not found. <a href="#dashboard">Back to the dashboard</a></div>;
  const evs = eventsOf(db, p.id); const series = priceSeries(db, p).map((x) => ({ date: x.date, value: x.price }));
  const update = (patch: Partial<typeof p>) => ctx.commit({ ...db, properties: db.properties.map((x) => (x.id === p.id ? { ...x, ...patch } : x)) });
  const sinceSeen = daysBetween(p.dateFirstObserved, ctx.now);
  return (
    <div className="stack">
      <a href="#dashboard" className="small">← Dashboard</a>
      {p.isDemo && <div className="banner demo">This is a <b>fictional example</b> property for trying the app out.</div>}
      <div className="row">
        <div><h1>{p.address}</h1><div className="muted">{p.town}{p.postcode ? `, ${p.postcode}` : ''}</div></div>
        <span className="sp" />
        <button onClick={() => update({ watched: !p.watched })} aria-pressed={p.watched}>{p.watched ? '★ On watchlist' : '☆ Add to watchlist'}</button>
        <a className="btn" href={`#edit-${p.id}`}>Edit details or price</a>
      </div>
      <div className="row"><StatusPill s={p.status} />{p.isDemo && <DemoPill />}<span className="price">{p.pricingBasis !== 'Unknown' ? p.pricingBasis + ' ' : ''}{fmtMoney(p.askingPrice)}</span><ChangeBadge db={db} p={p} /></div>
      {p.status === 'not_seen' && <div className="banner info">This listing was missing from a complete import. That does <b>not</b> mean it has sold: it may have been withdrawn, sold, or simply removed from that website. Confirm its status below if you find out.</div>}
      <div className="grid two">
        <div className="card">
          <h2>Asking price history</h2>
          <LineChart points={series} step until={['for_sale', 'closing_date'].includes(p.status) ? ctx.now : undefined} fmtY={(n) => fmtMoney(n)} label={`Asking price over time for ${p.address}`} />
          <dl className="dl" style={{ marginTop: 10 }}>
            <dt>Original asking price</dt><dd><Val v={p.originalAskingPrice} fmt={fmtMoney} /></dd>
            <dt>Current asking price</dt><dd><Val v={p.askingPrice} fmt={fmtMoney} /></dd>
            <dt>Home Report valuation</dt><dd><Val v={p.homeReportValuation} fmt={fmtMoney} /> <span className="muted small">(only if obtained by authorised means)</span></dd>
          </dl>
        </div>
        <div className="card">
          <h2>Details</h2>
          {p.photoUrl && p.photoPermitted && <img src={p.photoUrl} alt={`Photo of ${p.address}`} style={{ width: '100%', borderRadius: 8, marginBottom: 10 }} />}
          <dl className="dl">
            <dt>Bedrooms</dt><dd><Val v={p.bedrooms} /></dd><dt>Bathrooms</dt><dd><Val v={p.bathrooms} /></dd>
            <dt>Property type</dt><dd><Val v={p.propertyType} /></dd><dt>Floor area</dt><dd><Val v={p.floorAreaSqm} fmt={(n: number) => `${n} m²`} /></dd>
            <dt>Land / garden</dt><dd><Val v={p.landSize} /></dd><dt>EPC rating</dt><dd><Val v={p.epc} /></dd>
            <dt>Selling agent</dt><dd><Val v={p.agent} /></dd>
            <dt>Closing date</dt><dd>{p.closingDate ? fmtDate(p.closingDate) : <span className="unknown">None known</span>}</dd>
            <dt>First advertised</dt><dd>{p.dateFirstAdvertised ? fmtDate(p.dateFirstAdvertised) : <span className="unknown">Unknown (not verified)</span>}</dd>
            <dt>First observed</dt><dd>{fmtDate(p.dateFirstObserved)} ({sinceSeen} days ago)</dd>
            <dt>Last checked</dt><dd>{fmtDate(p.lastVerified)}</dd>
            <dt>Days on market</dt><dd>{daysOnMarket(db, p, ctx.now)} <span className="muted small">(as observed)</span></dd>
          </dl>
        </div>
      </div>
      <div className="grid two">
        <div className="card">
          <h2>Status history</h2>
          <ol className="tl" data-testid="timeline">
            {evs.map((e) => <li key={e.id} className={`ev-${e.type}`}><b>{EVENT_LABEL[e.type]}</b> <span className="muted small">{fmtDate(e.date)}</span><br /><span className="small">{describe(e)}</span><br /><span className="small muted">Source: {e.origin}</span></li>)}
          </ol>
          <details style={{ marginTop: 8 }}><summary>Record a status change</summary>
            <div className="row" style={{ marginTop: 8 }}>
              <label>New status<select value={newStatus} onChange={(e) => setNewStatus(e.target.value as Status)}>{(Object.keys(STATUS_LABEL) as Status[]).filter((s) => s !== 'not_seen').map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}</select></label>
              <label>Date<input type="date" value={statusDate} onChange={(e) => setStatusDate(e.target.value)} /></label>
              <button className="primary" disabled={newStatus === p.status} onClick={() => ctx.commit(editProperty(db, p.id, { status: newStatus, date: statusDate }, 'Manual status change'))}>Save status</button>
            </div>
            <p className="small muted">Under Scottish practice, "Under offer" means an offer was accepted; "Missives concluded" means a binding contract; only use "Sold (confirmed)" once the sale has completed.</p>
          </details>
        </div>
        <div className="card stack">
          <h2>Listing sources</h2>
          {p.sources.length ? <ul className="small">{p.sources.map((s, i) => <li key={i}><b>{s.source}</b>{s.listingId ? ` (ID ${s.listingId})` : ''}: seen {fmtDate(s.firstSeen)} to {fmtDate(s.lastSeen)}{s.url && <> · <a href={s.url} target="_blank" rel="noopener noreferrer">Open original listing ↗</a></>}</li>)}</ul> : <p className="muted">No source recorded.</p>}
          <h2>Notes</h2>
          <textarea value={notes} onChange={(e) => { setNotes(e.target.value); setSavedNote(false); }} aria-label="Notes" placeholder="Your private notes" />
          <div className="row"><button onClick={() => { update({ notes }); setSavedNote(true); }} disabled={notes === p.notes}>Save notes</button>{savedNote && <span className="small muted">Saved</span>}</div>
        </div>
      </div>
    </div>
  );
}
