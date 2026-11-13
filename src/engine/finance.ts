// Pure finance math: IRR, the equity waterfall, and loan sizing.
// Every function here is covered by tests/finance.test.ts.

import type { EquityAcct } from './types';

/** Net present value of evenly spaced (monthly) cash flows at a per-period rate. */
export function npv(rate: number, flows: number[]): number {
  let v = 0;
  for (let i = 0; i < flows.length; i++) v += flows[i] / Math.pow(1 + rate, i);
  return v;
}

/**
 * IRR of monthly cash flows, returned as an effective annual rate:
 * (1 + monthly IRR)^12 - 1. Returns NaN when there is no sign change.
 */
export function irrAnnual(flows: number[]): number {
  const hasNeg = flows.some((f) => f < 0);
  const hasPos = flows.some((f) => f > 0);
  if (!hasNeg || !hasPos) return NaN;
  let lo = -0.99, hi = 1.0;
  let fLo = npv(lo, flows), fHi = npv(hi, flows);
  for (let i = 0; i < 20 && fLo * fHi > 0; i++) { hi *= 2; fHi = npv(hi, flows); }
  if (fLo * fHi > 0) return NaN;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    const fMid = npv(mid, flows);
    if (Math.abs(fMid) < 1e-7) { lo = hi = mid; break; }
    if (fLo * fMid <= 0) { hi = mid; fHi = fMid; } else { lo = mid; fLo = fMid; }
  }
  const monthly = (lo + hi) / 2;
  return Math.pow(1 + monthly, 12) - 1;
}

/** Turn sparse {month, amount} entries into a dense monthly array starting at the first month. */
export function denseFlows(entries: { m: number; amt: number }[]): number[] {
  if (!entries.length) return [];
  const first = Math.min(...entries.map((e) => e.m));
  const last = Math.max(...entries.map((e) => e.m));
  const out = new Array(last - first + 1).fill(0);
  for (const e of entries) out[e.m - first] += e.amt;
  return out;
}

/** Accrue one month of simple (non-compounding) preferred return on unreturned capital. */
export function accruePref(a: EquityAcct): void {
  a.lpPref += (a.lpCap * a.pref) / 12;
  a.gpPref += (a.gpCap * a.pref) / 12;
}

/**
 * Distribute cash through the waterfall:
 *   1. return of capital, pro rata to LP and GP co-invest
 *   2. accrued preferred return, pro rata
 *   3. the rest: `promote` share to the GP, remainder pro rata by ownership
 */
export function distribute(a: EquityAcct, amount: number): { lp: number; gp: number; promote: number } {
  let left = Math.max(0, amount);
  let lp = 0, gp = 0, promote = 0;

  const cap = a.lpCap + a.gpCap;
  if (left > 0 && cap > 0) {
    const pay = Math.min(left, cap);
    const lpPart = pay * (a.lpCap / cap), gpPart = pay - lpPart;
    a.lpCap -= lpPart; a.gpCap -= gpPart; lp += lpPart; gp += gpPart; left -= pay;
  }
  const pref = a.lpPref + a.gpPref;
  if (left > 0 && pref > 0) {
    const pay = Math.min(left, pref);
    const lpPart = pay * (a.lpPref / pref), gpPart = pay - lpPart;
    a.lpPref -= lpPart; a.gpPref -= gpPart; lp += lpPart; gp += gpPart; left -= pay;
  }
  if (left > 0) {
    promote = left * a.promote;
    const rest = left - promote;
    lp += rest * a.lpShare;
    gp += rest * (1 - a.lpShare) + promote;
  }
  return { lp, gp, promote };
}

/**
 * Size a construction loan and the financing costs it creates.
 * `subtotal` is every cost except financing. Financing = origination fee + interest reserve,
 * both a function of the loan, so total cost solves: total = subtotal / (1 - ltc * k).
 */
export function sizeConstructionLoan(p: {
  subtotal: number; ltc: number; rate: number; feePct: number;
  avgOutstandingYears: number; maxLoan: number; value: number; maxLtv: number;
}): { loan: number; financing: number; total: number } {
  const k = p.feePct + p.rate * p.avgOutstandingYears;
  let total = p.subtotal / (1 - p.ltc * k);
  let loan = p.ltc * total;
  const cap = Math.min(p.maxLoan, p.maxLtv * p.value);
  if (loan > cap) {
    loan = Math.max(0, cap);
    total = p.subtotal + loan * k;
  }
  return { loan, financing: loan * k, total };
}

