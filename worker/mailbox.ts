// Where notifications come from: the real alert inbox (IMAP, e.g. a dedicated Gmail account), and the labelled
// simulated test mailbox. Both return the same InboundMessage shape. The inbox is opened READ-ONLY: nothing is
// deleted, moved or marked as read.
import { ImapFlow } from 'imapflow';
import { simpleParser, type ParsedMail } from 'mailparser';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { InboundMessage } from '../src/domain/pipeline';

export interface ImapConfig { host: string; port: number; user: string; password: string; folder: string }

const toMessage = (m: ParsedMail, fallbackId: string, simulated = false): InboundMessage => ({
  messageId: (m.messageId || fallbackId).replace(/[<>]/g, ''),
  from: m.from?.text ?? '', subject: m.subject ?? '(no subject)',
  date: (m.date ?? new Date()).toISOString(),
  html: typeof m.html === 'string' ? m.html : null, text: m.text ?? null, simulated,
});

/** Read every message received since `since` from the alert inbox. */
export async function readImap(cfg: ImapConfig, since: Date): Promise<{ messages: InboundMessage[]; checked: number }> {
  const client = new ImapFlow({ host: cfg.host, port: cfg.port, secure: true, auth: { user: cfg.user, pass: cfg.password }, logger: false });
  await client.connect();
  const messages: InboundMessage[] = []; let checked = 0;
  try {
    const lock = await client.getMailboxLock(cfg.folder, { readOnly: true });
    try {
      const uids = (await client.search({ since }, { uid: true })) || [];
      checked = uids.length;
      if (uids.length) for await (const msg of client.fetch(uids, { source: true, uid: true }, { uid: true })) {
        if (!msg.source) continue;
        messages.push(toMessage(await simpleParser(msg.source), `uid-${msg.uid}@${cfg.user}`));
      }
    } finally { lock.release(); }
  } finally { await client.logout().catch(() => undefined); }
  return { messages, checked };
}

/** The simulated test mailbox: each email is "delivered" once its scheduled number of hours has passed. */
export async function readSimulated(dir: string, startedAt: string, now: Date): Promise<{ messages: InboundMessage[]; checked: number }> {
  const files = readdirSync(dir).filter((f) => f.endsWith('.eml')).sort();
  const out: InboundMessage[] = [];
  for (const f of files) {
    const raw = readFileSync(join(dir, f));
    const m = await simpleParser(raw);
    const hours = Number(m.headers.get('x-dpw-deliver-after-hours') ?? 0);
    const due = new Date(Date.parse(startedAt) + hours * 3600000);
    if (due > now) continue;
    const msg = toMessage(m, f, true); msg.date = due.toISOString(); // shows when it arrived in the test timeline
    out.push(msg);
  }
  return { messages: out, checked: files.length };
}
