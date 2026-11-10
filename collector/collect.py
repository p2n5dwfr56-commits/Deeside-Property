#!/usr/bin/env python3
"""Deeside Property Watch: simple collector.

Source: Aberdein Considine's public property search (property.acandco.com), whose robots.txt allows the search and
listing pages. For each town it reads the search results, saves every listing to SQLite, compares with what was saved
last time, and records each change (new listing, price reduced or increased, status change, pricing basis change,
no longer listed).

Usage:  python3 collector/collect.py [--db collector/deeside.db] [--towns ...]   (default: the six Deeside towns)
Plain Python 3 standard library only. Polite: one request every few seconds, identifies itself, obeys robots.txt.
"""
import argparse, datetime as dt, html, json, re, sqlite3, sys, time, urllib.parse, urllib.request, urllib.robotparser

BASE = 'https://property.acandco.com'
SOURCE = 'Aberdein Considine'
UA = 'DeesidePropertyWatch/1.0 (personal property-price tracker; github.com/p2n5dwfr56-commits/deeside-property)'
DELAY = 4  # seconds between requests
MAX_PAGES = 10

SCHEMA = '''
CREATE TABLE IF NOT EXISTS runs (id INTEGER PRIMARY KEY, started TEXT, finished TEXT, ok INTEGER, pages INTEGER,
  listings INTEGER, new INTEGER, changes INTEGER, complete_towns TEXT, errors TEXT);
CREATE TABLE IF NOT EXISTS listings (listing_id TEXT PRIMARY KEY, source TEXT, url TEXT, address TEXT, town TEXT,
  postcode TEXT, price INTEGER, price_text TEXT, price_basis TEXT, status TEXT, bedrooms INTEGER, bathrooms INTEGER,
  living_rooms INTEGER, property_type TEXT, floor_area_sqm REAL, first_seen TEXT, last_seen TEXT, listed INTEGER DEFAULT 1,
  postal_town TEXT, in_area INTEGER, searched_town TEXT);
CREATE TABLE IF NOT EXISTS pages (run_id INTEGER, town TEXT, page INTEGER, cards INTEGER, fresh INTEGER, has_next INTEGER);
CREATE TABLE IF NOT EXISTS observations (run_id INTEGER, listing_id TEXT, seen_at TEXT, price INTEGER, price_basis TEXT,
  status TEXT, PRIMARY KEY (run_id, listing_id));
CREATE TABLE IF NOT EXISTS changes (id INTEGER PRIMARY KEY, run_id INTEGER, listing_id TEXT, at TEXT, kind TEXT,
  old_value TEXT, new_value TEXT);
'''

def now():
    return dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat()

def text(s):
    return re.sub(r'\s+', ' ', html.unescape(re.sub(r'<[^>]+>', ' ', s or ''))).strip()

class Fetcher:
    def __init__(self):
        self.robots = urllib.robotparser.RobotFileParser(BASE + '/robots.txt')
        self.robots.read()
        self.last = 0.0
        self.count = 0

    def get(self, url):
        if not self.robots.can_fetch(UA, url):
            raise PermissionError(f'robots.txt does not allow {url}')
        wait = self.last + DELAY - time.time()
        if wait > 0:
            time.sleep(wait)
        req = urllib.request.Request(url, headers={'User-Agent': UA, 'Accept-Language': 'en-GB'})
        with urllib.request.urlopen(req, timeout=30) as r:
            body = r.read().decode('utf-8', 'replace')
        self.last = time.time()
        self.count += 1
        return body

CARD = re.compile(r'<a href="/properties/property-detail\?propertyId=([A-Z0-9]+)"\s+tabindex="-1"')

def parse_results(page):
    """One dict per listing card on a search-results page."""
    out, seen = [], set()
    starts = [m.start() for m in CARD.finditer(page)]
    for n, start in enumerate(starts):
        pid = CARD.match(page, start).group(1)
        if pid in seen:
            continue
        seen.add(pid)
        card = page[start:starts[n + 1] if n + 1 < len(starts) else start + 20000]
        head = re.search(r'mb-4 font-semibold">\s*<p>(.*?)</p>\s*<p>(.*?)</p>', card, re.S)
        addr = re.search(r'<h3[^>]*>(.*?)</h3>\s*<p class="font-semibold">(.*?)</p>', card, re.S)
        flat = text(card)
        num = lambda label: (lambda m: int(m.group(1)) if m else None)(re.search(r'(\d+)\s+' + label, flat))
        price_text = text(addr.group(2)) if addr else ''
        digits = re.sub(r'[^\d]', '', price_text)
        address = text(addr.group(1)) if addr else None
        pc = re.search(r'\b(AB\d{1,2}\s*\d[A-Z]{2})\b', address or '')
        out.append({
            'listing_id': pid, 'url': f'{BASE}/properties/property-detail?propertyId={pid}',
            'status': text(head.group(1)) if head else None, 'price_basis': text(head.group(2)) if head else None,
            'address': address, 'postcode': pc.group(1) if pc else None,
            'price': int(digits) if digits else None, 'price_text': price_text or None,
            'bedrooms': num('Bedrooms'), 'bathrooms': num('Bathrooms'), 'living_rooms': num('Living Rooms'),
        })
    return out

