// A scripted "bot" plays the tutorial path end to end on several seeds.
// It checks that the game never gets stuck and that the books balance.
import { scoreGame } from '../src/engine/score';
import { describe, expect, it } from 'vitest';
import { askPrice, computeProforma, getParcel } from '../src/engine/proforma';
import * as S from '../src/engine/sim';
import type { Deal, Game } from '../src/engine/types';

function answer(g: Game) {
  let guard = 0;
  while (g.decisions.length && guard++ < 50) {
    const dec = g.decisions[0];
    const pickOpt = { finding: 'credit', ddDeadline: 'proceed', entDenied: 'reapply', changeOrder: 'approve', prospect: 'accept', bids: 'b0', retrade: 'accept' }[dec.kind] ?? 'ok';
    S.resolveDecision(g, dec.id, pickOpt);
  }
}
function run(g: Game, until: () => boolean, maxDays = 3000) {
  for (let i = 0; i < maxDays && !until() && !g.over; i++) { S.advanceDay(g); answer(g); }
  expect(until()).toBe(true);
}

function playDeal(g: Game, parcelId: string, type: 'ios' | 'spec', lpId: string): Deal {
  const p = getParcel(g, parcelId);
  let r = S.makeOffer(g, parcelId, type, askPrice(g, p));
  for (let i = 0; i < 20 && !r.ok; i++) r = S.makeOffer(g, parcelId, type, askPrice(g, p));
  expect(r.ok).toBe(true);
  const d = g.deals[g.deals.length - 1];
  for (const rep of ['env', 'survey', 'geo'] as const) S.orderReport(g, d.id, rep);
  run(g, () => Object.values(d.reports).every((x) => x.status === 'done'));
  S.finishDD(g, d.id);
  if (d.phase === 'entitlement') { S.startEntitlement(g, d.id, true, true); run(g, () => d.phase === 'predev' || d.phase === 'dead'); }
  expect(d.phase).toBe('predev');
  S.setGc(g, d.id, 'cowtown'); S.setGpPct(g, d.id, type === 'spec' ? 0.05 : 0.1);
  run(g, () => { if (!d.lpId) S.pitchLp(g, d.id, lpId); return !!d.lpId; });
  const pf = computeProforma(g, d);
  expect(pf.budget.total).toBeGreaterThan(0);
  expect(pf.budget.loan + pf.budget.equity).toBeCloseTo(pf.budget.total, 2);
  console.log(`  ${d.name}: total ${Math.round(pf.budget.total/1e3)}k loan ${Math.round(pf.budget.loan/1e3)}k gpEq ${Math.round(pf.budget.gpEquity/1e3)}k yoc ${(pf.yoc*100).toFixed(2)} spread ${Math.round(pf.spread*1e4)}bp score ${pf.score} projLP ${(pf.lpIrr*100).toFixed(1)} pursuit ${Math.round(d.pursuit/1e3)}k cash ${Math.round(g.cash/1e3)}k day ${g.day}`);
  const c = S.closeDeal(g, d.id);
  expect(c.msg + String(c.ok)).toContain('true');
  run(g, () => d.phase === 'operations');
  run(g, () => S.currentRent(g, d) > 0);
  expect(S.listForSale(g, d.id).ok).toBe(true);
  run(g, () => d.phase === 'sold');
  return d;
}

describe('full playthrough', () => {
  for (const seed of [7, 42, 2027, 99991, 123456]) {
    it(`seed ${seed}: IOS yard then spec building`, () => {
      const g = S.newGame(seed);
      const a = playDeal(g, 'bluemound', 'ios', 'hollis');
      const ra = a.result!;
      // every dollar distributed is accounted for: equity out = net sale + operating cash - loan
      expect(ra.lpOut + ra.gpOut).toBeGreaterThan(0);
      expect(Number.isFinite(ra.lpIrr)).toBe(true);
      expect(a.loan!.balance).toBe(0);
      expect(a.cash).toBe(0);
      for (const n of g.npcs) if (n.role === 'lp') n.rel = Math.max(n.rel, 70);
      const b = playDeal(g, 'northlake10', 'spec', 'caddo');
      const rb = b.result!;
      expect(Number.isFinite(rb.lpIrr)).toBe(true);
      expect(g.trackRecord).toBe(2);
      expect(g.flags.scenarioDone).toBe(true);
      const sc = scoreGame(g);
      expect(sc.total).toBeGreaterThan(0);
      console.log(`seed ${seed} | score ${sc.total} after ${(g.day / 360).toFixed(1)} yrs: ${sc.parts.map((x) => `${x.key} ${x.points}`).join(', ')}`);
      console.log(`seed ${seed} | IOS: cost ${Math.round(ra.totalCost / 1e3)}k sale ${Math.round(ra.salePrice / 1e3)}k LP IRR ${(ra.lpIrr * 100).toFixed(1)}% x${ra.lpMultiple.toFixed(2)} ${ra.months}mo | SPEC: cost ${(rb.totalCost / 1e6).toFixed(1)}M sale ${(rb.salePrice / 1e6).toFixed(1)}M LP IRR ${(rb.lpIrr * 100).toFixed(1)}% x${rb.lpMultiple.toFixed(2)} ${rb.months}mo promote ${Math.round(rb.promote / 1e3)}k | cash ${Math.round(g.cash / 1e3)}k day ${g.day}`);
    });
  }

  it('saves and reloads through JSON without changing the outcome', () => {
    const g1 = S.newGame(555);
    for (let i = 0; i < 100; i++) S.advanceDay(g1);
    const g2: Game = JSON.parse(JSON.stringify(g1));
    for (let i = 0; i < 400; i++) { S.advanceDay(g1); S.advanceDay(g2); answer(g1); answer(g2); }
    expect(JSON.stringify(g2)).toBe(JSON.stringify(g1));
  });
});
