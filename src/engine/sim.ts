// The simulation: player actions, the daily clock, and the month-end close.
// Every function mutates the Game object passed in. Nothing here touches the UI.
import { ACHIEVEMENTS } from '../content/achievements';
import { WORLD_EVENTS } from '../content/events';
import { BUYERS, RIVALS, TENANTS, makeNpcs, makeParcels } from '../content/world';
import { accrue, contributeTier, denseFlows, irrAnnual, payOut, sizePermLoan } from './finance';
import { ATTORNEY_FEE, COMMON, CYCLE, CYCLE_NEXT, ENT, IOS, MF_FULL, OUTREACH_COST, PERM, PRODUCTS, REPORTS, SPEC, STAFF, TERMS, TYPE_LABEL, ACRE_RANGE } from './params';
import { askPrice, baseCap, computeProforma, districtOf, entitlementKind, existingLeased, existingMarketNoi, getNpc, getParcel, makeAcct, usableAcres } from './proforma';
import { between, chance, pick, rand } from './rng';
import {
  DAYS_PER_MONTH, LOC_LIMIT, MAX_ACTIVE, OVERHEAD,
  type Bid, type Deal, type DealType, type Decision, type Game, type IosDesign, type Parcel,
  type Lease, type Prospect, type RepKey, type ReportId, type SpecDesign, type StaffKey,
} from './types';

export interface Result { ok: boolean; msg: string }
const ok = (msg: string): Result => ({ ok: true, msg });
const no = (msg: string): Result => ({ ok: false, msg });
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const round = (v: number, to = 1000) => Math.round(v / to) * to;
export const monthOf = (day: number) => Math.floor(day / DAYS_PER_MONTH);
const $ = (v: number) => (Math.abs(v) >= 1e6 ? `$${(v / 1e6).toFixed(2)}M` : `$${Math.round(v / 1000)}k`);

// ---------- setup ----------

/** Set the in-place rents of existing properties from today's market. */
function initExisting(g: Game, only?: (p: Parcel) => boolean) {
  for (const p of g.parcels) if (p.existing && (!only || only(p))) for (const l of p.existing.leases) l.rentAnnual = round(existingMarketNoi(g, p) * l.share * l.factor, 100);
}

/** Bring a save from an earlier build up to date. */
export function migrate(g: Game): Game {
  g.achievements ??= []; g.unlocked ??= ['ios', 'spec']; g.career ??= 0; g.player ??= '';
  for (const d of g.deals) { d.acq ??= false; d.reno ??= 'asis'; d.occ ??= 0; if (d.uw) { d.uw.leaseUp ??= d.type === 'ios' ? 3 : 6; d.uw.holdMonths ??= 6; } }
  const have = new Set(g.parcels.map((p) => p.id)), fresh = makeParcels().filter((p) => !have.has(p.id));
  if (fresh.length) { g.parcels.push(...fresh); initExisting(g, (p) => fresh.includes(p)); }
  return g;
}

export function newGame(seed = Date.now() % 2147483647, firmName = 'Your Development Co.', difficulty: Game['difficulty'] = 'rookie', career: Game['career'] = 0, player = ''): Game {
  const g: Game = {
    version: 3, seed, rng: seed, difficulty, firmName, day: 0, cash: 450000, attention: 4,
    rep: { investors: 35, lenders: 35, city: 35, brokers: 45, tenants: 30 }, trackRecord: 0,
    market: { iosRent: 4100, indRent: 8.1, iosCap: 0.0765, indCap: 0.0625, landIndex: 1, costIndex: 1, baseRate: 0.045 },
    marketHistory: [{ m: 0, iosRent: 4100, indRent: 8.1 }],
    parcels: makeParcels(), npcs: makeNpcs(), deals: [], decisions: [], nextId: 1,
    news: [{ day: 0, text: 'You open your own development shop with $450k and one good broker friend.', tone: 'info' }],
    almanac: ['ios', 'lpgp'], stats: { feesEarned: 0, promoteEarned: 0, lpDistributed: 0, deadDealCosts: 0 },
    over: false, career, player, flags: {}, staff: { analyst: false, pm: false, leasing: false },
    cycle: { phase: 'expansion', monthsLeft: 10 + (seed % 7) },
    achievements: [], unlocked: ['ios', 'spec'],
  };
  initExisting(g);
  return g;
}

// ---------- small helpers ----------

export const getDeal = (g: Game, id: string): Deal => g.deals.find((d) => d.id === id)!;
export const activeDeals = (g: Game) => g.deals.filter((d) => ['dd', 'entitlement', 'predev', 'construction', 'leasing'].includes(d.phase));
function news(g: Game, text: string, tone: 'good' | 'bad' | 'info' = 'info') { g.news.unshift({ day: g.day, text, tone }); if (g.news.length > 60) g.news.pop(); }
function log(g: Game, d: Deal, text: string) { d.log.unshift({ day: g.day, text }); }
function unlock(g: Game, ...keys: string[]) { for (const k of keys) if (!g.almanac.includes(k)) g.almanac.push(k); }
function bumpRep(g: Game, k: RepKey, v: number) { g.rep[k] = clamp(g.rep[k] + v, 0, 100); }
function decide(g: Game, dec: Omit<Decision, 'id'>) { g.decisions.push({ ...dec, id: g.nextId++ }); }
function notice(g: Game, title: string, body: string, d?: Deal, advisor?: Decision['advisor']) {
  decide(g, { kind: 'notice', dealId: d?.id, title, body, advisor, options: [{ id: 'ok', label: 'Continue' }] });
}
function flow(g: Game, d: Deal, lp: number, gp: number) { d.flows.push({ m: monthOf(g.day), lp, gp }); }
function spendPursuit(g: Game, d: Deal, amt: number) { g.cash -= amt; d.pursuit += amt; }

/** Pay a project cost: project cash first, then the construction loan, then a capital call on the GP. */
function pay(g: Game, d: Deal, amount: number) {
  let amt = amount;
  if (amt <= 0) return;
  d.costToDate += amt;
  const c = Math.min(d.cash, amt); d.cash -= c; amt -= c;
  if (amt > 0 && d.loan) { const draw = Math.min(d.loan.commit - d.loan.balance, amt); d.loan.balance += draw; amt -= draw; }
  if (amt > 0.5) capitalCall(g, d, amt);
}
function capitalCall(g: Game, d: Deal, amt: number) {
  g.cash -= amt; d.acct!.gpCap += amt; d.capCalls += amt; flow(g, d, 0, -amt);
  if (d.acct!.tier) contributeTier(d.acct!, amt);
  news(g, `${d.name} ran out of budget. You covered ${$(amt)} from firm cash.`, 'bad');
}
function overrun(g: Game, d: Deal, amt: number) {
  const con = d.con!;
  const use = Math.min(con.contingencyLeft, amt);
  con.contingencyLeft -= use; con.overrun += amt - use;
  pay(g, d, amt);
}

/** Current market NOI for the asset as built (or as designed, before closing). */
export function marketNoi(g: Game, d: Deal): number {
  const pf = computeProforma(g, d);
  if (!d.uw) return pf.noi;
  return d.type === 'ios' ? pf.rentUnit * d.uw.usableAcres * 12 : pf.rentUnit * d.uw.buildingSf;
}

export const maxActive = (g: Game) => MAX_ACTIVE + (g.staff.analyst ? 1 : 0) + (g.staff.pm ? 1 : 0);
export const leasedShare = (d: Deal) => (d.type === 'mf' ? Math.min(1, d.occ / MF_FULL) : d.leases.reduce((s, l) => s + l.share, 0));
export const fullyLeased = (d: Deal) => leasedShare(d) >= (d.type === 'mf' ? 0.955 : 0.999);

function leaseRent(g: Game, l: Lease, ignoreFree: boolean): number {
  if (g.day < l.startDay && !ignoreFree) return 0;
  const k = Math.floor((g.day - l.startDay) / DAYS_PER_MONTH) - l.freeMonths;
  if (k < 0 && !ignoreFree) return 0;
  return l.rentAnnual * Math.pow(1 + l.escal, Math.floor(Math.max(0, k) / 12));
}
/** Annual rent being collected right now, across all leases. */
export function currentRent(g: Game, d: Deal): number {
  if (d.phase === 'construction' && !d.acq) return 0;
  if (d.type === 'mf') return d.budget ? marketNoi(g, d) * leasedShare(d) : 0;
  return d.leases.reduce((s, l) => s + leaseRent(g, l, false), 0);
}
/** Contract rent ignoring free rent, used for valuation. */
export function contractRent(g: Game, d: Deal): number {
  if (d.type === 'mf') return marketNoi(g, d) * leasedShare(d);
  return d.leases.reduce((s, l) => s + leaseRent(g, l, true), 0);
}

export function netEffectiveRent(p: Prospect): number {
  let total = 0;
  for (let k = p.freeMonths; k < p.termMonths; k++) total += (p.rentAnnual / 12) * Math.pow(1 + p.escal, Math.floor((k - p.freeMonths) / 12));
  return (total - p.ti - p.lc) / (p.termMonths / 12);
}

