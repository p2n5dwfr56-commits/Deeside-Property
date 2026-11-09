// The scheduled worker end to end, with the labelled simulated mailbox and a file store.
import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { monitor } from './run';
import { FileStore } from './store';
import { eventsOf } from '../src/domain/engine';

describe('scheduled worker (simulated mailbox)', () => {
  it('delivers test emails over successive runs and updates history automatically', async () => {
    const store = new FileStore(join(mkdtempSync(join(tmpdir(), 'dpw-')), 'state.json'));
    const at = (h: number) => new Date(Date.parse('2026-11-09T06:00:00Z') + h * 3600000);
    const log = () => undefined;
    let r = await monitor({ store, simulation: true, trigger: 'schedule', now: at(0), log });
    expect(r.run).toMatchObject({ ok: true, messagesNew: 2, created: 4 });
    r = await monitor({ store, simulation: true, trigger: 'schedule', now: at(1), log }); expect(r.run.messagesNew).toBe(0);
    for (const h of [3, 6, 24, 48]) r = await monitor({ store, simulation: true, trigger: 'schedule', now: at(h), log });
    const { db } = await store.load();
    expect(db.runs).toHaveLength(6); expect(db.properties.every((p) => p.isDemo && p.demoKind === 'simulated')).toBe(true);
    const torphins = db.properties.find((p) => p.town === 'Torphins')!;
    expect(torphins.sources.map((s) => s.source).sort()).toEqual(['ASPC', 'Rightmove']);
    expect(eventsOf(db, torphins.id).map((e) => e.type)).toEqual(['listed', 'price_reduction']);
    const aboyne = db.properties.find((p) => p.town === 'Aboyne')!;
    expect(eventsOf(db, aboyne.id).map((e) => e.type)).toEqual(['listed', 'under_offer', 'price_reduction', 'returned_to_market']);
    expect(db.reviews.filter((x) => x.status === 'open')).toHaveLength(1);
    expect(db.sources.ASPC.lastError).toMatch(/No listings/);
    expect(db.messages.filter((m) => m.status === 'ignored')).toHaveLength(1);
  });
  it('reports a run as failed when no mailbox is configured', async () => {
    const store = new FileStore(join(mkdtempSync(join(tmpdir(), 'dpw-')), 'state.json'));
    const r = await monitor({ store, simulation: false, imap: null, log: () => undefined });
    expect(r.run.ok).toBe(false); expect(r.run.errors[0]).toMatch(/No mailbox/);
  });
});
