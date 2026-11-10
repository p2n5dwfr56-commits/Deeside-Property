#!/usr/bin/env python3
"""Deeside Property Watch: read myASPC alert emails and record what they say.

myASPC sends a daily round-up for each saved search (new properties and changes such as price or closing date) and
notifications for favourites (price change, closing date, under offer, no longer under offer, sold). This script reads
those emails from a dedicated mailbox, READ-ONLY (nothing is marked, moved or deleted), and saves each listing it finds
to the same SQLite database as the website collector, recording every change against what was known before.

Usage:  IMAP_USER=... IMAP_PASSWORD=... python3 collector/mailbox.py [--db collector/deeside.db] [--days 14]
Plain Python 3 standard library only. Each email is processed once (by Message-ID); the raw email is kept in the
database so it can be re-read if ASPC changes its layout.
"""
import argparse, datetime as dt, email, email.policy, email.utils, html, imaplib, json, os, re, sqlite3, sys

SOURCE = 'ASPC'
TOWNS = ['Torphins', 'Banchory', 'Aboyne', 'Ballater', "Kincardine O'Neil", 'Lumphanan']
SCHEMA_EXTRA = '''
CREATE TABLE IF NOT EXISTS emails (message_id TEXT PRIMARY KEY, received TEXT, processed TEXT, from_addr TEXT, subject TEXT,
  kind TEXT, listings INTEGER, status TEXT, raw BLOB);
'''
LINK = re.compile(r'https?://(?:www\.)?aspc\.co\.uk/search/property/(\d{4,})/([^/"\'\s<>?]*)/([^/"\'\s<>?]*)/?', re.I)
PRICE = re.compile(r'£\s?([\d,]{4,})')
BASES = ['Offers over', 'Offers around', 'Fixed price', 'Offers in the region of', 'Guide price', 'Price on application', 'Offers in excess of']
STATUSES = [('no longer under offer', 'For Sale'), ('back on the market', 'For Sale'), ('under offer', 'Under Offer'),
            ('closing date', 'Closing Date'), ('sold', 'Sold'), ('withdrawn', 'Withdrawn'), ('price change', None),
            ('price reduced', None), ('new', None)]

def now():
    return dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat()

def html_to_lines(h):
    h = re.sub(r'<(script|style)[^>]*>.*?</\1>', ' ', h, flags=re.S | re.I)
    h = re.sub(r'<br\s*/?>|</(p|div|tr|td|li|h\d|table)>', '\n', h, flags=re.I)
    return [re.sub(r'\s+', ' ', html.unescape(l)).strip() for l in re.sub(r'<[^>]+>', ' ', h).split('\n')]

def body_of(msg):
    parts = {'html': '', 'text': ''}
    for p in msg.walk():
        ct = p.get_content_type()
        if ct in ('text/html', 'text/plain') and not p.get_filename():
            try:
                parts['html' if ct == 'text/html' else 'text'] += p.get_content()
            except Exception:
                parts['html' if ct == 'text/html' else 'text'] += p.get_payload(decode=True).decode('utf-8', 'replace')
    return parts

