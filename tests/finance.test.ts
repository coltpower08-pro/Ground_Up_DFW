import { describe, expect, it } from 'vitest';
import { accruePref, denseFlows, distribute, irrAnnual, npv, sizeConstructionLoan } from '../src/engine/finance';
import type { EquityAcct } from '../src/engine/types';

describe('IRR', () => {
  it('one year, 10% gain = 10% annual IRR', () => {
    const f = new Array(13).fill(0); f[0] = -100; f[12] = 110;
    expect(irrAnnual(f)).toBeCloseTo(0.10, 6);
  });
  it('doubling in 24 months = 41.42% (sqrt 2 - 1)', () => {
    const f = new Array(25).fill(0); f[0] = -1000; f[24] = 2000;
    expect(irrAnnual(f)).toBeCloseTo(Math.SQRT2 - 1, 6);
  });
  it('level monthly payments: 1% a month = 12.68% effective annual', () => {
    // $1,000 buys 12 payments of 88.8488 at exactly 1% per month (annuity formula)
    const pmt = (1000 * 0.01) / (1 - Math.pow(1.01, -12));
    const f = [-1000, ...new Array(12).fill(pmt)];
    expect(irrAnnual(f)).toBeCloseTo(Math.pow(1.01, 12) - 1, 6);
    expect(npv(0.01, f)).toBeCloseTo(0, 6);
  });
  it('a loss gives a negative IRR; no sign change gives NaN', () => {
    const f = new Array(13).fill(0); f[0] = -100; f[12] = 80;
    expect(irrAnnual(f)).toBeCloseTo(-0.2, 6);
    expect(irrAnnual([100, 50])).toBeNaN();
  });
  it('denseFlows fills gaps and nets same-month entries', () => {
    expect(denseFlows([{ m: 3, amt: -10 }, { m: 5, amt: 4 }, { m: 5, amt: 1 }])).toEqual([-10, 0, 5]);
  });
});

describe('waterfall', () => {
  const acct = (): EquityAcct => ({ lpCap: 900, gpCap: 100, lpPref: 0, gpPref: 0, lpShare: 0.9, pref: 0.08, promote: 0.2 });
  it('accrues simple pref monthly on unreturned capital', () => {
    const a = acct();
    for (let i = 0; i < 12; i++) accruePref(a);
    expect(a.lpPref).toBeCloseTo(72, 9);
    expect(a.gpPref).toBeCloseTo(8, 9);
  });
  it('hand-worked case: $1,000 in, $1,500 out after one year', () => {
    // capital 1,000 (LP 900 / GP 100); pref 80 (LP 72 / GP 8); residual 420:
    // promote 20% = 84 to GP; remaining 336 split 90/10 = 302.4 / 33.6
    const a = acct();
    for (let i = 0; i < 12; i++) accruePref(a);
    const r = distribute(a, 1500);
    expect(r.lp).toBeCloseTo(900 + 72 + 302.4, 6);
    expect(r.gp).toBeCloseTo(100 + 8 + 33.6 + 84, 6);
    expect(r.promote).toBeCloseTo(84, 6);
    expect(r.lp + r.gp).toBeCloseTo(1500, 6);
  });
  it('a shortfall returns capital pro rata and pays no promote', () => {
    const a = acct();
    const r = distribute(a, 500);
    expect(r.lp).toBeCloseTo(450, 6);
    expect(r.gp).toBeCloseTo(50, 6);
    expect(r.promote).toBe(0);
    expect(a.lpCap).toBeCloseTo(450, 6);
  });
  it('partial distributions add up to the same total as one distribution', () => {
    const a = acct(), b = acct();
    const one = distribute(a, 1300);
    const p1 = distribute(b, 600), p2 = distribute(b, 700);
    expect(p1.lp + p2.lp).toBeCloseTo(one.lp, 6);
    expect(p1.gp + p2.gp).toBeCloseTo(one.gp, 6);
  });
});

describe('construction loan sizing', () => {
  it('solves the circular financing cost: total = subtotal / (1 - ltc * k)', () => {
    const r = sizeConstructionLoan({ subtotal: 1_000_000, ltc: 0.6, rate: 0.08, feePct: 0.01, avgOutstandingYears: 0.5, maxLoan: 1e9, value: 1e9, maxLtv: 0.7 });
    // k = 0.01 + 0.08 * 0.5 = 0.05 -> total = 1,000,000 / 0.97
    expect(r.total).toBeCloseTo(1_000_000 / 0.97, 4);
    expect(r.loan).toBeCloseTo(0.6 * r.total, 4);
    expect(r.total - r.financing).toBeCloseTo(1_000_000, 4);
  });
  it('caps the loan at the lender maximum and at loan-to-value', () => {
    const base = { subtotal: 1_000_000, ltc: 0.6, rate: 0.08, feePct: 0.01, avgOutstandingYears: 0.5 };
    expect(sizeConstructionLoan({ ...base, maxLoan: 400_000, value: 1e9, maxLtv: 0.7 }).loan).toBe(400_000);
    expect(sizeConstructionLoan({ ...base, maxLoan: 1e9, value: 500_000, maxLtv: 0.7 }).loan).toBeCloseTo(350_000, 6);
  });
});
