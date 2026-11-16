// Build 9 phase 2: underwriting, pricing and grading that change with the property type.
import { describe, expect, it } from 'vitest';
import { GLOSSARY } from '../src/content/glossary';
import { DISTRICTS, roadOf, siteDataOf } from '../src/content/world';
import { residualLandPsf, residualYardPsf } from '../src/content/sitedata';
import { BASE_VAC, capFor, demandFor, leaseUpFor, stepMarket, TYPES, vacancyFor } from '../src/engine/market';
import { ACRE_RANGE } from '../src/engine/params';
import { askPrice, computeProforma, explainGrade, existingPrice, HURDLE, scoreDeal, usableAcres } from '../src/engine/proforma';
import * as S from '../src/engine/sim';
import type { DealType, Game, Parcel } from '../src/engine/types';

const game = (seed = 3): Game => { const g = S.newGame(seed); g.unlocked.push('retail', 'mf', 'office', 'acq'); return g; };
const fitsSize = (p: Parcel, t: DealType) => usableAcres(p) >= ACRE_RANGE[t][0] && usableAcres(p) <= ACRE_RANGE[t][1];
const grade = (s: string) => 'FDCBA'.indexOf(s);
const g = game(), land = g.parcels.filter((p) => !p.existing);
const look = (p: Parcel, t: DealType, price = askPrice(g, p)) => S.previewProforma(g, p.id, t, price);

describe('one site, five answers', () => {
  it('gives different rent, value and grade for different property types on the same land', () => {
    const p = land.find((x) => (['ios', 'spec', 'retail', 'office', 'mf'] as DealType[]).every((t) => fitsSize(x, t)))!;
    expect(p).toBeTruthy();
    const pf = TYPES.map((t) => look(p, t));
    expect(new Set(pf.map((x) => Math.round(x.noi))).size).toBe(5);
    expect(new Set(pf.map((x) => Math.round(x.cap * 1e5))).size).toBeGreaterThanOrEqual(4);
    expect(new Set(pf.map((x) => Math.round(x.spread * 1e4))).size).toBe(5);
    // and across the map the grade really does depend on the type chosen
    const mixed = land.filter((x) => new Set(TYPES.filter((t) => fitsSize(x, t)).map((t) => look(x, t).score)).size >= 2);
    expect(mixed.length).toBeGreaterThan(land.length * 0.6);
  });
  it('uses a different hurdle for each type, with office the highest', () => {
    expect(HURDLE.office).toBeGreaterThan(HURDLE.retail); expect(HURDLE.retail).toBeGreaterThan(HURDLE.spec);
    expect(scoreDeal('spec', 0.012, 0.2)).toBe('C'); expect(scoreDeal('retail', 0.012, 0.2)).toBe('C'); expect(scoreDeal('office', 0.012, 0.2)).toBe('D');
    expect(scoreDeal('mf', 0.018, 0.2)).toBe('A'); expect(scoreDeal('office', 0.018, 0.2)).toBe('C');
    expect(scoreDeal('retail', 0.03, 0.2, true)).toBe('B'); // a slow lease-up costs a grade
  });
  it('explains a grade in plain words that name the type and its drivers', () => {
    const p = land.find((x) => x.fit!.includes('retail'))!;
    const why = S.previewWhy(g, p.id, 'retail', askPrice(g, p)).join(' ');
    expect(why).toMatch(/cars a day/); expect(why).toMatch(/110 bp/); expect(why).toMatch(/spread/);
    const q = land.find((x) => x.fit!.includes('office'))!;
    expect(S.previewWhy(g, q.id, 'office', askPrice(g, q)).join(' ')).toMatch(/jobs within five miles/);
  });
});

