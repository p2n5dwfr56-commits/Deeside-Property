#!/usr/bin/env python3
"""Demonstration and test of the comparison, with REPRESENTATIVE TEST DATA (fictional addresses, marked [TEST]).
Three daily collections are simulated from search-results pages built in the same layout as the agent's website.
Run:  python3 collector/test_collect.py      (no internet needed)"""
import os, sqlite3, sys, tempfile
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import collect, report

def card(pid, status, basis, address, price, beds):
    return (f'<div><a href="/properties/property-detail?propertyId={pid}"\n tabindex="-1" aria-hidden="true"></a>'
            f'<div class="flex justify-between items-center mb-4 font-semibold"> <p>{status}</p> <p>{basis}</p> </div>'
            f'<h3 class="text-grey-dark"> {address} </h3> <p class="font-semibold"> &#xA3;{price:,} </p>'
            f'<ul><li>{beds} Bedrooms</li><li>1 Living Rooms</li><li>1 Bathrooms</li></ul></div>')

DETAIL = '<div>Type</div><div>:</div><div>house</div><div>Dimensions</div><div>:</div><div>{a} m²</div><div>{t}</div>'
L = {  # id: (town, address, type, floor area)
    'T1': ('Banchory', '[TEST] 1 Example Road, Banchory, AB31 1AA', 'Detached', 140),
    'T2': ('Banchory', '[TEST] 2 Sample Crescent, Banchory, AB31 1AB', 'Semi Detached', 95),
    'T3': ('Torphins', '[TEST] 3 Demo Place, Torphins, AB31 4AA', 'Bungalow', 88),
    'T4': ('Aboyne', '[TEST] Flat 4, Model Court, Aboyne, AB34 5AA', 'Flat', 62),
    'T5': ('Ballater', '[TEST] Test Cottage, Ballater, AB35 5AA', 'Cottage', 70),
    'T6': ('Banchory', '[TEST] 6 New Build Way, Banchory, AB31 1AC', 'Detached', 160),
}

def day(listings):
    """listings: {id: (status, price)} -> fake website returning one results page per town and each listing's page."""
    pages = {}
    for pid, (status, price) in listings.items():
        town, addr, _, _ = L[pid]
        pages.setdefault(town, []).append(card(pid, status, 'Offers Over', addr, price, 3))
    class Fake:
        def __init__(self): self.count = 0
        def get(self, url):
            self.count += 1
            if 'propertyId=' in url:
                _, _, t, a = L[url.split('propertyId=')[1]]
                return DETAIL.format(a=a, t=t)
            town = collect.urllib.parse.unquote(url.split('address=')[1].split('&')[0])
            return '<html>' + ''.join(pages.get(town, [])) + '</html>'
    collect.Fetcher = Fake

TOWNS = ['Banchory', 'Torphins', 'Aboyne', 'Ballater']
db = os.path.join(tempfile.mkdtemp(), 'demo.db')

day({'T1': ('For Sale', 350000), 'T2': ('For Sale', 225000), 'T3': ('For Sale', 240000), 'T4': ('For Sale', 120000), 'T5': ('For Sale', 199000)})
r1 = collect.collect(db, TOWNS)
day({'T1': ('For Sale', 335000), 'T2': ('Under Offer', 225000), 'T3': ('For Sale', 245000), 'T4': ('For Sale', 120000), 'T6': ('For Sale', 425000)})
r2 = collect.collect(db, TOWNS)
day({'T1': ('For Sale', 335000), 'T2': ('For Sale', 225000), 'T3': ('For Sale', 245000), 'T4': ('For Sale', 120000), 'T5': ('For Sale', 189000), 'T6': ('For Sale', 425000)})
r3 = collect.collect(db, TOWNS)

print(report.report(db, every=True))
con = sqlite3.connect(db)
kinds = lambda run: sorted(k for (k,) in con.execute('SELECT kind FROM changes WHERE run_id=?', (run,)))
assert kinds(1) == ['new_listing'] * 5, kinds(1)
assert kinds(2) == ['new_listing', 'no_longer_listed', 'price_increased', 'price_reduced', 'status_changed'], kinds(2)
assert kinds(3) == ['price_reduced', 'relisted', 'status_changed'], kinds(3)
row = con.execute("SELECT price, status, property_type, floor_area_sqm FROM listings WHERE listing_id='T1'").fetchone()
assert row == (335000, 'For Sale', 'Detached', 140.0), row
print('\nAll checks passed.')
