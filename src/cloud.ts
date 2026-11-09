// The online app's connection to the cloud database (Supabase). Only the PUBLIC project address and publishable key
// are built into the website: they are designed to be public, and the database's row-level security lets only the
// email addresses in `allowed_users` read or change anything. Secret keys live only in GitHub secrets.
import { createClient, type SupabaseClient, type Session } from '@supabase/supabase-js';
import type { Db } from './domain/types';
import { migrate } from './domain/store';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? import.meta.env.VITE_SUPABASE_ANON_KEY) as string | undefined;
export const cloudConfigured = !!(url && key);
let client: SupabaseClient | null = null;
const sb = () => (client ??= createClient(url!, key!, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } }));

export class CloudConflict extends Error {}

export async function currentSession(): Promise<Session | null> { return (await sb().auth.getSession()).data.session; }
export function onAuthChange(f: (s: Session | null) => void) { return sb().auth.onAuthStateChange((_e, s) => f(s)).data.subscription; }

/** Sends a one-time sign-in link to your email (no password to remember). */
export async function sendLoginLink(email: string) {
  const { error } = await sb().auth.signInWithOtp({ email, options: { emailRedirectTo: location.origin + location.pathname, shouldCreateUser: true } });
  if (error) throw new Error(error.message);
}
export async function signOut() { await sb().auth.signOut(); }

export async function loadCloud(): Promise<{ db: Db; version: number }> {
  const { data, error } = await sb().from('app_state').select('data,version').eq('id', 'main').maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error('No data yet, or this email is not on the list of people allowed to open the dashboard. The first automatic check creates the data.');
  const db = migrate(data.data); if (!db) throw new Error('The cloud data could not be read.');
  return { db, version: data.version };
}

/** Saves only if nobody (e.g. the automatic check) has saved in the meantime. */
export async function saveCloud(db: Db, version: number): Promise<number> {
  const { data, error } = await sb().from('app_state').update({ data: db, version: version + 1, updated_at: new Date().toISOString() }).eq('id', 'main').eq('version', version).select('version');
  if (error) throw new Error(error.message);
  if (!data?.length) throw new CloudConflict('The automatic check updated the data while you were working.');
  return data[0].version as number;
}

/** The original email behind a recorded change. */
export async function rawMessage(messageId: string): Promise<{ subject: string; from_addr: string; received_at: string; body_text: string | null; body_html: string | null } | null> {
  const { data } = await sb().from('raw_messages').select('subject,from_addr,received_at,body_text,body_html').eq('message_id', messageId).maybeSingle();
  return data;
}
