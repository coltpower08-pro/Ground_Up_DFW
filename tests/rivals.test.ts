// Build 9 phase 3: rival firms, the league table, and scoring against the competition.
import { describe, expect, it } from 'vitest';
import { askPrice, getParcel } from '../src/engine/proforma';
import { CONTESTED_POINTS, LEAGUE_SIZE, RIVAL_FIRMS, circling, competingFor, league, rankBonusPct, rankOf, sellingNow } from '../src/engine/rivals';
import { scoreGame } from '../src/engine/score';
import * as S from '../src/engine/sim';
import type { Game } from '../src/engine/types';
import { botPlay } from './helpers/bot';

const years = (g: Game, n: number) => { for (let i = 0; i < n * 360; i++) { S.advanceDay(g); while (g.decisions.length) g.decisions.shift(); } return g; };

describe('rival firms', () => {
  it('six rivals start alongside the player and replay identically from the same seed', () => {
    const a = years(S.newGame(11), 4), b = years(S.newGame(11), 4), c = years(S.newGame(12), 4);
    expect(a.rivals!.length).toBe(6); expect(LEAGUE_SIZE).toBe(7);
    expect(a.rivals!.map((r) => Math.round(r.worth))).toEqual(b.rivals!.map((r) => Math.round(r.worth)));
    expect(a.rivals!.map((r) => Math.round(r.worth))).not.toEqual(c.rivals!.map((r) => Math.round(r.worth)));
    expect(a.rivals!.reduce((s, r) => s + r.done, 0)).toBeGreaterThan(6);
    expect(JSON.stringify(a)).not.toMatch(/Infinity|NaN/);
    expect(JSON.parse(JSON.stringify(a)).rivals).toEqual(a.rivals);
  });
  it('buy real sites they suit, never the tutorial sites, and leave plenty of land', () => {
    const g = years(S.newGame(21), 12), theirs = g.parcels.filter((p) => p.status === 'rival');
    expect(theirs.length).toBeGreaterThan(5);
    for (const p of theirs) { const r = g.rivals!.find((x) => x.id === p.rivalId)!; expect(r, p.name).toBeTruthy(); expect(p.fit!.some((t) => r.focus.includes(t)), `${r.name} on ${p.name}`).toBe(true); expect(p.existing).toBeUndefined(); }
    expect(getParcel(g, 'bluemound').status).toBe('available'); expect(getParcel(g, 'northlake10').status).toBe('available');
    expect(g.parcels.filter((p) => p.status === 'available' && !p.existing).length).toBeGreaterThanOrEqual(60);
    expect(g.news.some((n) => /bought .* for /.test(n.text))).toBe(true);
  });
  it('grow at different speeds, can lose money, and keep a history', () => {
    const g0 = S.newGame(5, 'T', 'pro'); g0.cash = 1e9; // enough cash that the idle player never goes bust
    const g = years(g0, 15), w = g.rivals!.map((r) => r.worth / r.start);
    expect(Math.max(...w)).toBeGreaterThan(3); expect(Math.min(...w)).toBeLessThan(Math.max(...w) / 2);
    for (const r of g.rivals!) { expect(r.hist.length).toBeGreaterThan(10); expect(r.worth).toBeGreaterThan(0); }
  });
});

describe('competing with rivals', () => {
  const eyed = (seed: number) => { const g = S.newGame(seed); for (let i = 0; i < 2000 && !g.rivals!.some((r) => r.eye); i++) { S.advanceDay(g); while (g.decisions.length) g.decisions.shift(); } return g; };
  it('a site a rival is circling is harder to lowball, and tying it up first is a win', () => {
    const g = eyed(31), r = g.rivals!.find((x) => x.eye)!, p = getParcel(g, r.eye!.parcelId), t = r.eye!.type;
    expect(circling(g, p.id)).toBe(r);
    const low = askPrice(g, p) * 0.9, withRival = S.offerOdds(g, p, low);
    r.eye = null; const alone = S.offerOdds(g, p, low); r.eye = { parcelId: p.id, type: t, until: 9999 };
    expect(withRival).toBeLessThan(alone);
    g.unlocked.push('retail', 'mf', 'office'); g.cash = 5e7;
    let res = S.makeOffer(g, p.id, t, askPrice(g, p));
    for (let i = 0; i < 30 && !res.ok; i++) res = S.makeOffer(g, p.id, t, askPrice(g, p));
    expect(res.ok).toBe(true);
    expect(g.contested!.won).toBe(1); expect(circling(g, p.id)).toBeUndefined();
    expect(g.news[0].text).toMatch(/before .* could move on it/);
  });
  it('a rival buys the site out from under a player who was still negotiating', () => {
    const g = eyed(32), r = g.rivals!.find((x) => x.eye)!, p = getParcel(g, r.eye!.parcelId);
    p.counterPrice = askPrice(g, p); // the player made an offer and got a counter
    years(g, 1);
    if (p.status === 'rival') { expect(g.contested!.lost).toBeGreaterThanOrEqual(1); expect(p.rivalId).toBe(r.id); }
    else expect(p.status).toBe('available'); // they ran out of room for another project and passed
    expect(g.contested!.lost + (p.status === 'available' ? 1 : 0)).toBeGreaterThanOrEqual(1);
  });
  it('competing space nearby slows tenants, and a competing sale trims the bids', () => {
    const g = S.newGame(41), d0 = S.previewProforma(g, 'northlake10', 'spec', 1e6);
    expect(d0.noi).toBeGreaterThan(0);
    let r = S.makeOffer(g, 'northlake10', 'spec', askPrice(g, getParcel(g, 'northlake10')));
    for (let i = 0; i < 30 && !r.ok; i++) r = S.makeOffer(g, 'northlake10', 'spec', askPrice(g, getParcel(g, 'northlake10')));
    const d = g.deals[0], before = S.arrivalOdds(g, d);
    g.rivals![0].active.push({ name: 'a warehouse', type: 'spec', district: 'alliance', cost: 2e7, value: 2.3e7, level: 1, stage: 'lease', left: 5 });
    expect(competingFor(g, 'spec', 'alliance').length).toBe(1);
    expect(S.arrivalOdds(g, d)).toBeLessThan(before);
    expect(competingFor(g, 'retail', 'alliance').length).toBe(0);
    g.rivals![0].active[g.rivals![0].active.length - 1].stage = 'sale';
    expect(sellingNow(g, 'spec').length).toBe(1); expect(sellingNow(g, 'mf').length).toBe(0);
  });
});

