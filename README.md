# Deeside Property Watch

Watches homes for sale in **Torphins, Banchory, Aboyne, Ballater, Kincardine O'Neil and Lumphanan** (and the villages
next to them) and records how each listing changes over time. It records **asking prices**, not sold prices or
valuations.

Each day a small Python script reads the public property search of one estate agent, saves every listing to a SQLite
database, compares it with the previous day and records:
- new listings;
- asking-price reductions and increases;
- status changes: Under Offer, Closing date, back on the market (an agent's "Sold" is kept as the agent's word and is
  **not** treated as a completed sale);
- listings that disappear from the agent's results (flagged; never assumed sold or withdrawn).

For each listing it keeps the address, the village or town (from the address, so Drumoak or Durris are not counted as
Banchory), the asking price and basis (e.g. Offers over), status, bedrooms, floor area, property type and the link to
the original listing. The website shows the listings, each one's price and status history, and what has changed.

## Setup (once)
In the GitHub repository:
1. **Settings → Secrets and variables → Actions → New repository secret**: name `DPW_PASSPHRASE`, value any
   passphrase you choose. It encrypts the database and the website's data, because this repository is public.
2. **Settings → Pages → Build and deployment → Source: GitHub Actions**.

Then **Actions → Collect listings → Run workflow**. The website is at
https://p2n5dwfr56-commits.github.io/Deeside-Property/ (enter the passphrase; you can tick "Remember on this device").
The collection then runs by itself every day at about 07:23 UK time.

## Where the data comes from
**Aberdein Considine** (property.acandco.com), whose robots.txt allows its property search and listing pages. The
collector identifies itself, waits 4 seconds between pages, checks robots.txt on every run and only reads public
pages. Only this agent's listings are covered.

**ASPC is not used**: its listing pages do not include prices or statuses; these come from `api.aspc.co.uk`, whose
robots.txt forbids automated access, and ASPC's terms require its written consent to copy material from its site.
ASPC could be added if it gives that consent. Other agents whose robots.txt allows their property pages (Northwood,
Anderson Bain, Peterkins) could be added as further sources.

## How it works
- `collector/collect.py`: reads the search results for the six towns (every page), each new listing's own page once
  (type and floor area), saves to SQLite and records the changes. Python 3 standard library only.
- `collector/report.py`: prints what changed, in plain words.
- `collector/export.py`: turns the database into the website's data file.
- `.github/workflows/collect.yml`: the daily run. The database is stored encrypted on the branch `collector-data`
  (one commit per collection, so earlier versions are kept); each run loads the previous database first.
- The website is the existing app (`src/`), built in "collected" mode and published with GitHub Pages.

On any computer with Python 3 you can also run `python3 collector/collect.py` and `python3 collector/report.py`.

## Checking it
- `python3 collector/test_collect.py`: three simulated days with fictional `[TEST]` listings; checks every kind of
  change, place names and the handling of "Sold". Runs on every change (Tests workflow).
- On the development branch `claude/simple-collector`, the "Collect listings" workflow runs the full process against a
  pretend website with fictional `[TEST]` listings (separate branch `collector-data-test`, public test passphrase)
  and opens the built website in a browser to check the recorded changes are shown.
- `npm test` and `npm run build` check the website code.
