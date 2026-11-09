// App shell: loads the saved data, saves every change straight away, and switches between pages (#name links).
import { useCallback, useEffect, useRef, useState } from 'react';
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
import { Monitoring } from './Monitoring';
import { CloudConflict, cloudConfigured, currentSession, loadCloud, onAuthChange, saveCloud, sendLoginLink, signOut } from '../cloud';

export interface Ctx { db: Db; commit: (db: Db) => boolean; go: (path: string) => void; now: string; areaTowns: string[]; cloud: boolean }

// Pages are plain #names (e.g. #import, #p-<id>) so links also work inside a claude.ai preview.
const useHash = () => { const [h, setH] = useState(location.hash.slice(1)); useEffect(() => { const f = () => { setH(location.hash.slice(1)); window.scrollTo(0, 0); }; addEventListener('hashchange', f); return () => removeEventListener('hashchange', f); }, []); return h; };

/** Towns in your area: your locations, limited to the radius around Torphins if you set one. */
export function areaTowns(db: Db) {
  const t = db.settings.towns, centre = t.find((x) => x.name === 'Torphins');
  return t.filter((x) => db.settings.radiusKm == null || !centre || !Number.isFinite(x.lat) || x.lat == null || distanceKm(centre, x) <= db.settings.radiusKm).map((x) => x.name);
}

export function App() { return cloudConfigured ? <CloudApp /> : <LocalApp />; }

/** Offline/preview mode: data kept in this browser. */
function LocalApp() {
  const [db, setDb] = useState<Db>(() => {
    let d = load();
    // The online preview starts with the labelled example properties on a first visit, so there is something to try.
    if (import.meta.env.VITE_PREVIEW && !d.properties.length) { let seen = true; try { seen = !!localStorage.getItem('dpw.previewSeen'); localStorage.setItem('dpw.previewSeen', '1'); } catch { /* storage blocked */ } if (!seen) { d = addDemo(d); save(d); } }
    return checkLongOnMarket(d);
  });
  const [saveError, setSaveError] = useState<string | null>(null);
  const commit = (next: Db) => { const n = checkLongOnMarket(next, today()); const r = save(n); setSaveError(r.ok ? null : r.error!); setDb(n); return r.ok; };
  return <Shell db={db} commit={commit} cloud={false} banner={saveError && <div className="banner err" role="alert">{saveError}. Your latest change is shown but NOT saved. Download a backup from Settings &amp; data.</div>} />;
}

/** Online mode: private login, data in the cloud database, shared by your Mac and iPhone and the automatic checks. */
function CloudApp() {
  const [session, setSession] = useState<unknown>(undefined);
  const [db, setDb] = useState<Db | null>(null); const [error, setError] = useState<string | null>(null); const [notice, setNotice] = useState<string | null>(null);
  const version = useRef(0); const saving = useRef<Promise<unknown>>(Promise.resolve()); const pending = useRef(0);
  useEffect(() => { currentSession().then(setSession); const sub = onAuthChange(setSession); return () => sub.unsubscribe(); }, []);
  const refresh = useCallback(async (force = false) => {
    if (pending.current && !force) return;
    try { const r = await loadCloud(); if (force || r.version !== version.current) { version.current = r.version; setDb(checkLongOnMarket(r.db, today())); } setError(null); }
    catch (e) { setError((e as Error).message); }
  }, []);
  useEffect(() => { if (session) refresh(true); }, [session, refresh]);
  useEffect(() => { // pick up the latest automatic check when you come back to the app
    const f = () => { if (document.visibilityState === 'visible' && session) refresh(); };
    document.addEventListener('visibilitychange', f); const t = setInterval(f, 5 * 60000);
    return () => { document.removeEventListener('visibilitychange', f); clearInterval(t); };
  }, [session, refresh]);
  if (session === undefined) return <main><p className="muted">Loading…</p></main>;
  if (!session) return <Login />;
  if (!db) return <main>{error ? <div className="banner err" role="alert">{error} <button onClick={() => signOut()}>Sign out</button></div> : <p className="muted">Loading your data…</p>}</main>;
  const commit = (next: Db) => {
    const n = checkLongOnMarket(next, today()); setDb(n); pending.current++;
    saving.current = saving.current.then(() => saveCloud(n, version.current).then((v) => { version.current = v; setNotice(null); })
      .catch(async (e) => { if (e instanceof CloudConflict) { setNotice('The automatic check updated the data while you were working, so your last change was not saved. The latest data is now shown: please repeat the change.'); await refresh(true); } else setNotice(`Not saved: ${(e as Error).message}`); }))
      .finally(() => { pending.current--; });
    return true;
  };
  return <Shell db={db} commit={commit} cloud banner={<>{notice && <div className="banner err" role="alert">{notice}</div>}{error && <div className="banner err">{error}</div>}</>} onSignOut={() => signOut()} />;
}

