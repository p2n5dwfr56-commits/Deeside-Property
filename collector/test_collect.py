"""Offline test: two collection runs from saved pages, the second with a price cut, an under-offer change and a listing removed."""
import os, sqlite3, sys, tempfile
sys.path.insert(0, os.path.dirname(__file__))
import collect

PAGES = os.environ.get('SAMPLES', os.path.join(os.path.dirname(__file__), 'samples'))
def load(n): return open(os.path.join(PAGES, n), encoding='utf-8').read()

def run(db, pages):
    class Fake:
        def __init__(self): self.count = 0
        def get(self, url):
            self.count += 1
            if 'property-detail' in url: return pages['detail']
            return pages.get(url.split('address=')[1].split('&')[0], '<html></html>')
    collect.Fetcher = Fake
    return collect.collect(db, ['Banchory', 'Torphins'])

banchory, torphins, detail = load('banchory.html'), load('torphins.html'), load('detail.html')
db = os.path.join(tempfile.mkdtemp(), 't.db')
r1 = run(db, {'Banchory': banchory, 'Torphins': torphins, 'detail': detail})
assert r1['listings'] == 14 and r1['new'] == 14, r1
b2 = banchory.replace('&#xA3;135,000', '&#xA3;129,000')                      # 25 Tillybrake Gardens reduced
b2 = b2.replace('<p>For Sale</p>\n', '<p>Under Offer</p>\n', 1) if '<p>For Sale</p>\n' in b2 else b2
t2 = torphins[:torphins.index('propertyId=BCH230167') - 60] + '</html>'           # the Torphins plot disappears
r2 = run(db, {'Banchory': b2, 'Torphins': t2, 'detail': detail})
con = sqlite3.connect(db)
kinds = [k for (k,) in con.execute('SELECT kind FROM changes WHERE run_id=2 ORDER BY id')]
print('run 2 changes:', kinds)
assert 'price_reduced' in kinds and 'status_changed' in kinds and 'no_longer_listed' in kinds, kinds
row = con.execute("SELECT price, status, property_type FROM listings WHERE listing_id='BCH260176'").fetchone()
assert row[0] == 129000, row
r3 = run(db, {'Banchory': b2, 'Torphins': torphins, 'detail': detail})
kinds3 = [k for (k,) in con.execute('SELECT kind FROM changes WHERE run_id=3')]
assert kinds3 == ['relisted'], kinds3
print('OK', r1, r2['changes'], 'changes in run 2;', kinds3)