/** What a buyer would pay today: each lease at its own cap rate, vacant space at a discount. */
export function estimateValue(g: Game, d: Deal): { value: number; cap: number; noi: number } {
  const base = baseCap(g, d);
  let value = 0, noi = 0;
  for (const l of d.leases) {
    const elapsed = Math.max(0, Math.floor((g.day - l.startDay) / DAYS_PER_MONTH));
    const remaining = l.termMonths - elapsed;
    const cap = base + (l.credit === 'A' ? -0.0025 : l.credit === 'C' ? 0.0035 : 0) + (remaining < 36 ? 0.003 : remaining > 84 ? -0.001 : 0);
    const n = leaseRent(g, l, true);
    value += n / cap - (Math.max(0, l.freeMonths - elapsed) * n) / 12; noi += n;
  }
  if (d.type === 'mf') { const n = contractRent(g, d); value += n / base; noi += n; }
  const vacant = Math.max(0, 1 - leasedShare(d));
  if (vacant > 0.001) { const n = marketNoi(g, d) * vacant; value += (n / (base + 0.0075)) * 0.9; if (!d.leases.length && d.type !== 'mf') noi = n; }
  return { value, cap: value > 0 ? noi / value : base, noi };
}

// ---------- site selection ----------

export function offerOdds(g: Game, p: Parcel, price: number): number {
  if (p.counterPrice && price >= p.counterPrice) return 1;
  const disc = 1 - price / askPrice(g, p);
  return clamp(0.95 - disc * 5 + (getNpc(g, 'dusty').rel - 50) / 200 + (p.offMarket ? 0.05 : 0), 0.02, 0.98);
}

export function visibleParcels(g: Game): Parcel[] {
  const dusty = getNpc(g, 'dusty').rel;
  return g.parcels.filter((p) => !p.offMarket || dusty >= 60 || p.status !== 'available');
}

function blankDeal(g: Game, p: Parcel, type: DealType, price: number, id: string): Deal {
  const short = p.name.replace(/ \(.*\)/, '');
  return {
    id, name: p.existing ? short : `${short} ${TYPE_LABEL[type]}`, type, parcelId: p.id, phase: 'dd', startDay: g.day,
    acq: !!p.existing, reno: 'asis', occ: 0,
    price, earnest: 0, earnestHard: false, ddDeadline: g.day + 60,
    reports: { env: { status: 'none', doneDay: 0 }, survey: { status: 'none', doneDay: 0 }, geo: { status: 'none', doneDay: 0 } },
    known: { env: false, soils: false, easement: false },
    ent: { kind: entitlementKind(p, type), status: 'none', attorney: false, outreach: false, odds: 0, decisionDay: 0, conditionsCost: 0, attempts: 0 },
    ios: { surface: 'stabilized', security: 'basic' }, spec: { coverage: 0.35, clear: 32, extras: false },
    gcId: null, lpId: null, lpCooldown: {}, gpPct: 0.1, pursuit: 0, budget: null, uw: null, loan: null, cash: 0, acct: null,
    flows: [], con: null, askFactor: 1, prospect: null, leases: [], lenderChoice: null, terms: 'standard', sale: { stage: 'none', day: 0, bid: null },
    devFeePaid: 0, costToDate: 0, closeDay: 0, promotePaid: 0, capCalls: 0, result: null, log: [],
  };
}

/** A first-look pro forma for a site the player has not offered on yet. */
export function previewProforma(g: Game, parcelId: string, type: DealType, price: number) {
  const p = getParcel(g, parcelId);
  return computeProforma(g, blankDeal(g, p, p.existing?.type ?? type, price, 'preview'));
}

export function makeOffer(g: Game, parcelId: string, type: DealType, price: number): Result {
  const p = getParcel(g, parcelId);
  if (p.status !== 'available') return no('That site is no longer available.');
  if (activeDeals(g).length >= maxActive(g)) return no(`Your team can only chase ${maxActive(g)} deals at a time. Finish or drop one, or hire help.`);
  if (p.existing) type = p.existing.type;
  if (p.existing && !g.unlocked.includes('acq')) return no('Buying existing properties unlocks when your firm holds $2 million in cash.');
  if (!g.unlocked.includes(type)) return no(`Your firm has not unlocked ${TYPE_LABEL[type].toLowerCase()} deals yet. See Milestones.`);
  const [lo, hi] = ACRE_RANGE[type], ua = usableAcres(p);
  if (!p.existing && ua < lo) return no(`This use needs at least ${lo} usable acres.`);
  if (!p.existing && ua > hi) return no(`This site is too big for that use. Look for ${hi} acres or less.`);
  const earnest = Math.max(10000, round(price * 0.02));
  if (g.cash < earnest) return no(`You need ${$(earnest)} of earnest money.`);
  if (!chance(g, offerOdds(g, p, price))) {
    const counter = round((price + askPrice(g, p)) / 2);
    p.counterPrice = p.counterPrice ? Math.min(p.counterPrice, counter) : counter;
    return no(`The seller passed and countered at ${$(p.counterPrice)}.`);
  }
  const d = blankDeal(g, p, type, price, `d${g.nextId++}`);
  d.earnest = earnest;
  g.cash -= earnest; p.status = 'contract'; p.counterPrice = undefined;
  g.deals.push(d);
  log(g, d, `Under contract at ${$(price)}. Earnest money ${$(earnest)} posted.`);
  news(g, `${p.name} is under contract at ${$(price)}.`, 'good');
  unlock(g, 'loi', 'earnest', 'dd', 'floodplain');
  bumpRep(g, 'brokers', 1);
  return ok(`Offer accepted at ${$(price)}. You have 60 days of due diligence.`);
}

export function walkDeal(g: Game, id: string): Result {
  const d = getDeal(g, id);
  if (!['dd', 'entitlement', 'predev'].includes(d.phase)) return no('It is too late to walk away from this deal.');
  const p = getParcel(g, d.parcelId);
  let lost = d.pursuit;
  if (!d.earnestHard) g.cash += d.earnest; else { lost += d.earnest; bumpRep(g, 'brokers', -2); }
  g.stats.deadDealCosts += lost;
  d.phase = 'dead'; p.status = 'available';
  g.decisions = g.decisions.filter((x) => x.dealId !== id);
  log(g, d, `Deal dropped. Dead-deal cost ${$(lost)}.`);
  news(g, `You walked away from ${p.name}. Dead-deal cost: ${$(lost)}.`, 'bad');
  return ok(`Deal dropped. You lost ${$(lost)}${d.earnestHard ? ', including the earnest money' : ' and got your earnest money back'}.`);
}

// ---------- due diligence ----------

export function orderReport(g: Game, id: string, r: ReportId): Result {
  const d = getDeal(g, id);
  if (d.reports[r].status !== 'none') return no('Already ordered.');
  if (!['dd', 'entitlement', 'predev'].includes(d.phase)) return no('Too late to order reports.');
  spendPursuit(g, d, REPORTS[r].cost);
  const days = Math.round(REPORTS[r].days * (g.staff.analyst ? 0.7 : 1));
  d.reports[r] = { status: 'ordered', doneDay: g.day + days };
  log(g, d, `Ordered ${REPORTS[r].label}.`);
  if (r === 'env') unlock(g, 'phase1');
  if (r === 'survey') unlock(g, 'easement');
  return ok(`${REPORTS[r].label} ordered. Results in ${days} days.`);
}