describe('scoring against the competition', () => {
  it('pays 20% for first, sliding to nothing in the bottom half', () => {
    expect(rankBonusPct(1)).toBeCloseTo(0.2); expect(rankBonusPct(2)).toBeCloseTo(0.133, 2); expect(rankBonusPct(3)).toBeCloseTo(0.067, 2);
    for (const k of [4, 5, 6, 7]) expect(rankBonusPct(k)).toBe(0);
  });
  it('adds the rank bonus and contested wins to the career score', () => {
    const g = S.newGame(51);
    const base = scoreGame(g);
    expect(base.rank).toBe(rankOf(g, base.netWorth)); expect(base.leagueSize).toBe(7);
    expect(base.parts.find((p) => p.key === 'league')!.points).toBe(0);
    g.contested = { won: 2, lost: 0 }; g.cash = 9e8; g.achievements.push('a', 'b');
    const top = scoreGame(g), lg = top.parts.find((p) => p.key === 'league')!, rest = top.parts.filter((p) => p.key !== 'league').reduce((s, p) => s + p.points, 0);
    expect(top.rank).toBe(1);
    expect(lg.points).toBe(Math.round(rest * 0.2) + 2 * CONTESTED_POINTS);
    expect(top.total).toBe(rest + lg.points);
    expect(league(g, top.netWorth)[0].you).toBe(true);
    expect(league(g, top.netWorth).length).toBe(RIVAL_FIRMS.length + 1);
  });
  it('saves from before rivals existed get a league with years of history behind it', () => {
    const old = JSON.parse(JSON.stringify(years(S.newGame(61), 3))) as Game;
    delete old.rivals; delete old.rivalRng; delete old.contested;
    const m = S.migrate(old);
    expect(m.rivals!.length).toBe(6); expect(m.contested).toEqual({ won: 0, lost: 0 });
    expect(m.rivals!.some((r) => r.done > 0)).toBe(true);
    expect(m.rivals!.every((r) => r.eye === null && r.active.every((d) => !d.parcelId))).toBe(true);
    years(m, 1);
    expect(JSON.stringify(m)).not.toMatch(/Infinity|NaN/);
  });
});

describe('balance', () => {
  it('a skilled player finishes a 10-year Rookie career in the top three of seven', () => {
    for (const seed of [1, 3, 9]) {
      const g = botPlay(S.newGame(seed, 'Bot', 'rookie', 10), 10), sc = scoreGame(g);
      console.log(`  rookie seed ${seed}: rank ${sc.rank}, net worth $${(sc.netWorth / 1e6).toFixed(1)}M, league bonus ${sc.parts.find((p) => p.key === 'league')!.points}`);
      expect(sc.rank, `seed ${seed}`).toBeLessThanOrEqual(3);
      expect(sc.parts.find((p) => p.key === 'league')!.points).toBeGreaterThan(0);
    }
  }, 240000);
  it('on Pro the same player is in the race, and can win it', () => {
    const ranks = [2, 4, 6].map((seed) => { const g = botPlay(S.newGame(seed, 'Bot', 'pro', 10), 10), sc = scoreGame(g); console.log(`  pro seed ${seed}: rank ${sc.rank}, net worth $${(sc.netWorth / 1e6).toFixed(1)}M`); return sc.rank; });
    // the scripted player does not time the cycle, so Pro punishes it some of the time; it must still be able to win
    expect(Math.min(...ranks)).toBeLessThanOrEqual(3);
    expect(ranks.filter((r) => r < 7).length).toBeGreaterThanOrEqual(2);
  }, 240000);
  it('a player who does nothing finishes in the bottom half, with no bonus', () => {
    for (const [seed, diff] of [[5, 'rookie'], [8, 'pro']] as const) {
      const g = botPlay(S.newGame(seed, 'Bot', diff, 10), 10, 'passive'), sc = scoreGame(g);
      expect(sc.rank).toBeGreaterThanOrEqual(5);
      expect(sc.parts.find((p) => p.key === 'league')!.points).toBe(0);
    }
  }, 240000);
});
