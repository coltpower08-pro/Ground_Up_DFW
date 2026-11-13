// Underwriting: turns a parcel plus the player's design and capital choices into a
// budget, returns and a deal score.
import { accrue, irrAnnual, payOut, sizeConstructionLoan } from './finance';
import { COMMON, ENT, IOS, MF_FULL, PRODUCTS, RENO, SF_PER_ACRE, SPEC, TERMS, type ProductKey } from './params';
import { DISTRICTS } from '../content/world';
import type { Budget, Deal, DealType, EquityAcct, Game, Grade, Npc, Parcel, Proforma } from './types';

export const getParcel = (g: Game, id: string): Parcel => g.parcels.find((p) => p.id === id)!;
export const districtOf = (g: Game, d: Deal) => DISTRICTS[getParcel(g, d.parcelId).district];
/** Market cap rate for this deal's property type in its district. */
export const typeCap = (g: Game, type: DealType) => (type === 'ios' ? g.market.iosCap : type === 'spec' ? g.market.indCap : PRODUCTS[type].cap + (g.market.indCap - 0.0625));
export const baseCap = (g: Game, d: Deal) => typeCap(g, d.type) + districtOf(g, d).cap;
export const leaseUpOf = (type: DealType) => (type === 'ios' ? IOS.leaseUpMonths : type === 'spec' ? SPEC.leaseUpMonths : PRODUCTS[type].leaseUp);

/** Market rent per unit for a site before design choices: $/acre/month for yards, net $/SF/year for buildings. */
export function rentBasis(g: Game, p: Parcel, type: DealType, usable: number): number {
  const dist = DISTRICTS[p.district], access = COMMON.accessRent[p.access];
  if (type === 'ios') return g.market.iosRent * dist.ios * access * (p.rail ? COMMON.railRent : 1) * Math.max(0.8, Math.min(1, 1 - (usable - 4) * 0.0225));
  if (type === 'spec') return g.market.indRent * dist.ind * access;
  return PRODUCTS[type].noiPsf * (g.market.indRent / 8.1) * dist.urban * access;
}
/** Full-market net income of an existing property at a given rent multiplier. */
export function existingMarketNoi(g: Game, p: Parcel, mult = 1): number {
  const ex = p.existing!, usable = usableAcres(p);
  const unit = rentBasis(g, p, ex.type, usable) * mult;
  return ex.type === 'ios' ? unit * usable * 12 : unit * ex.sf;
}
export const existingLeased = (p: Parcel) => (p.existing!.type === 'mf' ? Math.min(1, (p.existing!.occ ?? 0) / MF_FULL) : p.existing!.leases.reduce((s, l) => s + l.share, 0));
/** Asking price of an existing property: leased space at about the market cap rate, vacant space at a discount. */
export function existingPrice(g: Game, p: Parcel): number {
  const ex = p.existing!, cap = typeCap(g, ex.type) + DISTRICTS[p.district].cap, full = existingMarketNoi(g, p, ex.cond === 'tired' ? RENO.asis.tired : 1), ls = existingLeased(p);
  // priced the way a buyer would price it at a sale: each lease at its own cap rate, empty space at a discount
  const leased = ex.type === 'mf' ? (full * ls) / cap : ex.leases.reduce((s, l) => s + l.rentAnnual / (cap + (l.credit === 'A' ? -0.0025 : l.credit === 'C' ? 0.0035 : 0) + (l.monthsLeft < 36 ? 0.003 : l.monthsLeft > 84 ? -0.001 : 0)), 0);
  return Math.round((leased + (((1 - ls) * full) / (cap + 0.0075)) * 0.9 - ex.deferred * 0.4) / 5000) * 5000;
}
export const getNpc = (g: Game, id: string): Npc => g.npcs.find((n) => n.id === id)!;

export const askPrice = (g: Game, p: Parcel) => (p.existing ? existingPrice(g, p) : Math.round((p.acres * SF_PER_ACRE * p.askPsf * g.market.landIndex) / 1000) * 1000);

/** Acres that can earn rent, based on what the player knows so far. */
export function usableAcres(p: Parcel, d?: Deal): number {
  const ease = d?.known.easement ? p.hidden.easementAcres : 0;
  return Math.max(0.5, p.acres * (1 - p.floodPct) - ease);
}

export function entitlementKind(p: Parcel, type: DealType): keyof typeof ENT {
  if (p.existing) return 'none';
  if (p.zoning === 'ETJ') return 'plat';
  if (type === 'ios' || type === 'spec') return p.zoning === 'I' ? 'none' : p.zoning === 'C' ? (type === 'ios' ? 'sup' : 'rezone') : 'rezone';
  if (type === 'mf') return p.zoning === 'C' ? 'sup' : 'rezone'; // apartments almost always need a hearing
  return p.zoning === 'C' ? 'none' : p.zoning === 'I' ? 'sup' : 'rezone'; // retail and office belong on commercial land
}

