#!/bin/bash
# One-off check of a real collection, readable only by the reviewer (Claude session that holds the private key):
# collects from the real website into a fresh database, writes every listing and every results page read to CSV files,
# and encrypts them with tools/verify/reviewer-public-key.pem (the repository is public, so nothing is readable here).
set -e
python3 collector/collect.py --db /tmp/verify.db
python3 - <<'PY'
import csv, sqlite3
c = sqlite3.connect('/tmp/verify.db')
for name, q in [('listings', 'SELECT listing_id, address, town, postal_town, in_area, searched_town, price, price_text, price_basis, status, bedrooms, property_type, floor_area_sqm, url FROM listings ORDER BY town, address'),
                ('pages', 'SELECT town, page, cards, fresh, has_next FROM pages ORDER BY rowid')]:
    cur = c.execute(q); w = csv.writer(open(f'/tmp/{name}.csv', 'w', newline='')); w.writerow([d[0] for d in cur.description]); w.writerows(cur)
PY
tar -C /tmp -czf /tmp/verify.tgz listings.csv pages.csv
openssl rand -out /tmp/k.bin 32
openssl enc -aes-256-cbc -pbkdf2 -md sha256 -salt -in /tmp/verify.tgz -out verify.tgz.enc -pass file:/tmp/k.bin
openssl pkeyutl -encrypt -pubin -inkey tools/verify/reviewer-public-key.pem -pkeyopt rsa_padding_mode:oaep -in /tmp/k.bin -out verify.key.enc
