// Deeside Property Watch: the data model.
// Rule throughout: never invent information. Anything not supplied stays null and is shown as "Unknown".

/** Marketing status, using Scottish practice. */
export type Status =
  | 'for_sale'        // advertised for sale
  | 'closing_date'    // a closing date for offers has been set
  | 'under_offer'     // an offer has been accepted, missives not yet concluded
  | 'missives'        // missives concluded: a binding contract, sale not yet completed
  | 'sold'            // completed sale, confirmed (by you or an explicit "sold" from a source)
  | 'withdrawn'       // withdrawn from advertising, confirmed
  | 'not_seen';       // no longer seen in a complete listing import: UNVERIFIED, never treated as sold

export const STATUS_LABEL: Record<Status, string> = {
  for_sale: 'For sale',
  closing_date: 'Closing date set',
  under_offer: 'Under offer',
  missives: 'Missives concluded',
  sold: 'Sold (confirmed)',
  withdrawn: 'Withdrawn',
  not_seen: 'No longer seen (unverified)',
};

/** Statuses that count as "on the market" for inventory figures. */
export const ACTIVE: Status[] = ['for_sale', 'closing_date'];

export type PricingBasis = 'Offers over' | 'Fixed price' | 'Offers around' | 'Offers in the region of' | 'Guide price' | 'Price on application' | 'Unknown';
export const BASES: PricingBasis[] = ['Offers over', 'Fixed price', 'Offers around', 'Offers in the region of', 'Guide price', 'Price on application', 'Unknown'];

export type PropertyType = 'Detached' | 'Semi-detached' | 'Terraced' | 'Flat' | 'Bungalow' | 'Cottage' | 'Plot / land' | 'Other' | 'Unknown';
export const TYPES: PropertyType[] = ['Detached', 'Semi-detached', 'Terraced', 'Flat', 'Bungalow', 'Cottage', 'Plot / land', 'Other', 'Unknown'];

/** Where a listing was seen. One property can have several (e.g. ASPC and an agent's own site). */
export interface SourceRef {
  source: string;          // e.g. "ASPC", "Agent website", "Manual"
  url: string | null;
  listingId: string | null;
  firstSeen: string;       // ISO date this source first showed it
  lastSeen: string;        // ISO date this source last showed it
}

export interface Property {
  id: string;
  isDemo: boolean;         // not real data (example or simulated test), always labelled as such
  demoKind?: 'example' | 'simulated';
  address: string;
  town: string;
  postcode: string | null;
  askingPrice: number | null;
  originalAskingPrice: number | null;
  pricingBasis: PricingBasis;
  bedrooms: number | null;
  bathrooms: number | null;
  propertyType: PropertyType;
  floorAreaSqm: number | null;
  landSize: string | null;            // free text, e.g. "0.5 acre", "large rear garden"
  epc: string | null;                 // A to G
  homeReportValuation: number | null; // only from authorised sources; never estimated
  agent: string | null;
  sources: SourceRef[];
  dateFirstAdvertised: string | null; // only when verifiable
  dateFirstObserved: string;          // first time this app recorded it
  lastVerified: string;               // last time a source or you confirmed the details
  status: Status;
  closingDate: string | null;
  photoUrl: string | null;
  photoPermitted: boolean;            // photo shown only when you confirm display is permitted
  notes: string;
  watched: boolean;
}

export type EventType =
  | 'listed' | 'price_reduction' | 'price_increase' | 'basis_change'
  | 'closing_date' | 'under_offer' | 'missives' | 'sold' | 'withdrawn' | 'not_seen'
  | 'returned_to_market' | 'relisted' | 'details_changed' | 'merged';

export const EVENT_LABEL: Record<EventType, string> = {
  listed: 'New listing', price_reduction: 'Price reduced', price_increase: 'Price increased', basis_change: 'Pricing basis changed',
  closing_date: 'Closing date set', under_offer: 'Under offer', missives: 'Missives concluded', sold: 'Sold (confirmed)',
  withdrawn: 'Withdrawn', not_seen: 'No longer seen (unverified)', returned_to_market: 'Returned to market', relisted: 'Relisted',
  details_changed: 'Details changed', merged: 'Listings merged',
};

/** How sure we are about a change. */
export type Confidence =
  | 'reported'   // the source said so explicitly (e.g. an alert email showing "Under offer" or a price)
  | 'detected'   // found by comparing two observations (e.g. a lower price than last time)
  | 'manual'     // entered or confirmed by you
  | 'assumed';   // inferred by the app (e.g. a listing seen again after dropping off); treat with care

