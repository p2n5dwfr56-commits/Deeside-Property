// Demonstration properties: FICTIONAL, for trying the app out. Every one is flagged isDemo and labelled "Example" on
// screen, and they can be removed in one click. Their histories are created through the real import engine.
import type { Db } from './types';
import type { Observation } from './engine';
import { importObservations } from './engine';

const ago = (days: number, now: string) => new Date(Date.parse(now) - days * 86400000).toISOString().slice(0, 10);

export function addDemo(db0: Db, now = new Date().toISOString().slice(0, 10)): Db {
  const base: Observation[] = [
    { address: '1 Example Cottage, Station Road', town: 'Torphins', price: 245000, basis: 'Offers over', bedrooms: 3, bathrooms: 1, propertyType: 'Cottage', floorAreaSqm: 96, epc: 'E', agent: 'Example Agents (demo)', landSize: 'Front and rear gardens' },
    { address: '2 Demo Drive', town: 'Banchory', price: 495000, basis: 'Offers over', bedrooms: 5, bathrooms: 3, propertyType: 'Detached', floorAreaSqm: 210, epc: 'C', agent: 'Example Agents (demo)', landSize: '0.4 acre' },
    { address: '3 Sample Crescent', town: 'Aboyne', price: 320000, basis: 'Offers over', bedrooms: 4, bathrooms: 2, propertyType: 'Detached', floorAreaSqm: 140, epc: 'C', agent: 'Demo & Co Solicitors' },
    { address: '4 Specimen Street', town: 'Ballater', price: 189000, basis: 'Fixed price', bedrooms: 2, bathrooms: 1, propertyType: 'Flat', floorAreaSqm: 68, epc: 'D', agent: 'Demo & Co Solicitors' },
    { address: '5 Illustration Lane', town: "Kincardine O'Neil", price: 410000, basis: 'Offers around', bedrooms: 4, bathrooms: 2, propertyType: 'Detached', floorAreaSqm: null, epc: null, agent: null },
    { address: '6 Trial Terrace', town: 'Lumphanan', price: 210000, basis: 'Offers over', bedrooms: 3, bathrooms: 1, propertyType: 'Semi-detached', floorAreaSqm: 88, epc: 'D', agent: 'Example Agents (demo)' },
    { address: '7 Placeholder Park', town: 'Banchory', price: 275000, basis: 'Offers over', bedrooms: 3, bathrooms: 2, propertyType: 'Bungalow', floorAreaSqm: 110, epc: 'C', agent: 'Demo & Co Solicitors' },
    { address: '8 Mock Mill Road', town: 'Aboyne', price: 560000, basis: 'Offers over', bedrooms: 5, bathrooms: 4, propertyType: 'Detached', floorAreaSqm: 260, epc: 'B', agent: 'Example Agents (demo)', landSize: '1.2 acres' },
  ];
  const opt = (label: string) => ({ origin: 'Demonstration data', source: 'Demonstration', kind: 'csv' as const, label, isDemo: true, now });
  // what the demo "source" showed at each date: [days ago, changes]
  const steps: [number, Record<string, Partial<Observation>>][] = [
    [110, { '2 Demo Drive': {} }],
    [95, { '1 Example Cottage, Station Road': {}, '3 Sample Crescent': {} }],
    [70, { '2 Demo Drive': { price: 475000 }, '4 Specimen Street': {} }],
    [55, { '2 Demo Drive': { price: 465000 }, '5 Illustration Lane': {}, '6 Trial Terrace': {} }],
    [45, { '2 Demo Drive': { status: 'under_offer' }, '3 Sample Crescent': { status: 'closing_date' } }],
    [30, { '2 Demo Drive': { status: 'for_sale' }, '3 Sample Crescent': { status: 'under_offer' }, '7 Placeholder Park': {} }],
    [20, { '6 Trial Terrace': { price: 199000 }, '1 Example Cottage, Station Road': { price: 255000 } }],
    [12, { '3 Sample Crescent': { status: 'missives' }, '8 Mock Mill Road': {} }],
    [5, { '4 Specimen Street': { status: 'withdrawn' }, '6 Trial Terrace': { status: 'under_offer' } }],
  ];
  let db = db0; const state = new Map<string, Observation>(); // each property's latest advertised details
  for (const [d, changes] of steps) {
    const rows = Object.entries(changes).map(([addr, ch]) => { const cur = { ...(state.get(addr) ?? base.find((b) => b.address === addr)!), ...ch }; state.set(addr, cur); return { obs: { ...cur, date: ago(d, now) } }; });
    db = importObservations(db, rows, opt(`Demonstration data, ${ago(d, now)}`)).db;
  }
  return { ...db, imports: db.imports.filter((i) => i.source !== 'Demonstration'), alerts: db.alerts.filter((a) => !db.properties.find((p) => p.id === a.propertyId)?.isDemo) };
}

export function removeDemo(db: Db): Db {
  const ids = new Set(db.properties.filter((p) => p.isDemo).map((p) => p.id));
  return { ...db, properties: db.properties.filter((p) => !ids.has(p.id)), events: db.events.filter((e) => !ids.has(e.propertyId)), alerts: db.alerts.filter((a) => !a.propertyId || !ids.has(a.propertyId)) };
}