export function eligibleLenders(g: Game): Npc[] {
  return g.npcs.filter((n) => n.role === 'lender' && (!n.proOnly || g.difficulty === 'pro') && (n.id !== 'trinityregional' || n.rel >= 35 || g.trackRecord >= 1) && (n.id !== 'lifeco' || g.trackRecord >= 3));
}
const lenderLtc = (n: Npc) => (n.ltc ?? 0.6) + ((n.id === 'trinityregional' && n.rel >= 50) || (n.id === 'crosstimbers' && n.rel >= 60) ? 0.05 : 0);
/** Rookie: each lender's fixed rate. Pro: floating, base rate plus the lender's spread. */
export const lenderRate = (g: Game, n: Npc) => (g.difficulty === 'pro' ? g.market.baseRate + (n.spread ?? 0.035) : n.rate ?? 0.08);

export function scoreDeal(spread: number, margin: number): Grade {
  let s: Grade = spread >= 0.0175 ? 'A' : spread >= 0.0125 ? 'B' : spread >= 0.0075 ? 'C' : spread >= 0.0025 ? 'D' : 'F';
  if (margin < 0.08 && (s === 'A' || s === 'B' || s === 'C')) s = 'D';
  return s;
}

/** The waterfall terms for this deal: the investor's terms, adjusted in Pro by what the player asked for. */
export function dealTerms(g: Game, d: Deal) {
  const lp = d.lpId ? getNpc(g, d.lpId) : null;
  const pro = g.difficulty === 'pro' && !!lp;
  const t = TERMS[d.terms];
  return {
    pref: lp?.pref ?? 0.08,
    promote: lp ? Math.max(0, (lp.promote ?? 0) + (pro ? t.promote : 0)) : 0,
    hurdle2: lp?.hurdle2 ?? 0.15,
    promote2: lp ? Math.max(0, (lp.promote2 ?? lp.promote ?? 0) + (pro ? t.promote2 : 0)) : 0,
    catchUp: pro && t.catchUp,
    tiered: pro,
  };
}

export function makeAcct(g: Game, d: Deal, lpEquity: number, gpEquity: number): EquityAcct {
  const equity = lpEquity + gpEquity, t = dealTerms(g, d);
  const a: EquityAcct = { lpCap: lpEquity, gpCap: gpEquity, lpPref: 0, gpPref: 0, lpShare: equity > 0 ? lpEquity / equity : 0, pref: t.pref, promote: t.promote };
  if (t.tiered) a.tier = { b1: equity, b2: equity, hurdle2: t.hurdle2, promote2: t.promote2, catchUp: t.catchUp, contrib: equity, paid: 0, promo: 0 };
  return a;
}

/** Project LP and GP returns for a simple build, lease, hold six months, sell path. */
export function projectReturns(a: EquityAcct, months: number, cash: number): { lpIrr: number; gpIrr: number; lpMultiple: number } {
  const lpEquity = a.lpCap, gpEquity = a.gpCap;
  for (let i = 0; i < months; i++) accrue(a);
  const r = payOut(a, Math.max(0, cash));
  const mk = (inv: number, out: number) => {
    const f = new Array(months + 1).fill(0); f[0] = -inv; f[months] = out; return irrAnnual(f);
  };
  return {
    lpIrr: lpEquity > 0 ? mk(lpEquity, r.lp) : NaN,
    gpIrr: gpEquity > 0 ? mk(gpEquity, r.gp) : NaN,
    lpMultiple: lpEquity > 0 ? r.lp / lpEquity : NaN,
  };
}

