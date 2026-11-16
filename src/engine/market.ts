// One market per property type. Each has its own rent, cap rate and vacancy, metro-wide and by district,
// and each moves differently through the cycle: industrial has been the steadiest, office the weakest.
import { DISTRICTS, capAdj, siteDataOf } from '../content/world';
import { districtCost } from '../content/sitedata';
import { CYCLE, IOS, PRODUCTS, SPEC } from './params';
import { between } from './rng';
import type { DealType, Game, Market, Parcel } from './types';

export const TYPES: DealType[] = ['ios', 'spec', 'retail', 'office', 'mf'];
export const BASE_VAC: Record<DealType, number> = { ios: 0.04, spec: 0.075, retail: 0.06, office: 0.22, mf: 0.075 };
export const BASE_RENT = { ios: 4100, spec: 8.1 };
const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));

/** The parts of the market beyond industrial, as a new game starts. */
export const freshTypes = (): Pick<Market, 'idx' | 'caps' | 'vac'> => ({ idx: { retail: 1, office: 1, mf: 1 }, caps: { retail: PRODUCTS.retail.cap, office: PRODUCTS.office.cap, mf: PRODUCTS.mf.cap }, vac: { ...BASE_VAC } });

/** Rent level against the start of the game (1 = unchanged). */
export const rentIndex = (g: Game, t: DealType) => (t === 'ios' ? g.market.iosRent / BASE_RENT.ios : t === 'spec' ? g.market.indRent / BASE_RENT.spec : g.market.idx[t]);
/** Metro cap rate for a property type. */
export const typeCap = (g: Game, t: DealType) => (t === 'ios' ? g.market.iosCap : t === 'spec' ? g.market.indCap : g.market.caps[t]);
export const capFor = (g: Game, districtId: string, t: DealType) => typeCap(g, t) + capAdj(districtId, t);
/** Share of space sitting empty for a property type in a district. */
export const vacancyFor = (g: Game, districtId: string, t: DealType) => clamp((g.market.vac[t] / BASE_VAC[t]) * DISTRICTS[districtId].vac[t], 0.01, 0.5);
/** How readily tenants turn up at this site for this use: district demand, the site's own draw, and how tight the market is. 1 is average. */
export function demandFor(g: Game, p: Parcel, t: DealType): number {
  return DISTRICTS[p.district].demand[t] * siteDataOf(p.id).f[t].demand * clamp(Math.sqrt(BASE_VAC[t] / g.market.vac[t]), 0.6, 1.25);
}
export const leaseUpBase = (t: DealType) => (t === 'ios' ? IOS.leaseUpMonths : t === 'spec' ? SPEC.leaseUpMonths : PRODUCTS[t].leaseUp);
/** Months to fill a new property of this type at this site. */
export function leaseUpFor(g: Game, p: Parcel, t: DealType): number {
  const base = leaseUpBase(t);
  return clamp(Math.round(base / demandFor(g, p, t)), Math.ceil(base * 0.6), Math.round(base * 2.2));
}
/** Metro rent in the unit each type is quoted in: $/acre/month for yards, net $/SF/year for buildings. */
export const metroRent = (g: Game, t: DealType) => (t === 'ios' ? g.market.iosRent : t === 'spec' ? g.market.indRent : PRODUCTS[t].noiPsf * g.market.idx[t]);
/** District rent for a type, same units. */
export const districtRent = (g: Game, districtId: string, t: DealType) => metroRent(g, t) * DISTRICTS[districtId].rent[t];
/** Hard cost to build, per building SF (per land SF for a yard on a stabilized base). */
export const buildCost = (g: Game, t: DealType, districtId?: string) => (t === 'ios' ? IOS.surface.stabilized.cost : t === 'spec' ? SPEC.shell[32] : PRODUCTS[t].cost) * g.market.costIndex * (districtId ? districtCost(t, DISTRICTS[districtId]) : 1);

// how hard each type swings with the cycle
const RENT_UP: Record<'retail' | 'office' | 'mf', number> = { retail: 0.8, office: 0.4, mf: 1.15 };
const RENT_DOWN: Record<'retail' | 'office' | 'mf', number> = { retail: 0.9, office: 1.6, mf: 1.0 };
const CAP_BETA: Record<'retail' | 'office' | 'mf', number> = { retail: 1.1, office: 1.8, mf: 0.9 };
const VAC_STEP: Record<keyof typeof CYCLE, Record<DealType, number>> = {
  expansion: { ios: -0.0005, spec: -0.001, retail: -0.0008, office: -0.001, mf: -0.001 },
  peak: { ios: 0.0002, spec: 0.0006, retail: 0.0004, office: 0.0008, mf: 0.0006 },
  contraction: { ios: 0.001, spec: 0.002, retail: 0.0015, office: 0.004, mf: 0.002 },
  recovery: { ios: -0.0006, spec: -0.001, retail: -0.0006, office: 0, mf: -0.0012 },
};

/** One month of movement for retail, office and apartments, and for vacancy in every type. Industrial rents and caps move in sim.ts. */
export function stepMarket(g: Game) {
  const mk = g.market;
  for (const t of ['retail', 'office', 'mf'] as const) {
    if (g.difficulty === 'pro') {
      const c = CYCLE[g.cycle.phase];
      mk.idx[t] *= 1 + c.rent * (c.rent >= 0 ? RENT_UP[t] : RENT_DOWN[t]) + between(g, -0.002, 0.002);
      mk.caps[t] = clamp(mk.caps[t] + c.cap * CAP_BETA[t] + between(g, -0.0002, 0.0002), PRODUCTS[t].cap - 0.012, PRODUCTS[t].cap + 0.03);
    } else {
      mk.idx[t] *= (t === 'office' ? 1.0008 : 1.0022) + between(g, -0.002, 0.002);
      mk.caps[t] = clamp(mk.caps[t] + between(g, -0.0002, 0.0002), PRODUCTS[t].cap - 0.006, PRODUCTS[t].cap + 0.008);
    }
  }
  for (const t of TYPES) {
    const step = g.difficulty === 'pro' ? VAC_STEP[g.cycle.phase][t] : (BASE_VAC[t] - mk.vac[t]) * 0.05;
    mk.vac[t] = clamp(mk.vac[t] + step + between(g, -0.0006, 0.0006), BASE_VAC[t] * 0.45, BASE_VAC[t] * 2.2);
  }
}
