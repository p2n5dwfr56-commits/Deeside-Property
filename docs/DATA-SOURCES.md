# Where the data comes from, and what it can't tell you

Researched 9 November 2026. "Unconfirmed" means I could not verify it myself: the provider's site was out of reach
from the build environment, or a test needs an account.

## Ways to collect listings automatically

| Method | Covers | Cost | Reliability | Allowed? | Verdict |
|---|---|---|---|---|---|
| **Portal alert emails to a dedicated inbox, read on a schedule** | ASPC, Rightmove, Zoopla, OnTheMarket, ESPC, S1homes, any agent that sends alerts | Free | Good. Emails arrive whenever the portals send them; the reader must follow layout changes (failures are reported) | Yes: they are your own emails | **Chosen** |
| Same, but the inbox is reached with Google sign-in (Gmail API) instead of an app password | as above | Free | Good, but needs a Google Cloud project and a consent screen, which has more parts to go wrong | Yes | Later upgrade if Google withdraws app passwords |
| Alerts forwarded to an email-receiving service (Cloudflare Email Routing, Postmark, Mailgun) | as above | A domain (about £10 a year) or a paid plan | Very good, near instant | Yes | Worth it only if checks every 3 hours are too slow |
| Personal Outlook.com / Hotmail inbox | as above | Free | Microsoft now requires its own modern sign-in for mail programs, so a simple password connection is not offered | Yes | Not chosen: a separate Gmail is simpler |
| Commercial data APIs (PaTMa, Homedata, PropertyData) | Depends on provider, see below | £20+ a month plus usage | Unknown for Deeside until tested | Yes, under their licence | **Test before paying** (below) |
| Portal APIs | none available to buyers | n/a | n/a | Rightmove's feed API is only for agents uploading listings; Zoopla closed its public API; none found for OnTheMarket or ASPC | Not available |
| Copying the portal websites ("scraping", or ready-made scraping services) | everything shown on the sites | varies | Fragile | **No**: Rightmove and Zoopla terms forbid it | Not used |
| Agent or solicitor data feeds | that agent's listings | usually free, by arrangement | Good | Yes, with the agent's permission | Can be added per agent on request |

### Commercial providers (to test before any subscription)

| Provider | What it says it offers | Price | Deeside coverage | Next step |
|---|---|---|---|---|
| **PaTMa** | Property Data API with current and historical asking prices for a postcode or drawn area, including a listing price-history endpoint. Its Deal Finder product added ASPC and ESPC listings in October 2025 | £20/month plus credits from £0.002 per call; 500-credit trial | **Unconfirmed** for the API (the ASPC/ESPC note is for Deal Finder) | Start the free trial, then I query Torphins, Banchory, Aboyne and Ballater and compare with what the alerts show |
| **Homedata** | Listing lifecycle events (added, price changed, under offer, sold STC, withdrawn, completed) with date, price and source; a daily "watch an area" by postcode | Pay as you go | **Unconfirmed** for Scotland | Same test with a trial key |
| **PropertyData** | Asking-price statistics for an area; says it has tracked asking-price changes nationally since 2020 | Subscription | Some endpoints exclude Scotland; mostly averages, not individual listings | Low priority |

If one of these covers the four towns properly, it can become a second source. It would add the listings an alert misses and give earlier price history. The app's design already allows for that.

## What each part of the information depends on

| | |
|---|---|
| **Collected automatically** (once alerts are set up) | New listings in alert emails. Asking price and pricing basis. Price changes when a listing reappears in an email. Status words a portal shows (Under offer, Sold STC, Closing date). Listing links and IDs. Bedrooms and type when the email gives them. The date each was observed. Which source said so. |
| **Only through a paid API** (if coverage is confirmed) | Price history from before this app first saw a listing. A complete daily list of everything for sale, which is the only reliable way to notice withdrawals. Fuller details such as floor area. |
| **Needs you** | Setting up the alerts once. Saying whether a flagged look-alike is the same property. Confirming a completed sale or withdrawal. Home Report valuations. Permission to show photos. |
| **Not currently obtainable** | Completed sale prices as they happen (Registers of Scotland data is paid and published later). Reductions smaller than 2% through Rightmove alerts, because Rightmove only re-sends a reduced property at 2% or more (other portals may still report them). Listings beyond the limit an email shows: a Rightmove alert shows at most 14 properties, so use "instant" alerts to keep each email small. Status changes for properties you have not saved on the portal. |

**A listing that stops appearing is never treated as sold.** Alert emails only mention new and changed listings,
so the app flags such properties as "not mentioned recently" and leaves their status as it was.

## Sources
- [Rightmove: how property alerts work](https://customerfaq.rightmove.co.uk/support/solutions/articles/7000098933-how-the-property-alerts-work) · [Rightmove: reductions of 2% or more go back out in alerts](https://customerfaq.rightmove.co.uk/support/solutions/articles/7000055339/) · [Rightmove feed API (agents)](https://api-docs.rightmove.co.uk/docs/property-feed-api-product/1/overview)
- [Zoopla: email alerts and saved searches](https://help.zoopla.co.uk/hc/en-gb/sections/360001666418-Property-email-alerts-and-Saved-searches) · [Zoopla API terms (public API withdrawn)](https://developer.zoopla.co.uk/API_terms_of_use)
- [ASPC Property Search app (saved-search email alerts)](https://apps.apple.com/app/id493344117)
- [PaTMa Property Data API](https://www.patma.co.uk/property-data-api/) · [PaTMa API reference](https://www.patma.co.uk/docs/api/) · [PaTMa Deal Finder changes (ASPC/ESPC)](https://www.patma.co.uk/docs/deal-finder/changelog/)
- [Homedata](https://homedata.co.uk/) · [PropertyData API](https://propertydata.co.uk/api)
- [Google: winding down less secure sign-in for mail apps](https://workspaceupdates.googleblog.com/2023/09/winding-down-google-sync-and-less-secure-apps-support.html)
