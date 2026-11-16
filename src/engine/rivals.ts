// Rival developers. Six firms work the same metro on the same calendar: they circle sites, build, lease and sell,
// and their net worth is kept on a league table next to yours. They have their own random stream (kept in the
// save), so adding or tuning them never changes how the rest of a seeded game plays out.
import { DISTRICTS } from '../content/world';
import { leaseUpBase, rentIndex, typeCap } from './market';
import { CYCLE, PRODUCTS, SPEC, TYPE_SHORT } from './params';
import type { DealType, Game, Parcel, Rival, RivalDeal } from './types';

export const RIVAL_FIRMS: Omit<Rival, 'worth' | 'done' | 'won' | 'active' | 'eye' | 'hist' | 'best'>[] = [
  { id: 'stonegate', name: 'Stonegate Industrial', style: 'Big-box warehouses near the freeways. Patient, well capitalized, rarely overpays.', focus: ['spec'], skill: 0.75, pace: 1.1, start: 4200000, color: '#4f6f8a' },
  { id: 'prairieline', name: 'Prairie Line Partners', style: 'Yards and small industrial. Fast, scrappy, and everywhere you want to be.', focus: ['ios', 'spec'], skill: 0.55, pace: 2.2, start: 900000, color: '#8a6d2f' },
  { id: 'bisonridge', name: 'Bison Ridge Development', style: 'Shopping centers on suburban corners. Chases rooftops north and east.', focus: ['retail'], skill: 0.6, pace: 1.3, start: 1800000, color: '#a4553c' },
  { id: 'cedarelm', name: 'Cedar Elm Residential', style: 'Garden apartments, one after another. Rides the cycle hard in both directions.', focus: ['mf'], skill: 0.5, pace: 1.0, start: 2600000, color: '#4d7c5a' },
  { id: 'trinitycrest', name: 'Trinity Crest Group', style: 'Office and mixed use in the best addresses. Big swings, long waits.', focus: ['office', 'retail', 'mf'], skill: 0.65, pace: 0.7, start: 3400000, color: '#6c5a9c' },
  { id: 'redbud', name: 'Redbud Land & Yard', style: 'A two-person shop that started the same year you did. Yards first, anything after.', focus: ['ios'], skill: 0.4, pace: 1.6, start: 500000, color: '#b0562f' },
];
export const LEAGUE_SIZE = RIVAL_FIRMS.length + 1;
const PROTECTED = ['bluemound', 'northlake10'];
const MIN_OPEN_LAND = 62;