export function dscr(noi: number, annualDebtService: number): number {
  return annualDebtService > 0 ? noi / annualDebtService : Infinity;
}

// ---------- Pro mode: IRR-hurdle waterfall ----------

/** Grow the hurdle balances by one month (compounded, so the hurdles are true IRRs). */
export function accrueTier(a: EquityAcct): void {
  const t = a.tier!;
  t.b1 *= Math.pow(1 + a.pref, 1 / 12);
  t.b2 *= Math.pow(1 + t.hurdle2, 1 / 12);
}

/** Record new capital paid in by the investors (LP and GP co-invest together). */
export function contributeTier(a: EquityAcct, amount: number): void {
  const t = a.tier!;
  t.b1 += amount; t.b2 += amount; t.contrib += amount;
}

/**
 * Pro waterfall:
 *   1. everything to investors until they reach the preferred-return IRR
 *   2. optional GP catch-up until the GP holds its promote share of all profit paid so far
 *   3. split with promote 1 until investors reach the second IRR hurdle
 *   4. split with promote 2 after that
 * "Investors" are the LP and the GP co-investment, paid pro rata.
 */
export function distributeTiered(a: EquityAcct, amount: number): { lp: number; gp: number; promote: number } {
  const t = a.tier!;
  let left = Math.max(0, amount), inv = 0, promote = 0;
  const toInv = (x: number) => { inv += x; left -= x; t.paid += x; t.b1 = Math.max(0, t.b1 - x); t.b2 = Math.max(0, t.b2 - x); };
  const toGp = (x: number) => { promote += x; left -= x; t.promo += x; };

  if (left > 0 && t.b1 > 0) toInv(Math.min(left, t.b1));
  if (left > 0 && t.catchUp && a.promote > 0) {
    const profit = Math.max(0, t.paid - t.contrib);
    const target = (a.promote / (1 - a.promote)) * profit;
    if (target > t.promo) toGp(Math.min(left, target - t.promo));
  }
  if (left > 0 && t.b2 > 0) {
    const y = Math.min(left, t.b2 / (1 - a.promote));
    const p = y * a.promote;
    toInv(y - p); toGp(p);
  }
  if (left > 0) { const p = left * t.promote2, rest = left - p; toInv(rest); toGp(p); }

  const lp = inv * a.lpShare, gpInv = inv - lp;
  a.lpCap = Math.max(0, a.lpCap - lp); a.gpCap = Math.max(0, a.gpCap - gpInv);
  return { lp, gp: gpInv + promote, promote };
}

/** Accrue and pay through whichever waterfall the deal uses. */
export const accrue = (a: EquityAcct) => (a.tier ? accrueTier(a) : accruePref(a));
export const payOut = (a: EquityAcct, amount: number) => (a.tier ? distributeTiered(a, amount) : distribute(a, amount));

// ---------- permanent loans ----------

/** Annual debt service per dollar of loan for a fully amortizing monthly-pay mortgage. */
export function mortgageConstant(rate: number, years: number): number {
  const r = rate / 12, n = years * 12;
  return r === 0 ? 1 / years : (12 * r) / (1 - Math.pow(1 + r, -n));
}

/** Size a permanent loan at the lowest of the DSCR, loan-to-value and debt-yield tests. */
export function sizePermLoan(p: { noi: number; value: number; rate: number; amortYears: number; minDscr: number; maxLtv: number; minDebtYield: number }) {
  const byDscr = p.noi / (p.minDscr * mortgageConstant(p.rate, p.amortYears));
  const byLtv = p.value * p.maxLtv;
  const byYield = p.noi / p.minDebtYield;
  const loan = Math.max(0, Math.min(byDscr, byLtv, byYield));
  return { loan, byDscr, byLtv, byYield, binding: loan === byDscr ? 'DSCR' : loan === byLtv ? 'loan-to-value' : 'debt yield' };
}
