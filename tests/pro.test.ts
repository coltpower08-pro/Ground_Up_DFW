import { describe, expect, it } from 'vitest';
import { accrueTier, distributeTiered, irrAnnual, mortgageConstant, sizePermLoan } from '../src/engine/finance';
import { askPrice, computeProforma, getNpc, getParcel } from '../src/engine/proforma';
import * as S from '../src/engine/sim';
import type { EquityAcct, Game } from '../src/engine/types';

const acct = (catchUp: boolean): EquityAcct => ({
  lpCap: 900, gpCap: 100, lpPref: 0, gpPref: 0, lpShare: 0.9, pref: 0.08, promote: 0.2,
  tier: { b1: 1000, b2: 1000, hurdle2: 0.15, promote2: 0.35, catchUp, contrib: 1000, paid: 0, promo: 0 },
});

describe('Pro waterfall (IRR hurdles)', () => {
  it('hand-worked: $1,000 in, $1,500 out after a year, 8% pref, 20% to a 15% IRR, 35% after', () => {
    const a = acct(false);
    for (let i = 0; i < 12; i++) accrueTier(a);
    expect(a.tier!.b1).toBeCloseTo(1080, 6);
    expect(a.tier!.b2).toBeCloseTo(1150, 6);
    const r = distributeTiered(a, 1500);
    // 1,080 to investors; then 87.50 split 80/20 (70 / 17.50) gets investors to 15%;
    // remaining 332.50 split 65/35 (216.125 / 116.375)
    expect(r.promote).toBeCloseTo(17.5 + 116.375, 6);
    expect(r.lp).toBeCloseTo(0.9 * (1080 + 70 + 216.125), 6);
    expect(r.lp + r.gp).toBeCloseTo(1500, 6);
  });
  it('with a catch-up the GP reaches 20% of profit before the split resumes', () => {
    const a = acct(true);
    for (let i = 0; i < 12; i++) accrueTier(a);
    const r = distributeTiered(a, 1500);
    // pref profit 80 -> catch-up 20; then 87.50 (70 / 17.50); then 312.50 at 65/35
    expect(r.promote).toBeCloseTo(20 + 17.5 + 109.375, 6);
    expect(r.lp + r.gp).toBeCloseTo(1500, 6);
  });
  it('investors get exactly the hurdle IRR when cash stops at the hurdle', () => {
    const a = acct(false);
    for (let i = 0; i < 24; i++) accrueTier(a);
    const r = distributeTiered(a, a.tier!.b1);
    const f = new Array(25).fill(0); f[0] = -900; f[24] = r.lp;
    expect(irrAnnual(f)).toBeCloseTo(0.08, 6);
    expect(r.promote).toBe(0);
  });
});

describe('permanent loan sizing', () => {
  it('mortgage constant matches the annuity formula (6%, 25 years = 7.7316%)', () => {
    expect(mortgageConstant(0.06, 25)).toBeCloseTo(0.077316, 5);
  });
  it('takes the lowest of DSCR, LTV and debt yield', () => {
    const base = { noi: 100_000, rate: 0.06, amortYears: 25, minDscr: 1.25, maxLtv: 0.65, minDebtYield: 0.09 };
    const a = sizePermLoan({ ...base, value: 2_000_000 });
    expect(a.byDscr).toBeCloseTo(100_000 / (1.25 * mortgageConstant(0.06, 25)), 4);
    expect(a.loan).toBeCloseTo(a.byDscr, 4); // 1.035M < 1.11M (yield) < 1.3M (LTV)
    expect(sizePermLoan({ ...base, value: 1_000_000 }).binding).toBe('loan-to-value');
    expect(sizePermLoan({ ...base, rate: 0.03, value: 5_000_000 }).binding).toBe('debt yield');
  });
});

