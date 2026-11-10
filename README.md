# Deeside Property Watch

## Simple collector (current)
A small Python script (`collector/collect.py`, standard library only) reads the **public property search of Aberdein
Considine** (allowed by its robots.txt) for Banchory, Torphins, Aboyne, Ballater, Kincardine O'Neil and Lumphanan:
address, asking price and basis, status, bedrooms, floor area, property type and the listing link. Each run saves to a
SQLite database and records, against the previous run: new listings, price reductions and increases, Under Offer and
back-on-the-market, and listings that disappear (flagged, never assumed sold).
- Run by hand: GitHub **Actions → Collect listings → Run workflow**; it also runs daily. Or on any computer with Python:
  `python3 collector/collect.py` then `python3 collector/report.py` to see what changed.
- Test with representative data (no internet): `python3 collector/test_collect.py`.
- The website shows the results (`collector/export.py` makes its data file). In GitHub the database and data file are
  encrypted with the `DPW_PASSPHRASE` secret, because the repository is public.
- **ASPC is not used yet.** Its prices and statuses come from `api.aspc.co.uk`, whose robots.txt forbids automated access,
  and its terms require ASPC's written consent to copy material from the site.

The email-alert pipeline described below was never connected; its schedule is switched off.

A private service that watches homes for sale around Torphins, Banchory, Aboyne, Ballater, Kincardine O'Neil and
Lumphanan. It collects the property alerts that ASPC, Rightmove, Zoopla, OnTheMarket and agents send. Every 3 hours,
without you, it records:
- every new listing;
- every price change;
- every status change (Under offer, closing date, back on the market).

Each morning the dashboard shows what has changed.

It records **asking prices**, not sold prices or valuations. A reduction in asking price is not by itself evidence
that local values are falling.

```
 Portals & agents ──alert emails──▶ dedicated Gmail inbox
                                          │  read-only, every 3 hours
                                GitHub Actions: worker/run.ts ──▶ Supabase database ◀── website (Netlify)
                                (match, record history, alerts)    (private, versioned)     Mac & iPhone, private login
```

- **Setup steps (one time):** [docs/SETUP.md](docs/SETUP.md)
- **Data sources compared, and what can't be collected:** [docs/DATA-SOURCES.md](docs/DATA-SOURCES.md)

## What each run does
1. Reads new emails in the alert inbox, without changing the inbox, plus the simulated test mailbox while test mode is on.
2. Recognises the source from the sender or the listing links, and reads each listing: address, town, postcode, price,
   earlier price, status wording, bedrooms, type and listing link.
3. Matches it to a property already recorded:
   - by the portal's listing ID or link;
   - or by a building address with a house number or name.
   Look-alikes that can't be matched with confidence go to **Possible duplicates to check** and are not merged. You decide.
4. Records every change with the date observed, the source, the email it came from, and how certain it is: reported by
   the source, detected by comparison, entered by you, or assumed.
5. Never lets an older email overwrite newer facts. Never processes the same email twice. Never treats a listing that
   stops appearing as sold.
6. Records the run: emails read, properties created and updated, failures. It also tracks each source's health and warns
   when a source goes quiet.
7. Raises alerts for:
   - price reductions;
   - watched properties going under offer;
   - properties back on the market;
   - new matches for your criteria;
   - properties long on the market;
   - possible duplicates;
   - collection failures.
   It can also email you a summary.

## The website
- **Dashboard:**
  - the last automatic check;
  - **What's changed** since your last visit;
  - headline figures, filters and property cards.
- **Monitoring:**
  - every source's status (delivering, gone quiet, problem, not set up);
  - recent runs and notifications;
  - the duplicate review queue;
  - missing information;
  - listings not mentioned recently.
- **Property page:** price graph, full timeline with source and certainty, links to every portal listing, notes, watchlist.
- **Analysis, Alerts, Settings & data:** as before. Manual entry and spreadsheet import remain as a fallback.

Without the cloud settings, the website runs as an **offline preview** using browser storage.

## Test data
`worker/fixtures/simulated/` holds **labelled simulated emails**: `[SIMULATED TEST]`, fictional properties, listing numbers
starting 999. They are delivered over two days of scheduled runs to demonstrate the pipeline. Properties from them are
marked "Simulated test" everywhere and can be removed in one click. Fictional "Example" properties are separate and
also removable.

## For whoever maintains it
```
npm install
npm test                                  # 37 unit tests, including simulated monitoring runs
npm run build && npm run e2e              # 30 browser checks (needs Playwright)
npm run monitor -- --trigger manual       # one run; uses data/state.json unless Supabase secrets are set
npm run dev                               # website, offline preview
```
- `src/domain/`: engine (matching and history), portals (email reading), pipeline (one run), store, stats. Plain TypeScript.
- `worker/`: the scheduled job: mailbox (IMAP read-only, simulated), store (Supabase or file), summary email.
- `src/ui/`, `src/cloud.ts`: the website and its login and database connection.
- `supabase/schema.sql`: tables and row-level security. Only emails in `allowed_users` can read or change data.
- Secrets live only in GitHub Actions secrets and Netlify settings. The website contains only the public Supabase address
  and publishable key.
