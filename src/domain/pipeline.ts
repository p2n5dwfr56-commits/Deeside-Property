// One monitoring run: take the notifications received since last time, read the listings in each, update the
// properties (through the same engine as everything else), and record exactly what happened.
// Pure function: the scheduled worker supplies the messages and saves the result.
import type { Alert, Db, MessageRecord, RunRecord, SourceHealth } from './types';
import { importObservations } from './engine';
import { identifySource, parsePortalEmail } from './portals';
import { uid } from './parse';

export interface InboundMessage {
  messageId: string;
  from: string;
  subject: string;
  date: string;            // ISO timestamp the email was sent/received
  html: string | null;
  text: string | null;
  simulated?: boolean;     // a labelled test message, not a real notification
}

export interface RunOptions { trigger: RunRecord['trigger']; mailbox: string; startedAt: string; now?: string; mailboxErrors?: string[]; messagesChecked?: number }

/** Sources we expect notifications from once you have set up alerts with them. */
export const EXPECTED_SOURCES = ['ASPC', 'Rightmove', 'Zoopla', 'OnTheMarket'];
const MAX_MESSAGES = 5000, MAX_RUNS = 400;

export function processMessages(db0: Db, msgs: InboundMessage[], opt: RunOptions): { db: Db; run: RunRecord; processed: MessageRecord[] } {
  let db: Db = structuredClone(db0);
  const now = opt.now ?? new Date().toISOString();
  const run: RunRecord = { id: uid(), startedAt: opt.startedAt, finishedAt: now, trigger: opt.trigger, mailbox: opt.mailbox, ok: true, messagesChecked: opt.messagesChecked ?? msgs.length, messagesNew: 0, listingsRead: 0, created: 0, updated: 0, unchanged: 0, flagged: 0, errors: [...(opt.mailboxErrors ?? [])] };
  const done = new Set(db.messages.map((m) => m.messageId));
  const towns = db.settings.towns.map((t) => t.name);
  const processed: MessageRecord[] = [];
  // oldest first, so a later notification about the same property is applied after an earlier one
  for (const m of [...msgs].sort((a, b) => a.date.localeCompare(b.date))) {
    if (done.has(m.messageId)) continue; done.add(m.messageId); run.messagesNew++;
    const rec: MessageRecord = { messageId: m.messageId, receivedAt: m.date, processedAt: now, source: 'Not a property email', from: m.from, subject: m.subject, listings: 0, created: 0, updated: 0, unchanged: 0, flagged: 0, status: 'ignored', warnings: [], simulated: !!m.simulated };
    try {
      const source = identifySource(m.from, m.html || m.text || '');
      if (!source) { processed.push(rec); continue; }
      rec.source = source;
      const listings = parsePortalEmail({ html: m.html, text: m.text, from: m.from, subject: m.subject, date: m.date.slice(0, 10) }, towns, source);
      const usable = listings.filter((l) => l.obs.address && l.obs.town);
      rec.listings = usable.length; rec.warnings = [...new Set(listings.flatMap((l) => l.warnings))];
      if (listings.length > usable.length) rec.warnings.push(`${listings.length - usable.length} listing(s) skipped: address or town could not be read`);
      const h = health(db, source);
      h.lastMessageAt = max(h.lastMessageAt, m.date); h.messages++;
      if (!usable.length) {
        rec.status = 'no_listings'; h.failuresInRow++; h.lastFailureAt = now; h.lastError = `No listings could be read from "${m.subject}"`;
        run.errors.push(`${source}: no listings read from "${m.subject}"`);
      } else {
        const r = importObservations(db, usable.map((l) => ({ obs: l.obs })), {
          origin: `${source} email`, source, kind: 'email', label: `${source}: ${m.subject}`, now: m.date.slice(0, 10),
          evidence: `${source} email "${m.subject}" (${m.date.slice(0, 10)})`, messageId: m.messageId, isDemo: !!m.simulated, demoKind: m.simulated ? 'simulated' : undefined,
        });
        db = r.db; Object.assign(rec, { status: 'ok', created: r.report.created, updated: r.report.updated, unchanged: r.report.unchanged, flagged: r.report.flagged });
        h.lastListingsAt = max(h.lastListingsAt, m.date); h.listings += usable.length; h.failuresInRow = 0;
        run.listingsRead += usable.length; run.created += r.report.created; run.updated += r.report.updated; run.unchanged += r.report.unchanged; run.flagged += r.report.flagged;
      }
      db.sources[source] = h;
    } catch (e) {
      rec.status = 'error'; rec.warnings.push(String((e as Error).message || e)); run.errors.push(`Message "${m.subject}": ${String((e as Error).message || e)}`);
    }
    processed.push(rec);
  }
  run.ok = !(opt.mailboxErrors?.length);
  if (!run.ok) db.alerts.unshift(alert(null, 'collection_failed', `The automatic check could not read the mailbox: ${opt.mailboxErrors!.join('; ')}`));
  db.alerts.unshift(...quietSources(db, now));
  db.messages = [...processed.slice().reverse(), ...db.messages].slice(0, MAX_MESSAGES);
  db.runs = [{ ...run, finishedAt: new Date().toISOString() }, ...db.runs].slice(0, MAX_RUNS);
  return { db, run: db.runs[0], processed };
}

function health(db: Db, source: string): SourceHealth {
  return { ...(db.sources[source] ?? { source, lastMessageAt: null, lastListingsAt: null, lastFailureAt: null, lastError: null, messages: 0, listings: 0, failuresInRow: 0, quietAlertAt: null }) };
}
const max = (a: string | null, b: string) => (!a || b > a ? b : a);
const alert = (propertyId: string | null, kind: Alert['kind'], message: string): Alert => ({ id: uid(), at: new Date().toISOString(), propertyId, kind, message, read: false });

export type SourceState = 'ok' | 'quiet' | 'failing' | 'waiting';
/** Is this source still delivering? */
export function sourceState(db: Db, source: string, now = new Date().toISOString()): { state: SourceState; note: string } {
  const h = db.sources[source];
  if (!h || !h.lastMessageAt) return { state: 'waiting', note: 'No notification received yet' };
  if (h.failuresInRow >= 2) return { state: 'failing', note: `The last ${h.failuresInRow} emails could not be read` };
  const days = (Date.parse(now) - Date.parse(h.lastMessageAt)) / 86400000;
  if (days > db.settings.sourceQuietDays) return { state: 'quiet', note: `Nothing received for ${Math.floor(days)} days` };
  if (h.failuresInRow === 1) return { state: 'failing', note: 'The latest email could not be read' };
  return { state: 'ok', note: 'Delivering' };
}

/** Warn once per quiet spell when a source that used to deliver has stopped. */
function quietSources(db: Db, now: string): Alert[] {
  const out: Alert[] = [];
  for (const h of Object.values(db.sources)) {
    if (!h.lastMessageAt) continue;
    const quiet = sourceState(db, h.source, now).state === 'quiet';
    if (quiet && (!h.quietAlertAt || h.quietAlertAt < h.lastMessageAt)) {
      out.push(alert(null, 'source_quiet', `${h.source} has sent no notifications since ${h.lastMessageAt.slice(0, 10)}. Check the alert is still switched on.`));
      db.sources[h.source] = { ...h, quietAlertAt: now };
    }
  }
  return out;
}
