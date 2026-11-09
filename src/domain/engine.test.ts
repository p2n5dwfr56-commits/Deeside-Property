// Tests for the tracking engine, imports and parsing (run with: npm test)
import { describe, expect, it } from 'vitest';
import { importObservations, editProperty, eventsOf, findMatch, checkLongOnMarket } from './engine';
import { csvToObservations, readCsv, exportProperties, exportHistory } from './csv';
import { parseAlertEmail } from './email';
import { parsePrice, parseStatus, parseDate, addressKey } from './parse';
import { emptyDb, load, save, backup, restore } from './store';
import { addDemo, removeDemo } from './demo';
import { dashboard, priceSeries } from './stats';

const opt = (label = 't', extra = {}) => ({ origin: 'Test', source: 'TestSource', kind: 'csv' as const, label, ...extra });
const one = (o: object) => [{ obs: { address: '12 High Street', town: 'Torphins', price: 300000, basis: 'Offers over' as const, ...o } }];
class Mem implements Storage { m = new Map<string, string>(); get length() { return this.m.size; } clear() { this.m.clear(); } getItem(k: string) { return this.m.get(k) ?? null; } key(i: number) { return [...this.m.keys()][i] ?? null; } removeItem(k: string) { this.m.delete(k); } setItem(k: string, v: string) { this.m.set(k, v); } }

describe('parsing', () => {
  it('reads Scottish price wording', () => {
    expect(parsePrice('Offers over £495,000')).toEqual({ price: 495000, basis: 'Offers over' });
    expect(parsePrice('Fixed Price £189,000')).toEqual({ price: 189000, basis: 'Fixed price' });
    expect(parsePrice('OIRO £250k')).toEqual({ price: 250000, basis: 'Offers in the region of' });
    expect(parsePrice('3 bedrooms').price).toBeNull();
  });
  it('reads statuses, never turning "no longer advertised" into sold', () => {
    expect(parseStatus('Under Offer')).toBe('under_offer'); expect(parseStatus('Closing date set')).toBe('closing_date');
    expect(parseStatus('Missives concluded')).toBe('missives'); expect(parseStatus('Sold')).toBe('sold'); expect(parseStatus('banana')).toBeNull();
  });
  it('reads UK dates', () => { expect(parseDate('01/03/2026')).toBe('2026-03-01'); expect(parseDate('1 March 2026')).toBe('2026-03-01'); expect(parseDate('31/02/2026')).toBeNull(); });
  it('matches the same address written differently', () => { expect(addressKey('12 High St.', 'Torphins')).toBe(addressKey('12 high street', 'TORPHINS')); });
});

