# Deeside Property Watch

A private research tool for tracking residential property for sale around Torphins, Banchory, Aboyne, Ballater,
Kincardine O'Neil and Lumphanan. It records every asking price and status change, so you can see what has been
reduced, what has gone under offer, and what has come back on the market.

**What it is not:** it does not show sold prices or valuations. Every figure is an *asking price* the app has recorded.
A reduction in asking price is not by itself evidence that local values are falling.

## Status of this version (first release: stages B, C and E)

| Works now | Not yet |
|---|---|
| Add and edit properties by hand; "Unknown" for anything not supplied | Private login and use across devices (needs a Supabase account: see below) |
| CSV import with preview, per-row problems, template download | Email alerts (in-app alerts only for now) |
| Property-alert email import (paste or .eml) with preview | Email reader tuned to a real ASPC alert (needs a sample) |
| Full history: new, reduced/increased, closing date, under offer, missives, sold (confirmed), withdrawn, returned, relisted | Any automatic collection from websites (stage D: only with permission) |
| No duplicates: matched by listing ID, link, or normalised address and postcode | Postcode-accurate distances (uses approximate town centres) |
| "Complete list" imports mark missing listings **No longer seen (unverified)**, never sold | |
| Dashboard, filters, property cards, price graph, timeline, notes, watchlist | |
| Analysis: by town, by price range, inventory over time, reductions | |
| Alerts: reductions, watched under offer, back on market, new matches, long on market | |
| CSV export (properties, full history), JSON backup and restore | |
| Fictional example data, labelled "Example", removable in one click | |

Data is saved in the browser on the device you use (it survives refreshes and restarts). Download a backup from
**Settings & data** now and then until online sync is set up.

## Stage A: where the data can come from

| Source | Can it be used? | How this app uses it |
|---|---|---|
| **ASPC** (Aberdeen Solicitors Property Centre) | No public data feed or API found. Its website terms could not be read automatically; contact centre@aspc.co.uk / 01224 632949 to ask about a feed. | You receive ASPC saved-search alert emails and import them (paste or .eml). The app never logs in to or copies the ASPC website. |
| **Selling agents' own websites** | No standard feed. Some agents can send a CSV or XML feed on request. | CSV import; any agreed feed can be added in stage D. |
| **Rightmove** | No public API; its terms prohibit automated copying. | Not used. Manual entry of what you see is fine. |
| **Zoopla** | Its public API was withdrawn. | Not used. |
| **Scottish EPC register** | Open data, published quarterly under the Open Government Licence (address fields carry Royal Mail copyright). | Candidate for stage D: look up EPC rating and floor area by address. |
| **Registers of Scotland** (sold prices) | Individual sale prices need a paid ScotLIS search or a data licence (data@ros.gov.uk). Free statistics are area averages only. | Not used. "Sold (confirmed)" is only set by you or by an explicit "sold" from a source. |
| **Home Reports** | Available from the selling agent on request; not open data. | Entered by you only, never estimated. |

Sources: [ASPC](https://www.sspc.co.uk/centre/aspc) ·
[Zoopla API terms](https://developer.zoopla.co.uk/API_terms_of_use) ·
[Scottish EPC data](https://data.gov.scot/dataset/domestic_energy_performance_certificates___dataset_to_q1_2026) ·
[Registers of Scotland statistics](https://www.ros.gov.uk/data-and-statistics/property-market-statistics/house-price-map-visual) ·
[ASPC company record](https://find-and-update.company-information.service.gov.uk/company/SC065531)

Rules the app follows: no scraping, no logging in on your behalf, no getting round CAPTCHAs or paywalls, photos
shown only when you tick "I have permission to display this photo", and no automatic check is reported unless it
actually ran and returned valid data.

## How it works (for whoever maintains it)

- `src/domain/` holds the plain-TypeScript logic, with no screen code: tracking engine (`engine.ts`), CSV and email readers,
  statistics, storage, example data. Unit tests are in `engine.test.ts`.
- `src/ui/` holds the React screens. Pages are plain `#name` links (`#import`, `#p-<id>`).
- Nothing is ever deleted from a property's history. Each change is an event with old and new values, date and source.
- Storage is browser localStorage behind `load`/`save` in `store.ts`. Supabase replaces those two calls.

```
npm install
npm test          # 19 unit tests
npm run build
npm run e2e       # 30 browser checks (acceptance list, desktop, tablet and phone layouts)
npm run dev       # local development server
```

## Deploying

**Netlify (hosting, free tier):** connect this repository in Netlify. `netlify.toml` sets the build. No keys
are needed. The site sends `noindex` so search engines don't list it.

**Supabase (private login and sync, free tier), next step:** needs a Supabase project created in your own account.
Only the public "anon" key goes in the website. It is designed to be public and is protected by row-level security, so each
login sees only its own data. Any private keys (email service, data feeds) belong in Netlify or Supabase
settings, never in the code.
