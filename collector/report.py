#!/usr/bin/env python3
"""Print what changed, in plain words: python3 collector/report.py [--db collector/deeside.db] [--run N | --all]"""
import argparse, sqlite3

def money(v):
    return f'£{int(v):,}' if v not in (None, '') else '?'

def describe(kind, old, new):
    return {'new_listing': lambda: f'New listing at {money(new)}',
            'price_reduced': lambda: f'Price reduced {money(old)} → {money(new)} ({money(int(old) - int(new))} less)',
            'price_increased': lambda: f'Price increased {money(old)} → {money(new)}',
            'status_changed': lambda: f'Status {old} → {new}' + (' (back on the market)' if (old or '').lower().startswith(('under', 'sold')) and (new or '').lower() == 'for sale' else '')
                              + (' (the agent’s label; not confirmed as a completed sale)' if 'sold' in (new or '').lower() else ''),
            'basis_changed': lambda: f'Pricing basis {old} → {new}',
            'no_longer_listed': lambda: 'No longer listed (not in any town’s results; not confirmed as sold or withdrawn)',
            'relisted': lambda: 'Listed again'}.get(kind, lambda: kind)()

def report(db, run=None, every=False):
    con = sqlite3.connect(db)
    runs = con.execute('SELECT id, finished, listings, new, changes FROM runs WHERE finished IS NOT NULL ORDER BY id').fetchall()
    if not runs:
        return 'No collections yet.'
    pick = [r for r in runs if every or r[0] == (run or runs[-1][0])]
    out = []
    for rid, fin, n, new, ch in pick:
        out.append(f'Collection {rid} ({(fin or "")[:16].replace("T", " ")}): {n} listings, {ch} changes')
        for addr, kind, old, new_ in con.execute('SELECT l.address || CASE WHEN l.in_area=0 THEN " [near the six towns: " || l.town || "]" ELSE "" END, c.kind, c.old_value, c.new_value FROM changes c JOIN listings l '
                                                 'USING (listing_id) WHERE c.run_id=? ORDER BY c.kind, l.address', (rid,)):
            out.append(f'  • {addr}: {describe(kind, old, new_)}')
    return '\n'.join(out)

if __name__ == '__main__':
    a = argparse.ArgumentParser()
    a.add_argument('--db', default='collector/deeside.db'); a.add_argument('--run', type=int); a.add_argument('--all', action='store_true')
    o = a.parse_args()
    print(report(o.db, o.run, o.all))
