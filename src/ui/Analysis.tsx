// Market analysis from recorded ASKING prices. Not sold prices, not valuations.
import type { Ctx } from './App';
import { fmtMoney } from '../domain/parse';
import { byPriceBand, byTown, inventoryOverTime, priceChange } from '../domain/stats';
import { FilterBar, applyFilters, useFilters } from './Dashboard';
import { InlineBar, LineChart, pct } from './components';

export function Analysis({ ctx }: { ctx: Ctx }) {
  const [f, set] = useFilters(); const { db } = ctx;
  const props = applyFilters(db, { ...f, status: 'all' }, ctx.areaTowns, ctx.now);
  const towns = byTown(db, props, ctx.now); const bands = byPriceBand(db, props, ctx.now); const inv = inventoryOverTime(db, props, 16, ctx.now);
  const reducing = props.map((p) => ({ p, c: priceChange(db, p) })).filter((x) => x.c && x.c.diff < 0).sort((a, b) => a.c!.pct - b.c!.pct);
  const maxDays = Math.max(1, ...bands.map((b) => b.medianDays ?? 0)); const maxRed = Math.max(1, ...towns.map((t) => t.reducedPct ?? 0));
  const D = (n: number | null) => (n == null ? 'Unknown' : `${Math.round(n)} days`);
  return (
    <div className="stack">
      <h1>Analysis</h1>
      <div className="banner info small">These figures describe <b>asking prices and listing activity this app has recorded</b>. They are not sold prices or Home Report valuations, and price reductions are not proof that local house values are falling. Small numbers of properties make any figure unreliable. (The status filter is ignored here, so properties that have left the market still count.)</div>
      <FilterBar ctx={ctx} f={f} set={set} />
      <div className="card"><h2>Properties on the market, week by week</h2>
        <LineChart points={inv.map((x) => ({ date: x.date, value: x.count }))} fmtY={(n) => String(Math.round(n))} label="Number of properties on the market at the end of each week" height={200} />
        <p className="small muted">Rebuilt from recorded history. Only covers properties since this app first observed them.</p></div>
      <div className="card"><h2>By town</h2><div className="tablewrap"><table>
        <thead><tr><th>Town</th><th className="n">Tracked</th><th className="n">For sale</th><th className="n">Median asking</th><th>Share reduced</th><th className="n">Median days to under offer</th><th className="n">Median days on market</th></tr></thead>
        <tbody>{towns.map((t) => <tr key={t.town}><td>{t.town}</td><td className="n">{t.tracked}</td><td className="n">{t.forSale}</td><td className="n">{fmtMoney(t.medianPrice)}</td>
          <td><div className="row" style={{ flexWrap: 'nowrap' }}><span style={{ width: 44, textAlign: 'right' }}>{pct(t.reducedPct)}</span><InlineBar v={t.reducedPct} max={maxRed} /></div></td>
          <td className="n">{t.offers ? `${D(t.medianDaysToOffer)} (${t.offers})` : 'None yet'}</td><td className="n">{D(t.medianDays)}</td></tr>)}</tbody></table></div>
        <p className="small muted">"Days to under offer" uses only properties seen going under offer; the number in brackets is how many.</p></div>
      <div className="grid two">
        <div className="card"><h2>Time on market by price range</h2><table><thead><tr><th>Original asking price</th><th className="n">Properties</th><th>Median days on market</th></tr></thead>
          <tbody>{bands.map((b) => <tr key={b.label}><td>{b.label}</td><td className="n">{b.count}</td><td><div className="row" style={{ flexWrap: 'nowrap' }}><span style={{ width: 70, textAlign: 'right' }}>{b.count ? D(b.medianDays) : '–'}</span><InlineBar v={b.medianDays} max={maxDays} /></div></td></tr>)}</tbody></table></div>
        <div className="card"><h2>Reductions: original vs latest asking price</h2>
          {reducing.length ? <div className="tablewrap"><table><thead><tr><th>Property</th><th className="n">Original</th><th className="n">Latest</th><th className="n">Change</th></tr></thead>
            <tbody>{reducing.map(({ p, c }) => <tr key={p.id}><td><a href={`#p-${p.id}`}>{p.address}</a><br /><span className="small muted">{p.town}{p.isDemo ? (p.demoKind === 'simulated' ? ' · Simulated test' : ' · Example') : ''}</span></td><td className="n">{fmtMoney(p.originalAskingPrice)}</td><td className="n">{fmtMoney(p.askingPrice)}</td><td className="n down">−{fmtMoney(-c!.diff)}<br />{c!.pct.toFixed(1)}%</td></tr>)}</tbody></table></div> : <p className="muted">No reductions recorded among these properties.</p>}
        </div>
      </div>
    </div>
  );
}
