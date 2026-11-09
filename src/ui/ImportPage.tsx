// Imports: a spreadsheet (CSV) or a property-alert email. Always previewed first, and always reported honestly.
import { useState } from 'react';
import type { Ctx } from './App';
import type { ImportRecord } from '../domain/types';
import type { Observation } from '../domain/engine';
import { importObservations } from '../domain/engine';
import { csvToObservations, TEMPLATE_HEADER, toCsv } from '../domain/csv';
import type { EmailListing } from '../domain/email';
import { parseAlertEmail } from '../domain/email';
import { fmtMoney } from '../domain/parse';
import { download } from './components';

const readFile = (file: File) => file.text();

export function Report({ r }: { r: ImportRecord }) {
  return (
    <div className={`banner ${r.ok && !r.errors.length ? 'ok' : r.ok ? 'info' : 'err'}`} role="status" data-testid="import-report">
      <b>{r.ok ? 'Import finished' : 'Import failed: nothing was imported'}</b> ({r.label}, {new Date(r.at).toLocaleString('en-GB')})<br />
      {r.rows} rows read · {r.created} new · {r.updated} updated · {r.unchanged} unchanged{r.snapshot ? ` · ${r.notSeen} no longer seen (unverified)` : ''} · {r.errors.length} problems
      {r.errors.length > 0 && <details><summary>Show problems</summary><ul className="small">{r.errors.map((e, i) => <li key={i}>{e}</li>)}</ul></details>}
    </div>
  );
}