describe('location decides which type works', () => {
  it('office in a weak office district grades worse than apartments in a strong apartment district', () => {
    const weak = Object.values(DISTRICTS).filter((d) => d.rent.office <= 0.75).map((d) => d.id), strong = Object.values(DISTRICTS).filter((d) => d.rent.mf >= 1.15).map((d) => d.id);
    const off = land.filter((p) => weak.includes(p.district) && fitsSize(p, 'office')), apt = land.filter((p) => strong.includes(p.district) && p.fit!.includes('mf'));
    expect(off.length).toBeGreaterThan(3); expect(apt.length).toBeGreaterThan(3);
    const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    expect(avg(off.map((p) => grade(look(p, 'office').score)))).toBeLessThan(avg(apt.map((p) => grade(look(p, 'mf').score))) - 1);
    expect(Math.max(...off.map((p) => grade(look(p, 'office').score)))).toBeLessThanOrEqual(grade('D'));
    for (const p of off) expect(leaseUpFor(g, p, 'office')).toBeGreaterThan(12);
  });
  it('a hard corner is worth more to a shopping center than to industrial', () => {
    const corners = land.filter((p) => roadOf(p.id)!.hard && fitsSize(p, 'retail'));
    expect(corners.length).toBeGreaterThan(3);
    let wins = 0;
    for (const p of corners) {
      const sd = siteDataOf(p.id), d = DISTRICTS[p.district];
      if (residualLandPsf(p, 'retail', sd, d, d.cap) > residualYardPsf(p, sd, d, d.cap)) wins++;
      // the corner itself adds retail rent and does nothing for a yard
      expect(sd.f.retail.rent).toBeGreaterThan(0.95);
    }
    expect(wins).toBeGreaterThanOrEqual(corners.length * 0.8);
    // same district, same road class: the corner out-rents the mid-block site
    const mid = land.filter((p) => !roadOf(p.id)!.corner && roadOf(p.id)!.front === 'arterial');
    const avg = (xs: Parcel[]) => xs.reduce((a, p) => a + siteDataOf(p.id).f.retail.rent / 1, 0) / xs.length;
    expect(avg(corners)).toBeGreaterThan(avg(mid));
  });
  it('prices land at its highest and best use, so the wrong use fails on expensive dirt', () => {
    const dear = land.filter((p) => ['retail', 'office', 'mf'].includes(p.fit![0]) && p.askPsf > 15);
    expect(dear.length).toBeGreaterThan(8);
    for (const p of dear) expect(grade(look(p, 'ios').score), p.name).toBeLessThanOrEqual(grade('D'));
    // and most land works for at least one use at a fair offer
    const works = land.filter((p) => TYPES.some((t) => fitsSize(p, t) && grade(look(p, t, askPrice(g, p) * 0.9).score) >= grade('C')));
    expect(works.length).toBeGreaterThan(land.length * 0.8);
  });
  it('gives every type a healthy number of sites that pencil', () => {
    for (const t of TYPES) {
      const ok = land.filter((p) => p.fit!.includes(t) && grade(look(p, t, askPrice(g, p) * 0.9).score) >= grade('C'));
      expect(ok.length, t).toBeGreaterThanOrEqual(t === 'office' ? 8 : 12);
    }
  });
});

describe('a market for each type', () => {
  it('keeps separate rent, cap rate and vacancy by type and district', () => {
    expect(capFor(g, 'collin', 'mf')).toBeLessThan(capFor(g, 'collin', 'retail'));
    expect(capFor(g, 'collin', 'office')).toBeLessThan(capFor(g, 'southdallas', 'office'));
    expect(vacancyFor(g, 'southdallas', 'office')).toBeGreaterThan(vacancyFor(g, 'collin', 'office'));
    expect(vacancyFor(g, 'collin', 'office')).toBeGreaterThan(vacancyFor(g, 'collin', 'spec'));
    const p = land.find((x) => x.district === 'collin')!;
    expect(demandFor(g, p, 'office')).not.toBe(demandFor(g, p, 'mf'));
  });
  it('moves each type differently through a Pro downturn, office worst, and never breaks', () => {
    const pro = S.newGame(7, 'T', 'pro');
    pro.cycle.phase = 'contraction';
    const before = { ...pro.market.idx }, vac0 = { ...pro.market.vac };
    for (let i = 0; i < 12; i++) stepMarket(pro);
    const drop = (t: 'retail' | 'office' | 'mf') => 1 - pro.market.idx[t] / before[t];
    expect(drop('office')).toBeGreaterThan(drop('retail')); expect(drop('office')).toBeGreaterThan(drop('mf')); expect(drop('retail')).toBeGreaterThan(0);
    expect(pro.market.vac.office - vac0.office).toBeGreaterThan(pro.market.vac.ios - vac0.ios);
    expect(pro.market.caps.office - 0.074).toBeGreaterThan(pro.market.caps.mf - 0.051);
    const long = S.newGame(8, 'T', 'pro');
    for (let i = 0; i < 365 * 12; i++) S.advanceDay(long);
    for (const t of TYPES) { expect(long.market.vac[t]).toBeGreaterThan(0); expect(long.market.vac[t]).toBeLessThanOrEqual(BASE_VAC[t] * 2.2 + 1e-9); }
    expect(JSON.stringify(long)).not.toMatch(/Infinity|NaN/);
  });
});