def parse_aspc(msg):
    """Listings in a myASPC email: every property link, with the price, basis, status and bedrooms written near it.
    The layout of real alerts is checked against samples; anything not found is left empty, never guessed."""
    b = body_of(msg)
    src = b['html'] or html.escape(b['text'])
    found = {}
    for m in LINK.finditer(src):
        found.setdefault(m.group(1), m)
    ids = list(found)
    out = []
    for n, pid in enumerate(ids):
        m = found[pid]
        end = found[ids[n + 1]].start() if n + 1 < len(ids) else m.end() + 6000
        chunk = src[max(0, m.start() - 200):end]
        lines = [l for l in html_to_lines(chunk) if l]
        block = ' | '.join(lines)
        slug_addr = html.unescape(m.group(2)).replace('--', ', ').replace('-', ' ').strip()
        town = html.unescape(m.group(3)).replace('-', ' ').strip()
        address = next((l for l in lines if town.lower() in l.lower() and len(l) < 160 and '£' not in l), None) or f'{slug_addr}, {town}'
        price = PRICE.search(block)
        basis = next((b_ for b_ in BASES if b_.lower() in block.lower()), None)
        status = None
        for word, value in STATUSES:
            if word in block.lower() and value:
                status = value
                break
        beds = re.search(r'(\d+)\s*(?:bed|bedroom)', block, re.I)
        ptype = next((t for t in ['Semi-detached', 'Semi detached', 'Detached', 'Terraced', 'Terrace', 'Bungalow', 'Cottage', 'Flat',
                                  'Apartment', 'Maisonette', 'Villa', 'Plot', 'Land'] if re.search(r'\b' + t + r'\b', block, re.I)), None)
        closing = re.search(r'closing date[^|]{0,40}?(\d{1,2}(?:st|nd|rd|th)?\s+\w+\s*\d{0,4})', block, re.I)
        out.append({'listing_id': f'ASPC-{pid}', 'url': m.group(0).split('?')[0], 'address': address, 'town': town,
                    'postcode': (lambda p: p.group(1) if p else None)(re.search(r'\b(AB\d{1,2}\s*\d[A-Z]{2})\b', block)),
                    'price': int(price.group(1).replace(',', '')) if price else None, 'price_text': price.group(0) if price else None,
                    'price_basis': basis, 'status': status, 'bedrooms': int(beds.group(1)) if beds else None,
                    'property_type': ptype, 'closing_date': closing.group(1) if closing else None})
    return out

def record(con, run_id, at, c, evidence):
    """Save one listing seen in an email and record what changed. Emails only mention new or changed properties, so a
    property that is not mentioned is left as it was (never assumed sold or withdrawn)."""
    def change(kind, old, new):
        con.execute('INSERT INTO changes (run_id, listing_id, at, kind, old_value, new_value) VALUES (?,?,?,?,?,?)',
                    (run_id, c['listing_id'], at, kind, None if old is None else str(old), None if new is None else str(new)))
    row = con.execute('SELECT price, price_basis, status FROM listings WHERE listing_id=?', (c['listing_id'],)).fetchone()
    status = c['status'] or (row[2] if row else 'For Sale')
    if row is None:
        con.execute('''INSERT INTO listings (listing_id, source, url, address, town, postcode, price, price_text, price_basis, status,
            bedrooms, property_type, first_seen, last_seen, listed) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)''',
            (c['listing_id'], SOURCE, c['url'], c['address'], c['town'], c['postcode'], c['price'], c['price_text'], c['price_basis'],
             status, c['bedrooms'], c['property_type'], at, at))
        change('new_listing', None, c['price'])
    else:
        old_price, old_basis, old_status = row
        if c['price'] is not None and old_price is not None and c['price'] != old_price:
            change('price_reduced' if c['price'] < old_price else 'price_increased', old_price, c['price'])
        if c['price_basis'] and old_basis and c['price_basis'] != old_basis:
            change('basis_changed', old_basis, c['price_basis'])
        if c['status'] and c['status'] != old_status:
            change('status_changed', old_status, c['status'])
        con.execute('''UPDATE listings SET last_seen=?, price=COALESCE(?, price), price_text=COALESCE(?, price_text),
            price_basis=COALESCE(?, price_basis), status=?, bedrooms=COALESCE(?, bedrooms), property_type=COALESCE(?, property_type),
            postcode=COALESCE(?, postcode) WHERE listing_id=?''', (at, c['price'], c['price_text'], c['price_basis'], status,
            c['bedrooms'], c['property_type'], c['postcode'], c['listing_id']))
    con.execute('INSERT OR REPLACE INTO observations VALUES (?,?,?,?,?,?)', (run_id, c['listing_id'], at, c['price'], c['price_basis'], status))

