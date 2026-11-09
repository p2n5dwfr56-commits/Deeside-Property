// In-app notification centre. Alerts come only from changes this app actually recorded.
import type { Ctx } from './App';
import type { Alert } from '../domain/types';

const KIND: Record<Alert['kind'], string> = { price_reduction: 'Price reduced', watched_under_offer: 'Watched property under offer', back_on_market: 'Back on the market', new_match: 'New match for your criteria', long_on_market: 'Long on the market', source_quiet: 'A source has gone quiet', collection_failed: 'Automatic check failed', review_needed: 'Possible duplicate to check' };

export function Alerts({ ctx }: { ctx: Ctx }) {
  const { db } = ctx; const unread = db.alerts.filter((a) => !a.read).length;
  const setAll = (read: boolean, ids?: string[]) => ctx.commit({ ...db, alerts: db.alerts.map((a) => (!ids || ids.includes(a.id) ? { ...a, read } : a)) });
  return (
    <div className="stack">
      <div className="row"><h1>Alerts</h1><span className="sp" />{unread > 0 && <button onClick={() => setAll(true)}>Mark all as read</button>}</div>
      <p className="small muted">Alerts are raised when an import or your own edit records a change. There are no automatic website checks yet, so nothing here comes from an unattended check. Email alerts will follow once the online account is set up. Set your criteria and the "long on the market" threshold in <a href="#data">Settings</a>.</p>
      {!db.alerts.length && <div className="card muted">No alerts yet.</div>}
      {db.alerts.map((a) => { const p = db.properties.find((x) => x.id === a.propertyId); return (
        <div key={a.id} className={`card alert ${a.read ? '' : 'unread'}`} data-testid="alert">
          <div className="row"><b>{KIND[a.kind]}</b><span className="muted small">{new Date(a.at).toLocaleString('en-GB')}</span><span className="sp" />
            <button onClick={() => setAll(!a.read, [a.id])}>{a.read ? 'Mark unread' : 'Mark read'}</button></div>
          <div>{a.message}</div>{p && <a className="small" href={`#p-${p.id}`} onClick={() => !a.read && setAll(true, [a.id])}>View property</a>}
        </div>); })}
    </div>
  );
}