function reportDone(g: Game, d: Deal, r: ReportId) {
  const p = getParcel(g, d.parcelId);
  d.reports[r].status = 'done';
  if (d.budget) return; // too late: the land is already bought, so problems surface during construction
  const early = true;
  const finding = (key: string, cost: number, title: string, body: string, line: string, who: 'analyst' | 'attorney' | 'cm') => {
    if (!early) return;
    decide(g, {
      kind: 'finding', dealId: d.id, title, body, advisor: { who, line }, data: { key, cost },
      options: [
        { id: 'credit', label: 'Ask the seller for a price cut', detail: 'They may say no. You can still proceed or walk afterward.' },
        { id: 'absorb', label: `Accept it and budget ${$(cost)}` },
        { id: 'walk', label: 'Walk away', detail: d.earnestHard ? 'You lose your earnest money.' : 'Your earnest money comes back.' },
      ],
    });
  };
  if (r === 'env') {
    d.known.env = true;
    if (p.hidden.env === 'none') { log(g, d, 'Phase I came back clean.'); news(g, `${d.name}: environmental report is clean.`, 'good'); }
    else {
      const cost = COMMON.cleanup[p.hidden.env];
      finding('env', cost, 'Environmental problem found',
        p.hidden.env === 'minor'
          ? `The Phase I found an old buried fuel tank. Removing it and the stained soil will cost about ${$(cost)}.`
          : `The Phase I and follow-up testing found solvent contamination from the old truck wash. Cleanup will cost about ${$(cost)} and add roughly two months.`,
        'This is exactly why we order the report before the deposit goes hard. Now it is the seller\'s problem to negotiate, not just ours.', 'attorney');
    }
  }
  if (r === 'survey') {
    d.known.easement = true;
    if (p.hidden.easementAcres <= 0) { log(g, d, 'Survey and title are clean.'); news(g, `${d.name}: survey and title are clean.`, 'good'); }
    else {
      const cost = round((p.hidden.easementAcres / p.acres) * d.price, 500);
      finding('easement', cost, 'Easement found on the survey',
        `A pipeline easement crosses the tract and takes ${p.hidden.easementAcres} acres out of use. Usable land drops to ${usableAcres(p, d).toFixed(1)} acres, worth about ${$(cost)} less.`,
        'Fewer usable acres means less rent. I have updated the pro forma. Ask for a credit; the seller knew about that pipeline.', 'analyst');
    }
  }
  if (r === 'geo' && d.acq) {
    d.known.soils = true;
    const cost = p.existing!.deferred;
    if (cost <= 0) { log(g, d, 'Property condition report: no major repairs needed.'); news(g, `${d.name}: the building checks out.`, 'good'); }
    else finding('soils', cost, 'Deferred maintenance found', `The inspector found problems the seller did not mention: an aging roof, tired mechanical units and cracked paving. Expect about ${$(cost)} of repairs.`, 'Every older building is hiding a repair bill. Now we know the number, and we can ask the seller to pay for it.', 'cm');
    return;
  }
  if (r === 'geo') {
    d.known.soils = true;
    if (p.hidden.soils === 'good') { log(g, d, 'Soils report: good bearing soil.'); news(g, `${d.name}: soils report looks good.`, 'good'); }
    else {
      const cost = round(d.type === 'ios' ? usableAcres(p, d) * 43560 * IOS.soilsPsf : computeProforma(g, d).buildingSf * SPEC.soilsPsf, 500);
      finding('soils', cost, 'Expansive clay soils',
        `The borings found the heavy clay North Texas is known for. The site needs lime stabilization, adding about ${$(cost)}.`,
        'Better to learn this from a $14,000 report than from a cracked slab. I can price the fix into the budget now.', 'cm');
    }
  }
}

export function finishDD(g: Game, id: string): Result {
  const d = getDeal(g, id);
  if (d.phase !== 'dd') return no('Due diligence is already complete.');
  d.earnestHard = true;
  g.decisions = g.decisions.filter((x) => !(x.dealId === id && x.kind === 'ddDeadline'));
  if (d.ent.kind === 'none') { d.phase = 'predev'; d.ent.status = 'approved'; enterPredev(g, d); }
  else { d.phase = 'entitlement'; unlock(g, 'entitlement', 'etj'); }
  log(g, d, 'Due diligence complete. Earnest money is now non-refundable.');
  return ok('Due diligence complete. Your earnest money is now at risk.');
}

function enterPredev(g: Game, d: Deal) {
  unlock(g, 'hardsoft', 'gc', 'contingency', 'devfee', 'ltc', 'interestreserve', 'pref', 'promote', 'yoc', 'caprate', 'spread', 'noi');
  if (g.difficulty === 'pro') unlock(g, 'catchup', 'floating', 'cycle');
  log(g, d, 'Ready for design, contractor and capital.');
}

// ---------- entitlement ----------

export function entOdds(g: Game, d: Deal, attorney: boolean, outreach: boolean): number {
  const base = ENT[d.ent.kind].odds + d.ent.attempts * 0.15;
  return clamp(base + (attorney ? 0.2 : 0) + (outreach ? 0.1 : 0) + (getNpc(g, 'vega').rel - 30) / 250 + (g.rep.city - 35) / 400 + districtOf(g, d).ent - (d.type === 'mf' ? 0.1 : 0), 0.05, 0.97);
}

export function startEntitlement(g: Game, id: string, attorney: boolean, outreach: boolean): Result {
  const d = getDeal(g, id);
  if (d.phase !== 'entitlement' || d.ent.status === 'pending') return no('No application to file right now.');
  const e = ENT[d.ent.kind];
  const cost = (d.ent.attempts ? 15000 : e.fee) + (attorney ? ATTORNEY_FEE : 0) + (outreach ? OUTREACH_COST : 0);
  spendPursuit(g, d, cost);
  d.ent = { ...d.ent, status: 'pending', attorney, outreach, odds: entOdds(g, d, attorney, outreach), decisionDay: g.day + (d.ent.attempts ? 60 : e.days) };
  log(g, d, `${e.label} application filed.`);
  return ok(`${e.label} filed. The hearing is in ${d.ent.attempts ? 60 : e.days} days.`);
}

function entitlementDecision(g: Game, d: Deal) {
  const e = ENT[d.ent.kind];
  if (chance(g, d.ent.odds)) {
    d.ent.status = 'approved'; d.phase = 'predev'; bumpRep(g, 'city', 2);
    let body = `${e.label} approved for ${d.name}.`;
    if (chance(g, 0.3)) {
      d.ent.conditionsCost = d.type === 'ios' ? 45000 : 120000;
      body += ` The council added conditions: a masonry screening wall and extra landscaping, about ${$(d.ent.conditionsCost)}.`;
    }
    enterPredev(g, d);
    notice(g, 'Approved at the hearing', body, d, { who: 'attorney', line: 'The land is worth more today than it was yesterday. That is what entitlement does.' });
    log(g, d, `${e.label} approved.`);
  } else {
    d.ent.status = 'denied'; d.ent.attempts++;
    decide(g, {
      kind: 'entDenied', dealId: d.id, title: 'Denied at the hearing',
      body: `Neighbors packed the room and the vote went against ${d.name}. You can re-apply with concessions, or walk away and lose your earnest money.`,
      advisor: { who: 'attorney', line: 'A denial is not always final. If we come back with screening and limited hours, a couple of votes may move.' },
      options: [
        { id: 'reapply', label: 'Re-apply with concessions', detail: '$15k and 60 more days. Better odds this time.' },
        { id: 'walk', label: 'Walk away' },
      ],
    });
  }
}

// ---------- design and capital ----------

export function setIos(g: Game, id: string, patch: Partial<IosDesign>) { const d = getDeal(g, id); if (!d.budget) d.ios = { ...d.ios, ...patch }; }
export function setSpec(g: Game, id: string, patch: Partial<SpecDesign>) { const d = getDeal(g, id); if (!d.budget) d.spec = { ...d.spec, ...patch }; }
export function setReno(g: Game, id: string, reno: Deal['reno']) { const d = getDeal(g, id); if (!d.budget && d.acq) d.reno = reno; }
export function setGc(g: Game, id: string, gcId: string) { const d = getDeal(g, id); if (!d.budget) d.gcId = gcId; }
export function setGpPct(g: Game, id: string, pct: number) { const d = getDeal(g, id); if (!d.budget) d.gpPct = clamp(pct, 0.02, 1); }
export function setLender(g: Game, id: string, lenderId: string) { const d = getDeal(g, id); if (!d.budget) d.lenderChoice = lenderId; }
/** Pro: choose the waterfall terms to offer. Changing them after an investor commits sends you back to pitch again. */
export function setTerms(g: Game, id: string, terms: Deal['terms']) {
  const d = getDeal(g, id);
  if (d.budget || d.terms === terms) return;
  d.terms = terms;
  if (d.lpId) { log(g, d, `${getNpc(g, d.lpId).name} needs to approve the new terms.`); d.lpId = null; }
}

export function pitchOdds(g: Game, d: Deal, lpId: string): number {
  const lp = getNpc(g, lpId), pf = computeProforma(g, d);
  const bonus = { A: 0.15, B: 0.08, C: 0, D: -0.15, F: -0.3 }[pf.score];
  const pro = g.difficulty === 'pro' ? CYCLE[g.cycle.phase].appetite + TERMS[d.terms].pitch : 0;
  return clamp(0.25 + lp.rel / 150 + (g.rep.investors - 35) / 200 + bonus + (g.staff.analyst ? 0.05 : 0) + pro, 0.03, 0.97);
}

export function pitchLp(g: Game, id: string, lpId: string): Result {
  const d = getDeal(g, id), lp = getNpc(g, lpId);
  if (d.budget) return no('This deal is already capitalized.');
  if (g.trackRecord < (lp.minDeals ?? 0)) return no(`${lp.name} wants to see ${lp.minDeals} completed deal${lp.minDeals === 1 ? '' : 's'} first.`);
  if ((d.lpCooldown[lpId] ?? 0) > g.day) return no(`${lp.name} asked you to come back in a few weeks.`);
  if (g.attention < 1) return no('You are out of attention this month.');
  g.attention -= 1;
  unlock(g, 'lpgp', 'pref', 'promote');
  if (chance(g, pitchOdds(g, d, lpId))) {
    d.lpId = lpId; lp.rel = clamp(lp.rel + 3, 0, 100);
    d.gpPct = Math.max(d.gpPct, lp.minCoinvest ?? 0.05);
    log(g, d, `${lp.name} committed as equity partner.`);
    return ok(`${lp.name} is in. They will fund the investor share of the equity at closing.`);
  }
  d.lpCooldown[lpId] = g.day + 30;
  return no(`${lp.name} passed for now. Build the relationship or improve the deal, then try again in a month.`);
}