describe('acceptance: tracking', () => {
  it('adding a property saves it permanently (survives a reload of the store)', () => {
    const mem = new Mem(); const { db } = importObservations(emptyDb(), one({}), opt()); save(db, mem);
    const again = load(mem); expect(again.properties).toHaveLength(1); expect(again.properties[0].address).toBe('12 High Street');
  });
  it('importing the same property twice does not create a duplicate', () => {
    let { db } = importObservations(emptyDb(), one({}), opt('a')); db = importObservations(db, one({ address: '12 High St' }), opt('b')).db;
    expect(db.properties).toHaveLength(1); expect(db.imports[0].unchanged).toBe(1);
    // and the same listing from a second source is merged, keeping both sources
    db = importObservations(db, one({}), { ...opt('c'), source: 'ASPC' }).db; expect(db.properties).toHaveLength(1); expect(db.properties[0].sources.map((s) => s.source)).toEqual(['TestSource', 'ASPC']);
  });
  it('changing a price records both old and new values, with £ and % difference available', () => {
    let { db } = importObservations(emptyDb(), one({ date: '2026-03-01', price: 495000 }), opt());
    db = importObservations(db, one({ date: '2026-04-30', price: 475000 }), opt()).db;
    const p = db.properties[0]; const ev = eventsOf(db, p.id).find((e) => e.type === 'price_reduction')!;
    expect(ev.priceBefore).toBe(495000); expect(ev.priceAfter).toBe(475000); expect(ev.date).toBe('2026-04-30');
    expect(p.originalAskingPrice).toBe(495000); expect(p.askingPrice).toBe(475000);
    expect(db.alerts.some((a) => a.kind === 'price_reduction')).toBe(true);
  });
  it('Under Offer is saved, appears in the timeline, and can return to For Sale (the full example history)', () => {
    let { db } = importObservations(emptyDb(), one({ date: '2026-03-01', price: 495000 }), opt());
    db = importObservations(db, one({ date: '2026-04-30', price: 475000 }), opt()).db;
    db = importObservations(db, one({ date: '2026-05-15', price: 465000 }), opt()).db;
    db = importObservations(db, one({ date: '2026-05-25', price: 465000, status: 'under_offer' }), opt()).db;
    db = importObservations(db, one({ date: '2026-06-12', price: 465000, status: 'for_sale' }), opt()).db;
    const types = eventsOf(db, db.properties[0].id).map((e) => `${e.date} ${e.type}`);
    expect(types).toEqual(['2026-03-01 listed', '2026-04-30 price_reduction', '2026-05-15 price_reduction', '2026-05-25 under_offer', '2026-06-12 returned_to_market']);
    expect(db.properties[0].status).toBe('for_sale'); expect(db.alerts.some((a) => a.kind === 'back_on_market')).toBe(true);
    expect(priceSeries(db, db.properties[0]).map((x) => x.price)).toEqual([495000, 475000, 465000]);
  });
  it('a listing that disappears from a complete import is "no longer seen (unverified)", never sold', () => {
    const rows = [...one({}), { obs: { address: '3 Mill Lane', town: 'Torphins', price: 250000 } }];
    let { db } = importObservations(emptyDb(), rows, opt('full', { snapshot: true, snapshotTowns: ['Torphins'] }));
    db = importObservations(db, one({}), opt('full again', { snapshot: true, snapshotTowns: ['Torphins'] })).db;
    const gone = db.properties.find((p) => p.address === '3 Mill Lane')!;
    expect(gone.status).toBe('not_seen'); expect(eventsOf(db, gone.id).some((e) => e.type === 'sold')).toBe(false);
    expect(db.imports[0].notSeen).toBe(1);
    // if it is seen again it is "relisted"
    db = importObservations(db, rows, opt('back')).db; expect(db.properties.find((p) => p.address === '3 Mill Lane')!.status).toBe('for_sale');
    expect(eventsOf(db, gone.id).map((e) => e.type)).toContain('relisted');
  });
  it('an ordinary (partial) import never marks anything as no longer seen', () => {
    const rows = [...one({}), { obs: { address: '3 Mill Lane', town: 'Torphins' } }];
    let { db } = importObservations(emptyDb(), rows, opt()); db = importObservations(db, one({}), opt()).db;
    expect(db.properties.every((p) => p.status === 'for_sale')).toBe(true);
  });
  it('manual edits record history, and missing information stays Unknown (null)', () => {
    let { db } = importObservations(emptyDb(), one({ price: null, basis: null, date: '2026-03-01' }), opt());
    const p = db.properties[0]; expect(p.askingPrice).toBeNull(); expect(p.bedrooms).toBeNull(); expect(p.floorAreaSqm).toBeNull();
    db = editProperty(db, p.id, { bedrooms: 3, status: 'missives', date: '2026-06-01' });
    const ev = eventsOf(db, p.id); expect(ev.map((e) => e.type)).toEqual(['listed', 'missives', 'details_changed']); expect(ev[2].changes[0]).toEqual({ field: 'bedrooms', before: null, after: 3 });
  });
  it('long-on-market alerts are raised once', () => {
    let { db } = importObservations(emptyDb(), one({ date: '2026-01-01' }), opt()); db.settings.longOnMarketDays = 30;
    db = checkLongOnMarket(db, '2026-03-01'); db = checkLongOnMarket(db, '2026-03-02'); expect(db.alerts.filter((a) => a.kind === 'long_on_market')).toHaveLength(1);
  });
});

