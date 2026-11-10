#!/usr/bin/env python3
"""Turn the SQLite database into the Deeside Property Watch app's data file (same shape as a backup), so the existing
interface shows the collected listings and their change history.

Usage: python3 collector/export.py [--db collector/deeside.db] [--out collected.json]
"""
import argparse, json, os, sqlite3, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import collect

# The agent's own status words are kept unchanged in the database. For the app they are mapped to its statuses, but
# an agent's "Sold" / "Sold STC" is NOT treated as a completed sale (that needs confirmation, e.g. by you): it is shown
# as Under offer, and the event keeps the agent's exact wording.
STATUS = {'for sale': 'for_sale', 'under offer': 'under_offer', 'closing date': 'closing_date', 'closing date set': 'closing_date',
          'sold': 'under_offer', 'sold stc': 'under_offer', 'sold subject to contract': 'under_offer', 'let agreed': 'under_offer',
          'withdrawn': 'for_sale'}
BASIS = {'offers over': 'Offers over', 'fixed price': 'Fixed price', 'offers around': 'Offers around',
         'offers in the region of': 'Offers in the region of', 'guide price': 'Guide price', 'price on application': 'Price on application'}
TYPE_WORDS = [('semi', 'Semi-detached'), ('detached', 'Detached'), ('terrace', 'Terraced'), ('bungalow', 'Bungalow'),
              ('cottage', 'Cottage'), ('flat', 'Flat'), ('apartment', 'Flat'), ('maisonette', 'Flat'), ('plot', 'Plot / land'),
              ('land', 'Plot / land'), ('house', 'Other'), ('villa', 'Detached')]

def status(s, listed=True):
    if not listed:
        return 'not_seen'
    return STATUS.get((s or '').strip().lower(), 'for_sale')

def ptype(t, address):
    t = (t or '').lower()
    for w, v in TYPE_WORDS:
        if w in t:
            return v
    return 'Plot / land' if 'plot' in (address or '').lower() else 'Unknown'

def export(db_path):
    con = sqlite3.connect(db_path)
    con.executescript(collect.SCHEMA)  # an empty database (no source set up yet) exports as no properties
    con.row_factory = sqlite3.Row
    props, events = [], []
    first_price = {r['listing_id']: r['price'] for r in con.execute(
        'SELECT o.listing_id, o.price FROM observations o JOIN (SELECT listing_id, MIN(run_id) r FROM observations GROUP BY listing_id) f '
        'ON o.listing_id=f.listing_id AND o.run_id=f.r')}
    for r in con.execute('SELECT * FROM listings ORDER BY first_seen, listing_id'):
        props.append({
            'id': r['listing_id'], 'isDemo': False, 'address': r['address'] or r['listing_id'], 'town': r['town'],  # the actual village or town, from the address
            'postcode': r['postcode'], 'askingPrice': r['price'], 'originalAskingPrice': first_price.get(r['listing_id'], r['price']),
            'pricingBasis': BASIS.get((r['price_basis'] or '').lower(), 'Unknown'), 'bedrooms': r['bedrooms'], 'bathrooms': r['bathrooms'],
            'propertyType': ptype(r['property_type'], r['address']), 'floorAreaSqm': r['floor_area_sqm'], 'landSize': None, 'epc': None,
            'homeReportValuation': None, 'agent': r['source'],
            'sources': [{'source': r['source'], 'url': r['url'], 'listingId': r['listing_id'], 'firstSeen': r['first_seen'][:10], 'lastSeen': r['last_seen'][:10]}],
            'dateFirstAdvertised': None, 'dateFirstObserved': r['first_seen'][:10], 'lastVerified': r['last_seen'][:10],
            'status': status(r['status'], r['listed']), 'closingDate': None, 'photoUrl': None, 'photoPermitted': False,
            'notes': '', 'watched': False})
    for c in con.execute('SELECT c.*, l.price lp, l.source src FROM changes c JOIN listings l USING (listing_id) ORDER BY c.id'):
        k, old, new = c['kind'], c['old_value'], c['new_value']
        e = {'id': f"c{c['id']}", 'propertyId': c['listing_id'], 'date': c['at'][:10], 'recordedAt': c['at'], 'priceBefore': None,
             'priceAfter': None, 'basisBefore': None, 'basisAfter': None, 'statusBefore': None, 'statusAfter': None, 'changes': [],
             'origin': f"Collector run {c['run_id']}", 'importId': None, 'source': c['src'], 'confidence': 'detected',
             'evidence': 'myASPC alert email' if c['src'] == 'ASPC' else 'Agent website search results'}
        if k == 'new_listing':
            e.update(type='listed', priceAfter=int(new) if new else None, confidence='reported')
        elif k in ('price_reduced', 'price_increased'):
            e.update(type='price_reduction' if k == 'price_reduced' else 'price_increase', priceBefore=int(old), priceAfter=int(new))
        elif k == 'status_changed':
            sb, sa = status(old), status(new)
            e.update(statusBefore=sb, statusAfter=sa, confidence='reported',
                     type={'under_offer': 'under_offer', 'closing_date': 'closing_date'}.get(sa,
                          'returned_to_market' if sb in ('under_offer', 'closing_date') else 'details_changed'),
                     changes=[{'field': "agent's status", 'before': old, 'after': new}],
                     evidence=f"Agent's listing changed from \u201c{old}\u201d to \u201c{new}\u201d" + (' (not confirmed as a completed sale)' if 'sold' in (new or '').lower() else ''))
        elif k == 'basis_changed':
            e.update(type='basis_change', basisBefore=BASIS.get((old or '').lower(), 'Unknown'), basisAfter=BASIS.get((new or '').lower(), 'Unknown'))
        elif k == 'no_longer_listed':
            e.update(type='not_seen', statusAfter='not_seen', confidence='assumed', evidence='Not in any town’s complete search results')
        elif k == 'relisted':
            e.update(type='relisted', confidence='reported')
        else:
            continue
        events.append(e)
    runs = []
    for r in con.execute('SELECT * FROM runs WHERE finished IS NOT NULL ORDER BY id DESC LIMIT 60'):
        runs.append({'id': f"run{r['id']}", 'startedAt': r['started'], 'finishedAt': r['finished'], 'trigger': 'schedule',
                     'mailbox': 'myASPC alert emails' if r['complete_towns'] == 'email' else 'Aberdein Considine website', 'ok': bool(r['ok']), 'messagesChecked': r['pages'] or 0, 'messagesNew': 0,
                     'listingsRead': r['listings'] or 0, 'created': r['new'] or 0, 'updated': r['changes'] or 0, 'unchanged': 0,
                     'flagged': 0, 'errors': json.loads(r['errors'] or '[]')})
    return {'version': 2, 'properties': props, 'events': events, 'imports': [], 'alerts': [], 'settings': {}, 'reviews': [],
            'messages': [], 'runs': runs, 'sources': {}, 'simulation': {'startedAt': None}}

if __name__ == '__main__':
    a = argparse.ArgumentParser()
    a.add_argument('--db', default='collector/deeside.db')
    a.add_argument('--out', default='collected.json')
    o = a.parse_args()
    d = export(o.db)
    json.dump({'app': 'Deeside Property Watch', 'exportedAt': d['runs'][0]['finishedAt'] if d['runs'] else None, 'db': d}, open(o.out, 'w'))
    print(f"Exported {len(d['properties'])} properties and {len(d['events'])} changes")