function Login() {
  const [email, setEmail] = useState(''); const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle'); const [err, setErr] = useState<string | null>(null);
  return (
    <main><form className="card stack" style={{ maxWidth: 440, margin: '40px auto' }} onSubmit={async (e) => { e.preventDefault(); setErr(null); setState('sending'); try { await sendLoginLink(email.trim()); setState('sent'); } catch (x) { setErr((x as Error).message); setState('idle'); } }}>
      <h1>Deeside Property Watch</h1>
      <p className="small">Private. Enter your email address and we'll send you a sign-in link. Only addresses you have allowed can see any data.</p>
      {state === 'sent' ? <div className="banner ok" role="status">Check your email for the sign-in link, then open it on this device.</div> : <>
        <label>Email<input id="login-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" /></label>
        {err && <div className="banner err" role="alert">{err}</div>}
        <button className="primary" disabled={state === 'sending'}>{state === 'sending' ? 'Sending…' : 'Send sign-in link'}</button></>}
    </form></main>
  );
}

function Shell({ db, commit, cloud, banner, onSignOut }: { db: Db; commit: (db: Db) => boolean; cloud: boolean; banner?: React.ReactNode; onSignOut?: () => void }) {
  const path = useHash(); const now = today();
  const go = (p: string) => { location.hash = p; };
  const ctx: Ctx = { db, commit, go, now, areaTowns: areaTowns(db), cloud };
  const unread = db.alerts.filter((a) => !a.read).length;
  const openReviews = db.reviews.filter((r) => r.status === 'open').length;
  const m = path.match(/^(p|edit)-(.+)$/); const [page, arg] = m ? [m[1], m[2]] : [path || 'dashboard', ''];
  const nav: [string, string][] = [['dashboard', 'Dashboard'], ['monitor', 'Monitoring'], ['analysis', 'Analysis'], ['alerts', 'Alerts'], ['add', 'Add'], ['import', 'Import'], ['data', 'Settings & data']];
  let body;
  if (page === 'p' && arg) body = <Detail ctx={ctx} id={arg} />;
  else if (page === 'edit' && arg) body = <PropertyForm ctx={ctx} id={arg} />;
  else if (page === 'add') body = <PropertyForm ctx={ctx} />;
  else if (page === 'import') body = <ImportPage ctx={ctx} />;
  else if (page === 'alerts') body = <Alerts ctx={ctx} />;
  else if (page === 'analysis') body = <Analysis ctx={ctx} />;
  else if (page === 'monitor') body = <Monitoring ctx={ctx} />;
  else if (page === 'data') body = <SettingsPage ctx={ctx} onSignOut={onSignOut} />;
  else body = <Dashboard ctx={ctx} />;
  return (
    <>
      <header className="top"><div className="in">
        <div className="brand">Deeside Property Watch<small>Private research tool · asking prices, not valuations</small></div>
        <nav>{nav.map(([h, l]) => <a key={h} href={'#' + h} className={page === h ? 'on' : ''}>{l}
          {h === 'alerts' && unread > 0 && <span className="badge" aria-label={`${unread} unread`}>{unread}</span>}
          {h === 'monitor' && openReviews > 0 && <span className="badge" aria-label={`${openReviews} to review`}>{openReviews}</span>}</a>)}</nav>
      </div></header>
      <main>{banner}{body}</main>
    </>
  );
}
