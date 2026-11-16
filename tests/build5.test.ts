// New asset classes, purchases of existing properties, and milestones.
import { describe, expect, it } from 'vitest';
import { ACHIEVEMENTS } from '../src/content/achievements';
import { ACRE_RANGE } from '../src/engine/params';
import { askPrice, computeProforma, getParcel, usableAcres } from '../src/engine/proforma';
import * as S from '../src/engine/sim';
import type { Deal, DealType, Game } from '../src/engine/types';

function answer(g: Game) {
  let guard = 0;
  while (g.decisions.length && guard++ < 50) {
    const dec = g.decisions[0];
    const o = { finding: 'credit', ddDeadline: 'proceed', entDenied: 'reapply', changeOrder: 'approve', prospect: 'accept', bids: 'b0', retrade: 'accept' }[dec.kind] ?? 'ok';
    S.resolveDecision(g, dec.id, o);
  }
}
function run(g: Game, until: () => boolean, maxDays = 4000) {
  for (let i = 0; i < maxDays && !until() && !g.over; i++) { S.advanceDay(g); answer(g); }
  expect(until()).toBe(true);
}
function rich(seed: number): Game {
  const g = S.newGame(seed);
  g.unlocked.push('retail', 'mf', 'office', 'acq'); g.cash = 2e8;
  for (const n of g.npcs) n.rel = 95;
  g.trackRecord = 5; g.rep.investors = 90; g.rep.city = 90;
  return g;
}
function play(g: Game, parcelId: string, type: DealType, reno: Deal['reno'] = 'asis'): Deal {
  const p = getParcel(g, parcelId);
  let r = S.makeOffer(g, parcelId, type, askPrice(g, p));
  for (let i = 0; i < 30 && !r.ok; i++) r = S.makeOffer(g, parcelId, type, askPrice(g, p));
  expect(r.msg + r.ok).toContain('true');
  const d = g.deals[g.deals.length - 1];
  for (const rep of ['env', 'survey', 'geo'] as const) S.orderReport(g, d.id, rep);
  run(g, () => Object.values(d.reports).every((x) => x.status === 'done'));
  S.finishDD(g, d.id);
  for (let k = 0; k < 6 && d.phase === 'entitlement'; k++) { S.startEntitlement(g, d.id, true, true); run(g, () => d.phase !== 'entitlement' || d.ent.status !== 'pending'); }
  expect(d.phase).toBe('predev');
  if (d.acq) S.setReno(g, d.id, reno);
  if (!(d.acq && reno === 'asis')) S.setGc(g, d.id, 'cowtown');
  const lp = g.npcs.filter((n) => n.role === 'lp').sort((a, b) => (b.maxCheck ?? 0) - (a.maxCheck ?? 0))[0];
  S.setGpPct(g, d.id, Math.min(1, Math.max(0.1, Math.ceil((1 - ((lp.maxCheck ?? 0) * 0.9) / computeProforma(g, d).budget.equity) * 20) / 20)));
  run(g, () => { if (!d.lpId) S.pitchLp(g, d.id, lp.id); return !!d.lpId; });
  const pf = computeProforma(g, d);
  expect(pf.budget.loan + pf.budget.equity).toBeCloseTo(pf.budget.total, 2);
  const c = S.closeDeal(g, d.id);
  expect(c.msg + String(c.ok)).toContain('true');
  run(g, () => d.phase === 'operations');
  run(g, () => S.currentRent(g, d) > 0);
  const before = S.estimateValue(g, d).value;
  expect(S.listForSale(g, d.id).ok).toBe(true);
  run(g, () => d.phase === 'sold' || d.phase === 'leasing');
  if (d.phase !== 'sold') { run(g, () => d.phase === 'operations'); S.listForSale(g, d.id); run(g, () => d.phase === 'sold'); }
  const res = d.result!;
  expect(d.cash).toBe(0); expect(d.loan!.balance).toBe(0); expect(Number.isFinite(res.lpIrr)).toBe(true);
  const months = Math.round((g.day - d.closeDay) / 30);
  console.log(`  ${(d.acq ? 'BUY ' + reno : 'BUILD').padEnd(14)} ${d.type.padEnd(6)} ${d.name.padEnd(32)} cost ${String(Math.round(d.costToDate / 1e3)).padStart(6)}k value ${String(Math.round(before / 1e3)).padStart(6)}k | uw ${pf.score} yoc ${(pf.yoc * 100).toFixed(1)} uwIRR ${(pf.lpIrr * 100).toFixed(0)}% | LP IRR ${(res.lpIrr * 100).toFixed(1)}% x${res.lpMultiple.toFixed(2)} promote ${Math.round(res.promote / 1e3)}k in ${months} mo`);
  return d;
}