describe('existing buildings', () => {
  it('are priced the way a buyer would value them at a sale, type by type', () => {
    for (const p of g.parcels.filter((x) => x.existing)) {
      const ex = p.existing!, price = existingPrice(g, p), cap = capFor(g, p.district, ex.type);
      const pf = look(p, ex.type);
      // stabilized value at this type's cap rate brackets the asking price: never above full value, never a giveaway
      expect(price, p.name).toBeLessThanOrEqual((pf.noi / cap) * 1.08);
      expect(price, p.name).toBeGreaterThan((pf.noi / cap) * 0.45);
      expect(pf.cap).toBeCloseTo(cap, 6);
    }
    // the same building is worth more in a stronger district for its type
    const offices = g.parcels.filter((x) => x.existing?.type === 'office');
    const perSf = (p: Parcel) => existingPrice(g, p) / p.existing!.sf / Math.max(0.3, p.existing!.leases.reduce((s, l) => s + l.share, 0) * 0.5 + 0.5);
    const hi = offices.filter((p) => DISTRICTS[p.district].rent.office >= 1.1), lo = offices.filter((p) => DISTRICTS[p.district].rent.office < 1.1);
    if (hi.length && lo.length) expect(Math.max(...hi.map(perSf))).toBeGreaterThan(Math.min(...lo.map(perSf)));
  });
  it('a bought-and-leased building sells for about what the underwriting said', () => {
    const gg = game(31); gg.cash = 2e8; gg.trackRecord = 5; for (const n of gg.npcs) n.rel = 95; gg.rep.investors = 90;
    const p = gg.parcels.find((x) => x.existing && x.existing.type === 'retail' && x.status === 'available')!;
    let r = S.makeOffer(gg, p.id, 'retail', askPrice(gg, p));
    for (let i = 0; i < 30 && !r.ok; i++) r = S.makeOffer(gg, p.id, 'retail', askPrice(gg, p));
    const d = gg.deals[gg.deals.length - 1], pf = computeProforma(gg, d);
    expect(pf.value).toBeGreaterThan(d.price * 0.85);
    expect(explainGrade(gg, d, pf).join(' ')).toMatch(/return to equity/);
  });
});

describe('teaching', () => {
  it('has an Almanac entry for every new idea, and unlocks them when a deal starts', () => {
    const keys = GLOSSARY.map((t) => t.key);
    for (const k of ['hbu', 'residual', 'hurdle', 'vacancy', 'absorption', 'traffic', 'rooftops', 'anchor', 'officejobs', 'classa', 'renters', 'schools', 'laborpool']) expect(keys, k).toContain(k);
    expect(new Set(keys).size).toBe(keys.length);
    const gg = game(4); gg.cash = 5e7;
    const p = gg.parcels.find((x) => !x.existing && x.fit!.includes('retail') && !x.offMarket)!;
    let r = S.makeOffer(gg, p.id, 'retail', askPrice(gg, p));
    for (let i = 0; i < 30 && !r.ok; i++) r = S.makeOffer(gg, p.id, 'retail', askPrice(gg, p));
    for (const k of ['hbu', 'residual', 'traffic', 'rooftops']) expect(gg.almanac, k).toContain(k);
  });
  it('old saves pick up the new market and today\'s land prices', () => {
    const old = JSON.parse(JSON.stringify(game(5))) as Game;
    delete (old.market as Partial<Game['market']>).idx; delete (old.market as Partial<Game['market']>).caps; delete (old.market as Partial<Game['market']>).vac;
    const some = old.parcels.find((x) => x.id.startsWith('g-retail'))!; some.askPsf = 1;
    const m = S.migrate(old);
    expect(m.market.idx.office).toBe(1); expect(m.market.vac.office).toBeCloseTo(0.22); expect(m.market.caps.mf).toBeCloseTo(0.051);
    expect(m.parcels.find((x) => x.id === some.id)!.askPsf).toBeGreaterThan(1);
    for (let i = 0; i < 90; i++) S.advanceDay(m);
    expect(JSON.stringify(m)).not.toMatch(/Infinity|NaN/);
  });
});
