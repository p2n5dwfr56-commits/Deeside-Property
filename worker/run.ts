// One unattended monitoring run. GitHub Actions starts this on a schedule (see .github/workflows/monitor.yml);
// you can also run it by hand: npm run monitor -- --trigger manual
//
// Settings come from environment variables (stored as GitHub Actions secrets, never in the code):
//   SUPABASE_URL, SUPABASE_SECRET_KEY          cloud database (without them: a local JSON file, DPW_STATE_FILE)
//   IMAP_USER, IMAP_PASSWORD [IMAP_HOST, IMAP_FOLDER]   the alert inbox (Gmail app password)
//   SIMULATION=on|off                          labelled test mailbox (default: on until the inbox is set up)
//   DIGEST_TO [APP_URL]                        optional email summary of new alerts
import { appendFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { processMessages, type InboundMessage } from '../src/domain/pipeline';
import { checkLongOnMarket } from '../src/domain/engine';
import { readImap, readSimulated } from './mailbox';
import { Conflict, FileStore, SupabaseStore, type Store } from './store';
import { sendDigest } from './digest';

const here = dirname(fileURLToPath(import.meta.url));
const arg = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : undefined; };
const env = process.env;

export async function monitor(opts: { store: Store; now?: Date; trigger?: 'schedule' | 'manual' | 'test'; imap?: { host: string; port: number; user: string; password: string; folder: string } | null; simulation?: boolean; simDir?: string; log?: (s: string) => void }) {
  const log = opts.log ?? console.log; const now = opts.now ?? new Date(); const startedAt = new Date().toISOString();
  for (let attempt = 1; attempt <= 3; attempt++) {
    let { db, version } = await opts.store.load();
    const msgs: InboundMessage[] = []; const errors: string[] = []; const boxes: string[] = []; let checked = 0;
    // look back 3 days before the last successful run, so nothing is missed if a run fails (duplicates are skipped)
    const lastOk = db.runs.find((r) => r.ok); const since = new Date(lastOk ? Date.parse(lastOk.startedAt) - 3 * 86400000 : now.getTime() - 30 * 86400000);
    if (opts.imap) {
      boxes.push('Alert inbox');
      try { const r = await readImap(opts.imap, since); msgs.push(...r.messages); checked += r.checked; }
      catch (e) { errors.push(`Alert inbox: ${(e as Error).message}`); }
    }
    if (opts.simulation) {
      boxes.push('Simulated test mailbox');
      db.simulation = { startedAt: db.simulation?.startedAt ?? now.toISOString() };
      const r = await readSimulated(opts.simDir ?? join(here, 'fixtures', 'simulated'), db.simulation.startedAt!, now); msgs.push(...r.messages); checked += r.checked;
    }
    if (!boxes.length) errors.push('No mailbox is configured yet (add IMAP_USER and IMAP_PASSWORD, or turn on SIMULATION)');
    const res = processMessages(db, msgs, { trigger: opts.trigger ?? 'manual', mailbox: boxes.join(' + ') || 'none', startedAt, now: now.toISOString(), mailboxErrors: errors, messagesChecked: checked });
    db = checkLongOnMarket(res.db, now.toISOString().slice(0, 10));
    try {
      await opts.store.save(db, version);
    } catch (e) { if (e instanceof Conflict && attempt < 3) { log(`Data changed during the run; trying again (${attempt})`); continue; } throw e; }
    const sources = Object.fromEntries(res.processed.map((m) => [m.messageId, m.source]));
    await opts.store.keepRaw(msgs.filter((m) => sources[m.messageId] !== undefined), sources).catch((e) => log(`Could not keep the original emails: ${(e as Error).message}`));
    return { db, run: res.run, processed: res.processed };
  }
  throw new Error('Gave up after 3 attempts');
}

function summary(run: Awaited<ReturnType<typeof monitor>>) {
  const r = run.run;
  return [
    `## Deeside Property Watch: automatic check ${r.ok ? 'completed' : 'had problems'}`,
    `- Finished: ${new Date(r.finishedAt).toLocaleString('en-GB', { timeZone: 'Europe/London' })} (UK time), started by: ${r.trigger}`,
    `- Mailbox: ${r.mailbox}; ${r.messagesChecked} message(s) looked at, ${r.messagesNew} new`,
    `- Listings read: ${r.listingsRead}; new properties: ${r.created}; updated: ${r.updated}; unchanged: ${r.unchanged}; possible duplicates flagged: ${r.flagged}`,
    ...(r.errors.length ? ['', '### Problems', ...r.errors.map((e) => `- ${e}`)] : []),
    ...(run.processed.length ? ['', '| Received | Source | Subject | Listings | New | Updated | Result |', '|---|---|---|---|---|---|---|',
      ...run.processed.map((m) => `| ${m.receivedAt.slice(0, 16).replace('T', ' ')} | ${m.source} | ${m.subject.replace(/\|/g, '/')} | ${m.listings} | ${m.created} | ${m.updated} | ${m.status} |`)] : []),
  ].join('\n');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const store: Store = env.SUPABASE_URL && env.SUPABASE_SECRET_KEY ? new SupabaseStore(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY) : new FileStore(env.DPW_STATE_FILE || join(here, '..', 'data', 'state.json'));
  const imap = env.IMAP_USER && env.IMAP_PASSWORD ? { host: env.IMAP_HOST || 'imap.gmail.com', port: Number(env.IMAP_PORT || 993), user: env.IMAP_USER, password: env.IMAP_PASSWORD, folder: env.IMAP_FOLDER || 'INBOX' } : null;
  const simulation = env.SIMULATION ? env.SIMULATION === 'on' : !imap;
  const trigger = (arg('trigger') as 'schedule' | 'manual' | 'test') || 'manual';
  const now = arg('now') ? new Date(arg('now')!) : undefined;
  monitor({ store, imap, simulation, trigger, now }).then(async (res) => {
    const text = summary(res); console.log(text);
    if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, text + '\n');
    if (env.DIGEST_TO && imap) {
      const fresh = res.db.alerts.filter((a) => a.at >= res.run.startedAt);
      await sendDigest({ host: env.SMTP_HOST || 'smtp.gmail.com', user: imap.user, password: imap.password, to: env.DIGEST_TO, appUrl: env.APP_URL }, res.run, fresh).catch((e) => console.log(`Summary email not sent: ${e.message}`));
    }
    process.exit(res.run.ok ? 0 : 1);
  }).catch((e) => { console.error(`Run failed: ${e.message}`); if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, `## Automatic check FAILED\n${e.message}\n`); process.exit(1); });
}