describe('imports and exports', () => {
  it('reads CSV with flexible headers, quotes and errors reported per row', () => {
    const csv = 'Address,Town,Asking price,Status,Beds,Floor area\n"12 High Street, Upper",Torphins,"Offers over £300,000",For sale,3,"1,000 sq ft"\n,Banchory,200000,,,\n4 Low Road,Aboyne,£250000,weird,,\n';
    const r = csvToObservations(csv); expect(r.missing).toEqual([]);
    expect(r.rows[0].obs).toMatchObject({ address: '12 High Street, Upper', price: 300000, basis: 'Offers over', bedrooms: 3, floorAreaSqm: 92.9 });
    expect(r.rows[1].error).toMatch(/address/); expect(r.rows[2].error).toMatch(/status "weird"/);
    const { report } = importObservations(emptyDb(), r.rows, opt()); expect(report.created).toBe(1); expect(report.errors).toHaveLength(2); expect(report.ok).toBe(true);
  });
  it('refuses a CSV without address and town columns', () => { expect(csvToObservations('Price,Beds\n1,2').missing).toEqual(['address', 'town']); });
  it('exports round-trip through the CSV reader; history export lists every change', () => {
    const db = addDemo(emptyDb(), '2026-11-09');
    expect(readCsv(exportProperties(db)).length).toBe(db.properties.length + 1);
    expect(readCsv(exportHistory(db)).length).toBe(db.events.length + 1);
  });
  it('reads listings from a property alert email (HTML)', () => {
    const html = '<html><body><table><tr><td><a href="https://www.aspc.co.uk/property/123456">View</a></td></tr><tr><td>12 High Street, Torphins, AB31 4XX</td></tr><tr><td>Offers over &pound;300,000</td></tr><tr><td>3 bedroom detached house</td></tr><tr><td>Mill House, Banchory</td></tr><tr><td>Fixed price &pound;250,000</td></tr></table></body></html>';
    const ls = parseAlertEmail(html, ['Torphins', 'Banchory'], '2026-11-09');
    expect(ls).toHaveLength(2); expect(ls[0].obs).toMatchObject({ address: '12 High Street', town: 'Torphins', price: 300000, basis: 'Offers over', postcode: 'AB31 4XX', bedrooms: 3 });
    expect(ls[1].obs).toMatchObject({ town: 'Banchory', price: 250000, basis: 'Fixed price' });
  });
  it('backup and restore keep everything', () => { const db = addDemo(emptyDb()); expect(restore(backup(db))).toEqual(db); expect(() => restore('{"x":1}')).toThrow(); });
});

describe('demonstration data', () => {
  it('is labelled, has history, and can be removed completely', () => {
    const db = addDemo(emptyDb(), '2026-11-09'); expect(db.properties.length).toBe(8); expect(db.properties.every((p) => p.isDemo)).toBe(true);
    const d = dashboard(db, db.properties, '2026-11-09'); expect(d.reduced).toBeGreaterThan(0); expect(d.underOffer).toBeGreaterThan(0); expect(d.returned).toBe(1); expect(d.increased).toBe(1); // only 1 Example Cottage was increased
    const clean = removeDemo(db); expect(clean.properties).toHaveLength(0); expect(clean.events).toHaveLength(0);
  });
  it('finds matches by listing URL even if the address is written differently', () => {
    const { db } = importObservations(emptyDb(), one({ url: 'https://example.org/p/1' }), opt());
    expect(findMatch(db, { address: 'Different text', town: 'Torphins', url: 'https://example.org/p/1' }, 'Other')).toBeTruthy();
  });
});