STYLES = ['Semi Detached', 'Semi-Detached', 'Detached', 'End Terrace', 'Mid Terrace', 'Terraced', 'Terrace', 'Bungalow',
          'Cottage', 'Flat', 'Apartment', 'Maisonette', 'Villa', 'Plot', 'Land']

def parse_detail(page):
    """(property type, floor area in m²) from a listing page: type is the style in its feature list, else its 'Type' field."""
    body = re.sub(r'<script.*?</script>|<style.*?</style>', '', page, flags=re.S)
    lines = [l.strip() for l in html.unescape(re.sub(r'<[^>]+>', '\n', body)).split('\n') if l.strip()]
    area = None  # floor area in m², from the 'Dimensions' field
    for i, l in enumerate(lines):
        if l == 'Dimensions' and i + 2 < len(lines) and lines[i + 1] == ':':
            m = re.match(r'([\d.,]+)\s*m', lines[i + 2])
            area = float(m.group(1).replace(',', '')) if m else None
    for l in lines:
        for s in STYLES:
            if l.lower() == s.lower():
                return s, area
    for i, l in enumerate(lines):
        if l == 'Type' and i + 2 < len(lines) and lines[i + 1] == ':':
            return lines[i + 2].capitalize(), area
    return None, area


TOWNS = ['Torphins', 'Banchory', 'Aboyne', 'Ballater', "Kincardine O'Neil", 'Lumphanan']
STREET = re.compile(r"\d|\b(road|street|st|avenue|drive|gardens|crescent|place|terrace|court|lane|way|view|park|brae|wynd|close|row|"
                    r"square|grove|walk|steading|cottages?|farm|house|lodge|mains|plot|flat|apartment|development)\b", re.I)
def _norm(s):
    return re.sub(r"[^a-z]", "", (s or '').lower().replace("’", "'"))

def locate(address, searched):
    """(locality, postal town, in one of the six towns?) from an address such as
    'Rowanbrae, Main Road, Lumphanan, Banchory, Aberdeenshire, AB31 4PX' -> ('Lumphanan', 'Banchory', True)
    'Lochton Steading, Durris, Banchory, AB31 6DB'                     -> ('Durris', 'Banchory', False)
    The search that found a listing is only used when the address names no place at all."""
    parts = [p.strip() for p in (address or '').split(',') if p.strip()]
    parts = [p for p in parts if not re.fullmatch(r'AB\d{1,2}\s*\d[A-Z]{2}|Aberdeenshire|Scotland|United Kingdom|UK', p, re.I)]
    places = [p for p in parts[1:] if not STREET.search(p)]          # the first part is the house or street
    if not places:
        return searched, searched, any(_norm(searched) == _norm(t) for t in TOWNS)
    postal, locality = places[-1], places[-2] if len(places) > 1 else places[-1]
    for t in TOWNS:                                                    # spell the six towns consistently
        if _norm(locality) == _norm(t):
            return t, postal, True
    return locality, postal, False

