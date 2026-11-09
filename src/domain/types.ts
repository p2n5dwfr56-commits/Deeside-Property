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
  isDemo: boolean;         // demonstration data, always labelled as such
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
  | 'returned_to_market' | 'relisted' | 'details_changed';

export const EVENT_LABEL: Record<EventType, string> = {
  listed: 'New listing', price_reduction: 'Price reduced', price_increase: 'Price increased', basis_change: 'Pricing basis changed',
  closing_date: 'Closing date set', under_offer: 'Under offer', missives: 'Missives concluded', sold: 'Sold (confirmed)',
  withdrawn: 'Withdrawn', not_seen: 'No longer seen (unverified)', returned_to_market: 'Returned to market', relisted: 'Relisted',
  details_changed: 'Details changed',
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
  origin: string;            // "Manual", "CSV: file.csv", "Email import", ...
  importId: string | null;
}

export interface ImportRecord {
  id: string;
  at: string;
  kind: 'csv' | 'email' | 'manual' | 'backup';
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
  propertyId: string;
  kind: 'price_reduction' | 'watched_under_offer' | 'back_on_market' | 'new_match' | 'long_on_market';
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
}

export interface Db {
  version: 1;
  properties: Property[];
  events: PropertyEvent[];
  imports: ImportRecord[];
  alerts: Alert[];
  settings: Settings;
}
