// Tests for automatic collection: reading portal emails, matching across portals, and monitoring runs.
import { describe, expect, it } from 'vitest';
import { decodeLink, identifySource, parsePortalEmail, splitAddress, statusFromWords } from './portals';
import { processMessages, sourceState, type InboundMessage } from './pipeline';
import { eventsOf, importObservations, identifiesBuilding, isStale, resolveReview } from './engine';
import { emptyDb, migrate } from './store';

const towns = ['Torphins', 'Banchory', 'Aboyne', 'Ballater', "Kincardine O'Neil", 'Lumphanan'];
const card = (href: string, addr: string, price: string, extra = '') => `<tr><td><a href="${href}"><img src="x"></a></td></tr><tr><td><a href="${href}">${addr}</a></td></tr><tr><td>${price}</td></tr><tr><td>3 bedroom detached house</td></tr>${extra}`;
const mail = (id: string, date: string, html: string, from = 'Rightmove <alerts@rightmove.co.uk>', subject = 'New properties'): InboundMessage => ({ messageId: id, from, subject, date, html: `<table>${html}<tr><td>Unsubscribe</td></tr></table>`, text: null });
const run = (db = emptyDb(), msgs: InboundMessage[], now = '2026-11-09T07:00:00Z') => processMessages(db, msgs, { trigger: 'schedule', mailbox: 'test', startedAt: now, now });

describe('reading portal emails', () => {
  it('decodes tracking links and finds the listing ID', () => {
    expect(decodeLink('https://t.example/c?u=https%3A%2F%2Fwww.rightmove.co.uk%2Fproperties%2F123456789%3Fx%3D1')).toContain('rightmove.co.uk/properties/123456789');
  });
  it('identifies the source by sender, or by the links in a forwarded email', () => {
    expect(identifySource('alerts@email.rightmove.co.uk', '')).toBe('Rightmove');
    expect(identifySource('me@hotmail.com', '<a href="https://www.zoopla.co.uk/for-sale/details/12345678/">x</a>')).toBe('Zoopla');
    expect(identifySource('friend@example.com', 'hello')).toBeNull();
  });
  it('splits portal addresses into address, town and postcode', () => {
    expect(splitAddress('12 High Street, Torphins, Banchory, Aberdeenshire, AB31 4XX', towns)).toEqual({ address: '12 High Street', town: 'Torphins', postcode: 'AB31 4XX' });
    expect(splitAddress('Main Street, Echt, Westhill, AB32', towns)).toMatchObject({ address: 'Main Street', town: 'Echt' });
  });
  it('reads Scottish and portal status wording, never a bare "sold"', () => {
    expect(statusFromWords('Sold STC').status).toBe('under_offer'); expect(statusFromWords('Closing date set').status).toBe('closing_date');
    expect(statusFromWords('See sold house prices near you').status).toBeNull();
  });
  it('reads several listings, prices, earlier prices and status from one email', () => {
    const html = card('https://www.rightmove.co.uk/properties/111111111', '1 Mill Lane, Torphins, AB31 4AA', 'Offers over £250,000', '<tr><td>Reduced from £260,000</td></tr>')
      + card('https://www.rightmove.co.uk/properties/222222222', '2 Low Road, Aboyne, AB34 5BB', 'Fixed price £199,000', '<tr><td>Under offer</td></tr>');
    const ls = parsePortalEmail({ html: `<table>${html}<tr><td>Unsubscribe. Sold prices.</td></tr></table>`, text: null, from: 'x@rightmove.co.uk', subject: 'Alert', date: '2026-11-09' }, towns, 'Rightmove');
    expect(ls).toHaveLength(2);
    expect(ls[0].obs).toMatchObject({ address: '1 Mill Lane', town: 'Torphins', postcode: 'AB31 4AA', price: 250000, previousPrice: 260000, basis: 'Offers over', bedrooms: 3, listingId: '111111111', status: null });
    expect(ls[1].obs).toMatchObject({ town: 'Aboyne', price: 199000, basis: 'Fixed price', status: 'under_offer', statusWording: 'Under offer' });
  });
});

describe('matching across portals', () => {
  it('a house number or name identifies a building; a street alone does not', () => {
    expect(identifiesBuilding('12 High Street')).toBe(true); expect(identifiesBuilding('Mill House')).toBe(true); expect(identifiesBuilding('Station Road')).toBe(false);
  });
  it('the same house on two portals becomes one record with both listings', () => {
    const { db } = run(emptyDb(), [
      mail('a', '2026-11-09T06:00:00Z', card('https://www.rightmove.co.uk/properties/111111111', '12 Burnett Road, Torphins, Banchory, AB31 4ZZ', '£285,000')),
      mail('b', '2026-11-09T06:30:00Z', card('https://www.aspc.co.uk/property/555555', '12 Burnett Rd, Torphins, AB31 4ZZ', 'Offers over £285,000'), 'ASPC <alerts@aspc.co.uk>'),
    ]);
    expect(db.properties).toHaveLength(1); expect(db.properties[0].sources.map((s) => s.source)).toEqual(['Rightmove', 'ASPC']);
  });
  it('a similar but unconfirmed match is flagged for review, not merged; you can merge or keep separate', () => {
    let { db } = run(emptyDb(), [
      mail('a', '2026-11-09T06:00:00Z', card('https://www.rightmove.co.uk/properties/111111111', 'Station Road, Banchory, AB31', '£325,000')),
      mail('b', '2026-11-09T07:00:00Z', card('https://www.zoopla.co.uk/for-sale/details/99999999/', '17 Station Road, Banchory AB31 5ZZ', '£325,000'), 'Zoopla <a@zoopla.co.uk>'),
    ]);
    expect(db.properties).toHaveLength(2); expect(db.reviews.filter((r) => r.status === 'open')).toHaveLength(1);
    expect(db.alerts.some((a) => a.kind === 'review_needed')).toBe(true);
    const merged = resolveReview(db, db.reviews[0].id, 'merge');
    expect(merged.properties).toHaveLength(1); expect(merged.properties[0].address).toBe('17 Station Road'); expect(merged.properties[0].sources).toHaveLength(2);
    expect(eventsOf(merged, merged.properties[0].id).map((e) => e.type)).toContain('merged');
    db = resolveReview(db, db.reviews[0].id, 'separate'); expect(db.properties).toHaveLength(2); expect(db.reviews[0].status).toBe('separate');
  });
});

