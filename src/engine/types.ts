// Core data types for the simulation. No UI code lives in /engine.

export type RepKey = 'investors' | 'lenders' | 'city' | 'brokers' | 'tenants';
export type DealType = 'ios' | 'spec' | 'retail' | 'mf' | 'office';

/** An existing, already-built property offered for sale. */
export interface Existing {
  type: DealType;
  sf: number; // building size; 0 for a yard
  cond: 'good' | 'tired';
  deferred: number; // hidden repair bill a property condition report would find
  occ?: number; // apartments: share of units occupied
  leases: { tenant: string; credit: 'A' | 'B' | 'C'; factor: number; monthsLeft: number; share: number; rentAnnual: number }[];
}
export type Phase =
  | 'dd' | 'entitlement' | 'predev' | 'construction'
  | 'leasing' | 'operations' | 'sold' | 'dead';
export type Zoning = 'I' | 'C' | 'AG' | 'ETJ';
export type ReportId = 'env' | 'survey' | 'geo';
export type Grade = 'A' | 'B' | 'C' | 'D' | 'F';

export interface Parcel {
  id: string;
  name: string;
  area: string;
  district: string;
  acres: number;
  askPsf: number;
  zoning: Zoning;
  floodPct: number;
  water: boolean;
  sewer: boolean;
  access: number; // 1-5, highway access
  rail: boolean;
  offMarket: boolean;
  blurb: string;
  tile: { x: number; y: number; w: number; h: number };
  hidden: { env: 'none' | 'minor' | 'major'; soils: 'good' | 'expansive'; easementAcres: number };
  existing?: Existing;
  status: 'available' | 'contract' | 'owned' | 'sold' | 'rival';
  counterPrice?: number; // seller's last counter, if any
}

export interface Npc {
  id: string;
  name: string;
  org: string;
  role: 'broker' | 'tenantrep' | 'lp' | 'lender' | 'city' | 'gc';
  blurb: string;
  rel: number; // 0-100 relationship
  // LP terms
  maxCheck?: number;
  pref?: number;
  promote?: number;
  minCoinvest?: number;
  minDeals?: number;
  hurdle2?: number; // Pro: investor IRR above which the higher promote applies
  promote2?: number;
  // lender terms
  ltc?: number;
  rate?: number;
  maxLoan?: number;
  spread?: number; // Pro: floating rate = base rate + spread
  fee?: number;
  proOnly?: boolean;
  // contractor terms
  costFactor?: number;
  delayRisk?: number;
  monthsDelta?: number;
}

export interface IosDesign { surface: 'gravel' | 'stabilized' | 'paved'; security: 'basic' | 'premium' }
export interface SpecDesign { coverage: 0.3 | 0.35 | 0.4; clear: 28 | 32 | 36; extras: boolean }

export interface Budget {
  land: number; closing: number; hard: number; soft: number; pursuit: number;
  devFee: number; contingency: number; leasing: number; financing: number;
  total: number; loan: number; equity: number; gpEquity: number; lpEquity: number;
}

export interface Proforma {
  usableAcres: number;
  buildingSf: number;
  budget: Budget;
  rentUnit: number; // $/acre/month (ios) or $/SF/yr (spec)
  noi: number;
  yoc: number;
  cap: number;
  spread: number;
  value: number;
  profit: number;
  margin: number;
  conMonths: number;
  leaseUp: number;
  holdMonths: number;
  lenderId: string | null;
  rate: number;
  ltc: number;
  fee: number;
  lenderOptions: { id: string; loan: number; rate: number; ltc: number; fee: number; total: number }[];
  lpIrr: number;
  gpIrr: number;
  lpMultiple: number;
  score: Grade;
}

export interface Lease {
  tenant: string;
  credit: 'A' | 'B' | 'C';
  rentAnnual: number;
  escal: number;
  termMonths: number;
  freeMonths: number;
  ti: number;
  lc: number;
  startDay: number;
  share: number; // fraction of the property this lease covers
}

export interface Prospect {
  tenant: string;
  business: string;
  credit: 'A' | 'B' | 'C';
  rentAnnual: number;
  escal: number;
  termMonths: number;
  freeMonths: number;
  ti: number;
  lc: number;
  countered: boolean;
  share: number;
}

export interface Bid { buyer: string; kind: 'institution' | 'private' | 'syndicator'; price: number; note: string }

export interface EquityAcct {
  lpCap: number; gpCap: number; // unreturned capital
  lpPref: number; gpPref: number; // accrued, unpaid preferred return
  lpShare: number; // LP share of invested equity
  pref: number; // annual preferred return
  promote: number; // GP share of profits after capital and pref
  // Pro mode: IRR-hurdle waterfall. b1/b2 are what investors are still owed to reach the pref and the second hurdle.
  tier?: { b1: number; b2: number; hurdle2: number; promote2: number; catchUp: boolean; contrib: number; paid: number; promo: number };
}