def collect(db_path, towns):
    con = sqlite3.connect(db_path)
    con.executescript(SCHEMA)
    have = [r[1] for r in con.execute('PRAGMA table_info(listings)')]
    for col, kind in [('floor_area_sqm', 'REAL'), ('postal_town', 'TEXT'), ('in_area', 'INTEGER'), ('searched_town', 'TEXT')]:
        if col not in have:  # databases made by an earlier version
            con.execute(f'ALTER TABLE listings ADD COLUMN {col} {kind}')
    started = now()
    run_id = con.execute('INSERT INTO runs (started) VALUES (?)', (started,)).lastrowid
    f, errors, seen, complete = Fetcher(), [], {}, []
    for town in towns:
        try:
            got_all = False
            for page_no in range(1, MAX_PAGES + 1):
                url = f'{BASE}/properties/?address={urllib.parse.quote(town)}' + (f'&page={page_no}' if page_no > 1 else '')
                page = f.get(url)
                cards = parse_results(page)
                fresh = [c for c in cards if c['listing_id'] not in seen]
                for c in cards:
                    seen.setdefault(c['listing_id'], dict(c, searched=town))
                has_next = f'page={page_no + 1}"' in page or f'page={page_no + 1}&' in page
                con.execute('INSERT INTO pages VALUES (?,?,?,?,?,?)', (run_id, town, page_no, len(cards), len(fresh), int(has_next)))
                if not fresh or not has_next:
                    got_all = True
                    break
            if got_all:
                complete.append(town)
        except Exception as e:  # keep going with the other towns; this town is then not treated as complete
            errors.append(f'{town}: {e}')

    new = changed = 0
    at = now()
    def change(lid, kind, old, new_):
        nonlocal changed
        con.execute('INSERT INTO changes (run_id, listing_id, at, kind, old_value, new_value) VALUES (?,?,?,?,?,?)',
                    (run_id, lid, at, kind, None if old is None else str(old), None if new_ is None else str(new_)))
        changed += 1
    for lid, c in seen.items():
        c['town'], c['postal_town'], c['in_area'] = locate(c['address'], c['searched'])
        row = con.execute('SELECT price, price_basis, status, listed, property_type, floor_area_sqm FROM listings WHERE listing_id=?', (lid,)).fetchone()
        ptype, area = (row[4], row[5]) if row else (None, None)
        if not ptype:  # each listing's own page is read once, for its property type and floor area
            try:
                ptype, area = parse_detail(f.get(c['url']))
            except Exception as e:
                errors.append(f'{lid} details: {e}')
        if row is None:
            con.execute('''INSERT INTO listings (listing_id, source, url, address, town, postcode, price, price_text, price_basis,
                status, bedrooms, bathrooms, living_rooms, property_type, floor_area_sqm, first_seen, last_seen, listed, postal_town, in_area,
                searched_town) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?,?)''', (lid, SOURCE, c['url'], c['address'], c['town'],
                c['postcode'], c['price'], c['price_text'], c['price_basis'], c['status'], c['bedrooms'], c['bathrooms'], c['living_rooms'],
                ptype, area, at, at, c['postal_town'], int(c['in_area']), c['searched']))
            change(lid, 'new_listing', None, c['price'])
            new += 1
        else:
            old_price, old_basis, old_status, listed = row[:4]
            if not listed:
                change(lid, 'relisted', None, c['status'])
            if c['price'] is not None and old_price is not None and c['price'] != old_price:
                change(lid, 'price_reduced' if c['price'] < old_price else 'price_increased', old_price, c['price'])
            if c['price_basis'] != old_basis:
                change(lid, 'basis_changed', old_basis, c['price_basis'])
            if c['status'] != old_status:
                change(lid, 'status_changed', old_status, c['status'])
            con.execute('''UPDATE listings SET town=?, postal_town=?, in_area=?, url=?, address=?, postcode=?, price=?, price_text=?, price_basis=?, status=?,
                bedrooms=?, bathrooms=?, living_rooms=?, property_type=?, floor_area_sqm=?, last_seen=?, listed=1 WHERE listing_id=?''',
                (c['town'], c['postal_town'], int(c['in_area']), c['url'], c['address'], c['postcode'], c['price'], c['price_text'],
                 c['price_basis'], c['status'], c['bedrooms'], c['bathrooms'], c['living_rooms'], ptype, area, at, lid))
        con.execute('INSERT OR REPLACE INTO observations VALUES (?,?,?,?,?,?)', (run_id, lid, at, c['price'], c['price_basis'], c['status']))
    # A listing is "no longer listed" only when every town's results were read completely and it wasn't in any of them.
    if len(complete) == len(towns):
        for (lid,) in con.execute('SELECT listing_id FROM listings WHERE listed=1').fetchall():
            if lid not in seen:
                change(lid, 'no_longer_listed', None, None)
                con.execute('UPDATE listings SET listed=0 WHERE listing_id=?', (lid,))
    ok = not errors and len(seen) > 0
    con.execute('UPDATE runs SET finished=?, ok=?, pages=?, listings=?, new=?, changes=?, complete_towns=?, errors=? WHERE id=?',
                (now(), int(ok), f.count, len(seen), new, changed, ','.join(complete), json.dumps(errors), run_id))
    con.commit()
    con.close()
    return {'run': run_id, 'requests': f.count, 'listings': len(seen), 'new': new, 'changes': changed,
            'complete_towns': complete, 'errors': errors}

if __name__ == '__main__':
    a = argparse.ArgumentParser()
    a.add_argument('--db', default='collector/deeside.db')
    a.add_argument('--towns', default="Banchory,Torphins,Aboyne,Ballater,Kincardine O'Neil,Lumphanan")
    a.add_argument('--test-site', action='store_true', help='use the pretend website with fictional [TEST] listings (testsite.py)')
    o = a.parse_args()
    if o.test_site:  # day 1, 2, 3 ... of the test scenario, following the collections already in the database
        import os, testsite
        n = 0
        if os.path.exists(o.db):
            try:
                n = sqlite3.connect(o.db).execute('SELECT COUNT(*) FROM runs WHERE finished IS NOT NULL').fetchone()[0]
            except sqlite3.Error:
                n = 0
        Fetcher = testsite.fetcher_for(n + 1)
        print(f'TEST SITE (fictional listings), day {n + 1}')
    r = collect(o.db, [t.strip() for t in o.towns.split(',') if t.strip()])
    # Counts only: the workflow log is public, so no addresses or prices are printed.
    print(f"Run {r['run']}: {r['requests']} pages read, {r['listings']} listings, {r['new']} new, {r['changes']} changes recorded, "
          f"complete towns: {', '.join(r['complete_towns']) or 'none'}")
    for e in r['errors']:
        print('Problem:', e.split(':')[0])
    sys.exit(0 if r['listings'] else 1)