export function closeBlockers(g: Game, d: Deal): string[] {
  const out: string[] = [];
  const pf = computeProforma(g, d);
  if (!d.gcId && !(d.acq && d.reno === 'asis')) out.push('Choose a contractor.');
  if (!pf.lenderId) out.push('No lender will finance this yet.');
  const lp = d.lpId ? getNpc(g, d.lpId) : null;
  if (lp) {
    if (pf.budget.lpEquity > (lp.maxCheck ?? 0)) out.push(`${lp.name} can invest at most ${$(lp.maxCheck ?? 0)}. Raise your own share or find a bigger partner.`);
    if (d.gpPct < (lp.minCoinvest ?? 0.05) - 1e-9) out.push(`${lp.name} requires you to co-invest at least ${Math.round((lp.minCoinvest ?? 0.05) * 100)}%.`);
  }
  const need = pf.budget.gpEquity - d.pursuit - d.earnest;
  if (need > g.cash + LOC_LIMIT * 0.5) out.push(lp ? `You need ${$(need)} more cash for your share of the equity.` : `Without an equity partner you must fund ${$(need)} more yourself. Pitch an investor.`);
  for (const dec of g.decisions) if (dec.dealId === d.id && dec.kind === 'finding') out.push('Resolve the open due diligence finding.');
  return out;
}

export function closeDeal(g: Game, id: string): Result {
  const d = getDeal(g, id);
  if (d.phase !== 'predev') return no('This deal is not ready to close.');
  const blockers = closeBlockers(g, d);
  if (blockers.length) return no(blockers[0]);
  const pf = computeProforma(g, d), b = pf.budget, p = getParcel(g, d.parcelId);
  const gc = d.gcId ? getNpc(g, d.gcId) : null;
  d.budget = b; d.uw = pf; d.closeDay = g.day;
  g.cash -= b.gpEquity - d.pursuit - d.earnest;
  d.acct = makeAcct(g, d, b.lpEquity, b.gpEquity);
  flow(g, d, -b.lpEquity, -b.gpEquity);
  d.cash = b.equity - d.pursuit - d.earnest;
  d.costToDate = d.pursuit + d.earnest;
  d.loan = { lenderId: pf.lenderId!, commit: b.loan, rate: pf.rate, balance: 0, spread: getNpc(g, pf.lenderId!).spread === undefined ? undefined : getNpc(g, pf.lenderId!).spread! - (d.acq && existingLeased(p) >= 0.9 ? 0.015 : 0) };
  pay(g, d, b.land - d.earnest + b.closing + b.loan * pf.fee + b.soft * 0.4);
  const delay = d.known.env && p.hidden.env === 'major' ? 60 : 0;
  d.con = { daysTotal: pf.conMonths * DAYS_PER_MONTH, daysDone: 0, delayDays: delay, paidFrac: 0, hardBudget: b.hard, contingencyLeft: b.contingency, overrun: 0, surprisesDone: false, doneDay: 0 };
  d.phase = 'construction'; p.status = 'owned';
  unlock(g, 'waterfall'); bumpRep(g, 'brokers', 2); bumpRep(g, 'lenders', 1);
  if (d.acq) {
    // the tenants and their leases come with the property
    const ex = p.existing!;
    d.leases = ex.leases.map((l) => ({ tenant: l.tenant, credit: l.credit, rentAnnual: l.rentAnnual / Math.pow(1.03, Math.floor((Math.max(60, l.monthsLeft) - l.monthsLeft) / 12)), escal: 0.03, termMonths: Math.max(60, l.monthsLeft), freeMonths: 0, ti: 0, lc: 0, startDay: g.day - (Math.max(60, l.monthsLeft) - l.monthsLeft) * DAYS_PER_MONTH, share: l.share }));
    d.occ = ex.occ ?? 0;
    if (!fullyLeased(d)) g.flags[`vacant-${d.id}`] = true;
    log(g, d, `Closed on the purchase at ${$(d.price)}. Budget ${$(b.total)}, loan ${$(b.loan)}, equity ${$(b.equity)}.`);
    news(g, `You bought ${d.name}.`, 'good');
    if (d.con.daysTotal === 0) { d.con.doneDay = g.day; d.phase = fullyLeased(d) ? 'operations' : 'leasing'; return ok('Closed. The property is yours.'); }
    return ok('Closed. Renovation has started.');
  }
  log(g, d, `Closed on the land. ${gc!.name} breaks ground. Budget ${$(b.total)}, loan ${$(b.loan)}, equity ${$(b.equity)}.`);
  news(g, `${d.name}: land closed and construction started.`, 'good');
  return ok('Closed. Construction has started.');
}

// ---------- leasing ----------

export function setAsk(g: Game, id: string, f: number) { getDeal(g, id).askFactor = f; }

function arrivalOdds(g: Game, d: Deal): number {
  const askF = d.askFactor <= 0.95 ? 1.4 : d.askFactor <= 1 ? 1 : d.askFactor <= 1.05 ? 0.6 : 0.3;
  const quality = d.type === 'ios' ? IOS.security[d.ios.security].demand : d.spec.extras ? SPEC.extrasDemand : 1;
  const base = d.type === 'ios' ? IOS.arrival : d.type === 'spec' ? SPEC.arrival : PRODUCTS[d.type].arrival;
  const pre = d.phase === 'construction' && !d.acq ? 0.5 : 1;
  const cyc = g.difficulty === 'pro' ? CYCLE[g.cycle.phase].demand : 1;
  return clamp(base * districtOf(g, d).demand * askF * quality * pre * cyc * (g.staff.leasing ? 1.3 : 1) * (0.7 + getNpc(g, 'priya').rel * 0.006) * (0.85 + g.rep.tenants / 200), 0.02, 0.95);
}

function makeProspect(g: Game, d: Deal): Prospect {
  const t = pick(g, TENANTS.filter((x) => x.type === d.type));
  const r = rand(g);
  const credit = r < 0.25 ? 'A' : r < 0.75 ? 'B' : 'C';
  const f = credit === 'A' ? between(g, 0.93, 0.97) : credit === 'B' ? between(g, 0.96, 1.0) : between(g, 0.99, 1.04);
  // big buildings can be split: some tenants only want half
  const free = 1 - leasedShare(d);
  const multi = (d.type === 'spec' && d.uw!.buildingSf >= 100000) || d.type === 'retail' || d.type === 'office';
  const share = multi && (free < 0.75 || chance(g, 0.45)) ? 0.5 : 1;
  const rentAnnual = round(marketNoi(g, d) * share * (share < 1 ? 1.03 : 1) * d.askFactor * f, 100);
  const pr = d.type === 'retail' || d.type === 'office' ? PRODUCTS[d.type] : null;
  const termMonths = pr ? pick(g, [...pr.terms]) : d.type === 'ios' ? pick(g, [36, 60, 60, 84]) : pick(g, [60, 84, 120]);
  const freeMonths = pr ? pick(g, [...pr.free]) : d.type === 'ios' ? pick(g, [0, 1, 1, 2]) : pick(g, [2, 3, 4, 5]);
  const ti = d.type === 'ios' ? 0 : round(d.uw!.buildingSf * share * (pr ? between(g, pr.ti[0], pr.ti[1]) : between(g, 2, 6)));
  const lc = round(rentAnnual * (termMonths / 12) * (pr ? pr.lcPct : d.type === 'ios' ? IOS.lcPct : SPEC.lcPct), 100);
  return { tenant: t.name, business: t.business, credit, rentAnnual, escal: pick(g, [0.03, 0.035, 0.04]), termMonths, freeMonths, ti, lc, countered: false, share };
}

function offerProspect(g: Game, d: Deal) {
  const p = d.prospect!;
  const creditText = { A: 'strong credit', B: 'average credit', C: 'weak credit' }[p.credit];
  const line = p.credit === 'A' ? 'Strong credit pays a little less rent, but a buyer will pay more for the building.'
    : p.credit === 'C' ? 'The rent looks great. Just know that a weak tenant can stop paying, and buyers will price that in.'
    : 'Solid, ordinary tenant. Compare the net effective rent, not the face rent.';
  decide(g, {
    kind: 'prospect', dealId: d.id, title: `Lease proposal: ${p.tenant}`,
    body: `${p.tenant}, a ${p.business} company with ${creditText}, wants to lease ${p.share < 1 ? `half of ${d.name} (${Math.round((d.uw!.buildingSf * p.share) / 1000)}k SF)` : d.type === 'retail' || d.type === 'office' ? `all of ${d.name}` : d.name}.`,
    advisor: { who: 'broker', line }, data: { ...p } as unknown as Record<string, unknown>,
    options: [
      { id: 'accept', label: 'Sign the lease' },
      ...(p.countered ? [] : [{ id: 'counter', label: 'Counter at 4% more rent', detail: 'They may accept, hold firm, or walk.' }]),
      { id: 'pass', label: 'Pass and keep marketing' },
    ],
  });
  unlock(g, 'nnn', 'ner', 'credit');
}

