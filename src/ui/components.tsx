// Small shared pieces: status labels, "Unknown" values, price-change badges and a simple line chart.
import { useRef, useState, type ReactNode } from 'react';
import type { Db, Property, Status } from '../domain/types';
import { STATUS_LABEL } from '../domain/types';
import { fmtDate, fmtMoney } from '../domain/parse';
import { priceChange } from '../domain/stats';

export const StatusPill = ({ s }: { s: Status }) => <span className={`pill st-${s}`}>{STATUS_LABEL[s]}</span>;
export const DemoPill = ({ kind }: { kind?: 'example' | 'simulated' }) => kind === 'simulated'
  ? <span className="pill demo" title="From the labelled simulated test mailbox, not a real notification">Simulated test</span>
  : <span className="pill demo" title="Fictional demonstration data">Example</span>;

/** Shows a value, or "Unknown" in grey italics when it is missing. */
export function Val({ v, fmt }: { v: unknown; fmt?: (x: never) => ReactNode }) {
  if (v == null || v === '' || v === 'Unknown') return <span className="unknown">Unknown</span>;
  return <>{fmt ? fmt(v as never) : String(v)}</>;
}

export function ChangeBadge({ db, p }: { db: Db; p: Property }) {
  const c = priceChange(db, p); if (!c) return null;
  const down = c.diff < 0;
  return <span className={`pill ${down ? 'chg-down' : 'chg-up'}`}>{down ? '▼' : '▲'} {fmtMoney(Math.abs(c.diff))} ({Math.abs(c.pct).toFixed(1)}%)</span>;
}

export const pct = (x: number | null, d = 0) => (x == null ? 'Unknown' : `${x.toFixed(d)}%`);

/** One-series line chart with a hover crosshair. `step` draws an asking-price staircase that runs on to `until`. */
export function LineChart({ points, step, until, fmtY, label, height = 220 }: { points: { date: string; value: number }[]; step?: boolean; until?: string; fmtY: (n: number) => string; label: string; height?: number }) {
  const [hover, setHover] = useState<number | null>(null); const ref = useRef<SVGSVGElement>(null);
  if (!points.length) return <p className="muted small">Not enough history to draw a chart yet.</p>;
  const W = 640, H = height, L = 92, R = 16, T = 14, B = 26;
  const t = (d: string) => Date.parse(d);
  const xs = points.map((p) => t(p.date)); const x1 = Math.max(...xs, until ? t(until) : 0); const x0 = Math.min(...xs) === x1 ? x1 - 86400000 * 7 : Math.min(...xs);
  const vs = points.map((p) => p.value); let y0 = Math.min(...vs), y1 = Math.max(...vs);
  if (step) { const pad = Math.max((y1 - y0) * 0.25, y1 * 0.03); y0 -= pad; y1 += pad; } else { y0 = 0; y1 = Math.max(1, y1 * 1.15); }
  const sx = (v: number) => L + ((v - x0) / (x1 - x0 || 1)) * (W - L - R), sy = (v: number) => T + (1 - (v - y0) / (y1 - y0 || 1)) * (H - T - B);
  let d = '';
  points.forEach((p, i) => { const X = sx(t(p.date)), Y = sy(p.value); d += i === 0 ? `M${X},${Y}` : step ? `H${X}V${Y}` : `L${X},${Y}`; });
  if (step && until) d += `H${sx(t(until))}`;
  const ticks = [0, 1, 2, 3].map((i) => y0 + ((y1 - y0) * i) / 3);
  const onMove = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect(); const px = ((e.clientX - r.left) / r.width) * W;
    let best = 0; points.forEach((p, i) => { if (Math.abs(sx(t(p.date)) - px) < Math.abs(sx(t(points[best].date)) - px)) best = i; }); setHover(best);
  };
  const hp = hover != null ? points[hover] : null;
  return (
    <div className="chart">
      <svg ref={ref} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
        <g className="grid">{ticks.map((v, i) => <line key={i} x1={L} x2={W - R} y1={sy(v)} y2={sy(v)} />)}</g>
        {ticks.map((v, i) => <text key={i} className="axis" x={L - 6} y={sy(v) + 4} textAnchor="end">{fmtY(v)}</text>)}
        <text className="axis" x={L} y={H - 6}>{fmtDate(new Date(x0).toISOString().slice(0, 10))}</text>
        <text className="axis" x={W - R} y={H - 6} textAnchor="end">{fmtDate(new Date(x1).toISOString().slice(0, 10))}</text>
        <path d={d} fill="none" stroke="var(--accent)" strokeWidth={2} strokeLinejoin="round" />
        {points.map((p, i) => <circle key={i} cx={sx(t(p.date))} cy={sy(p.value)} r={hover === i ? 5 : 4} fill="var(--accent)" stroke="var(--surface)" strokeWidth={2} />)}
        {hp && <line x1={sx(t(hp.date))} x2={sx(t(hp.date))} y1={T} y2={H - B} stroke="var(--ink3)" strokeDasharray="3 3" />}
        <rect x={L} y={T} width={W - L - R} height={H - T - B} fill="transparent" />
      </svg>
      {hp && <div className="tip" style={{ left: `${(sx(t(hp.date)) / W) * 100}%`, top: `${(sy(hp.value) / H) * 100}%` }}><b>{fmtY(hp.value)}</b><br />{fmtDate(hp.date)}</div>}
    </div>
  );
}

/** Horizontal bar used inside tables (the number is always shown next to it). */
export const InlineBar = ({ v, max }: { v: number | null; max: number }) => <div className="bartrack"><div className="bar" style={{ width: v == null || !max ? 0 : `${(v / max) * 100}%` }} /></div>;

/** Save a file. Inside a claude.ai preview the viewer's own save prompt is used; elsewhere a normal download. */
export async function download(name: string, text: string, type = 'text/csv'): Promise<void> {
  const c = (window as unknown as { claude?: { use?: (n: string) => Promise<{ save: (r: { filename: string; data: string }) => Promise<unknown> } | null> } }).claude;
  if (c?.use) { const d = await c.use('downloads').catch(() => null); if (d) { await d.save({ filename: name, data: text }).catch(() => undefined); return; } }
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
