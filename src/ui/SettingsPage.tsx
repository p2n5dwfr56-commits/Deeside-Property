// Locations, radius, alert criteria, and your data: export, backup, restore, example data.
import { useState } from 'react';
import type { Ctx } from './App';
import type { PropertyType, Settings } from '../domain/types';
import { TYPES } from '../domain/types';
import { distanceKm } from '../domain/parse';
import { backup, emptyDb, restore } from '../domain/store';
import { exportHistory, exportProperties } from '../domain/csv';
import { addDemo, removeDemo } from '../domain/demo';
import { download } from './components';

export function SettingsPage({ ctx, onSignOut }: { ctx: Ctx; onSignOut?: () => void }) {
  const { db } = ctx; const s = db.settings;
  const [name, setName] = useState(''); const [lat, setLat] = useState(''); const [lon, setLon] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, setPending] = useState<{ db: ReturnType<typeof restore>; file: string } | null>(null); const [wipe, setWipe] = useState(false);
  const setS = (patch: Partial<Settings>) => ctx.commit({ ...db, settings: { ...s, ...patch } });
  const centre = s.towns.find((t) => t.name === 'Torphins');
  const n = (v: string) => (v.trim() === '' ? null : Number(v));
  const stamp = ctx.now;
  const demoCount = db.properties.filter((p) => p.isDemo && p.demoKind !== 'simulated').length;
  const addTown = () => {
    if (!name.trim()) return; if (s.towns.some((t) => t.name.toLowerCase() === name.trim().toLowerCase())) { setMsg({ ok: false, text: 'That location is already in the list.' }); return; }
    const la = Number(lat), lo = Number(lon); const hasPos = lat.trim() !== '' && lon.trim() !== '' && Number.isFinite(la) && Number.isFinite(lo);
    setS({ towns: [...s.towns, { name: name.trim(), lat: hasPos ? la : NaN, lon: hasPos ? lo : NaN }] }); setName(''); setLat(''); setLon(''); setMsg(null);
  };
  const onRestore = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; if (!f) return;
    try { setPending({ db: restore(await f.text()), file: f.name }); setMsg(null); }
    catch (err) { setMsg({ ok: false, text: `Restore failed: ${(err as Error).message} Nothing was changed.` }); }
    e.target.value = '';
  };
  return (
    <div className="stack">
      <h1>Settings &amp; data</h1>
      {msg && <div className={`banner ${msg.ok ? 'ok' : 'err'}`} role="status">{msg.text}</div>}
      <div className="grid two">
        <div className="card stack"><h2>Locations</h2>
          <table><thead><tr><th>Town</th><th className="n">From Torphins</th><th /></tr></thead>
            <tbody>{s.towns.map((t) => <tr key={t.name}><td>{t.name}</td><td className="n">{centre && Number.isFinite(t.lat) ? `${distanceKm(centre, t).toFixed(1)} km` : 'Unknown'}</td>
              <td>{t.name !== 'Torphins' && <button onClick={() => setS({ towns: s.towns.filter((x) => x.name !== t.name) })} aria-label={`Remove ${t.name}`}>Remove</button>}</td></tr>)}</tbody></table>
          <div className="filters"><label>New location<input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Echt" /></label>
            <label>Latitude (optional)<input value={lat} onChange={(e) => setLat(e.target.value)} inputMode="decimal" /></label>
            <label>Longitude (optional)<input value={lon} onChange={(e) => setLon(e.target.value)} inputMode="decimal" /></label><button onClick={addTown}>Add location</button></div>
          <label>Only include locations within this distance of Torphins (km, blank for no limit)
            <input inputMode="decimal" defaultValue={s.radiusKm ?? ''} onBlur={(e) => setS({ radiusKm: n(e.target.value) })} /></label>
          <p className="small muted">Distances use approximate town centres. Locations added without a position are always included. Removing a location keeps its properties; choose "Everything tracked" on the dashboard to see them.</p>
        </div>
        <div className="card stack"><h2>Alerts</h2>
          <label>"Long on the market" after this many days<input inputMode="numeric" defaultValue={s.longOnMarketDays} onBlur={(e) => { const v = Number(e.target.value); if (v > 0) setS({ longOnMarketDays: v }); }} /></label>
          <h3>Alert me about new listings matching</h3>
          <div className="row">{s.towns.map((t) => <label key={t.name} className="inline"><input type="checkbox" checked={s.criteria.towns.includes(t.name)} onChange={(e) => setS({ criteria: { ...s.criteria, towns: e.target.checked ? [...s.criteria.towns, t.name] : s.criteria.towns.filter((x) => x !== t.name) } })} />{t.name}</label>)}</div>
          <div className="filters">
            <label>Min price (£)<input inputMode="numeric" defaultValue={s.criteria.minPrice ?? ''} onBlur={(e) => setS({ criteria: { ...s.criteria, minPrice: n(e.target.value) } })} /></label>
            <label>Max price (£)<input inputMode="numeric" defaultValue={s.criteria.maxPrice ?? ''} onBlur={(e) => setS({ criteria: { ...s.criteria, maxPrice: n(e.target.value) } })} /></label>
            <label>Min bedrooms<input inputMode="numeric" defaultValue={s.criteria.minBeds ?? ''} onBlur={(e) => setS({ criteria: { ...s.criteria, minBeds: n(e.target.value) } })} /></label>
          </div>
          <div className="row small">{TYPES.filter((t) => t !== 'Unknown').map((t) => <label key={t} className="inline"><input type="checkbox" checked={s.criteria.types.includes(t)} onChange={(e) => setS({ criteria: { ...s.criteria, types: e.target.checked ? [...s.criteria.types, t] : s.criteria.types.filter((x) => x !== t) as PropertyType[] } })} />{t}</label>)}</div>
          <label>Warn when a source has sent nothing for (days)<input inputMode="numeric" defaultValue={s.sourceQuietDays} onBlur={(e) => { const v = Number(e.target.value); if (v > 0) setS({ sourceQuietDays: v }); }} /></label>
          <label>Flag listings not mentioned by any source for (days)<input inputMode="numeric" defaultValue={s.staleDays} onBlur={(e) => { const v = Number(e.target.value); if (v > 0) setS({ staleDays: v }); }} /></label>
          <p className="small muted">Leave everything blank to get no "new match" alerts. Price reductions, watched properties going under offer and properties coming back on the market always raise an alert.</p>
        </div>
      </div>
      <div className="card stack"><h2>Your data</h2>
        {ctx.cloud ? <p className="small">Everything is saved in your <b>private cloud database</b>, shared by your devices and the automatic checks. A backup file is still a good idea now and then.</p>
          : <p className="small">This is the <b>offline preview</b>: data is saved in this browser on this device only. Download a backup now and then.</p>}
        <div className="row">
          <button className="primary" onClick={() => download(`deeside-property-backup-${stamp}.json`, backup(db), 'application/json')}>Download full backup</button>
          <label className="btn" style={{ display: 'inline-block' }}>Restore from backup…<input type="file" accept=".json,application/json" onChange={onRestore} style={{ display: 'none' }} /></label>
          <button onClick={() => download(`deeside-properties-${stamp}.csv`, exportProperties(db))}>Export properties (CSV)</button>
          <button onClick={() => download(`deeside-history-${stamp}.csv`, exportHistory(db))}>Export full history (CSV)</button>
        </div>
        {pending && <div className="banner info" role="alert">Replace everything in this browser with the backup <b>{pending.file}</b> ({pending.db.properties.length} properties)? Your current data will be lost unless you have downloaded a backup.
          <div className="row" style={{ marginTop: 8 }}><button className="primary" onClick={() => { ctx.commit(pending.db); setMsg({ ok: true, text: `Restored ${pending.db.properties.length} properties from ${pending.file}.` }); setPending(null); }}>Replace with backup</button><button onClick={() => setPending(null)}>Cancel</button></div></div>}
        <h3>Example data</h3>
        <div className="row">{demoCount ? <button onClick={() => { ctx.commit(removeDemo(db)); setMsg({ ok: true, text: `Removed ${demoCount} example properties. Your own data is untouched.` }); }}>Remove the {demoCount} example properties</button>
          : <button onClick={() => { ctx.commit(addDemo(db, ctx.now)); setMsg({ ok: true, text: 'Added 8 fictional example properties, marked "Example".' }); }}>Add example properties</button>}</div>
        {onSignOut && <div><button onClick={onSignOut}>Sign out</button></div>}
        <details><summary>Delete everything</summary><p className="small">This removes all properties, history and settings from this browser.</p>
          {!wipe ? <button className="danger" onClick={() => setWipe(true)}>Delete all data…</button> : <div className="row"><span className="down small">This cannot be undone unless you have a backup.</span>
            <button className="danger" onClick={() => { ctx.commit(emptyDb()); setWipe(false); setMsg({ ok: true, text: 'All data deleted.' }); }}>Yes, delete everything</button><button onClick={() => setWipe(false)}>Cancel</button></div>}</details>
      </div>
    </div>
  );
}
