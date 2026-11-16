// The facts that drive each property type at a site: traffic and rooftops for shops, jobs for offices,
// renters and schools for apartments, labor and ramps for industrial. All of it is derived from the map
// (fixed, never random per game), shown in the site panel, and fed into rent, lease-up and approval odds.
import { COMMON, IOS, PRODUCTS, SF_PER_ACRE, SPEC } from '../engine/params';
import type { DealType, Parcel } from '../engine/types';
import { entitlementKind } from '../engine/zoning';
import { H, W, hash, urbanity } from '../render/layout';
import type { SiteRoad } from './roads';
import { OFFICE_CENTERS, type Ctx } from './sitegen';

export interface TypeFactor { rent: number; demand: number; ent: number }
export interface SiteData {
  // shops
  traffic: number; rooftops: number; income: number; anchors: number;
  // offices
  jobs: number; amenities: number; officeVac: number;
  // apartments
  renters: number; medRent: number; jobGrowth: number; schools: number;
  // industrial
  labor: number;
  /** Multipliers on district rent and tenant demand, and a shift in approval odds, for each property type here. */
  f: Record<DealType, TypeFactor>;
}
/** What each district is like for the people-driven property types. vac is the usual vacancy rate. */
export interface DistrictProfile { wealth: number; growth: number; rent: Record<DealType, number>; demand: Record<DealType, number>; vac: Record<DealType, number> }

const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
const around = (x: number, y: number, r: number) => { let s = 0, n = 0; for (let j = -r; j <= r; j++) for (let i = -r; i <= r; i++) { if (i * i + j * j > r * r) continue; const tx = x + i, ty = y + j; n++; if (tx >= 0 && ty >= 0 && tx < W && ty < H) s += urbanity(tx, ty); } return s / n; };

export function computeSiteData(p: Pick<Parcel, 'tile' | 'access'>, road: SiteRoad, k: Ctx, d: DistrictProfile, suit: Record<DealType, number>): SiteData {
  const x = p.tile.x, y = p.tile.y, r = (s: number) => hash(x, y, 900 + s);
  const u2 = around(x, y, 2), u4 = around(x, y, 4), u9 = around(x, y, 9);
  const rooftops = Math.round((1500 + u4 * 52000) / 100) * 100;
  const income = Math.round(58 + d.wealth * 62 + r(1) * 22 - 8) * 1000;
  const base = road.front === 'interstate' ? 120000 + r(2) * 70000 : road.front === 'highway' ? 60000 + r(2) * 50000 : road.front === 'arterial' ? 24000 + r(2) * 20000 : road.front === 'collector' ? 9000 + r(2) * 7000 : 2500 + r(2) * 2500;
  const traffic = Math.round(((base * (0.7 + u2 * 0.6)) + (road.hard ? 20000 + r(3) * 15000 : road.corner ? 7000 : 0)) / 100) * 100;
  const anchors = Math.min(3, Math.floor(u4 * 3.2 + r(4) * 1.2));
  let jobsRaw = u9 * 45000;
  for (const o of OFFICE_CENTERS) jobsRaw += o.s * 170000 * Math.max(0, 1 - Math.hypot(o.at[0] - x - 0.5, o.at[1] - y - 0.5) / 6.5);
  const jobs = Math.round(jobsRaw / 1000) * 1000;
  const amenities = clamp(Math.round(1 + k.office * 2.2 + k.u * 2), 1, 5);
  const officeVac = clamp(d.vac.office + (0.5 - k.office) * 0.08 + (r(5) - 0.5) * 0.04, 0.08, 0.36);
  const renters = Math.round((rooftops * (0.28 + k.u * 0.3)) / 100) * 100;
  const medRent = Math.round((1130 + (income / 1000) * 6 + k.u * 250 + k.office * 200) / 10) * 10;
  const jobGrowth = Math.round((0.8 + d.growth + r(6) * 0.8) * 10) / 10;
  const schools = clamp(Math.round(2.5 + d.wealth * 6 + r(7) * 2), 1, 10);
  const labor = Math.round((30000 + u9 * 900000) / 1000) * 1000;

  const tS = Math.min(1, Math.sqrt(traffic / 60000)), iS = clamp((income - 55000) / 75000, 0, 1), rS = Math.min(1, rooftops / 30000), jS = Math.min(1, jobs / 200000), lS = Math.min(1, labor / 600000);
  const ind = (t: 'ios' | 'spec') => Math.min(1, suit[t] / 0.8);
  const f: SiteData['f'] = {
    retail: { rent: clamp(0.72 + tS * 0.22 + iS * 0.2 + rS * 0.12 + (road.hard ? 0.08 : road.corner ? 0.03 : 0), 0.7, 1.4), demand: clamp(0.6 + rS * 0.4 + anchors * 0.08 + (road.hard ? 0.12 : 0), 0.55, 1.4), ent: 0 },
    office: { rent: clamp(0.86 + jS * 0.18 + ((amenities - 1) / 4) * 0.1 + k.office * 0.12, 0.85, 1.3), demand: clamp(0.6 + jS * 0.5 + (0.22 - officeVac) * 1.5, 0.45, 1.3), ent: 0 },
    mf: { rent: clamp(0.8 + ((medRent - 1300) / 1000) * 0.3 + (schools / 10) * 0.1, 0.85, 1.25), demand: clamp(0.6 + (jobGrowth / 3) * 0.35 + Math.min(1, renters / 12000) * 0.25, 0.55, 1.4), ent: clamp(-(schools - 5) * 0.015, -0.08, 0.06) },
    // yards and warehouses in the wrong place (no freeway, no industry nearby) rent for less and sit longer
    ios: { rent: (0.99 + lS * 0.05) * (0.7 + 0.3 * ind('ios')), demand: (0.85 + lS * 0.3) * (0.4 + 0.6 * ind('ios')), ent: 0 },
    spec: { rent: (0.99 + lS * 0.05) * (0.88 + 0.17 * ind('spec')), demand: (0.85 + lS * 0.3) * (0.55 + 0.45 * ind('spec')), ent: 0 },
  };
  return { traffic, rooftops, income, anchors, jobs, amenities, officeVac, renters, medRent, jobGrowth, schools, labor, f };
}