function signLease(g: Game, d: Deal) {
  const p = d.prospect!;
  const start = d.phase === 'construction' && !d.acq ? g.day + Math.max(0, d.con!.daysTotal - d.con!.daysDone) : g.day;
  d.leases.push({ tenant: p.tenant, credit: p.credit, rentAnnual: p.rentAnnual, escal: p.escal, termMonths: p.termMonths, freeMonths: p.freeMonths, ti: p.ti, lc: p.lc, startDay: start, share: p.share });
  d.prospect = null;
  pay(g, d, p.ti + p.lc);
  if (d.phase === 'leasing' && fullyLeased(d)) d.phase = 'operations';
  bumpRep(g, 'tenants', 2); getNpc(g, 'priya').rel = clamp(getNpc(g, 'priya').rel + 2, 0, 100);
  log(g, d, `Lease signed with ${p.tenant}: ${$(p.rentAnnual)}/yr for ${p.termMonths / 12} years.`);
  news(g, `${d.name}: lease signed with ${p.tenant}.`, 'good');
}

// ---------- sale ----------

export function listForSale(g: Game, id: string): Result {
  const d = getDeal(g, id);
  if (d.phase !== 'operations' || !fullyLeased(d)) return no('Lease the whole property before taking it to market.');
  if (d.sale.stage !== 'none') return no('Already on the market.');
  d.sale = { stage: 'marketing', day: g.day + 45, bid: null };
  unlock(g, 'caprate', 'retrade');
  log(g, d, 'Listed for sale. Offers are due in 45 days.');
  return ok('Listed. Your broker will call for offers in 45 days.');
}

function callForOffers(g: Game, d: Deal) {
  const { value, cap } = estimateValue(g, d);
  const mk = (kind: Bid['kind'], f: number, note: string): Bid => ({ buyer: pick(g, BUYERS[kind]), kind, price: round(value * f * between(g, 0.985, 1.015), 5000), note });
  const bids = [
    mk('institution', 0.97, 'All cash. Has never failed to close.'),
    mk('private', 1.0, '1031 exchange buyer. Motivated, but known to ask for a price cut late.'),
    mk('syndicator', 1.035, 'Highest price, but they still need to raise their equity and loan.'),
  ];
  decide(g, {
    kind: 'bids', dealId: d.id, title: `Offers are in on ${d.name}`,
    body: `Three buyers bid. The market cap rate for this lease is about ${(cap * 100).toFixed(2)}%.`,
    advisor: { who: 'broker', line: 'Price is only one term. Ask yourself which of these buyers actually shows up at closing.' },
    data: { bids },
    options: [
      ...bids.map((b, i) => ({ id: `b${i}`, label: `${b.buyer}: ${$(b.price)}`, detail: b.note })),
      { id: 'hold', label: 'Reject all and keep the property' },
    ],
  });
}

function completeSale(g: Game, d: Deal, price: number) {
  const a = d.acct!, b = d.budget!, uw = d.uw!;
  const net = price * (1 - COMMON.saleCostPct);
  const repaid = d.loan!.balance;
  d.cash += net - repaid; d.loan!.balance = 0;
  const noi = contractRent(g, d);
  const out = payOut(a, Math.max(0, d.cash));
  d.cash = 0; g.cash += out.gp; flow(g, d, out.lp, out.gp);
  d.promotePaid += out.promote; g.stats.promoteEarned += out.promote; g.stats.lpDistributed += out.lp;

  const sum = (f: (x: { lp: number; gp: number }) => number, sign: 1 | -1) => d.flows.reduce((s, x) => s + (sign * f(x) > 0 ? sign * f(x) : 0), 0);
  const lpIn = sum((x) => x.lp, -1), lpOut = sum((x) => x.lp, 1), gpIn = sum((x) => x.gp, -1), gpOut = sum((x) => x.gp, 1);
  const lpIrr = lpIn > 0 ? irrAnnual(denseFlows(d.flows.map((x) => ({ m: x.m, amt: x.lp })))) : NaN;
  const gpIrr = irrAnnual(denseFlows(d.flows.map((x) => ({ m: x.m, amt: x.gp }))));
  const months = Math.round((g.day - d.closeDay) / DAYS_PER_MONTH);
  d.result = {
    salePrice: price, netProceeds: net, loanRepaid: repaid, totalCost: d.costToDate, profit: net - d.costToDate,
    lpIrr, gpIrr, lpMultiple: lpIn > 0 ? lpOut / lpIn : NaN, gpMultiple: gpIn > 0 ? gpOut / gpIn : NaN,
    lpIn, lpOut, gpIn, gpOut, promote: d.promotePaid, devFee: d.devFeePaid, months,
    plan: { cost: b.total, noi: uw.noi, cap: uw.cap, months: uw.conMonths + uw.leaseUp + uw.holdMonths, lpIrr: uw.lpIrr },
    actual: { cost: d.costToDate, noi, cap: noi / price, months, lpIrr },
  };
  d.phase = 'sold'; d.sale.stage = 'none'; getParcel(g, d.parcelId).status = 'sold';
  g.trackRecord++;
  const lp = d.lpId ? getNpc(g, d.lpId) : null;
  if (lp) {
    const delta = lpIrr >= 0.18 ? 12 : lpIrr >= 0.12 ? 7 : lpIrr >= lp.pref! ? 3 : lpIrr >= 0 ? -5 : -15;
    bumpRep(g, 'investors', delta); lp.rel = clamp(lp.rel + delta * 1.5, 0, 100);
  }
  bumpRep(g, 'lenders', 5); bumpRep(g, 'brokers', 3);
  const lender = getNpc(g, d.loan!.lenderId); lender.rel = clamp(lender.rel + 8, 0, 100);
  unlock(g, 'irr', 'multiple', 'waterfall');
  log(g, d, `Sold for ${$(price)}.`);
  news(g, `${d.name} sold for ${$(price)}.`, 'good');
  decide(g, { kind: 'result', dealId: d.id, title: `${d.name} sold`, body: '', options: [{ id: 'ok', label: 'Continue' }] });
  checkAchievements(g);
  if (d.type === 'spec' && !g.flags.scenarioDone && g.deals.some((x) => x.type === 'ios' && x.phase === 'sold')) {
    g.flags.scenarioDone = true;
    notice(g, 'Scenario complete', `You delivered an IOS yard and a spec building and paid your investors. Firm cash stands at ${$(g.cash)}. Keep playing in sandbox mode, or start over and try to beat your returns.`);
  }
}

// ---------- refinance ----------

/** Quote a permanent loan to replace the construction loan and cash out equity without selling. */
export function refiQuote(g: Game, d: Deal) {
  const rate = g.difficulty === 'pro' ? g.market.baseRate + PERM.proSpread : PERM.rookieRate;
  const est = estimateValue(g, d), noi = contractRent(g, d);
  const size = sizePermLoan({ noi, value: est.value, rate, amortYears: PERM.amortYears, minDscr: PERM.minDscr, maxLtv: PERM.maxLtv, minDebtYield: PERM.minDebtYield });
  const loan = round(size.loan, 5000), fee = loan * PERM.fee, payoff = d.loan?.balance ?? 0;
  const eligible = d.phase === 'operations' && fullyLeased(d) && currentRent(g, d) > 0 && d.sale.stage === 'none' && !d.loan?.perm;
  return { rate, loan, fee, payoff, proceeds: loan - fee - payoff, binding: size.binding, value: est.value, noi, eligible };
}

export function refinance(g: Game, id: string): Result {
  const d = getDeal(g, id), q = refiQuote(g, d);
  if (!q.eligible) return no('Refinancing needs a fully leased property with rent flowing and no sale in progress.');
  if (q.proceeds < 0) return no(`The new loan would not cover the old one. You would have to bring ${$(-q.proceeds)}.`);
  d.loan = { lenderId: d.loan!.lenderId, commit: q.loan, balance: q.loan, rate: q.rate, perm: true };
  d.costToDate += q.fee;
  d.cash += q.proceeds;
  const reserve = q.loan * (q.rate / 12) * 2, amt = Math.max(0, d.cash - reserve);
  const out = payOut(d.acct!, amt);
  d.cash -= amt; g.cash += out.gp; flow(g, d, out.lp, out.gp);
  d.promotePaid += out.promote; g.stats.promoteEarned += out.promote; g.stats.lpDistributed += out.lp;
  bumpRep(g, 'lenders', 2); unlock(g, 'refi', 'dscr'); g.flags.refi = true; checkAchievements(g);
  log(g, d, `Refinanced with a ${$(q.loan)} permanent loan at ${(q.rate * 100).toFixed(2)}%. Paid out ${$(amt)} to the partners.`);
  news(g, `${d.name} refinanced. ${$(amt)} went to you and your investors, and you still own it.`, 'good');
  return ok(`Refinanced. ${$(out.lp)} went to investors and ${$(out.gp)} to you.`);
}

// ---------- staff ----------

