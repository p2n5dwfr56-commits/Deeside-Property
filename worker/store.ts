// Where the data lives. In normal use: the Supabase cloud database (one row holding the whole history, saved with a
// version number so two writers can never overwrite each other). For tests and for running without an account: a
// JSON file. Secret keys come from environment variables (GitHub Actions secrets), never from the code.
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Db } from '../src/domain/types';
import { emptyDb, migrate } from '../src/domain/store';
import type { InboundMessage } from '../src/domain/pipeline';

export class Conflict extends Error { constructor() { super('The data was changed by someone else while this run was working'); } }

export interface Store { name: string; load(): Promise<{ db: Db; version: number }>; save(db: Db, version: number): Promise<number>; keepRaw(msgs: InboundMessage[], sources: Record<string, string>): Promise<void> }

export class FileStore implements Store {
  name = 'file';
  constructor(private path: string) {}
  async load() {
    if (!existsSync(this.path)) return { db: emptyDb(), version: 0 };
    const o = JSON.parse(readFileSync(this.path, 'utf8'));
    const db = migrate(o.data); if (!db) throw new Error(`${this.path} is not Deeside Property Watch data`);
    return { db, version: o.version ?? 0 };
  }
  async save(db: Db, version: number) {
    if (existsSync(this.path) && (JSON.parse(readFileSync(this.path, 'utf8')).version ?? 0) !== version) throw new Conflict();
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(this.path, JSON.stringify({ version: version + 1, updatedAt: new Date().toISOString(), data: db }));
    return version + 1;
  }
  async keepRaw(msgs: InboundMessage[], sources: Record<string, string>) {
    if (!msgs.length) return;
    const p = this.path.replace(/\.json$/, '') + '-messages.jsonl'; mkdirSync(dirname(p), { recursive: true });
    appendFileSync(p, msgs.map((m) => JSON.stringify({ ...m, source: sources[m.messageId] ?? null })).join('\n') + '\n');
  }
}

export class SupabaseStore implements Store {
  name = 'supabase';
  constructor(private url: string, private key: string) {}
  private headers(extra: Record<string, string> = {}) {
    // New-style secret keys (sb_secret_…) go in the apikey header only; older JWT keys also need Authorization.
    const h: Record<string, string> = { apikey: this.key, 'content-type': 'application/json', ...extra };
    if (this.key.startsWith('eyJ')) h.authorization = `Bearer ${this.key}`;
    return h;
  }
  private async req(path: string, init: RequestInit & { headers?: Record<string, string> } = {}) {
    const r = await fetch(`${this.url.replace(/\/$/, '')}/rest/v1/${path}`, { ...init, headers: this.headers(init.headers) });
    if (!r.ok) throw new Error(`Database request failed (${r.status}): ${(await r.text()).slice(0, 300)}`);
    const t = await r.text(); return t ? JSON.parse(t) : null;
  }
  async load() {
    const rows = await this.req('app_state?id=eq.main&select=data,version');
    if (!rows.length) { await this.req('app_state', { method: 'POST', body: JSON.stringify({ id: 'main', data: emptyDb(), version: 1 }), headers: { prefer: 'resolution=ignore-duplicates' } }); return { db: emptyDb(), version: 1 }; }
    const db = migrate(rows[0].data); if (!db) throw new Error('The cloud database does not hold Deeside Property Watch data');
    return { db, version: rows[0].version as number };
  }
  async save(db: Db, version: number) {
    const rows = await this.req(`app_state?id=eq.main&version=eq.${version}`, { method: 'PATCH', body: JSON.stringify({ data: db, version: version + 1, updated_at: new Date().toISOString() }), headers: { prefer: 'return=representation' } });
    if (!rows?.length) throw new Conflict();
    return version + 1;
  }
  async keepRaw(msgs: InboundMessage[], sources: Record<string, string>) {
    if (!msgs.length) return;
    const rows = msgs.map((m) => ({ message_id: m.messageId, received_at: m.date, source: sources[m.messageId] ?? null, subject: m.subject, from_addr: m.from, body_html: m.html?.slice(0, 500000) ?? null, body_text: m.text?.slice(0, 200000) ?? null, simulated: !!m.simulated }));
    await this.req('raw_messages?on_conflict=message_id', { method: 'POST', body: JSON.stringify(rows), headers: { prefer: 'resolution=ignore-duplicates' } });
  }
}
