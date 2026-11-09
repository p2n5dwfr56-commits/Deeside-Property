// Reading property-alert emails (e.g. ASPC saved-search alerts) that YOU received, pasted or uploaded as text/.eml.
// The email's exact layout is not yet known, so this reads general patterns and always shows a preview to confirm.
// Listings are split at each price line or listing link; anything it cannot read is left as Unknown.
import type { Observation } from './engine';
import { parseBasis, parseInt0, parsePrice, parseStatus, parseType, postcodeOf } from './parse';

export interface EmailListing { obs: Observation; raw: string; warnings: string[] }

/** Strip HTML and quoted-printable encoding so the email reads as plain text. */
export function emailToText(input: string): string {
  let s = input;
  if (/Content-Transfer-Encoding:\s*quoted-printable/i.test(s) || /=\r?\n/.test(s)) s = s.replace(/=\r?\n/g, '').replace(/=([0-9A-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
  if (/<html|<table|<td|<br|<p[ >]/i.test(s)) {
    s = s.replace(/<a[^>]*href="([^"]+)"[^>]*>/gi, ' [$1] ').replace(/<(br|\/p|\/div|\/tr|\/td|\/li|\/h\d)[^>]*>/gi, '\n').replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ').replace(/&pound;/g, '£').replace(/&amp;/g, '&').replace(/&#39;|&rsquo;/g, '’').replace(/&quot;/g, '"');
  }
  return s.split(/\r?\n/).map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n');
}

export function parseAlertEmail(input: string, knownTowns: string[], date: string): EmailListing[] {
  const lines = emailToText(input).split('\n');
  const urlRe = /https?:\/\/[^\s\]>"]+/;
  const priceRe = /(offers\s+(over|around|in the region of)|fixed\s+price|guide\s+price|o\/o|£\s?\d)/i;
  // a listing starts at a line containing a price; collect the lines around it
  const starts: number[] = []; lines.forEach((l, i) => { if (priceRe.test(l) && /\d{3}/.test(l.replace(/,/g, ''))) starts.push(i); });
  const out: EmailListing[] = [];
  starts.forEach((s, k) => {
    const from = Math.max(k ? starts[k - 1] + 1 : 0, s - 3), to = Math.min(lines.length, (starts[k + 1] ?? lines.length));
    const block = lines.slice(from, to); const text = block.join('\n'); const warnings: string[] = [];
    const pr = parsePrice(lines[s]);
    // address: the line before the price that mentions a known town or a postcode, otherwise the nearest text line
    const townRe = new RegExp(`\\b(${knownTowns.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`, 'i');
    const before = lines.slice(from, s + 1).reverse();
    const addrLine = before.find((l) => townRe.test(l) || postcodeOf(l)) || block.find((l) => townRe.test(l) || postcodeOf(l)) || '';
    const town = (addrLine.match(townRe) || text.match(townRe) || [])[1] || '';
    let address = addrLine.replace(urlRe, '').replace(priceRe, '').replace(/£[\d,]+/g, '').trim().replace(/[,\s-]+$/, '');
    if (town) address = address.replace(new RegExp(`,?\\s*${town}\\b.*$`, 'i'), '').trim() || address;
    if (!address) warnings.push('address not found');
    if (!town) warnings.push('town not recognised (add it to your locations first)');
    if (pr.price == null) warnings.push('price not read');
    const url = (text.match(urlRe) || [])[0] || null;
    const bedsM = text.match(/(\d+)\s*(bed|bedroom)/i), bathsM = text.match(/(\d+)\s*(bath|bathroom)/i);
    out.push({ raw: text, warnings, obs: {
      address, town, postcode: postcodeOf(text), price: pr.price, basis: pr.basis || parseBasis(text), status: parseStatus(/under offer|closing date|sold|withdrawn/i.test(text) ? (text.match(/under offer|closing date|sold|withdrawn/i) || [''])[0] : ''),
      bedrooms: bedsM ? parseInt0(bedsM[1]) : null, bathrooms: bathsM ? parseInt0(bathsM[1]) : null, propertyType: parseType((text.match(/\b(semi[- ]detached|detached|bungalow|cottage|flat|apartment|terraced|terrace|villa|house|plot)\b/i) || [''])[0]),
      url, listingId: url ? (url.match(/(\d{5,})/) || [])[1] || null : null, date,
    } });
  });
  return out;
}