export const staffCost = (g: Game) => (Object.keys(STAFF) as StaffKey[]).reduce((s, k) => s + (g.staff[k] ? STAFF[k].salary : 0), 0);

export function setStaff(g: Game, k: StaffKey, on: boolean): Result {
  if (g.staff[k] === on) return ok('');
  if (!on && k !== 'leasing' && activeDeals(g).length > maxActive(g) - 1) return no('You have too many deals in pursuit to let them go right now.');
  g.staff[k] = on;
  news(g, on ? `You hired ${k === 'analyst' ? 'an analyst' : k === 'pm' ? 'a project manager' : 'a leasing agent'}. Overhead is up ${$(STAFF[k].salary)} a month.` : `You let your ${STAFF[k].label.toLowerCase()} go.`, 'info');
  return ok(on ? `${STAFF[k].label} hired.` : `${STAFF[k].label} let go.`);
}

// ---------- ending a career ----------

/** End the career now and count what the firm owns at today's values. */
export function retire(g: Game): Result {
  if (g.over) return no('This career is already over.');
  g.over = true; g.decisions = [];
  g.ending = { how: 'retired', text: `${g.firmName} retires after ${Math.round(g.day / 36) / 10} years and ${g.trackRecord} completed deal${g.trackRecord === 1 ? '' : 's'}. Properties you still own are counted at what they would sell for today.` };
  return ok('Career over.');
}

// ---------- milestones ----------

export function checkAchievements(g: Game) {
  for (const a of ACHIEVEMENTS) {
    if (g.achievements.includes(a.id) || !a.test(g)) continue;
    g.achievements.push(a.id);
    if (a.unlock && !g.unlocked.includes(a.unlock)) g.unlocked.push(a.unlock);
    for (const [k, v] of Object.entries(a.rep ?? {})) bumpRep(g, k as RepKey, v);
    notice(g, `Milestone: ${a.title}`, `${a.desc} ${a.reward}`, undefined, a.unlock ? { who: 'analyst', line: a.unlock === 'acq' ? 'Existing properties are marked on the map with their buildings already standing. Buying one skips the hearing and the construction risk, and the price reflects that.' : 'A new property type means new tenants, new risks and different math. Read the first pro forma closely.' } : undefined);
    news(g, `Milestone reached: ${a.title}. ${a.reward}`, 'good');
  }
}

// ---------- relationships ----------

export function network(g: Game, npcId: string, kind: 'coffee' | 'outing'): Result {
  const n = getNpc(g, npcId);
  const ap = kind === 'coffee' ? 1 : 2, cost = kind === 'coffee' ? 150 : 1500;
  if (g.attention < ap) return no('You are out of attention this month. It refills on the 1st.');
  if (g.cash < cost) return no('Not enough cash.');
  g.attention -= ap; g.cash -= cost;
  const gain = Math.round(kind === 'coffee' ? between(g, 4, 7) : between(g, 11, 15));
  n.rel = clamp(n.rel + gain, 0, 100);
  const key: RepKey = n.role === 'lp' ? 'investors' : n.role === 'lender' ? 'lenders' : n.role === 'city' ? 'city' : n.role === 'tenantrep' ? 'tenants' : 'brokers';
  bumpRep(g, key, 1);
  if (npcId === 'dusty' && n.rel >= 60 && !g.flags.pocket) { g.flags.pocket = true; news(g, 'Dusty shared two pocket listings. Look for them on the map.', 'good'); }
  return ok(`${n.name}: relationship +${gain}.`);
}

// ---------- decisions ----------

export function resolveDecision(g: Game, decId: number, optionId: string): Result {
  const i = g.decisions.findIndex((x) => x.id === decId);
  if (i < 0) return no('That decision is no longer open.');
  const dec = g.decisions[i];
  g.decisions.splice(i, 1);
  const d = dec.dealId ? getDeal(g, dec.dealId) : null;
  let msg = '';
  switch (dec.kind) {
    case 'ddDeadline':
      if (optionId === 'extend') { spendPursuit(g, d!, 7500); d!.ddDeadline = g.day + 30; msg = 'Extended 30 days for $7,500.'; }
      else if (optionId === 'proceed') return finishDD(g, d!.id);
      else return walkDeal(g, d!.id);
      break;
    case 'finding': {
      const { key, cost } = dec.data as { key: string; cost: number };
      if (optionId === 'walk') return walkDeal(g, d!.id);
      if (optionId === 'credit') {
        const p = getParcel(g, d!.parcelId);
        const odds = (key === 'env' ? (p.hidden.env === 'major' ? 0.45 : 0.6) : key === 'easement' ? 0.55 : 0.5) + (getNpc(g, 'dusty').rel - 50) / 250;
        if (chance(g, odds)) {
          const credit = round(cost * (key === 'env' && p.hidden.env === 'major' ? 0.75 : 1), 500);
          d!.price -= credit; log(g, d!, `Seller agreed to a ${$(credit)} price cut.`); msg = `The seller agreed to cut the price by ${$(credit)}.`;
        } else { log(g, d!, 'Seller refused a price cut.'); msg = 'The seller refused. The cost is in your budget now; you can still walk from the deal room.'; }
      } else msg = 'Added to the budget.';
      break;
    }
    case 'entDenied':
      if (optionId === 'reapply') return startEntitlement(g, d!.id, d!.ent.attorney, true);
      return walkDeal(g, d!.id);
    case 'changeOrder': {
      const { cost } = dec.data as { cost: number };
      if (optionId === 'approve') { overrun(g, d!, cost); msg = `Change order approved: ${$(cost)}.`; }
      else if (chance(g, 0.5)) msg = 'The contractor backed down. No cost.';
      else { overrun(g, d!, cost * 0.6); d!.con!.delayDays += 15; msg = `You settled at ${$(cost * 0.6)} and lost two weeks arguing.`; }
      log(g, d!, msg);
      break;
    }
    case 'prospect': {
      const p = d!.prospect;
      if (!p) break;
      if (optionId === 'accept') { signLease(g, d!); msg = 'Lease signed.'; }
      else if (optionId === 'pass') { d!.prospect = null; msg = 'You passed. Marketing continues.'; }
      else {
        p.countered = true;
        const r = rand(g), okOdds = 0.45 + (getNpc(g, 'priya').rel - 30) / 200 + (g.staff.leasing ? 0.1 : 0);
        if (r < okOdds) { p.rentAnnual = round(p.rentAnnual * 1.04, 100); p.lc = round(p.lc * 1.04, 100); signLease(g, d!); msg = 'They accepted your counter. Lease signed at the higher rent.'; }
        else if (r < okOdds + 0.3) { offerProspect(g, d!); msg = 'They held firm at their original offer.'; }
        else { d!.prospect = null; msg = 'They walked and signed somewhere else.'; }
      }
      break;
    }
    case 'bids': {
      if (optionId === 'hold') { d!.sale = { stage: 'none', day: 0, bid: null }; msg = 'You kept the property.'; break; }
      const bid = (dec.data as { bids: Bid[] }).bids[Number(optionId.slice(1))];
      d!.sale = { stage: 'closing', day: g.day + 30, bid };
      log(g, d!, `Accepted ${bid.buyer} at ${$(bid.price)}. Closing in 30 days.`);
      msg = `Under contract with ${bid.buyer}. Closing in 30 days.`;
      break;
    }
    case 'retrade': {
      const bid = d!.sale.bid!;
      if (optionId === 'accept') { completeSale(g, d!, round(bid.price * 0.97, 1000)); msg = 'You took the lower price and closed.'; }
      else { d!.sale = { stage: 'marketing', day: g.day + 45, bid: null }; msg = 'Back on the market. New offers in 45 days.'; }
      break;
    }
    case 'gameover': break;
    default: break;
  }
  return ok(msg);
}

// ---------- the clock ----------

export function advanceDay(g: Game) {
  if (g.over || g.decisions.length) return;
  g.day++;
  for (const d of g.deals) {
    if (d.phase === 'dead' || d.phase === 'sold') continue;
    for (const r of ['env', 'survey', 'geo'] as ReportId[]) if (d.reports[r].status === 'ordered' && g.day >= d.reports[r].doneDay) reportDone(g, d, r);
    if (d.phase === 'dd' && g.day >= d.ddDeadline && !g.decisions.some((x) => x.dealId === d.id && x.kind === 'ddDeadline')) {
      decide(g, {
        kind: 'ddDeadline', dealId: d.id, title: 'Due diligence period is ending',
        body: `Your 60 days on ${d.name} are up. After today your ${$(d.earnest)} of earnest money is at risk.`,
        advisor: { who: 'attorney', line: 'If reports are still out, pay for the extension. It is cheap next to a deposit.' },
        options: [
          { id: 'extend', label: 'Extend 30 days', detail: '$7,500 non-refundable fee.' },
          { id: 'proceed', label: 'Finish due diligence and go hard' },
          { id: 'walk', label: 'Walk away', detail: 'Your earnest money comes back.' },
        ],
      });
    }
    if (d.phase === 'entitlement' && d.ent.status === 'pending' && g.day >= d.ent.decisionDay) entitlementDecision(g, d);
    if (d.phase === 'construction' && d.con) {
      if (d.con.delayDays > 0) d.con.delayDays--; else d.con.daysDone++;
      if (!d.con.surprisesDone && d.con.daysDone >= d.con.daysTotal * 0.3) surprises(g, d);
      if (d.con.daysDone >= d.con.daysTotal) finishConstruction(g, d);
    }
    if (d.sale.stage === 'marketing' && g.day >= d.sale.day) { d.sale.day = 1e9; callForOffers(g, d); }
    if (d.sale.stage === 'closing' && g.day >= d.sale.day) closing(g, d);
  }
  if (g.day % DAYS_PER_MONTH === 0) monthClose(g);
}