export function computeProforma(g: Game, d: Deal): Proforma {
  const p = getParcel(g, d.parcelId);
  const usable = usableAcres(p, d);
  const usableSf = usable * SF_PER_ACRE;
  const gc = d.gcId ? getNpc(g, d.gcId) : null;
  const gcFactor = gc?.costFactor ?? 1;
  const ci = g.market.costIndex;
  const cleanup = d.known.env ? COMMON.cleanup[p.hidden.env] : 0;
  const soilsBad = d.known.soils && p.hidden.soils === 'expansive';
  const dist = DISTRICTS[p.district];

  let hard = 0, soft = 0, devFee = 0, contingency = 0, leasing = 0, noi = 0, rentUnit = 0, buildingSf = 0, conMonths = 0, leaseUp = 0, cap = 0;

  let holdMonths: number = COMMON.holdMonths;
  if (d.acq) {
    // buying an existing property: price in place of land, renovation in place of construction
    const ex = p.existing!, plan = RENO[d.reno], mult = ex.cond === 'tired' ? plan.tired : plan.good;
    buildingSf = ex.sf;
    rentUnit = rentBasis(g, p, d.type, usable) * mult;
    const full = d.type === 'ios' ? rentUnit * usable * 12 : rentUnit * buildingSf;
    const ls = d.budget ? 1 : existingLeased(p), inPlace = d.type === 'mf' ? full * ls : ex.leases.reduce((t, l) => t + l.rentAnnual, 0);
    noi = d.type === 'mf' ? full : inPlace + (1 - ls) * full;
    hard = (d.type === 'ios' ? usableSf * plan.iosPsf : buildingSf * plan.psf) * ci * gcFactor + (d.known.soils ? ex.deferred : 0) + cleanup;
    soft = d.price * 0.005 + hard * 0.08; devFee = d.price * 0.01 + hard * 0.04; contingency = hard * 0.08;
    const vacant = 1 - ls;
    leasing = vacant * (d.type === 'ios' ? full * 5 * IOS.lcPct : d.type === 'spec' ? buildingSf * SPEC.tiPsf + full * 5 * SPEC.lcPct : buildingSf * PRODUCTS[d.type].tiPsf + full * 5 * PRODUCTS[d.type].lcPct);
    conMonths = plan.months; leaseUp = vacant > 0.05 ? Math.round(leaseUpOf(d.type) * Math.min(1, vacant + 0.3)) : 0; cap = typeCap(g, d.type) + dist.cap;
    holdMonths = ls >= 0.9 && existingLeased(p) >= 0.9 ? 36 : 24;
  } else if (d.type === 'ios') {
    const s = IOS.surface[d.ios.surface], sec = IOS.security[d.ios.security];
    hard = usableSf * s.cost * ci * gcFactor + sec.base + sec.perAcre * usable + cleanup + d.ent.conditionsCost
      + (soilsBad ? usableSf * IOS.soilsPsf : 0) + (!p.water || !p.sewer ? IOS.wellSeptic : 0);
    rentUnit = rentBasis(g, p, 'ios', usable) * s.rent * sec.rent;
    noi = rentUnit * usable * 12;
    soft = hard * IOS.softPct; devFee = hard * IOS.devFeePct; contingency = hard * IOS.contPct;
    leasing = noi * 5 * IOS.lcPct;
    conMonths = s.months + (gc?.monthsDelta ?? 0); leaseUp = IOS.leaseUpMonths; cap = g.market.iosCap + dist.cap;
  } else if (d.type === 'spec') {
    buildingSf = Math.round((usableSf * d.spec.coverage) / 1000) * 1000;
    const psf = SPEC.shell[d.spec.clear] + (d.spec.extras ? SPEC.extrasCost : 0);
    hard = buildingSf * psf * ci * gcFactor + cleanup + d.ent.conditionsCost
      + (soilsBad ? buildingSf * SPEC.soilsPsf : 0) + (!p.sewer ? SPEC.sewerExt : 0) + (!p.water ? SPEC.waterExt : 0);
    rentUnit = rentBasis(g, p, 'spec', usable) * SPEC.clearRent[d.spec.clear] * SPEC.coverageRent[d.spec.coverage] * (d.spec.extras ? SPEC.extrasRent : 1);
    noi = rentUnit * buildingSf;
    soft = hard * SPEC.softPct + buildingSf * SPEC.impactPsf; devFee = hard * SPEC.devFeePct; contingency = hard * SPEC.contPct;
    leasing = buildingSf * SPEC.tiPsf + noi * 5 * SPEC.lcPct;
    conMonths = SPEC.months + (gc?.monthsDelta ?? 0); leaseUp = SPEC.leaseUpMonths; cap = g.market.indCap + dist.cap;
  } else {
    // shopping centers, apartments and offices share one model; d.spec.extras means a premium finish
    const pr = PRODUCTS[d.type as ProductKey];
    buildingSf = Math.round((usableSf * pr.far) / 1000) * 1000;
    hard = buildingSf * (pr.cost + (d.spec.extras ? pr.premiumCost : 0)) * ci * gcFactor + cleanup + d.ent.conditionsCost
      + (soilsBad ? buildingSf * SPEC.soilsPsf : 0) + (!p.sewer ? SPEC.sewerExt : 0) + (!p.water ? SPEC.waterExt : 0);
    rentUnit = rentBasis(g, p, d.type, usable) * (d.spec.extras ? pr.premiumRent : 1);
    noi = rentUnit * buildingSf;
    soft = hard * pr.softPct + buildingSf * SPEC.impactPsf; devFee = hard * SPEC.devFeePct; contingency = hard * SPEC.contPct;
    leasing = buildingSf * pr.tiPsf + noi * 5 * pr.lcPct;
    conMonths = pr.months + (gc?.monthsDelta ?? 0); leaseUp = pr.leaseUp; cap = typeCap(g, d.type) + dist.cap;
  }

  const land = d.price, closing = land * (d.acq ? 0.005 : COMMON.closingPct), pursuit = d.pursuit;
  const subtotal = land + closing + hard + soft + pursuit + devFee + contingency + leasing;
  const value = noi / cap;
  const years = d.acq ? (conMonths * 0.55 + leaseUp) / 12 : Math.max(0.25, (conMonths * 0.55 + leaseUp) / 12);

  // lenders charge less against a building that already earns its keep
  const stabDisc = d.acq && existingLeased(p) >= 0.9 ? 0.015 : 0;
  const lenderOptions = eligibleLenders(g).map((n) => {
    const ltc = lenderLtc(n), rate = lenderRate(g, n) - stabDisc, fee = n.fee ?? COMMON.loanFeePct;
    const r = sizeConstructionLoan({ subtotal, ltc, rate, feePct: fee, avgOutstandingYears: years, maxLoan: n.maxLoan ?? 0, value, maxLtv: n.proOnly ? 0.78 : COMMON.maxLtv });
    return { id: n.id, loan: r.loan, financing: r.financing, total: r.total, rate, ltc, fee };
  });
  // Rookie: the bank lending the most wins (lowest rate breaks ties). Pro: the player's pick, if still eligible.
  const auto = [...lenderOptions].filter((o) => !getNpc(g, o.id).proOnly).sort((a, b) => (Math.abs(b.loan - a.loan) > 1 ? b.loan - a.loan : a.rate - b.rate))[0];
  const chosen = (g.difficulty === 'pro' && lenderOptions.find((o) => o.id === d.lenderChoice)) || auto;
  const best = chosen ?? { id: null, loan: 0, financing: 0, total: subtotal, rate: 0, ltc: 0, fee: 0 };

  const total = best.total, loan = best.loan, equity = total - loan;
  const lp = d.lpId ? getNpc(g, d.lpId) : null;
  const gpPct = lp ? d.gpPct : 1;
  const gpEquity = equity * gpPct, lpEquity = equity - gpEquity;
  const budget: Budget = { land, closing, hard, soft, pursuit, devFee, contingency, leasing, financing: best.financing, total, loan, equity, gpEquity, lpEquity };

  const yoc = noi / total, spread = yoc - cap;
  // purchases count on the 3% yearly rent bumps in the leases; developments are underwritten flat
  const netSale = value * (d.acq ? Math.pow(1.03, (conMonths + leaseUp + holdMonths) / 12) : 1) * (1 - COMMON.saleCostPct);
  const profit = netSale - total, margin = profit / total;
  const months = Math.max(1, conMonths + leaseUp + holdMonths);
  const hold = noi * (holdMonths / 12) - loan * best.rate * (holdMonths / 12);
  const ret = projectReturns(makeAcct(g, d, lpEquity, gpEquity), months, netSale - loan + hold);
  // developments are graded on the spread; purchases on the projected return to equity
  const eq = Number.isFinite(ret.lpIrr) ? ret.lpIrr : ret.gpIrr;
  const score: Grade = d.acq ? (eq >= 0.16 ? 'A' : eq >= 0.11 ? 'B' : eq >= 0.06 ? 'C' : eq >= 0.02 ? 'D' : 'F') : scoreDeal(spread, margin);

  return {
    usableAcres: usable, buildingSf, budget, rentUnit, noi, yoc, cap, spread, value, profit, margin, conMonths,
    leaseUp, holdMonths,
    lenderId: best.id, rate: best.rate, ltc: best.ltc, fee: best.fee, lenderOptions, ...ret, score,
  };
}

/** Investor IRR if the exit cap rate or the construction cost misses the plan. Rows: cost overrun. Columns: cap-rate change. */
export function sensitivity(g: Game, d: Deal, pf: Proforma) {
  const caps = [-0.0025, 0, 0.0025, 0.005], overs = [0, 0.05, 0.1];
  const b = pf.budget, months = Math.max(1, pf.conMonths + pf.leaseUp + pf.holdMonths);
  const hold = pf.noi * (pf.holdMonths / 12) - b.loan * pf.rate * (pf.holdMonths / 12);
  const grid = overs.map((o) => caps.map((c) => {
    const netSale = (pf.noi / (pf.cap + c)) * (1 - COMMON.saleCostPct);
    return projectReturns(makeAcct(g, d, b.lpEquity, b.gpEquity), months, netSale - b.loan - b.hard * o + hold).lpIrr;
  }));
  return { caps, overs, grid };
}
