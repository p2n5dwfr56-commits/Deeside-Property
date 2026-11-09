// Monitoring: is the automatic collection working? Last check, each source's health, failures, notifications
// received, possible duplicates to review, and records with missing information.
import type { Ctx } from './App';
import type { Property } from '../domain/types';
import { EXPECTED_SOURCES, sourceState, type SourceState } from '../domain/pipeline';
import { identifiesBuilding, isStale, resolveReview } from '../domain/engine';
import { fmtDate, fmtMoney } from '../domain/parse';
import { DemoPill, StatusPill } from './components';
import { removeSimulated } from '../domain/demo';

export const when = (iso: string | null | undefined) => {
  if (!iso) return 'Never';
  const mins = Math.round((Date.now() - Date.parse(iso)) / 60000);
  const rel = mins < 1 ? 'just now' : mins < 60 ? `${mins} min ago` : mins < 48 * 60 ? `${Math.round(mins / 60)} h ago` : `${Math.round(mins / 1440)} days ago`;
  return `${new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} (${rel})`;
};
const STATE: Record<SourceState, [string, string]> = { ok: ['Delivering', 'st-under_offer'], quiet: ['Gone quiet', 'st-closing_date'], failing: ['Problem', 'chg-down'], waiting: ['Not set up yet', 'st-withdrawn'] };

/** The latest automatic check, in one line, for the dashboard. */
export function LastCheck({ ctx }: { ctx: Ctx }) {
  const r = ctx.db.runs[0];
  if (!r) return <div className="banner info small" data-testid="last-check">No automatic check has run yet. <a href="#monitor">Monitoring</a></div>;
  const late = Date.now() - Date.parse(r.finishedAt) > 7 * 3600000;
  return (
    <div className={`banner small ${!r.ok || late ? 'err' : 'ok'}`} data-testid="last-check">
      <b>{r.ok ? 'Last automatic check' : 'Last automatic check FAILED'}:</b> {when(r.finishedAt)} · {r.messagesNew} new notification{r.messagesNew === 1 ? '' : 's'} · {r.created} new {r.created === 1 ? 'property' : 'properties'} · {r.updated} updated
      {r.mailbox.includes('Simulated') && <> · <b>includes simulated test emails</b></>}
      {late && <> · <b>no check for over 7 hours: the schedule may have stopped</b></>} · <a href="#monitor">Details</a>
    </div>
  );
}

