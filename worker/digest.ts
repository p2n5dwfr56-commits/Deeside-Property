// Optional email summary after a run that found something new. Uses the same mailbox account (Gmail SMTP) and only
// runs when DIGEST_TO is set. It only reports what this run actually recorded.
import nodemailer from 'nodemailer';
import type { Alert, RunRecord } from '../src/domain/types';

export async function sendDigest(cfg: { host: string; user: string; password: string; to: string; appUrl?: string }, run: RunRecord, alerts: Alert[]) {
  if (!alerts.length && run.ok) return false;
  const lines = [
    run.ok ? `Automatic check completed ${new Date(run.finishedAt).toLocaleString('en-GB', { timeZone: 'Europe/London' })}.` : `The automatic check had a problem: ${run.errors.join('; ')}`,
    `${run.messagesNew} new notification(s); ${run.created} new properties, ${run.updated} updated${run.flagged ? `, ${run.flagged} possible duplicate(s) to check` : ''}.`, '',
    ...alerts.map((a) => `• ${a.message}`), '', cfg.appUrl ? `Open the dashboard: ${cfg.appUrl}` : '',
  ];
  const t = nodemailer.createTransport({ host: cfg.host, port: 465, secure: true, auth: { user: cfg.user, pass: cfg.password } });
  await t.sendMail({ from: `Deeside Property Watch <${cfg.user}>`, to: cfg.to, subject: `Deeside Property Watch: ${alerts.length ? `${alerts.length} change(s)` : 'check failed'}`, text: lines.join('\n') });
  return true;
}