export interface DealResult {
  salePrice: number; netProceeds: number; loanRepaid: number;
  totalCost: number; profit: number;
  lpIrr: number; gpIrr: number; lpMultiple: number; gpMultiple: number;
  lpIn: number; lpOut: number; gpIn: number; gpOut: number;
  promote: number; devFee: number; months: number;
  plan: { cost: number; noi: number; cap: number; months: number; lpIrr: number };
  actual: { cost: number; noi: number; cap: number; months: number; lpIrr: number };
}

export interface Deal {
  id: string;
  name: string;
  type: DealType;
  parcelId: string;
  phase: Phase;
  startDay: number;
  price: number;
  earnest: number;
  earnestHard: boolean;
  ddDeadline: number;
  reports: Record<ReportId, { status: 'none' | 'ordered' | 'done'; doneDay: number }>;
  known: { env: boolean; soils: boolean; easement: boolean };
  ent: {
    kind: 'none' | 'plat' | 'sup' | 'rezone';
    status: 'none' | 'pending' | 'approved' | 'denied';
    attorney: boolean; outreach: boolean;
    odds: number; decisionDay: number; conditionsCost: number; attempts: number;
  };
  ios: IosDesign;
  spec: SpecDesign;
  gcId: string | null;
  lpId: string | null;
  lpCooldown: Record<string, number>;
  gpPct: number;
  acq: boolean; // buying an existing property instead of developing
  reno: 'asis' | 'refresh' | 'reposition';
  occ: number; // apartments: share of units occupied
  lenderChoice: string | null; // Pro: lender picked by the player
  terms: 'investor' | 'standard' | 'sponsor'; // Pro: waterfall terms offered to the investor
  pursuit: number;
  // set at closing
  budget: Budget | null;
  uw: Proforma | null;
  loan: { lenderId: string; commit: number; rate: number; balance: number; spread?: number; perm?: boolean } | null;
  cash: number;
  acct: EquityAcct | null;
  flows: { m: number; lp: number; gp: number }[];
  con: {
    daysTotal: number; daysDone: number; delayDays: number; paidFrac: number;
    hardBudget: number; contingencyLeft: number; overrun: number; surprisesDone: boolean; doneDay: number;
  } | null;
  askFactor: number;
  prospect: Prospect | null;
  leases: Lease[];
  sale: { stage: 'none' | 'marketing' | 'closing'; day: number; bid: Bid | null };
  devFeePaid: number;
  costToDate: number;
  closeDay: number;
  promotePaid: number;
  capCalls: number;
  result: DealResult | null;
  log: { day: number; text: string }[];
}

export interface DecisionOption { id: string; label: string; detail?: string }
export interface Decision {
  id: number;
  kind: string;
  dealId?: string;
  title: string;
  body: string;
  advisor?: { who: 'analyst' | 'broker' | 'attorney' | 'cm'; line: string };
  options: DecisionOption[];
  data?: Record<string, unknown>;
}

export interface Market {
  iosRent: number; // $/acre/month
  indRent: number; // $/SF/year NNN
  iosCap: number;
  indCap: number;
  landIndex: number;
  costIndex: number;
  baseRate: number; // floating-rate index, a SOFR stand-in
}

export interface Game {
  version: number;
  seed: number;
  rng: number;
  difficulty: 'rookie' | 'pro';
  firmName: string;
  day: number;
  cash: number;
  attention: number;
  rep: Record<RepKey, number>;
  trackRecord: number;
  market: Market;
  marketHistory: { m: number; iosRent: number; indRent: number }[];
  parcels: Parcel[];
  npcs: Npc[];
  deals: Deal[];
  decisions: Decision[];
  nextId: number;
  news: { day: number; text: string; tone: 'good' | 'bad' | 'info' }[];
  almanac: string[]; // unlocked glossary keys
  stats: { feesEarned: number; promoteEarned: number; lpDistributed: number; deadDealCosts: number };
  over: boolean;
  /** Career length in in-game years; 0 is open-ended. */
  career: 10 | 25 | 0;
  player: string;
  /** How the career ended, once it has. */
  ending?: { how: 'complete' | 'retired' | 'bust'; text: string };
  flags: Record<string, boolean>;
  staff: Record<StaffKey, boolean>;
  achievements: string[];
  unlocked: string[]; // asset classes the firm may develop, plus 'acq' for buying existing properties
  cycle: { phase: CyclePhase; monthsLeft: number };
}

export const DAYS_PER_MONTH = 30;
export const OVERHEAD = 7000;
export const LOC_LIMIT = 150000;
export const MAX_ACTIVE = 3;
export type StaffKey = 'analyst' | 'pm' | 'leasing';
export type CyclePhase = 'expansion' | 'peak' | 'contraction' | 'recovery';