/** What it costs to build a type in a district, against the metro. Cheaper districts get simpler buildings: surface parking, plainer finishes. */
export const districtCost = (type: DealType, d: DistrictProfile) => (type === 'ios' || type === 'spec' ? 1 : Math.round(clamp(0.3 + 0.7 * d.rent[type], 0.75, 1.15) * 100) / 100);

/** District cap-rate adjustment for a property type: strong-rent districts trade at lower cap rates. */
export const districtCapAdj = (type: DealType, indCapAdj: number, d: DistrictProfile) => (type === 'ios' || type === 'spec' ? indCapAdj : Math.round(((1 - d.rent[type]) * 0.012 + indCapAdj * 0.3) * 1e5) / 1e5);

// the profit a developer needs before the land is worth buying: enough to clear each type's grading hurdle
const MARGIN: Record<string, number> = { retail: 0.2, office: 0.275, mf: 0.2, ios: 0.18, spec: 0.17 };
const ENT_DISCOUNT = { none: 0.9, plat: 0.84, sup: 0.78, rezone: 0.66 };
/**
 * What the land is worth to a developer of a given use, per square foot of land: the finished value, less a
 * fair profit, less every cost except the land. Sellers of land that still needs a hearing take a discount.
 */
export function residualLandPsf(p: Pick<Parcel, 'acres' | 'floodPct' | 'zoning' | 'existing'>, type: 'retail' | 'office' | 'mf', sd: SiteData, d: DistrictProfile, indCapAdj: number): number {
  const pr = PRODUCTS[type], usableSf = p.acres * (1 - p.floodPct) * SF_PER_ACRE, bsf = usableSf * pr.far;
  const noi = pr.noiPsf * d.rent[type] * sd.f[type].rent * bsf, cap = pr.cap + districtCapAdj(type, indCapAdj, d);
  const cost = (bsf * (pr.cost * districtCost(type, d) * (1 + pr.softPct + 0.035 + 0.05) + 1.25 + pr.tiPsf) + noi * 5 * pr.lcPct) * 1.06;
  return ((noi / cap / (1 + MARGIN[type]) - cost) * ENT_DISCOUNT[entitlementKind(p, type)]) / (p.acres * SF_PER_ACRE);
}

/** The same idea for a storage yard: what the finished, leased yard is worth, less a profit, less the cost of building it. */
export function residualYardPsf(p: Pick<Parcel, 'acres' | 'floodPct' | 'zoning' | 'existing' | 'access' | 'rail'>, sd: SiteData, d: DistrictProfile, indCapAdj: number): number {
  const usable = p.acres * (1 - p.floodPct), rent = 4100 * d.rent.ios * COMMON.accessRent[p.access] * sd.f.ios.rent * (p.rail ? COMMON.railRent : 1) * Math.max(0.62, Math.min(1, 1 - (usable - 4) * 0.0225));
  const noi = rent * usable * 12, s = IOS.surface.stabilized, sec = IOS.security.basic;
  const cost = ((usable * SF_PER_ACRE * s.cost + sec.base + sec.perAcre * usable) * (1 + IOS.softPct + IOS.devFeePct + IOS.contPct) + noi * 5 * IOS.lcPct) * 1.05;
  return ((noi / (0.0765 + indCapAdj) / (1 + MARGIN.ios) - cost) * ENT_DISCOUNT[entitlementKind(p, 'ios')]) / (p.acres * SF_PER_ACRE);
}

/** And for a warehouse: a 32-foot building covering 35% of the usable land. */
export function residualSpecPsf(p: Pick<Parcel, 'acres' | 'floodPct' | 'zoning' | 'existing' | 'access' | 'water' | 'sewer'>, sd: SiteData, indRentFactor: number, indCapAdj: number): number {
  const bsf = p.acres * (1 - p.floodPct) * SF_PER_ACRE * 0.35, noi = 8.1 * indRentFactor * COMMON.accessRent[p.access] * sd.f.spec.rent * bsf;
  const hard = bsf * SPEC.shell[32] + (!p.sewer ? SPEC.sewerExt : 0) + (!p.water ? SPEC.waterExt : 0);
  const cost = (hard * (1 + SPEC.softPct + SPEC.devFeePct + SPEC.contPct) + bsf * (SPEC.impactPsf + SPEC.tiPsf) + noi * 5 * SPEC.lcPct) * 1.06;
  return ((noi / (0.0625 + indCapAdj) / (1 + MARGIN.spec) - cost) * ENT_DISCOUNT[entitlementKind(p, 'spec')]) / (p.acres * SF_PER_ACRE);
}