export function ImportPage({ ctx }: { ctx: Ctx }) {
  const { db } = ctx;
  const [tab, setTab] = useState<'csv' | 'email'>('csv');
  const [text, setText] = useState(''); const [label, setLabel] = useState('');
  const [source, setSource] = useState('ASPC'); const [snapshot, setSnapshot] = useState(false);
  const [snapTowns, setSnapTowns] = useState<string[]>(ctx.areaTowns);
  const [emailDate, setEmailDate] = useState(ctx.now);
  const [picked, setPicked] = useState<Record<number, boolean>>({});
  const [report, setReport] = useState<ImportRecord | null>(null);

  const csv = tab === 'csv' && text.trim() ? csvToObservations(text) : null;
  const towns = db.settings.towns.map((t) => t.name);
  const email: EmailListing[] = tab === 'email' && text.trim() ? parseAlertEmail(text, towns, emailDate) : [];

  const run = (rows: { obs: Observation | null; error?: string }[], kind: 'csv' | 'email') => {
    const { db: next, report: r } = importObservations(db, rows, { origin: `${kind === 'csv' ? 'CSV' : 'Email'}: ${label || (kind === 'csv' ? 'pasted data' : 'pasted email')}`, source: source.trim() || 'Unknown source', kind, label: label || (kind === 'csv' ? 'Pasted CSV' : 'Pasted email'), snapshot: kind === 'csv' && snapshot, snapshotTowns: snapTowns });
    if (!r.ok) { ctx.commit({ ...db, imports: [r, ...db.imports] }); setReport(r); return; } // a failed import changes no properties, but is logged
    if (ctx.commit(next)) { setReport(r); setText(''); setPicked({}); }
    else setReport({ ...r, ok: false, errors: [...r.errors, 'Could not save in this browser, so nothing was imported.'] });
  };
  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => { const file = e.target.files?.[0]; if (!file) return; setText(await readFile(file)); setLabel(file.name); setReport(null); };

  return (
    <div className="stack">
      <h1>Import</h1>
      <div className="row"><button className={tab === 'csv' ? 'primary' : ''} onClick={() => { setTab('csv'); setText(''); setReport(null); }}>Spreadsheet (CSV)</button><button className={tab === 'email' ? 'primary' : ''} onClick={() => { setTab('email'); setText(''); setReport(null); }}>Property alert email</button></div>
      {report && <Report r={report} />}
      <div className="card stack">
        {tab === 'csv' ? <>
          <p className="small">Upload a CSV file (save it from Excel or Google Sheets as "CSV"), or paste its contents. Only <b>Address</b> and <b>Town</b> are required; columns can be in any order and common names are recognised. Importing the same file again will not create duplicates: changes in price or status are recorded as history.</p>
          <div className="row"><button onClick={() => download('deeside-property-template.csv', toCsv([TEMPLATE_HEADER, ['12 Example Road', 'Torphins', 'AB31 4XX', 'Offers over £250,000', 'Offers over', 'For sale', 3, 1, 'Detached', 110, '0.25 acre', 'D', '', 'Example Agents', 'https://example.org/listing/1', '', '', '2026-11-01', '', '', 'no']]))}>Download a blank template</button></div>
        </> : <>
          <p className="small">Paste a property alert email you received (for example an ASPC saved-search alert), or upload it as a <b>.eml</b> or text file (in most email programs: "Save as" or "Download message"). The app reads it here in your browser and shows what it found before anything is saved. It does not log in to any website.</p>
          <p className="small muted">This reader has not yet been tuned to a real ASPC alert; please check the preview carefully. Sending a sample alert to the developer would let it be made exact.</p>
        </>}
        <div className="filters">
          <label>File<input type="file" accept={tab === 'csv' ? '.csv,text/csv,text/plain' : '.eml,.txt,.html,.htm,message/rfc822,text/plain,text/html'} onChange={onFile} /></label>
          <label>Source name<input value={source} onChange={(e) => setSource(e.target.value)} placeholder="e.g. ASPC" /></label>
          <label>Description<input value={label} onChange={(e) => setLabel(e.target.value)} placeholder={tab === 'csv' ? 'e.g. ASPC list 9 Nov' : 'e.g. ASPC alert 9 Nov'} /></label>
          {tab === 'email' && <label>Date of the email<input type="date" value={emailDate} onChange={(e) => setEmailDate(e.target.value)} /></label>}
        </div>
        <textarea value={text} onChange={(e) => { setText(e.target.value); setReport(null); }} placeholder={tab === 'csv' ? 'Or paste CSV here' : 'Or paste the email here'} aria-label={tab === 'csv' ? 'CSV text' : 'Email text'} style={{ minHeight: 140, fontFamily: 'ui-monospace,monospace', fontSize: 13 }} />
        {tab === 'csv' && <div className="stack">
          <label className="inline"><input type="checkbox" checked={snapshot} onChange={(e) => setSnapshot(e.target.checked)} /> This file is a <b>complete list</b> of everything currently for sale from "{source}" in the towns below</label>
          {snapshot && <div className="small"><div className="row">{towns.map((t) => <label key={t} className="inline"><input type="checkbox" checked={snapTowns.includes(t)} onChange={(e) => setSnapTowns(e.target.checked ? [...snapTowns, t] : snapTowns.filter((x) => x !== t))} />{t}</label>)}</div>
            <p className="muted">Properties from this source in these towns that are missing from the file will be marked "No longer seen (unverified)". They are never marked as sold.</p></div>}
        </div>}
      </div>

      {csv && <div className="card stack">
        <h2>Preview</h2>
        {csv.missing.length ? <div className="banner err">This file has no column for: {csv.missing.join(', ')}. Nothing can be imported. Check the first row holds the column names.</div> : <>
          <p className="small">{csv.rows.filter((r) => r.obs).length} rows can be imported, {csv.rows.filter((r) => !r.obs).length} have problems.{csv.unknownColumns.length > 0 && ` Columns not used: ${csv.unknownColumns.join(', ')}.`}</p>
          <div className="tablewrap"><table><thead><tr><th>#</th><th>Address</th><th>Town</th><th className="n">Price</th><th>Status</th><th>Beds</th><th>Problem</th></tr></thead>
            <tbody>{csv.rows.slice(0, 50).map((r, i) => <tr key={i}><td>{i + 1}</td><td>{r.obs?.address}</td><td>{r.obs?.town}</td><td className="n">{r.obs ? fmtMoney(r.obs.price) : ''}</td><td>{r.obs?.status ?? (r.obs ? 'Not stated' : '')}</td><td>{r.obs?.bedrooms ?? ''}</td><td className="down">{r.error}</td></tr>)}</tbody></table></div>
          {csv.rows.length > 50 && <p className="small muted">Showing the first 50 of {csv.rows.length} rows.</p>}
          {!csv.rows.some((r) => r.obs) && <div className="banner err" role="alert">Nothing can be imported: every row has a problem (see the last column). Nothing has been changed.</div>}
          <div><button className="primary" onClick={() => run(csv.rows, 'csv')} disabled={!csv.rows.some((r) => r.obs)}>Import {csv.rows.filter((r) => r.obs).length} rows</button></div>
        </>}
      </div>}

      {tab === 'email' && text.trim() && <div className="card stack">
        <h2>Listings found: {email.length}</h2>
        {!email.length ? <p>No listings with a price could be found in this email. If it is an alert email, please send a copy so the reader can be adjusted.</p> : <>
          <div className="tablewrap"><table><thead><tr><th>Import?</th><th>Address</th><th>Town</th><th className="n">Price</th><th>Beds</th><th>Link</th><th>Warnings</th></tr></thead>
            <tbody>{email.map((l, i) => { const on = picked[i] ?? !l.warnings.some((w) => /address|town/.test(w)); return <tr key={i}>
              <td><input type="checkbox" aria-label={`Import listing ${i + 1}`} checked={on} onChange={(e) => setPicked({ ...picked, [i]: e.target.checked })} /></td>
              <td>{l.obs.address || <span className="unknown">Unknown</span>}</td><td>{l.obs.town || <span className="unknown">Unknown</span>}</td><td className="n">{fmtMoney(l.obs.price)}</td><td>{l.obs.bedrooms ?? <span className="unknown">Unknown</span>}</td>
              <td>{l.obs.url ? <a href={l.obs.url} target="_blank" rel="noopener noreferrer">link</a> : ''}</td><td className="small down">{l.warnings.join('; ')}</td></tr>; })}</tbody></table></div>
          <div><button className="primary" onClick={() => run(email.filter((l, i) => picked[i] ?? !l.warnings.some((w) => /address|town/.test(w))).map((l) => ({ obs: l.obs })), 'email')}>Import selected listings</button></div>
        </>}
      </div>}

      <div className="card"><h2>Import history</h2>
        {db.imports.length ? <div className="tablewrap"><table><thead><tr><th>When</th><th>What</th><th>Source</th><th className="n">New</th><th className="n">Updated</th><th className="n">Unchanged</th><th className="n">Not seen</th><th className="n">Problems</th></tr></thead>
          <tbody>{db.imports.slice(0, 30).map((r) => <tr key={r.id}><td>{new Date(r.at).toLocaleString('en-GB')}</td><td>{r.label}{r.snapshot ? ' (complete list)' : ''}</td><td>{r.source}</td><td className="n">{r.created}</td><td className="n">{r.updated}</td><td className="n">{r.unchanged}</td><td className="n">{r.snapshot ? r.notSeen : '–'}</td><td className="n">{r.errors.length}</td></tr>)}</tbody></table></div> : <p className="muted">No imports yet.</p>}
      </div>
    </div>
  );
}