function answer(g: Game, pass = false) {
  for (let i = 0; i < 50 && g.decisions.length; i++) {
    const dec = g.decisions[0];
    const opt = { finding: 'credit', ddDeadline: 'proceed', entDenied: 'reapply', changeOrder: 'approve', prospect: pass ? 'pass' : 'accept', bids: 'b0', retrade: 'accept' }[dec.kind] ?? 'ok';
    S.resolveDecision(g, dec.id, opt);
  }
}
function run(g: Game, until: () => boolean, maxDays = 4000) {
  for (let i = 0; i < maxDays && !until() && !g.over; i++) { S.advanceDay(g); answer(g); }
  expect(until()).toBe(true);
}
function toClose(g: Game, parcelId: string, type: 'ios' | 'spec', lpId: string) {
  const p = getParcel(g, parcelId);
  let r = S.makeOffer(g, parcelId, type, askPrice(g, p));
  for (let i = 0; i < 20 && !r.ok; i++) r = S.makeOffer(g, parcelId, type, askPrice(g, p));
  const d = g.deals[g.deals.length - 1];
  for (const rep of ['env', 'survey', 'geo'] as const) S.orderReport(g, d.id, rep);
  run(g, () => Object.values(d.reports).every((x) => x.status === 'done'));
  S.finishDD(g, d.id);
  if (d.phase === 'entitlement') { S.startEntitlement(g, d.id, true, true); run(g, () => d.phase === 'predev'); }
  S.setGc(g, d.id, 'cowtown'); S.setGpPct(g, d.id, type === 'spec' ? 0.05 : 0.1);
  getNpc(g, lpId).rel = 80;
  run(g, () => { if (!d.lpId) S.pitchLp(g, d.id, lpId); return !!d.lpId; });
  return d;
}

describe('Pro mode play-through', () => {
  for (const seed of [11, 314, 8675309]) {
    it(`seed ${seed}: tiered waterfall, floating rate, refinance, then sale`, () => {
      const g = S.newGame(seed, 'Test', 'pro');
      const d = toClose(g, 'bluemound', 'ios', 'hollis');
      S.setLender(g, d.id, 'crosstimbers');
      const pf = computeProforma(g, d);
      expect(pf.lenderOptions.some((o) => o.id === 'mesa')).toBe(true);
      expect(S.closeDeal(g, d.id).ok).toBe(true);
      expect(d.acct!.tier).toBeDefined();
      run(g, () => d.phase === 'operations' && S.currentRent(g, d) > 0);
      expect(Math.abs(d.loan!.rate - (g.market.baseRate + 0.035))).toBeLessThan(0.0005); // resets monthly, so it can lag by one step
      const q = S.refiQuote(g, d);
      expect(q.eligible).toBe(true);
      if (q.proceeds >= 0) { expect(S.refinance(g, d.id).ok).toBe(true); expect(d.loan!.perm).toBe(true); expect(d.loan!.balance).toBe(q.loan); }
      expect(S.listForSale(g, d.id).ok).toBe(true);
      run(g, () => d.phase === 'sold');
      const r = d.result!;
      expect(d.cash).toBe(0);
      expect(Number.isFinite(r.lpIrr)).toBe(true);
      console.log(`pro seed ${seed} | refi ${q.proceeds >= 0 ? Math.round(q.proceeds / 1e3) + 'k out' : 'n/a'} | LP IRR ${(r.lpIrr * 100).toFixed(1)}% x${r.lpMultiple.toFixed(2)} | promote ${Math.round(r.promote / 1e3)}k | cycle ${g.cycle.phase} base ${(g.market.baseRate * 100).toFixed(2)}%`);
    });
  }
});

describe('staff and split leases', () => {
  it('hiring raises deal capacity and monthly cost', () => {
    const g = S.newGame(5);
    expect(S.maxActive(g)).toBe(3);
    S.setStaff(g, 'analyst', true); S.setStaff(g, 'pm', true);
    expect(S.maxActive(g)).toBe(5);
    const cash = g.cash;
    for (let i = 0; i < 30; i++) S.advanceDay(g);
    expect(cash - g.cash).toBeCloseTo(7000 + 6500 + 8000, 6);
  });
  it('a big spec building can lease in two halves and only sells when full', () => {
    let seen = false;
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const g = S.newGame(seed);
      g.trackRecord = 1; g.cash = 2_000_000;
      const d = toClose(g, 'northlake10', 'spec', 'caddo');
      expect(S.closeDeal(g, d.id).ok).toBe(true);
      run(g, () => d.leases.length > 0);
      if (d.leases[0].share < 1) {
        seen = true;
        run(g, () => d.con!.daysDone >= d.con!.daysTotal);
        if (!S.fullyLeased(d)) { expect(d.phase).toBe('leasing'); expect(S.listForSale(g, d.id).ok).toBe(false); }
        run(g, () => S.fullyLeased(d));
        expect(d.leases.length).toBe(2);
        expect(S.leasedShare(d)).toBeCloseTo(1, 9);
        run(g, () => d.phase === 'operations');
        break;
      }
    }
    expect(seen).toBe(true);
  });
});