describe('monitoring runs', () => {
  const first = mail('m1', '2026-11-01T06:00:00Z', card('https://www.rightmove.co.uk/properties/111111111', '12 Burnett Road, Torphins, AB31 4ZZ', 'Offers over £285,000'));
  const second = mail('m2', '2026-11-08T06:00:00Z', card('https://www.rightmove.co.uk/properties/111111111', '12 Burnett Road, Torphins, AB31 4ZZ', 'Offers over £275,000'), undefined, 'Price reduced');
  it('a second notification for an existing property updates its history, dated when it was observed', () => {
    let { db } = run(emptyDb(), [first]); ({ db } = run(db, [second]));
    const ev = eventsOf(db, db.properties[0].id);
    expect(ev.map((e) => `${e.date} ${e.type}`)).toEqual(['2026-11-01 listed', '2026-11-08 price_reduction']);
    expect(ev[1]).toMatchObject({ priceBefore: 285000, priceAfter: 275000, source: 'Rightmove', confidence: 'detected', messageId: 'm2' });
    expect(db.properties[0].lastVerified).toBe('2026-11-08');
  });
  it('the same email is never processed twice', () => {
    let { db, run: r } = run(emptyDb(), [first, second]); expect(r.messagesNew).toBe(2);
    ({ db, run: r } = run(db, [first, second])); expect(r.messagesNew).toBe(0); expect(db.events).toHaveLength(2);
  });
  it('emails processed out of order do not overwrite newer facts', () => {
    let { db } = run(emptyDb(), [second]); ({ db } = run(db, [first]));
    expect(db.properties[0].askingPrice).toBe(275000); expect(db.properties[0].dateFirstObserved).toBe('2026-11-01');
  });
  it('records each run, per-source health, unreadable emails and mailbox failures', () => {
    const bad = mail('m3', '2026-11-09T06:00:00Z', '<tr><td>New layout! <a href="https://www.aspc.co.uk/">ASPC</a></td></tr>', 'ASPC <a@aspc.co.uk>');
    let { db, run: r } = run(emptyDb(), [first, bad]);
    expect(r).toMatchObject({ ok: true, messagesNew: 2, created: 1 }); expect(r.errors[0]).toMatch(/ASPC: no listings/);
    expect(db.sources.ASPC.failuresInRow).toBe(1); expect(sourceState(db, 'ASPC').state).toBe('failing'); expect(sourceState(db, 'Zoopla').state).toBe('waiting');
    ({ db, run: r } = processMessages(db, [], { trigger: 'schedule', mailbox: 'Alert inbox', startedAt: '2026-11-10T06:00:00Z', mailboxErrors: ['Alert inbox: login failed'] }));
    expect(r.ok).toBe(false); expect(db.alerts[0].kind).toBe('collection_failed'); expect(db.runs).toHaveLength(2);
  });
  it('warns once when a source stops delivering', () => {
    let { db } = run(emptyDb(), [first]);
    ({ db } = run(db, [], '2026-11-20T06:00:00Z')); ({ db } = run(db, [], '2026-11-21T06:00:00Z'));
    expect(db.alerts.filter((a) => a.kind === 'source_quiet')).toHaveLength(1); expect(sourceState(db, 'Rightmove', '2026-11-21T06:00:00Z').state).toBe('quiet');
  });
  it('a listing no longer mentioned is flagged as not recently seen, but its status is not changed', () => {
    const { db } = run(emptyDb(), [first]);
    expect(isStale(db, db.properties[0], '2026-12-20')).toBe(true); expect(db.properties[0].status).toBe('for_sale');
  });
  it('the source-stated earlier price is kept with its provenance', () => {
    const m = mail('m4', '2026-11-09T06:00:00Z', card('https://www.rightmove.co.uk/properties/333333333', '3 Hill View, Aboyne, AB34 5AA', '£240,000', '<tr><td>Reduced from £250,000</td></tr>'));
    const { db } = run(emptyDb(), [m]); const p = db.properties[0];
    expect(p.originalAskingPrice).toBe(250000); expect(p.askingPrice).toBe(240000);
    expect(eventsOf(db, p.id)[0].evidence).toMatch(/date of that price unknown/);
  });
  it('old saved data upgrades without loss', () => {
    const { db } = importObservations(emptyDb(), [{ obs: { address: '1 A Road', town: 'Torphins' } }], { origin: 'x', source: 'Manual', kind: 'manual', label: 'x' });
    const old = { ...db, version: 1, reviews: undefined, messages: undefined, runs: undefined, sources: undefined };
    const up = migrate(old)!; expect(up.version).toBe(2); expect(up.properties).toHaveLength(1); expect(up.runs).toEqual([]);
  });
});
