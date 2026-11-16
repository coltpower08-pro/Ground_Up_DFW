import { describe, expect, it } from 'vitest';
import { liquidation, scoreGame } from '../src/engine/score';
import * as S from '../src/engine/sim';
import type { Game } from '../src/engine/types';
import { periodStart } from '../src/services/scores';

function answer(g: Game) {
  for (let k = 0; k < 50 && g.decisions.length; k++) {
    const dec = g.decisions[0];
    S.resolveDecision(g, dec.id, ({ finding: 'credit', ddDeadline: 'proceed', entDenied: 'reapply', changeOrder: 'approve', prospect: 'accept', bids: 'b0', retrade: 'accept' } as Record<string, string>)[dec.kind] ?? 'ok');
  }
}

describe('career score', () => {
  it('going broke ends the career and still posts a score', () => {
    const g = S.newGame(11, 'Broke Co', 'rookie', 10);
    for (let i = 0; i < 4000 && !g.over; i++) { S.advanceDay(g); answer(g); }
    expect(g.ending?.how).toBe('bust');
    expect(scoreGame(g).total).toBeGreaterThanOrEqual(0);
  });
  it('a brand-new firm scores zero', () => {
    const s = scoreGame(S.newGame(7));
    expect(s.total).toBe(0);
    expect(s.netWorth).toBe(450000);
    expect(s.parts.map((p) => p.key)).toEqual(['wealth', 'investors', 'deals', 'milestones', 'reputation', 'league']);
  });
  it('a 10-year career ends on its own after ten years, and the score reflects what happened', () => {
    const g = S.newGame(11, 'Test Co', 'rookie', 10, 'Tester');
    g.cash = 6e6; // enough to carry ten years of overhead without doing a deal
    for (let i = 0; i < 4000 && !g.over; i++) { S.advanceDay(g); answer(g); }
    expect(g.over).toBe(true);
    expect(g.ending?.how).toBe('complete');
    expect(Math.round(g.day / 360)).toBe(10);
    const s = scoreGame(g);
    expect(s.netWorth).toBeLessThan(6e6); // an idle firm only burns overhead
    expect(s.parts.find((x) => x.key === 'deals')!.points).toBe(0);
  });
  it('an open-ended career does not end on its own; retiring ends it', () => {
    const g = S.newGame(12);
    for (let i = 0; i < 400; i++) { S.advanceDay(g); answer(g); }
    expect(g.over).toBe(false);
    expect(S.retire(g).ok).toBe(true);
    expect(g.over && g.ending?.how).toBe('retired');
    expect(S.retire(g).ok).toBe(false);
  });
  it('owned properties count toward net worth at their sale value, and investors get their share', () => {
    const g = S.newGame(5); g.unlocked.push('acq'); g.cash = 4e7; for (const n of g.npcs) n.rel = 95;
    const p = g.parcels.find((x) => x.id === 'ex-westport1')!;
    let r = S.makeOffer(g, p.id, 'spec', S.askPrice(g, p)); for (let i = 0; i < 30 && !r.ok; i++) r = S.makeOffer(g, p.id, 'spec', S.askPrice(g, p));
    const d = g.deals[0]; S.finishDD(g, d.id); S.setGpPct(g, d.id, 0.1);
    const lp = g.npcs.filter((n) => n.role === 'lp').sort((a, b) => (b.maxCheck ?? 0) - (a.maxCheck ?? 0))[0];
    for (let i = 0; i < 400 && !d.lpId; i++) { S.pitchLp(g, d.id, lp.id); S.advanceDay(g); answer(g); }
    expect(S.closeDeal(g, d.id).ok).toBe(true);
    const x = liquidation(g, d);
    expect(x.gp).toBeGreaterThan(0);
    if (d.lpId) expect(x.lp).toBeGreaterThan(0);
    const before = scoreGame(g);
    expect(before.netWorth).toBeCloseTo(g.cash + x.gp, 0);
  });
});

describe('score periods', () => {
  it('weeks start Monday, months on the 1st, years on Jan 1', () => {
    const wed = new Date(2026, 10, 18, 15, 30); // Wednesday, Nov 18 2026
    expect(new Date(periodStart('week', wed)).toDateString()).toBe(new Date(2026, 10, 16).toDateString());
    const sun = new Date(2026, 10, 22, 9);
    expect(new Date(periodStart('week', sun)).toDateString()).toBe(new Date(2026, 10, 16).toDateString());
    expect(new Date(periodStart('month', wed)).getDate()).toBe(1);
    expect(new Date(periodStart('year', wed)).getMonth()).toBe(0);
    expect(periodStart('all', wed)).toBe(0);
  });
});