function surprises(g: Game, d: Deal) {
  const p = getParcel(g, d.parcelId), con = d.con!;
  con.surprisesDone = true;
  const lines: string[] = [];
  if (!d.known.env && p.hidden.env !== 'none') {
    const c = COMMON.cleanup[p.hidden.env] * COMMON.surprisePenalty; overrun(g, d, c);
    if (p.hidden.env === 'major') con.delayDays += 45;
    lines.push(`Crews hit contaminated soil. Emergency cleanup: ${$(c)}${p.hidden.env === 'major' ? ' and six weeks of delay' : ''}.`);
  }
  if (!d.known.soils && p.hidden.soils === 'expansive') {
    const c = (d.type === 'ios' ? d.uw!.usableAcres * 43560 * IOS.soilsPsf : d.uw!.buildingSf * SPEC.soilsPsf) * COMMON.surprisePenalty; overrun(g, d, c);
    lines.push(`The subgrade is expansive clay. Unplanned lime stabilization: ${$(c)}.`);
  }
  if (!d.known.easement && p.hidden.easementAcres > 0) {
    if (d.type === 'ios') { d.uw!.usableAcres -= p.hidden.easementAcres; lines.push(`A pipeline easement nobody surveyed takes ${p.hidden.easementAcres} acres out of the yard. You will collect less rent.`); }
    else { const c = p.hidden.easementAcres * 90000; overrun(g, d, c); lines.push(`A pipeline easement forces a redesign of the truck court: ${$(c)}.`); }
  }
  d.known = { env: true, soils: true, easement: true };
  if (lines.length) {
    for (const l of lines) log(g, d, l);
    notice(g, 'Surprise on site', lines.join(' '), d, { who: 'cm', line: 'A report during due diligence would have caught this for a fraction of the price.' });
  }
}

function finishConstruction(g: Game, d: Deal) {
  payProgress(g, d);
  d.con!.doneDay = g.day;
  d.phase = fullyLeased(d) ? 'operations' : 'leasing';
  if (!d.acq) for (const l of d.leases) l.startDay = g.day;
  const saved = d.con!.contingencyLeft;
  log(g, d, 'Construction complete.');
  notice(g, d.acq ? 'Renovation complete' : 'Construction complete', `${d.name} is finished${saved > 1000 ? ` with ${$(saved)} of contingency unspent` : d.con!.overrun > 0 ? `, ${$(d.con!.overrun)} over the contingency` : ''}. ${d.type === 'mf' ? 'Leasing starts now, a few units at a time.' : fullyLeased(d) ? (d.acq ? 'It is fully leased.' : 'Your tenant moves in now.') : d.leases.length ? 'Half the building still needs a tenant.' : 'Now it needs a tenant.'}`, d,
    { who: 'cm', line: d.con!.overrun > 0 ? 'We went over. Every dollar past contingency came out of the owners\' pockets.' : 'On budget. Unspent contingency means a smaller loan to carry.' });
}

function payProgress(g: Game, d: Deal) {
  const con = d.con!, b = d.budget!;
  const frac = Math.min(1, con.daysDone / con.daysTotal), delta = frac - con.paidFrac;
  if (delta <= 0) return;
  pay(g, d, con.hardBudget * delta + b.soft * 0.6 * delta);
  const fee = b.devFee * delta;
  pay(g, d, fee); g.cash += fee; d.devFeePaid += fee; g.stats.feesEarned += fee;
  con.paidFrac = frac;
}

function constructionEvents(g: Game, d: Deal) {
  const gc = getNpc(g, d.gcId!), con = d.con!;
  const pm = g.staff.pm ? 0.6 : 1;
  if (chance(g, (gc.delayRisk ?? 0.1) * pm)) {
    const days = Math.round(between(g, 8, 18)); con.delayDays += days;
    news(g, `${d.name}: ${pick(g, ['a week of storms', 'a short-handed crew', 'a late material delivery', 'a stretch of 105-degree days'])} cost ${days} days.`, 'bad');
    log(g, d, `Schedule slipped ${days} days.`); return;
  }
  if (chance(g, 0.1)) {
    const c = con.hardBudget * between(g, 0.008, 0.02); overrun(g, d, c);
    news(g, `${d.name}: ${d.type === 'ios' ? 'rock and base material' : 'concrete and steel'} prices jumped. ${$(c)} came out of contingency.`, 'bad');
    log(g, d, `Material price increase: ${$(c)}.`); return;
  }
  const coRate = gc.id === 'redriver' ? 0.2 : gc.id === 'cowtown' ? 0.1 : 0.06;
  if (chance(g, coRate * pm)) {
    const cost = round(con.hardBudget * between(g, 0.008, 0.018), 500);
    decide(g, {
      kind: 'changeOrder', dealId: d.id, title: 'Change order request',
      body: `${gc.name} wants ${$(cost)} more for ${pick(g, ['unsuitable fill they had to haul off', 'a utility line that was not on the drawings', 'extra drainage the inspector asked for'])}. You have ${$(con.contingencyLeft)} of contingency left.`,
      advisor: { who: 'cm', line: 'Some change orders are fair. Fighting one can save money or cost you two weeks.' },
      data: { cost },
      options: [{ id: 'approve', label: `Approve ${$(cost)}` }, { id: 'fight', label: 'Dispute it', detail: 'Even odds: no cost, or a partial payment plus a two-week delay.' }],
    });
  }
}

function closing(g: Game, d: Deal) {
  const bid = d.sale.bid!;
  if (bid.kind === 'private' && bid.note !== 'retraded' && chance(g, 0.35)) {
    bid.note = 'retraded'; d.sale.day = 1e9;
    decide(g, {
      kind: 'retrade', dealId: d.id, title: 'The buyer wants a price cut',
      body: `${bid.buyer} says their inspection found issues and asks for 3% off, or ${$(bid.price * 0.97)}.`,
      advisor: { who: 'broker', line: 'This is a re-trade. They are betting you would rather take the haircut than start over.' },
      options: [{ id: 'accept', label: 'Accept the lower price and close' }, { id: 'remarket', label: 'Refuse and go back to market', detail: 'New offers in 45 days.' }],
    });
    return;
  }
  if (bid.kind === 'syndicator' && chance(g, 0.3)) {
    d.sale = { stage: 'marketing', day: g.day + 30, bid: null };
    notice(g, 'The buyer could not close', `${bid.buyer} failed to raise their money. ${d.name} goes back on the market for 30 days.`, d, { who: 'broker', line: 'The highest bid only counts if it closes.' });
    return;
  }
  completeSale(g, d, bid.price);
}

