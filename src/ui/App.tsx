// App shell: loads the saved data, saves every change straight away, and switches between pages (#name links).
import { useEffect, useState } from 'react';
import type { Db } from '../domain/types';
import { load, save } from '../domain/store';
import { checkLongOnMarket } from '../domain/engine';
import { addDemo } from '../domain/demo';
import { distanceKm, today } from '../domain/parse';
import { Dashboard } from './Dashboard';
import { Detail } from './Detail';
import { PropertyForm } from './PropertyForm';
import { ImportPage } from './ImportPage';
import { Alerts } from './Alerts';
import { Analysis } from './Analysis';
import { SettingsPage } from './SettingsPage';

export interface Ctx { db: Db; commit: (db: Db) => boolean; go: (path: string) => void; now: string; areaTowns: string[] }

// Pages are plain #names (e.g. #import, #p-<id>) so links also work inside a claude.ai preview.
const useHash = () => { const [h, setH] = useState(location.hash.slice(1)); useEffect(() => { const f = () => { setH(location.hash.slice(1)); window.scrollTo(0, 0); }; addEventListener('hashchange', f); return () => removeEventListener('hashchange', f); }, []); return h; };

/** Towns in your area: your locations, limited to the radius around Torphins if you set one. */
export function areaTowns(db: Db) {
  const t = db.settings.towns, centre = t.find((x) => x.name === 'Torphins');
  return t.filter((x) => db.settings.radiusKm == null || !centre || !Number.isFinite(x.lat) || x.lat == null || distanceKm(centre, x) <= db.settings.radiusKm).map((x) => x.name);
}

export function App() {
  const [db, setDb] = useState<Db>(() => {
    let d = load();
    // The online preview starts with the labelled example properties on a first visit, so there is something to try.
    if (import.meta.env.VITE_PREVIEW && !d.properties.length) { let seen = true; try { seen = !!localStorage.getItem('dpw.previewSeen'); localStorage.setItem('dpw.previewSeen', '1'); } catch { /* storage blocked */ } if (!seen) { d = addDemo(d); save(d); } }
    return checkLongOnMarket(d);
  });
  const [saveError, setSaveError] = useState<string | null>(null);
  const path = useHash(); const now = today();
  const commit = (next: Db) => { const n = checkLongOnMarket(next, now); const r = save(n); setSaveError(r.ok ? null : r.error!); setDb(n); return r.ok; };
  const go = (p: string) => { location.hash = p; };
  const ctx: Ctx = { db, commit, go, now, areaTowns: areaTowns(db) };
  const unread = db.alerts.filter((a) => !a.read).length;
  const m = path.match(/^(p|edit)-(.+)$/); const [page, arg] = m ? [m[1], m[2]] : [path || 'dashboard', ''];
  const nav: [string, string][] = [['dashboard', 'Dashboard'], ['analysis', 'Analysis'], ['add', 'Add property'], ['import', 'Import'], ['alerts', 'Alerts'], ['data', 'Settings & data']];
  let body;
  if (page === 'p' && arg) body = <Detail ctx={ctx} id={arg} />;
  else if (page === 'edit' && arg) body = <PropertyForm ctx={ctx} id={arg} />;
  else if (page === 'add') body = <PropertyForm ctx={ctx} />;
  else if (page === 'import') body = <ImportPage ctx={ctx} />;
  else if (page === 'alerts') body = <Alerts ctx={ctx} />;
  else if (page === 'analysis') body = <Analysis ctx={ctx} />;
  else if (page === 'data') body = <SettingsPage ctx={ctx} />;
  else body = <Dashboard ctx={ctx} />;
  const cur = page;
  return (
    <>
      <header className="top"><div className="in">
        <div className="brand">Deeside Property Watch<small>Private research tool · asking prices, not valuations</small></div>
        <nav>{nav.map(([h, l]) => <a key={h} href={'#' + h} className={cur === h ? 'on' : ''}>{l}{h === 'alerts' && unread > 0 && <span className="badge" aria-label={`${unread} unread`}>{unread}</span>}</a>)}</nav>
      </div></header>
      <main>
        {saveError && <div className="banner err" role="alert">{saveError}. Your latest change is shown but NOT saved. Download a backup from Settings &amp; data.</div>}
        {body}
      </main>
    </>
  );
}
