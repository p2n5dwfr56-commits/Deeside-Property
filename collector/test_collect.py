#!/usr/bin/env python3
"""Demonstration and test of the comparison with REPRESENTATIVE TEST DATA (collector/testsite.py: fictional [TEST]
listings). Three daily collections; checks every kind of change. Run: python3 collector/test_collect.py (no internet)."""
import os, sqlite3, sys, tempfile
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import collect, export, report, testsite

TOWNS = ['Banchory', 'Torphins', 'Aboyne', 'Ballater', "Kincardine O'Neil", 'Lumphanan']
db = os.path.join(tempfile.mkdtemp(), 'demo.db')
for day in (1, 2, 3):
    collect.Fetcher = testsite.fetcher_for(day)
    collect.collect(db, TOWNS)
print(report.report(db, every=True))

con = sqlite3.connect(db)
kinds = lambda run: sorted(k for (k,) in con.execute('SELECT kind FROM changes WHERE run_id=?', (run,)))
assert kinds(1) == ['new_listing'] * 6, kinds(1)
assert kinds(2) == ['new_listing', 'no_longer_listed', 'price_increased', 'price_reduced', 'status_changed', 'status_changed'], kinds(2)
assert kinds(3) == ['price_reduced', 'price_reduced', 'relisted', 'status_changed'], kinds(3)
assert con.execute("SELECT price, status, property_type, floor_area_sqm, town, in_area FROM listings WHERE listing_id='T1'").fetchone() \
    == (335000, 'For Sale', 'Detached', 140.0, 'Banchory', 1)
assert con.execute("SELECT town, postal_town, in_area FROM listings WHERE listing_id='T3'").fetchone() == ('Torphins', 'Banchory', 1)
assert con.execute("SELECT town, postal_town, in_area FROM listings WHERE listing_id='T7'").fetchone() == ('Drumoak', 'Banchory', 0)
d = export.export(db)
by = {p['id']: p for p in d['properties']}
assert by['T4']['status'] == 'under_offer', by['T4']['status']          # the agent's "Sold" is not a confirmed sale
assert by['T7']['town'] == 'Drumoak' and by['T1']['originalAskingPrice'] == 350000 and by['T1']['askingPrice'] == 335000
assert any(e['type'] == 'price_reduction' and e['propertyId'] == 'T1' for e in d['events'])
print('\nAll checks passed.')