describe('new asset classes', () => {
  for (const type of ['retail', 'office', 'mf'] as DealType[]) {
    it(`${type}: develop, lease and sell`, () => {
      for (const seed of [3, 11]) {
        const g = rich(seed);
        const [lo, hi] = ACRE_RANGE[type];
        const sites = g.parcels.filter((p) => !p.existing && !p.offMarket && usableAcres(p) >= lo && usableAcres(p) <= hi && p.floodPct < 0.15).sort((a, b) => (a.zoning === 'C' ? 0 : 1) - (b.zoning === 'C' ? 0 : 1)).slice(0, 2);
        expect(sites.length).toBeGreaterThan(0);
        for (const p of sites) if (p.status === 'available') play(g, p.id, type);
      }
    });
  }
  it('locked types cannot be offered on, and size limits apply', () => {
    const g = S.newGame(9);
    const p = g.parcels.find((x) => !x.existing && usableAcres(x) >= 5 && usableAcres(x) <= 10)!;
    expect(S.makeOffer(g, p.id, 'retail', askPrice(g, p) * 2).ok).toBe(false);
    const ex = g.parcels.find((x) => x.existing)!;
    expect(S.makeOffer(g, ex.id, ex.existing!.type, askPrice(g, ex) * 2).ok).toBe(false);
    expect(g.deals.length).toBe(0);
  });
});

describe('buying existing properties', () => {
  it('every existing property can be bought, run and sold, as is and repositioned', () => {
    for (const reno of ['asis', 'reposition'] as const) {
      const g = rich(reno === 'asis' ? 21 : 22);
      for (const p of g.parcels.filter((x) => x.existing)) {
        expect(askPrice(g, p)).toBeGreaterThan(100000);
        if (p.status === 'available') play(g, p.id, p.existing!.type, reno);
      }
    }
  });
  it('a leased purchase pays rent from the day it closes', () => {
    const g = rich(5);
    const p = getParcel(g, 'ex-westport1');
    let r = S.makeOffer(g, p.id, 'spec', askPrice(g, p)); for (let i = 0; i < 30 && !r.ok; i++) r = S.makeOffer(g, p.id, 'spec', askPrice(g, p));
    const d = g.deals[0];
    S.finishDD(g, d.id); S.setGpPct(g, d.id, 1);
    expect(S.closeDeal(g, d.id).ok).toBe(true);
    expect(d.phase).toBe('operations');
    expect(S.currentRent(g, d)).toBeGreaterThan(0);
    // held three years, a safe building pays a modest positive return; flipped at once it would lose the closing costs
    const uw = computeProforma(g, d);
    for (let i = 0; i < 36 * 30; i++) { S.advanceDay(g); answer(g); }
    S.listForSale(g, d.id); run(g, () => d.phase === 'sold');
    console.log(`  HOLD 36 mo Westport: uw ${(uw.gpIrr * 100).toFixed(1)}% | actual GP IRR ${(d.result!.gpIrr * 100).toFixed(1)}% x${d.result!.gpMultiple.toFixed(2)}`);
    expect(d.result!.gpMultiple).toBeGreaterThan(1.05);
  });
});

describe('milestones', () => {
  it('start locked, unlock by feat, and old saves migrate', () => {
    const g = S.newGame(4);
    expect(g.unlocked).toEqual(['ios', 'spec']);
    expect(S.maxActive(g)).toBe(3);
    g.cash = 2.5e6; S.checkAchievements(g);
    expect(g.unlocked).toContain('acq');
    g.trackRecord = 2; S.checkAchievements(g);
    expect(g.unlocked).toContain('retail');
    expect(ACHIEVEMENTS.filter((a) => a.unlock).map((a) => a.unlock).sort()).toEqual(['acq', 'mf', 'office', 'retail']);
    const old = JSON.parse(JSON.stringify(S.newGame(4))) as Game;
    delete (old as Partial<Game>).achievements; delete (old as Partial<Game>).unlocked;
    old.parcels = old.parcels.filter((p) => !p.existing);
    const m = S.migrate(old);
    expect(m.unlocked).toEqual(['ios', 'spec']);
    expect(m.parcels.filter((p) => p.existing).length).toBe(35);
    expect(m.parcels.filter((p) => p.existing).every((p) => p.existing!.type === 'mf' || !p.existing!.leases.length || p.existing!.leases[0].rentAnnual > 0)).toBe(true);
  });
});