function rr(g: Game): number {
  g.rivalRng = ((g.rivalRng ?? g.seed ^ 0x5bd1e995) + 0x6d2b79f5) | 0;
  let t = g.rivalRng;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const span = (g: Game, lo: number, hi: number) => lo + rr(g) * (hi - lo);
const pickOne = <T,>(g: Game, xs: T[]): T => xs[Math.floor(rr(g) * xs.length)];
const month = (g: Game) => Math.floor(g.day / 30);

export function freshRivals(): Rival[] {
  return RIVAL_FIRMS.map((f) => ({ ...f, worth: f.start, done: 0, won: 0, active: [], eye: null, hist: [f.start], best: '' }));
}
const buildMonths = (t: DealType) => (t === 'ios' ? 4 : t === 'spec' ? SPEC.months : PRODUCTS[t].months);
/** How many projects a firm can carry at once. */
const capacity = (r: Rival) => (r.worth < 1.2e6 ? 1 : r.worth < 6e6 ? 2 : r.worth < 25e6 ? 3 : 4);
/** A level for today's pricing of a type: rents up or cap rates down both make finished buildings worth more. */
const priceLevel = (g: Game, t: DealType) => rentIndex(g, t) / typeCap(g, t);

export interface RivalHooks {
  /** Total cost, finished value, and timing of a project on a real site, from the same underwriting the player sees. */
  underwrite(g: Game, p: Parcel, t: DealType): { cost: number; value: number; grade: string } | null;
  news(g: Game, text: string, tone: 'good' | 'bad' | 'info'): void;
}

/** One month for every rival. */
export function stepRivals(g: Game, hooks: RivalHooks, quiet = false) {
  if (!g.rivals) g.rivals = freshRivals();
  const m = month(g), appetite = g.difficulty === 'pro' ? 1 + CYCLE[g.cycle.phase].appetite * 3 : 1;
  for (const r of g.rivals) {
    // projects under way
    for (const d of [...r.active]) {
      if (d.stage === 'build' && --d.left <= 0) { d.stage = 'lease'; d.left = Math.max(1, Math.round(leaseUpBase(d.type) * span(g, 0.7, 1.5) / Math.max(0.6, appetite))); }
      else if (d.stage === 'lease') {
        // your competing space slows their lease-up, as theirs slows yours
        const fight = g.deals.some((x) => x.type === d.type && (x.phase === 'leasing' || (x.phase === 'operations' && x.leases.length === 0)) && g.parcels.find((p) => p.id === x.parcelId)?.district === d.district);
        if (!(fight && rr(g) < 0.3) && --d.left <= 0) { d.stage = 'sale'; d.left = 2; }
      } else if (d.stage === 'sale' && --d.left <= 0) {
        const realized = d.value * (priceLevel(g, d.type) / d.level) * (1 + span(g, -0.07, 0.07) + (r.skill - 0.5) * 0.06);
        const profit = realized - d.cost, gain = profit > 0 ? profit * (0.13 + 0.11 * r.skill) * (d.type === 'ios' ? 1.8 : 1) + d.cost * 0.015 : Math.max(profit * 0.4, -r.worth * 0.35);
        r.worth = Math.max(60000, r.worth + gain); r.done++;
        r.active.splice(r.active.indexOf(d), 1);
        r.best = `${d.name}, sold for $${(realized / 1e6).toFixed(1)}M${profit < 0 ? ' at a loss' : ''}`;
        if (!quiet && (d.parcelId || rr(g) < 0.35)) hooks.news(g, `${r.name} sold ${d.name} for $${(realized / 1e6).toFixed(1)}M${profit < 0 ? ', taking a loss' : ''}.`, 'info');
      }
    }
    r.worth = Math.max(60000, r.worth - (3000 + r.worth * 0.0014)); // overhead

    // the site they have been circling
    if (r.eye && m >= r.eye.until) {
      const p = g.parcels.find((x) => x.id === r.eye!.parcelId), t = r.eye.type;
      r.eye = null;
      const uw = p && p.status === 'available' ? hooks.underwrite(g, p, t) : null;
      if (p && uw && r.active.length < capacity(r)) {
        p.status = 'rival'; p.rivalId = r.id;
        r.active.push({ name: p.name.replace(/ \(.*\)/, ''), type: t, district: p.district, parcelId: p.id, cost: uw.cost, value: uw.value, level: priceLevel(g, t), stage: 'build', left: buildMonths(t) });
        const lost = !!p.counterPrice;
        if (lost) { g.contested = g.contested ?? { won: 0, lost: 0 }; g.contested.lost++; }
        if (!quiet) hooks.news(g, lost ? `${r.name} bought ${p.name.replace(/ \(.*\)/, '')} while you were still negotiating. They plan ${TYPE_SHORT[t].toLowerCase()}.` : `${r.name} bought ${p.name.replace(/ \(.*\)/, '')} for ${TYPE_SHORT[t].toLowerCase()}.`, lost ? 'bad' : 'info');
      }
    }

    // looking for the next one
    if (r.active.length >= capacity(r) || r.eye || rr(g) > (r.pace / 12) * appetite * 1.6) continue;
    const budget = r.worth * 20;
    const openLand = g.parcels.filter((p) => p.status === 'available' && !p.existing).length;
    const onMap = !quiet && m > 5 && openLand > MIN_OPEN_LAND && rr(g) < 0.55;
    if (onMap) {
      const taken = new Set(g.rivals.map((x) => x.eye?.parcelId));
      const options: { p: Parcel; t: DealType }[] = [];
      for (const p of g.parcels) {
        if (p.status !== 'available' || p.existing || p.offMarket || PROTECTED.includes(p.id) || taken.has(p.id)) continue;
        const t = r.focus.find((f) => p.fit?.includes(f));
        if (!t) continue;
        const uw = hooks.underwrite(g, p, t);
        if (uw && uw.cost <= budget && 'ABC'.includes(uw.grade)) options.push({ p, t });
      }
      if (options.length) {
        const o = pickOne(g, options);
        r.eye = { parcelId: o.p.id, type: o.t, until: m + 2 + Math.floor(rr(g) * 3) };
        continue;
      }
    }
    // a deal somewhere off the player's map of listings: same economics, no site to fight over
    const t = pickOne(g, r.focus), base = t === 'ios' ? 2.2e6 : t === 'spec' ? 22e6 : t === 'retail' ? 20e6 : t === 'mf' ? 45e6 : 50e6;
    const cost = Math.min(budget, base * span(g, 0.5, 1.6));
    if (cost < (t === 'ios' ? 0.8e6 : 6e6)) { if (t !== 'ios' && rr(g) < 0.5) continue; }
    const size = Math.max(0.7e6, cost), margin = 0.1 + r.skill * 0.1 + span(g, -0.1, 0.1);
    const d = pickOne(g, Object.values(DISTRICTS).filter((x) => x.rent[t] >= 0.9));
    r.active.push({ name: `${t === 'ios' ? 'a yard' : t === 'spec' ? 'a warehouse' : t === 'retail' ? 'a shopping center' : t === 'mf' ? 'an apartment community' : 'an office building'} in ${d.name.split(' / ')[0]}`, type: t, district: d.id, cost: size, value: size * (1 + margin), level: priceLevel(g, t), stage: 'build', left: buildMonths(t) });
  }
  if (m % 12 === 0) for (const r of g.rivals) { r.hist.push(Math.round(r.worth)); if (r.hist.length > 40) r.hist.shift(); }
}

/** Rivals whose finished space is hunting the same tenants as a property of this type in this district. */
export const competingFor = (g: Game, type: DealType, district: string): Rival[] => (g.rivals ?? []).filter((r) => r.active.some((d) => d.stage === 'lease' && d.type === type && d.district === district));
/** Rivals with the same kind of property on the sale market right now. */
export const sellingNow = (g: Game, type: DealType): Rival[] => (g.rivals ?? []).filter((r) => r.active.some((d) => d.stage === 'sale' && d.type === type));
/** The rival circling a site, if any. */
export const circling = (g: Game, parcelId: string): Rival | undefined => (g.rivals ?? []).find((r) => r.eye?.parcelId === parcelId);

export interface LeagueRow { id: string; name: string; worth: number; done: number; active: number; you: boolean; color: string; style: string; hist: number[]; best: string }
/** The league table: every firm by net worth, best first. */
export function league(g: Game, yourWorth: number): LeagueRow[] {
  const rows: LeagueRow[] = (g.rivals ?? []).map((r) => ({ id: r.id, name: r.name, worth: r.worth, done: r.done, active: r.active.length, you: false, color: r.color, style: r.style, hist: r.hist, best: r.best }));
  rows.push({ id: 'you', name: g.firmName, worth: yourWorth, done: g.trackRecord, active: g.deals.filter((d) => !['dead', 'sold'].includes(d.phase)).length, you: true, color: '#d9622b', style: 'Your firm.', hist: [], best: '' });
  return rows.sort((a, b) => b.worth - a.worth || (a.you ? -1 : 1));
}
export const rankOf = (g: Game, yourWorth: number) => league(g, yourWorth).findIndex((r) => r.you) + 1;
/** Share of the base score added for league position: 20% for first, sliding to nothing in the bottom half. */
export const rankBonusPct = (rank: number, size = LEAGUE_SIZE) => { const half = Math.ceil(size / 2); return rank >= half ? 0 : Math.round((0.2 * (half - rank)) / (half - 1) * 1000) / 1000; };
export const CONTESTED_POINTS = 150;
