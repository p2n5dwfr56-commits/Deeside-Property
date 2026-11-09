// Reading property notification emails from the portals (Rightmove, Zoopla, OnTheMarket, ASPC, ESPC, S1homes) and
// agents. Works on the email's HTML or text, so it runs both in the scheduled worker and in the browser.
//
// How it reads an email: it finds the links to individual listings (each portal has its own link pattern, often
// wrapped in a tracking redirect, which is decoded), splits the email into one block per listing, then reads the
// address, price, status words, bedrooms and type from each block. Anything it cannot read stays Unknown.
// The exact layouts of real alerts must be confirmed against genuine emails; see tests for the cases covered.
import type { Observation } from './engine';
import { emailToText, parseAlertEmail } from './email';
import { parseBasis, parseInt0, parsePrice, parseType, postcodeOf } from './parse';
import type { Status } from './types';

export interface Portal { name: string; domains: RegExp; listing: RegExp }

/** Link patterns: the captured group is the portal's own listing ID. */
export const PORTALS: Portal[] = [
  { name: 'Rightmove', domains: /rightmove\.co\.uk/i, listing: /rightmove\.co\.uk\/(?:properties|property-for-sale\/property)[/-](\d{6,})/i },
  { name: 'Zoopla', domains: /zoopla\.co\.uk/i, listing: /zoopla\.co\.uk\/(?:for-sale\/)?details\/(\d{6,})/i },
  { name: 'OnTheMarket', domains: /onthemarket\.com/i, listing: /onthemarket\.com\/details\/(\d{6,})/i },
  { name: 'ASPC', domains: /aspc\.co\.uk/i, listing: /aspc\.co\.uk\/(?:property|properties|search\/property|Property)[^"'\s<>]*?[/=-](\d{5,})/i },
  { name: 'ESPC', domains: /espc\.com/i, listing: /espc\.com\/property\/[^"'\s<>]*?(\d{6,})/i },
  { name: 'S1homes', domains: /s1homes\.com/i, listing: /s1homes\.com\/[^"'\s<>]*?(\d{6,})/i },
];

const KNOWN_SENDERS: Record<string, string> = { 'rightmove.co.uk': 'Rightmove', 'zoopla.co.uk': 'Zoopla', 'onthemarket.com': 'OnTheMarket', 'aspc.co.uk': 'ASPC', 'espc.com': 'ESPC', 's1homes.com': 'S1homes' };

/** Decode tracking redirects ("…?url=https%3A%2F%2Fwww.rightmove.co.uk%2Fproperties%2F123…") so the real link shows. */
export function decodeLink(href: string): string {
  let s = href.replace(/&amp;/g, '&');
  for (let i = 0; i < 3; i++) { try { const d = decodeURIComponent(s); if (d === s) break; s = d; } catch { break; } }
  // some trackers base64-encode the destination
  const b64 = s.match(/[?&/](?:u|url|target|redirect|link)=([A-Za-z0-9_-]{24,}={0,2})/);
  if (b64) { try { const t = atob(b64[1].replace(/-/g, '+').replace(/_/g, '/')); if (/^https?:\/\//.test(t)) s += ' ' + t; } catch { /* not base64 */ } }
  return s;
}

/** Which source sent this email? Uses the sender's domain, or (for forwarded emails) the listing links inside. */
export function identifySource(from: string, body: string, agentDomains: Record<string, string> = {}): string | null {
  const dom = (from.match(/@([a-z0-9.-]+)/i)?.[1] || '').toLowerCase();
  for (const [d, n] of Object.entries({ ...KNOWN_SENDERS, ...agentDomains })) if (dom === d || dom.endsWith('.' + d)) return n;
  const links = [...body.matchAll(/href\s*=\s*["']([^"']+)["']/gi)].map((m) => decodeLink(m[1])).join(' ') + ' ' + body;
  const counts = PORTALS.map((p) => ({ p, n: (links.match(new RegExp(p.listing.source, 'gi')) || []).length })).sort((a, b) => b.n - a.n);
  if (counts[0].n > 0) return counts[0].p.name;
  // no listing links (e.g. a changed layout): fall back to any link to a portal, so the failure is reported for that source
  const byDomain = PORTALS.map((p) => ({ p, n: (links.match(new RegExp(p.domains.source, 'gi')) || []).length })).sort((a, b) => b.n - a.n);
  return byDomain[0].n > 0 ? byDomain[0].p.name : null;
}

/** Scottish and portal status wording -> our status (with the original words kept as evidence). */
export function statusFromWords(text: string): { status: Status | null; wording: string | null } {
  const m = text.match(/\b(under offer|sold stc|sold subject to contract|sale agreed|offer accepted|closing date(?: set)?|missives concluded|withdrawn|reserved|back on (?:the )?market|returned to market)\b/i);
  if (!m) return { status: null, wording: null };
  const w = m[1].toLowerCase();
  const status: Status | null = /missives/.test(w) ? 'missives' : /under offer|sold stc|subject to contract|sale agreed|offer accepted|reserved/.test(w) ? 'under_offer'
    : /closing date/.test(w) ? 'closing_date' : /withdrawn/.test(w) ? 'withdrawn' : /back on|returned/.test(w) ? 'for_sale' : null;
  // A plain "sold" is never read from an email: footers mention "sold prices", and completion must be confirmed by you.
  return { status, wording: m[1] };
}

/** Split "12 High Street, Torphins, Banchory, Aberdeenshire, AB31 4XX" into address, town and postcode. */
export function splitAddress(line: string, knownTowns: string[]): { address: string; town: string; postcode: string | null } {
  const postcode = postcodeOf(line);
  const parts = line.replace(/\b(AB\d{1,2})\s?(\d[A-Z]{2})?\b/gi, '').split(',').map((x) => x.trim()).filter((x) => x && !/^(aberdeenshire|scotland|uk|united kingdom)$/i.test(x));
  const lower = knownTowns.map((t) => t.toLowerCase());
  let ti = parts.findIndex((p, i) => i > 0 && lower.includes(p.toLowerCase()));
  if (ti < 0 && parts.length === 1) { const t = knownTowns.find((t) => new RegExp(`\\b${t.replace(/[.*+?^${}()|[\]\\']/g, '\\$&')}\\b`, 'i').test(parts[0])); if (t) return { address: parts[0].replace(new RegExp(`,?\\s*${t}.*$`, 'i'), '').trim() || parts[0], town: t, postcode }; }
  if (ti < 0) ti = parts.length >= 2 ? 1 : -1;
  if (ti < 0) return { address: parts[0] || '', town: '', postcode };
  const town = knownTowns.find((t) => t.toLowerCase() === parts[ti].toLowerCase()) ?? parts[ti];
  return { address: parts.slice(0, ti).join(', '), town, postcode };
}

export interface PortalListing { obs: Observation; warnings: string[]; raw: string }

/** Read all listings from one notification email. */
export function parsePortalEmail(input: { html: string | null; text: string | null; from: string; subject: string; date: string }, knownTowns: string[], source: string): PortalListing[] {
  const body = input.html || input.text || '';
  const portal = PORTALS.find((p) => p.name === source);
  // 1. find listing links, in order of first appearance
  const hits: { id: string; url: string; pos: number }[] = [];
  const hrefRe = /href\s*=\s*["']([^"']+)["']/gi; let m: RegExpExecArray | null;
  const patterns = portal ? [portal] : PORTALS;
  while ((m = hrefRe.exec(body))) {
    const real = decodeLink(m[1]);
    for (const p of patterns) { const lm = real.match(p.listing); if (lm) { hits.push({ id: lm[1], url: canonicalUrl(p.name, lm[1], real), pos: m.index }); break; } }
  }
  if (!input.html) for (const p of patterns) for (const lm of body.matchAll(new RegExp(p.listing.source, 'gi'))) hits.push({ id: lm[1], url: canonicalUrl(p.name, lm[1], lm[0]), pos: lm.index ?? 0 });
  const firsts: typeof hits = []; for (const h of hits.sort((a, b) => a.pos - b.pos)) if (!firsts.some((f) => f.id === h.id)) firsts.push(h);
  const subjectStatus = statusFromWords(input.subject);
  const subjectReduced = /reduc|price (drop|change|cut)|lowered/i.test(input.subject);
  if (!firsts.length) {
    // No recognisable listing links: fall back to reading prices and addresses from the text.
    return parseAlertEmail(body, knownTowns, input.date).map((l) => ({ obs: { ...l.obs, ...splitFallback(l.obs, knownTowns) }, warnings: [...l.warnings, 'no listing links found: read from text only'], raw: l.raw }));
  }
  // 2. one block per listing: from its first link to the next listing's first link
  return firsts.map((h, i) => {
    const start = i === 0 ? Math.max(0, h.pos - 1500) : h.pos;
    const block = body.slice(i === 0 ? Math.max(start, lastBoundary(body, h.pos)) : start, firsts[i + 1]?.pos ?? footerStart(body, h.pos));
    const text = emailToText(input.html ? block : block).replace(/\[[^\]]*\]/g, ' ').replace(/ +/g, ' ');
    const lines = text.split('\n').map((l) => l.trim()).filter((l) => l && !/^(view|see|more|details|view property|view details|save|unsubscribe)$/i.test(l));
    const warnings: string[] = [];
    // price: the current price, and an earlier price if the email says it was reduced
    const priceLine = lines.find((l) => /£\s?\d/.test(l) && !/(was|from|previously|reduced from)\s*£/i.test(l)) || lines.find((l) => /£\s?\d/.test(l)) || '';
    const prices = [...text.matchAll(/£\s?([\d,]{4,})/g)].map((x) => Number(x[1].replace(/,/g, '')));
    const prev = text.match(/(?:was|reduced from|previously|from)\s*£\s?([\d,]{4,})/i); const previousPrice = prev ? Number(prev[1].replace(/,/g, '')) : null;
    let price = parsePrice(priceLine).price; if (price != null && previousPrice === price && prices.length > 1) price = prices.find((x) => x !== previousPrice) ?? price;
    // address: a line with a known town or an AB postcode, or a comma-separated line without a price
    const townRe = new RegExp(`\\b(${knownTowns.map((t) => t.replace(/[.*+?^${}()|[\]\\']/g, '\\$&')).join('|')})\\b`, 'i');
    const addrLine = lines.find((l) => !/£/.test(l) && !/\bbed/i.test(l) && (townRe.test(l) || postcodeOf(l)) && l.length < 140)
      || lines.find((l) => !/£/.test(l) && !/\bbed/i.test(l) && /,/.test(l) && l.length < 140) || '';
    const { address, town, postcode } = splitAddress(addrLine, knownTowns);
    const st = statusFromWords(text); const status = st.status ?? (i === 0 || firsts.length === 1 ? subjectStatus.status : null);
    const beds = text.match(/(\d+)\s*(?:-|\s)?\s*bed(?:room)?s?\b/i), baths = text.match(/(\d+)\s*bath(?:room)?s?\b/i);
    const typeWord = text.match(/\b(semi[- ]detached|detached|bungalow|cottage|flat|apartment|maisonette|terraced|end of terrace|terrace|town ?house|villa|farmhouse|plot|land|house)\b/i)?.[0] ?? '';
    if (!address) warnings.push('address not found'); if (!town) warnings.push('town not recognised');
    if (price == null) warnings.push('price not read');
    if (subjectReduced && previousPrice == null && i === 0 && firsts.length === 1) warnings.push('email says reduced but gives no earlier price: the change will be detected by comparison');
    const obs: Observation = {
      address, town, postcode, price, previousPrice: previousPrice && price && previousPrice !== price ? previousPrice : null,
      basis: parsePrice(priceLine).basis || parseBasis(text), status, statusWording: status ? (st.wording ?? subjectStatus.wording) : null,
      bedrooms: beds ? parseInt0(beds[1]) : null, bathrooms: baths ? parseInt0(baths[1]) : null, propertyType: typeWord ? parseType(typeWord) : null,
      url: h.url, listingId: h.id, date: input.date,
    };
    return { obs, warnings, raw: lines.join('\n') };
  });
}

function canonicalUrl(portal: string, id: string, real: string): string {
  if (portal === 'Rightmove') return `https://www.rightmove.co.uk/properties/${id}`;
  if (portal === 'Zoopla') return `https://www.zoopla.co.uk/for-sale/details/${id}/`;
  if (portal === 'OnTheMarket') return `https://www.onthemarket.com/details/${id}/`;
  const u = real.match(/https?:\/\/[^\s"'<>]+/); return u ? u[0].split(/[?#]/)[0] : real;
}
/** Start of the first listing's block: just after the email's header text (the last table row before the first link). */
function lastBoundary(body: string, pos: number): number {
  const before = body.slice(0, pos); const i = Math.max(before.lastIndexOf('<tr'), before.lastIndexOf('<table'), before.lastIndexOf('<div'));
  return i > 0 ? i : 0;
}
/** Where the email's footer begins (unsubscribe text etc.), so it isn't read as part of the last listing. */
function footerStart(body: string, from: number): number {
  const m = body.slice(from).search(/unsubscribe|manage (your )?(alerts|email|preferences)|you are receiving|you're receiving|privacy policy|this email was sent/i);
  return m > 0 ? from + m : body.length;
}
function splitFallback(o: Observation, knownTowns: string[]) { return o.town ? {} : splitAddress(o.address, knownTowns); }