function monthClose(g: Game) {
  const m = monthOf(g.day);
  for (const d of g.deals) {
    if (!d.budget || d.phase === 'sold' || d.phase === 'dead') continue;
    const a = d.acct!, loan = d.loan!;
    accrue(a);
    if (d.phase === 'construction') { payProgress(g, d); constructionEvents(g, d); }
    const rent = currentRent(g, d) / 12;
    d.cash += rent;
    if (d.phase === 'leasing') pay(g, d, d.budget.total * COMMON.vacantCarryPctMonthly * (1 - leasedShare(d)));
    if (g.difficulty === 'pro' && !loan.perm && loan.spread !== undefined) loan.rate = g.market.baseRate + loan.spread;
    // interest: capitalized into the loan until rent starts, then paid from cash
    const interest = loan.balance * (loan.rate / 12);
    if (interest > 0) {
      d.costToDate += rent > 0 ? 0 : interest;
      if (rent <= 0 && loan.balance + interest <= loan.commit) loan.balance += interest;
      else if (d.cash >= interest) d.cash -= interest;
      else if (loan.balance + interest <= loan.commit) loan.balance += interest;
      else { const short = interest - d.cash; d.cash = 0; capitalCall(g, d, short); }
    }
    // leasing
    if (!fullyLeased(d) && !d.prospect && d.type !== 'mf' && (d.phase === 'leasing' || (d.phase === 'construction' && d.type !== 'ios' && (d.acq || d.con!.daysDone >= d.con!.daysTotal * 0.5)))) {
      if (chance(g, arrivalOdds(g, d))) { d.prospect = makeProspect(g, d); offerProspect(g, d); }
    }
    // apartments fill a few units at a time instead of signing one big lease
    if (d.type === 'mf' && d.phase !== 'construction') {
      const askF = d.askFactor <= 0.95 ? 1.4 : d.askFactor <= 1 ? 1 : d.askFactor <= 1.05 ? 0.6 : 0.3;
      const target = d.askFactor > 1.05 ? 0.86 : d.askFactor > 1 ? 0.91 : 0.95;
      const pace = 0.095 * askF * districtOf(g, d).demand * (g.staff.leasing ? 1.3 : 1) * (d.spec.extras || d.reno === 'reposition' ? 1.15 : 1) * (g.difficulty === 'pro' ? CYCLE[g.cycle.phase].demand : 1);
      d.occ = d.occ < target ? Math.min(target, d.occ + pace) : Math.max(target, d.occ - 0.02);
      if (d.phase === 'leasing' && fullyLeased(d)) { d.phase = 'operations'; notice(g, 'Stabilized', `${d.name} has reached ${Math.round(d.occ * 100)}% occupancy. Lenders and buyers now treat it as a stabilized property.`, d, { who: 'analyst', line: 'Apartments re-price every time a lease turns, so rent follows the market up and down faster than any other property type.' }); }
      else if (d.phase === 'operations' && !fullyLeased(d) && d.sale.stage === 'none') d.phase = 'leasing';
    }
    // a repair bill nobody inspected for shows up a few months after a purchase
    if (d.acq && !g.flags[`pcr-${d.id}`] && g.day - d.closeDay >= 90) {
      g.flags[`pcr-${d.id}`] = true;
      const ex = getParcel(g, d.parcelId).existing!;
      if (!d.known.soils && ex.deferred > 0) { const c = ex.deferred * 1.5; pay(g, d, c); notice(g, 'The roof failed', `${d.name} needed emergency repairs: ${$(c)}. A property condition report would have found this before you bought it.`, d, { who: 'cm', line: 'The inspection costs $14,000. Skipping it cost a great deal more.' }); }
    }
    // leases run out: the tenant renews at today's rent or leaves
    for (const l of [...d.leases]) {
      if (g.day - l.startDay < l.termMonths * DAYS_PER_MONTH || d.sale.stage === 'closing') continue;
      const mkt = round(marketNoi(g, d) * l.share, 100);
      if (chance(g, 0.62 + (g.rep.tenants - 30) / 300)) { const old = leaseRent(g, l, true); Object.assign(l, { rentAnnual: mkt, startDay: g.day, termMonths: 60, freeMonths: 0, escal: 0.03 }); news(g, `${l.tenant} renewed at ${d.name} for five years at ${$(mkt)} a year (was ${$(old)}).`, mkt >= old ? 'good' : 'bad'); log(g, d, `${l.tenant} renewed at ${$(mkt)}/yr.`); }
      else { d.leases = d.leases.filter((x) => x !== l); if (d.phase === 'operations') d.phase = 'leasing'; if (d.sale.stage === 'marketing') d.sale = { stage: 'none', day: 0, bid: null }; notice(g, 'A lease expired', `${l.tenant} did not renew at ${d.name} and has moved out. That space is on the market again.`, d, { who: 'broker', line: 'Every lease ends eventually. Buyers pay less for a building whose leases are about to roll.' }); }
    }
    // operations
    if (d.phase === 'operations' && d.leases.length) {
      const bad = d.leases.find((l) => leaseRent(g, l, false) > 0 && chance(g, l.credit === 'C' ? 0.012 : l.credit === 'B' ? 0.002 : 0));
      if (bad && d.sale.stage !== 'closing') {
        d.leases = d.leases.filter((l) => l !== bad); d.phase = 'leasing'; d.sale = { stage: 'none', day: 0, bid: null };
        notice(g, 'Your tenant defaulted', `${bad.tenant} stopped paying rent and moved out of ${d.name}. ${d.leases.length ? 'Half the building is vacant again.' : 'The property is vacant again.'}`, d, { who: 'broker', line: 'Weak credit paid you more rent, and this is the other side of that trade.' });
      } else if (d.type !== 'ios' && m % 12 >= 2 && m % 12 <= 5 && chance(g, 0.02)) {
        const c = round(d.budget.hard * 0.01, 500); pay(g, d, c);
        news(g, `Hail hit ${d.name}. The insurance deductible cost ${$(c)}.`, 'bad');
      }
      if (m % 3 === 2) {
        const reserve = loan.balance * (loan.rate / 12) * 2;
        if (d.cash > reserve + 1000) {
          const amt = d.cash - reserve, out = payOut(a, amt);
          d.cash -= amt; g.cash += out.gp; flow(g, d, out.lp, out.gp);
          d.promotePaid += out.promote; g.stats.promoteEarned += out.promote; g.stats.lpDistributed += out.lp;
          news(g, `${d.name} paid a quarterly distribution of ${$(amt)}.`, 'good');
        }
      }
    }
  }
  // firm
  g.cash -= OVERHEAD + staffCost(g);
  if (g.cash < 0) g.cash += g.cash * 0.0125;
  g.attention = 4;
  const mk = g.market;
  if (g.difficulty === 'pro') {
    // Pro: a market cycle moves rents, cap rates, costs and interest rates together
    const c = CYCLE[g.cycle.phase];
    mk.iosRent *= 1 + c.rent + between(g, -0.002, 0.002);
    mk.indRent *= 1 + c.rent + between(g, -0.002, 0.002);
    mk.costIndex *= 1 + c.cost; mk.landIndex *= 1 + c.rent * 0.8 + 0.001;
    mk.iosCap = clamp(mk.iosCap + c.cap + between(g, -0.0002, 0.0002), 0.06, 0.095);
    mk.indCap = clamp(mk.indCap + c.cap + between(g, -0.0002, 0.0002), 0.048, 0.08);
    mk.baseRate = clamp(mk.baseRate + c.rate, 0.025, 0.07);
    if (--g.cycle.monthsLeft <= 0) {
      const next = CYCLE_NEXT[g.cycle.phase], n = CYCLE[next];
      g.cycle = { phase: next, monthsLeft: Math.round(between(g, n.months[0], n.months[1])) };
      unlock(g, 'cycle');
      const text = { peak: 'The market is peaking. Rent growth is slowing and lenders are getting pickier.', contraction: 'The market has turned. Rents are slipping, buyers want higher cap rates and investors are cautious.', recovery: 'The market is finding its floor. Tenants are touring again and rates are easing.', expansion: 'The market is expanding again. Rents and values are rising.' }[next];
      notice(g, `Market shift: ${n.label.toLowerCase()}`, text, undefined, { who: 'analyst', line: next === 'contraction' ? 'Deals underwritten at the top get tested now. Watch your interest reserves and do not count on today\'s exit cap rate.' : next === 'expansion' ? 'Land bought in the slump is about to look smart.' : 'Worth re-running the numbers on anything not yet under construction.' });
    }
  } else {
    // Rookie: steady growth
    mk.iosRent *= 1.0025 + between(g, -0.002, 0.002);
    mk.indRent *= 1.0025 + between(g, -0.002, 0.002);
    mk.costIndex *= 1.002; mk.landIndex *= 1.003;
    mk.iosCap = clamp(mk.iosCap + between(g, -0.0002, 0.0002), 0.06, 0.085);
    mk.indCap = clamp(mk.indCap + between(g, -0.0002, 0.0002), 0.048, 0.07);
  }
  g.marketHistory.push({ m, iosRent: mk.iosRent, indRent: mk.indRent });
  if (g.marketHistory.length > 120) g.marketHistory.shift();
  if (m > 2 && chance(g, 0.07)) { const e = pick(g, WORLD_EVENTS); e.apply(g); news(g, e.text, e.tone); }
  if (m > 5 && chance(g, 0.12)) {
    const open = g.parcels.filter((p) => p.status === 'available' && !['bluemound', 'northlake10'].includes(p.id));
    if (open.length > 18) { const p = pick(g, open); p.status = 'rival'; news(g, `${pick(g, RIVALS)} bought ${p.name.replace(/ \(.*\)/, '')}.`, 'info'); }
  }
  if (g.career && m >= g.career * 12) {
    g.over = true;
    g.ending = { how: 'complete', text: `${g.career} years are up. ${g.firmName} closes the books on ${g.trackRecord} completed deal${g.trackRecord === 1 ? '' : 's'}. Properties you still own are counted at what they would sell for today.` };
    return;
  }
  if (m % 12 === 0) {
    const live = g.deals.filter((d) => !['dead', 'sold'].includes(d.phase)).length;
    notice(g, `Year ${2027 + m / 12} begins`, `Firm cash: ${$(g.cash)}. Completed deals: ${g.trackRecord}. Active deals: ${live}. Fees earned so far: ${$(g.stats.feesEarned)}. Promote earned: ${$(g.stats.promoteEarned)}. Paid to investors: ${$(g.stats.lpDistributed)}.`);
  }
  checkAchievements(g);
  if (g.cash < -LOC_LIMIT) {
    g.over = true;
    g.ending = { how: 'bust', text: `Your firm is ${$(-g.cash)} overdrawn and the bank has called its line of credit. Most developers who fail run out of cash, not ideas.` };
  }
}
export { askPrice } from './proforma';