export function Monitoring({ ctx }: { ctx: Ctx }) {
  const { db } = ctx; const r = db.runs[0];
  const sources = [...new Set([...EXPECTED_SOURCES, ...Object.keys(db.sources)])];
  const open = db.reviews.filter((x) => x.status === 'open');
  const live = db.properties.filter((p) => !p.isDemo || p.demoKind === 'simulated');
  const incomplete = live.filter((p) => ['for_sale', 'closing_date', 'under_offer', 'missives'].includes(p.status)).map((p) => ({ p, miss: missing(p) })).filter((x) => x.miss.length);
  const stale = db.properties.filter((p) => isStale(db, p, ctx.now));
  const simCount = db.properties.filter((p) => p.demoKind === 'simulated').length;
  return (
    <div className="stack">
      <h1>Monitoring</h1>
      <LastCheck ctx={ctx} />
      {simCount > 0 && <div className="banner demo small"><b>{simCount} simulated test properties</b> are shown (marked "Simulated test"). They come from the labelled test mailbox, not real notifications. <button onClick={() => ctx.commit(removeSimulated(db))}>Remove simulated test data</button></div>}
      <div className="card"><h2>Sources</h2>
        <div className="tablewrap"><table><thead><tr><th>Source</th><th>Status</th><th>Last notification</th><th>Last listings read</th><th className="n">Emails</th><th className="n">Listings</th><th>Note</th></tr></thead>
          <tbody>{sources.map((s) => { const h = db.sources[s]; const st = sourceState(db, s); return (
            <tr key={s} data-testid={`source-${s}`}><td><b>{s}</b></td><td><span className={`pill ${STATE[st.state][1]}`}>{STATE[st.state][0]}</span></td><td>{when(h?.lastMessageAt)}</td><td>{when(h?.lastListingsAt)}</td>
              <td className="n">{h?.messages ?? 0}</td><td className="n">{h?.listings ?? 0}</td><td className="small">{st.state === 'failing' ? h?.lastError : st.note}</td></tr>); })}</tbody></table></div>
        <p className="small muted">Every source is checked at each automatic run (every 3 hours). "Gone quiet" means nothing has arrived for {db.settings.sourceQuietDays} days: check the alert is still switched on with that website.</p>
      </div>

      <div className="card stack"><h2>Possible duplicates to check ({open.length})</h2>
        {!open.length ? <p className="muted">Nothing to check. When two listings look alike but can't be matched with confidence, they appear here instead of being merged.</p>
          : open.map((rv) => { const a = db.properties.find((p) => p.id === rv.aId), b = db.properties.find((p) => p.id === rv.bId); if (!a || !b) return null; return (
            <div key={rv.id} className="card" data-testid="review">
              <p className="small">Alike because: {rv.reasons.join(', ')}.</p>
              <div className="grid two">{[a, b].map((p) => <Mini key={p.id} p={p} />)}</div>
              <div className="row" style={{ marginTop: 8 }}><button className="primary" onClick={() => ctx.commit(resolveReview(db, rv.id, 'merge'))}>Same property: merge</button><button onClick={() => ctx.commit(resolveReview(db, rv.id, 'separate'))}>Different properties</button></div>
            </div>); })}
      </div>

      <div className="grid two">
        <div className="card"><h2>Missing information ({incomplete.length})</h2>
          {incomplete.length ? <ul className="small">{incomplete.slice(0, 40).map(({ p, miss }) => <li key={p.id}><a href={`#p-${p.id}`}>{p.address}, {p.town}</a>: {miss.join(', ')}</li>)}</ul> : <p className="muted">None.</p>}
          <p className="small muted">Shown as "Unknown" until a notification provides it, or you add it. Nothing is guessed.</p></div>
        <div className="card"><h2>Not mentioned recently ({stale.length})</h2>
          {stale.length ? <ul className="small">{stale.map((p) => <li key={p.id}><a href={`#p-${p.id}`}>{p.address}, {p.town}</a>: last seen {fmtDate(p.lastVerified)}</li>)}</ul> : <p className="muted">None.</p>}
          <p className="small muted">Alert emails only mention new and changed listings, so silence does not mean sold or withdrawn. These keep their last known status.</p></div>
      </div>

      <div className="card"><h2>Recent automatic checks</h2>
        {db.runs.length ? <div className="tablewrap"><table><thead><tr><th>Finished</th><th>Started by</th><th>Mailbox</th><th className="n">New emails</th><th className="n">Listings</th><th className="n">New</th><th className="n">Updated</th><th className="n">To check</th><th>Result</th></tr></thead>
          <tbody>{db.runs.slice(0, 25).map((x) => <tr key={x.id}><td>{when(x.finishedAt)}</td><td>{x.trigger === 'schedule' ? 'Schedule' : x.trigger === 'manual' ? 'By hand' : 'Test'}</td><td className="small">{x.mailbox}</td><td className="n">{x.messagesNew}</td><td className="n">{x.listingsRead}</td><td className="n">{x.created}</td><td className="n">{x.updated}</td><td className="n">{x.flagged}</td>
            <td className="small">{x.ok ? (x.errors.length ? <span className="up">Done, with {x.errors.length} problem{x.errors.length > 1 ? 's' : ''}</span> : <span className="pill st-under_offer">OK</span>) : <span className="down">Failed: {x.errors.join('; ')}</span>}</td></tr>)}</tbody></table></div> : <p className="muted">No automatic check has run yet.</p>}
      </div>

      <div className="card"><h2>Notifications received</h2>
        {db.messages.length ? <div className="tablewrap"><table><thead><tr><th>Received</th><th>Source</th><th>Subject</th><th className="n">Listings</th><th className="n">New</th><th className="n">Updated</th><th>Result</th></tr></thead>
          <tbody>{db.messages.slice(0, 40).map((m) => <tr key={m.messageId}><td>{when(m.receivedAt)}</td><td>{m.source}</td><td className="small">{m.subject}</td><td className="n">{m.listings}</td><td className="n">{m.created}</td><td className="n">{m.updated}</td>
            <td className="small">{m.status === 'ok' ? 'Read' : m.status === 'ignored' ? 'Not a property email' : m.status === 'no_listings' ? <span className="down">No listings could be read</span> : <span className="down">Error</span>}{m.warnings.length > 0 && <details><summary>{m.warnings.length} note{m.warnings.length > 1 ? 's' : ''}</summary>{m.warnings.join('; ')}</details>}</td></tr>)}</tbody></table></div> : <p className="muted">None yet.</p>}
      </div>
      {r && <p className="small muted">Checks run on GitHub's servers every 3 hours whether or not this page is open. {ctx.cloud ? 'Results are saved in your private cloud database.' : 'This copy is the offline preview.'}</p>}
    </div>
  );
}

function missing(p: Property) {
  const m: string[] = [];
  if (p.askingPrice == null) m.push('price'); if (!p.postcode) m.push('postcode'); if (p.bedrooms == null) m.push('bedrooms');
  if (p.propertyType === 'Unknown') m.push('type'); if (!identifiesBuilding(p.address)) m.push('house number or name');
  return m;
}

function Mini({ p }: { p: Property }) {
  return (
    <div className="small">
      <div className="row"><StatusPill s={p.status} />{p.isDemo && <DemoPill kind={p.demoKind} />}</div>
      <b><a href={`#p-${p.id}`}>{p.address}</a></b>, {p.town} {p.postcode ?? ''}<br />
      {fmtMoney(p.askingPrice)} · {p.bedrooms ?? '?'} bed · {p.propertyType}<br />
      {p.sources.map((s) => <span key={s.source + s.listingId}>{s.source}{s.url && <> (<a href={s.url} target="_blank" rel="noopener noreferrer">listing</a>)</>} </span>)}
      <br /><span className="muted">First seen {fmtDate(p.dateFirstObserved)}</span>
    </div>
  );
}