def process_message(con, run_id, raw):
    msg = email.message_from_bytes(raw, policy=email.policy.default)
    mid = (msg.get('Message-ID') or '').strip() or f"no-id-{hash(raw)}"
    if con.execute('SELECT 1 FROM emails WHERE message_id=?', (mid,)).fetchone():
        return None
    sender = str(msg.get('From', ''))
    try:
        received = email.utils.parsedate_to_datetime(msg.get('Date')).astimezone(dt.timezone.utc).replace(microsecond=0).isoformat()
    except Exception:
        received = now()
    listings, status = [], 'ignored'
    if 'aspc.co.uk' in sender.lower() or 'aspc' in str(msg.get('Subject', '')).lower():
        listings = parse_aspc(msg)
        for c in listings:
            record(con, run_id, received, c, str(msg.get('Subject', '')))
        status = 'ok' if listings else 'no_listings'
    con.execute('INSERT INTO emails VALUES (?,?,?,?,?,?,?,?,?)', (mid, received, now(), sender, str(msg.get('Subject', '')),
                'ASPC' if status != 'ignored' else 'other', len(listings), status, raw))
    return status, len(listings)

def run(db_path, days):
    import collect  # same database tables
    con = sqlite3.connect(db_path)
    con.executescript(collect.SCHEMA + SCHEMA_EXTRA)
    started = now()
    run_id = con.execute('INSERT INTO runs (started) VALUES (?)', (started,)).lastrowid
    host, user, pw = os.environ.get('IMAP_HOST') or 'imap.gmail.com', os.environ['IMAP_USER'], os.environ['IMAP_PASSWORD']
    folder = os.environ.get('IMAP_FOLDER') or 'INBOX'
    errors, checked, used, listings = [], 0, 0, 0
    try:
        im = imaplib.IMAP4_SSL(host)
        im.login(user, pw)
        im.select(f'"{folder}"', readonly=True)   # read-only: nothing in the mailbox is changed
        since = (dt.date.today() - dt.timedelta(days=days)).strftime('%d-%b-%Y')
        typ, data = im.search(None, 'SINCE', since)
        for num in (data[0].split() if data and data[0] else []):
            typ, parts = im.fetch(num, '(BODY.PEEK[])')
            raw = next((p[1] for p in parts if isinstance(p, tuple)), None)
            if not raw:
                continue
            checked += 1
            r = process_message(con, run_id, raw)
            if r and r[0] != 'ignored':
                used += 1
                listings += r[1]
        im.logout()
    except Exception as e:
        errors.append(f'Mailbox: {type(e).__name__}: {e}'[:300])
    changes = con.execute('SELECT COUNT(*) FROM changes WHERE run_id=?', (run_id,)).fetchone()[0]
    new = con.execute("SELECT COUNT(*) FROM changes WHERE run_id=? AND kind='new_listing'", (run_id,)).fetchone()[0]
    con.execute('UPDATE runs SET finished=?, ok=?, pages=?, listings=?, new=?, changes=?, complete_towns=?, errors=? WHERE id=?',
                (now(), int(not errors), checked, listings, new, changes, 'email', json.dumps(errors), run_id))
    con.commit()
    con.close()
    return {'run': run_id, 'emails_checked': checked, 'aspc_emails': used, 'listings': listings, 'new': new, 'changes': changes, 'errors': errors}

if __name__ == '__main__':
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    a = argparse.ArgumentParser()
    a.add_argument('--db', default='collector/deeside.db')
    a.add_argument('--days', type=int, default=14)
    o = a.parse_args()
    r = run(o.db, o.days)
    # Counts only: the workflow log is public.
    print(f"Run {r['run']}: {r['emails_checked']} new emails checked, {r['aspc_emails']} from ASPC, {r['listings']} listings read, "
          f"{r['new']} new properties, {r['changes']} changes recorded")
    for e in r['errors']:
        print('Problem:', e.split(':')[0] + ':', e.split(':')[1] if ':' in e else '')
    sys.exit(1 if r['errors'] else 0)