export const CONFIDENCE_LABEL: Record<Confidence, string> = {
  reported: 'Reported by the source', detected: 'Detected by comparing notifications', manual: 'Entered by you', assumed: 'Assumed by the app (unconfirmed)',
};

/** One entry in a property's history. Nothing is ever deleted or overwritten. */
export interface PropertyEvent {
  id: string;
  propertyId: string;
  date: string;              // ISO date the change was observed / took effect
  recordedAt: string;        // ISO timestamp it was saved
  type: EventType;
  priceBefore: number | null;
  priceAfter: number | null;
  basisBefore: PricingBasis | null;
  basisAfter: PricingBasis | null;
  statusBefore: Status | null;
  statusAfter: Status | null;
  changes: { field: string; before: unknown; after: unknown }[]; // for details_changed
  origin: string;            // "Manual", "CSV: file.csv", "Rightmove email: ...", ...
  importId: string | null;
  source?: string | null;     // which source the observation came from (ASPC, Rightmove, Manual, ...)
  confidence?: Confidence;
  evidence?: string | null;   // e.g. the email subject and date
  messageId?: string | null;  // the email it came from
}

export interface ImportRecord {
  id: string;
  at: string;
  kind: 'csv' | 'email' | 'manual' | 'backup' | 'api';
  label: string;            // file name or description
  source: string;
  snapshot: boolean;        // "this import lists everything currently for sale from this source in these towns"
  rows: number;
  created: number;
  updated: number;
  unchanged: number;
  notSeen: number;
  errors: string[];
  ok: boolean;
}

export interface Alert {
  id: string;
  at: string;
  propertyId: string | null;  // null for alerts about sources or the monitoring itself
  kind: 'price_reduction' | 'watched_under_offer' | 'back_on_market' | 'new_match' | 'long_on_market' | 'source_quiet' | 'collection_failed' | 'review_needed';
  message: string;
  read: boolean;
}

export interface Criteria { towns: string[]; minPrice: number | null; maxPrice: number | null; minBeds: number | null; types: PropertyType[] }

export interface Town { name: string; lat: number; lon: number }

export interface Settings {
  towns: Town[];               // locations being tracked
  radiusKm: number | null;     // optional: also include towns within this distance of Torphins
  criteria: Criteria;          // for "new property matching my criteria" alerts
  longOnMarketDays: number;    // alert threshold
  sourceQuietDays: number;     // warn when a source has sent nothing for this many days
  staleDays: number;           // flag active listings not seen in any notification for this many days
}

/** Two listings that might be the same property but could not be matched confidently. */
export interface ReviewItem {
  id: string;
  at: string;
  aId: string;               // the newer record
  bId: string;               // the existing record it resembles
  reasons: string[];
  status: 'open' | 'merged' | 'separate';
  resolvedAt: string | null;
}

/** One received notification (email) and what was done with it. The raw text is kept in the cloud database. */
export interface MessageRecord {
  messageId: string;
  receivedAt: string;        // ISO timestamp from the email
  processedAt: string;
  source: string;            // Rightmove, Zoopla, OnTheMarket, ASPC, ... or "Not a property email"
  from: string;
  subject: string;
  listings: number;          // listings read from it
  created: number; updated: number; unchanged: number; flagged: number;
  status: 'ok' | 'no_listings' | 'ignored' | 'error';
  warnings: string[];
  simulated: boolean;
}

/** One unattended monitoring run. */
export interface RunRecord {
  id: string;
  startedAt: string;
  finishedAt: string;
  trigger: 'schedule' | 'manual' | 'test';
  mailbox: string;           // "Gmail inbox" / "Simulated test mailbox" / both
  ok: boolean;
  messagesChecked: number;   // messages looked at in the mailbox
  messagesNew: number;       // not seen before
  listingsRead: number;
  created: number; updated: number; unchanged: number; flagged: number;
  errors: string[];
}

export interface SourceHealth {
  source: string;
  lastMessageAt: string | null;     // last notification received
  lastListingsAt: string | null;    // last notification from which listings were read
  lastFailureAt: string | null;
  lastError: string | null;
  messages: number;
  listings: number;
  failuresInRow: number;
  quietAlertAt: string | null;      // when we last warned it had gone quiet
}

export interface Db {
  version: 2;
  properties: Property[];
  events: PropertyEvent[];
  imports: ImportRecord[];
  alerts: Alert[];
  settings: Settings;
  reviews: ReviewItem[];
  messages: MessageRecord[];
  runs: RunRecord[];
  sources: Record<string, SourceHealth>;
  simulation: { startedAt: string | null };
}
