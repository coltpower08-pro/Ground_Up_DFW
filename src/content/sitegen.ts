// Rule-built sites and existing buildings that fill out the metro beyond the hand-written ones.
// Each property type is placed where it actually works: yards and warehouses by the freeways, rail and
// industrial districts; shops on arterial corners near rooftops; offices in the job centers; apartments
// in the suburbs near jobs and shopping. Everything is derived from fixed hashes, never the game's random
// seed, so every game and every save sees the same map.
import type { DealType, Existing, Parcel } from '../engine/types';
import { CITIES, FLOOD, GROUND, H, INTERMODALS, RAILS, ROADS, W, blockAt, hash, industry, isSite, ll, placeRectAt, urbanity, type XY } from '../render/layout';

type Use = 'ios' | 'spec' | 'retail' | 'office' | 'mf';
type Base = Omit<Parcel, 'status'>;

/** Where the office jobs are. Strength 0 to 1. */
export const OFFICE_CENTERS: { name: string; at: XY; s: number }[] = ([
  ['Downtown Dallas', 32.78, -96.8, 1], ['Uptown', 32.802, -96.805, 1], ['Preston Center', 32.865, -96.805, 0.9], ['Las Colinas', 32.87, -96.94, 0.9],
  ['Legacy', 33.08, -96.82, 1], ['Frisco North Platinum', 33.12, -96.83, 0.95], ['Telecom Corridor', 32.98, -96.72, 0.8], ['Addison / Galleria', 32.94, -96.83, 0.85],
  ['Downtown Fort Worth', 32.755, -97.33, 0.8], ['Alliance Town Center', 32.925, -97.3, 0.7], ['Westlake / Southlake', 32.975, -97.19, 0.85],
  ['Arlington Entertainment District', 32.75, -97.085, 0.6], ['Allen / SH-121', 33.13, -96.72, 0.75], ['Cypress Waters', 32.93, -96.98, 0.8],
] as [string, number, number, number][]).map(([name, la, lo, s]) => ({ name, at: ll(la, lo), s }));

const dLine = (p: XY, line: XY[]) => { let best = 1e9; for (let i = 0; i < line.length - 1; i++) { const [ax, ay] = line[i], [bx, by] = line[i + 1], dx = bx - ax, dy = by - ay, t = Math.max(0, Math.min(1, ((p[0] - ax) * dx + (p[1] - ay) * dy) / (dx * dx + dy * dy || 1))); best = Math.min(best, Math.hypot(p[0] - ax - dx * t, p[1] - ay - dy * t)); } return best; };
const nearestRoad = (p: XY, kinds: string[]) => { let best = 1e9, name = ''; for (const r of ROADS) if (kinds.includes(r.kind)) { const d = dLine(p, r.pts); if (d < best) { best = d; name = r.name; } } return { d: best, name }; };
const title = (s: string) => s.toLowerCase().replace(/(^|[\s.])([a-z])/g, (_, a, b) => a + b.toUpperCase());

/** What a spot on the map is like, for deciding which property types belong there. */
export function context(x: number, y: number) {
  const c: XY = [x + 0.5, y + 0.5], u = urbanity(x, y), ind = industry(x, y);
  const fw = nearestRoad(c, ['interstate', 'highway']), is = nearestRoad(c, ['interstate']);
  const rail = Math.min(...RAILS.map((r) => dLine(c, r))), port = Math.min(...INTERMODALS.map((p) => Math.hypot(p[0] - c[0], p[1] - c[1])));
  let office = 0, officeName = '';
  for (const o of OFFICE_CENTERS) { const v = o.s * (1 - Math.hypot(o.at[0] - c[0], o.at[1] - c[1]) / 3); if (v > office) { office = v; officeName = o.name; } }
  let city = '', cd = 1e9, cdir = '';
  for (const k of CITIES) { const d = Math.hypot(k.x - c[0], k.y - c[1]); if (d < cd) { cd = d; city = title(k.name); cdir = Math.abs(c[0] - k.x) > Math.abs(c[1] - k.y) ? (c[0] > k.x ? 'East' : 'West') : c[1] > k.y ? 'South' : 'North'; } }
  // a major corner: two section-line arterials meet at one of this tile's corners
  const majorCorner = (x % 4 === 0 || x % 4 === 3) && (y % 4 === 0 || y % 4 === 3);
  return { u, ind, fw, is, rail, port, office, officeName, city, cityDist: cd, cdir, majorCorner, core: GROUND[y * W + x] === 3, flood: FLOOD.has(y * W + x) };
}
export type Ctx = ReturnType<typeof context>;

/** How well each property type suits a spot, roughly 0 to 1.5. */
export function suitability(k: Ctx): Record<Use, number> {
  const band = (v: number, mid: number, wide: number) => Math.max(0, 1 - Math.abs(v - mid) / wide);
  return {
    ios: k.u < 0.6 ? k.ind * 1.6 + (k.fw.d < 1.3 ? 0.45 : 0) + (k.port < 4 ? 0.3 : 0) + (k.rail < 1 ? 0.15 : 0) - k.u * 0.5 : 0,
    spec: k.u < 0.65 ? k.ind * 2 + (k.is.d < 1.6 ? 0.5 : 0) + (k.rail < 1 ? 0.25 : 0) + (k.port < 5 ? 0.3 : 0) - k.u * 0.6 : 0,
    retail: k.ind < 0.28 ? band(k.u, 0.5, 0.45) * 0.8 + (k.fw.d < 1.5 ? 0.25 : 0) + (k.majorCorner ? 0.45 : 0) : 0,
    office: k.office > 0.2 ? k.office * 1.3 + (k.fw.d < 1.5 ? 0.15 : 0) : 0,
    mf: k.ind < 0.2 ? band(k.u, 0.45, 0.35) * 0.9 + (k.fw.d < 2.2 ? 0.2 : 0) + (k.office > 0.3 ? 0.2 : 0) : 0,
  };
}

const LAND_BASE: Record<string, number> = { alliance: 6, dfw: 15, gsw: 12.5, netarrant: 9.5, southdallas: 3.6, eastdallas: 4.8, southtarrant: 4.6, westfw: 3.6, denton: 3.6, collin: 11, cbd: 26, fwcbd: 12 };
const USE_LAND: Record<Use, number> = { ios: 1.05, spec: 1, retail: 1.5, office: 1.45, mf: 1.15 };
const QUOTA: Record<Use, number> = { retail: 22, office: 16, mf: 22, spec: 10, ios: 8 };
const ACRES: Record<Use, [number, number]> = { ios: [2.5, 9], spec: [6, 38], retail: [3, 12], office: [2.5, 9], mf: [6, 20] };
const SUFFIX: Record<Use, string[]> = {
  ios: ['Yard Site', 'Truck Lot', 'Storage Tract', 'Laydown Yard', 'Trailer Lot Site'],
  spec: ['Logistics Tract', 'Business Park Site', 'Commerce Tract', 'Distribution Site', 'Industrial Tract'],
  retail: ['Crossing', 'Corner', 'Marketplace Pad', 'Commons Tract', 'Village Tract', 'Plaza Site'],
  office: ['Office Park Site', 'Center Pad', 'Campus Tract', 'Tower Site', 'Plaza Lot'],
  mf: ['Residential Tract', 'Meadows Tract', 'Heights Tract', 'Landing', 'Creekside Tract', 'Station Tract'],
};
const BUILDING: Record<Use, string[]> = {
  ios: ['Truck Terminal', 'Equipment Yard', 'Trailer Lot', 'Container Yard', 'Fleet Yard'],
  spec: ['Distribution Center', 'Commerce Center', 'Business Park', 'Logistics Center', 'Trade Center'],
  retail: ['Shopping Center', 'Village', 'Marketplace', 'Town Center', 'Shops'],
  office: ['Office Center', 'Tower', 'Plaza', 'Corporate Center', 'Executive Park'],
  mf: ['Apartments', 'Flats', 'Villas', 'Lofts', 'Residences'],
};
const TEN_A = ['Brazos', 'Pecos', 'Llano', 'Caprock', 'Bluestem', 'Mesquite', 'Palo Duro', 'Guadalupe', 'Sabine', 'Concho', 'Frio', 'Nueces', 'Red River', 'Cross Timbers', 'Blackland', 'Chaparral', 'Cimarron', 'Lavaca', 'Pedernales', 'Wichita'];
const TEN_B: Record<Exclude<Use, 'mf'>, string[]> = {
  ios: ['Trucking', 'Equipment Rental', 'Trailer Leasing', 'Crane Service', 'Paving', 'Fleet Services'],
  spec: ['Logistics', 'Distribution', 'Packaging', 'Supply Co.', 'Fulfillment', 'Foods'],
  retail: ['Market', 'Fitness', 'Hardware', 'Pharmacy', 'Outfitters', 'Furniture'],
  office: ['Insurance Group', 'Engineering', 'Financial', 'Title Co.', 'Health Partners', 'Software'],
};

export function generateSites(districtOf: (x: number, y: number) => string, existing: Base[]): { land: Base[]; buildings: Base[] } {
  const spots: { x: number; y: number; use: Use }[] = existing.map((p) => ({ x: p.tile.x + p.tile.w / 2, y: p.tile.y + p.tile.h / 2, use: (p.existing?.type ?? 'spec') as Use }));
  const names = new Set(existing.map((p) => p.name));
  const uniq = (place: string, dir: string, tail: string) => { let n = `${place} ${tail}`; if (names.has(n)) n = `${dir} ${place} ${tail}`; for (let i = 2; names.has(n); i++) n = `${place} ${tail} ${i}`; names.add(n); return n; };

  // rank every open tile for every use once
  const cand: { x: number; y: number; k: Ctx; s: Record<Use, number>; d: string }[] = [];
  for (let y = 2; y < H - 2; y++) for (let x = 2; x < W - 2; x++) { if (blockAt(x, y) !== 0 || isSite(x, y)) continue; const k = context(x, y); cand.push({ x, y, k, s: suitability(k), d: districtOf(x, y) }); }

  const pickSpots = (use: Use, n: number, salt: number, gapSame: number, floor: number, gapAny = 1.5) => {
    const out: typeof cand = [], perDistrict: Record<string, number> = {}, cap = Math.max(2, Math.ceil(n * 0.3));
    const ranked = cand.map((c) => ({ c, v: c.s[use] + hash(c.x, c.y, salt) * 0.45 })).filter((r) => r.c.s[use] >= floor).sort((a, b) => b.v - a.v || a.c.y * W + a.c.x - (b.c.y * W + b.c.x));
    for (const { c } of ranked) {
      if (out.length >= n) break;
      if ((perDistrict[c.d] ?? 0) >= cap) continue;
      if (spots.some((s) => Math.hypot(s.x - c.x - 0.5, s.y - c.y - 0.5) < (s.use === use ? gapSame : gapAny))) continue;
      out.push(c); perDistrict[c.d] = (perDistrict[c.d] ?? 0) + 1; spots.push({ x: c.x + 0.5, y: c.y + 0.5, use });
    }
    return out;
  };

  const land: Base[] = [];
  (Object.keys(QUOTA) as Use[]).forEach((use, ui) => {
    pickSpots(use, QUOTA[use], 500 + ui, 2.6, use === 'office' ? 0.3 : 0.45).forEach((c, i) => {
      const r = (s: number) => hash(c.x, c.y, 520 + s), k = c.k, [lo, hi] = ACRES[use];
      let acres = Math.round((lo + (hi - lo) * Math.pow(r(1), use === 'spec' ? 1.4 : 1.1)) * 10) / 10;
      if (k.core) acres = Math.min(acres, 4.5);
      const tile = placeRectAt(c.x + 0.5, c.y + 0.5, acres >= 6 ? 2 : 1, acres > 20 ? 2 : 1, true, 3);
      if (!tile) return;
      const rural = k.u < 0.15;
      const zoning: Parcel['zoning'] = use === 'ios' || use === 'spec' ? (r(2) < 0.55 ? 'I' : rural && r(3) < 0.4 ? 'ETJ' : r(3) < 0.5 ? 'AG' : 'C') : use === 'mf' ? (r(2) < 0.45 ? 'C' : rural && r(3) < 0.3 ? 'ETJ' : 'AG') : r(2) < 0.7 ? 'C' : r(3) < 0.5 ? 'AG' : 'I';
      const floodPct = k.flood ? Math.round((0.06 + r(4) * 0.22) * 100) / 100 : 0;
      const askPsf = Math.round(LAND_BASE[c.d] * USE_LAND[use] * (0.85 + k.u * 0.45) * (acres > 15 ? 0.8 : 1) * (zoning === 'AG' ? 0.72 : zoning === 'ETJ' ? 0.62 : 1) * (1 - floodPct * 0.5) * (0.9 + r(5) * 0.2) * (k.majorCorner && use === 'retail' ? 1.15 : 1) * 20) / 20;
      const served = k.u > 0.12 || k.ind > 0.1 || zoning !== 'ETJ';
      const offMarket = r(6) < 0.1;
      const place = k.cityDist < 5 ? k.city : k.fw.name, tail = SUFFIX[use][Math.floor(r(7) * SUFFIX[use].length)];
      const name = uniq(place, k.cdir, use === 'spec' || use === 'mf' ? `${tail} ${Math.round(acres)}` : tail) + (offMarket ? ' (pocket listing)' : '');
      const near = k.fw.d < 2.5 ? `, near ${k.fw.name}` : '';
      const zoneNote = zoning === 'AG' ? ' Agricultural zoning, so it needs a rezoning.' : zoning === 'ETJ' ? ' Outside city limits: no zoning to fight, and no city utilities.' : '';
      const blurb = (offMarket ? 'Off-market. ' : '') + ({
        ios: `A ${rural ? 'cheap, flat' : 'tight infill'} tract for trucks and equipment ${k.fw.d < 1.3 ? `a minute from ${k.fw.name}` : 'off the main roads'}.`,
        spec: `${acres > 20 ? 'A big-box site' : 'A warehouse site'} ${k.is.d < 1.6 ? `with quick access to ${k.is.name}` : 'in an established industrial pocket'}${k.rail < 1 ? ', with rail alongside' : ''}.`,
        retail: `{front}, with ${k.u > 0.5 ? 'dense rooftops all around' : 'new subdivisions filling in nearby'}.`,
        office: `An office site in the ${k.officeName} job center${k.core ? ', where land is sold by the square foot and buildings go up, not out' : ''}.`,
        mf: `An apartment site ${k.office > 0.3 ? `close to the jobs in ${k.officeName}` : 'in a growing suburb'}${k.fw.d < 2.2 ? `, a short drive from ${k.fw.name}` : ''}. Expect neighbors at the hearing.`,
      } as Record<Use, string>)[use] + zoneNote + (floodPct > 0.1 ? ' Part of it floods.' : '');
      const fit = (Object.keys(c.s) as Use[]).filter((t) => t === use || c.s[t] >= 0.6).sort((a, b) => (a === use ? -1 : b === use ? 1 : c.s[b] - c.s[a]));
      land.push({
        id: `g-${use}-${i}`, name, area: `${k.city}${near}`, district: c.d, acres, askPsf, zoning, floodPct, water: served, sewer: served && !(rural && r(8) < 0.5), access: 3, rail: k.rail < 0.9 && (use === 'spec' || use === 'ios'), offMarket, blurb, tile, fit: fit as DealType[],
        hidden: { env: (use === 'spec' || use === 'ios') && k.ind > 0.15 ? (r(9) < 0.2 ? 'major' : r(9) < 0.5 ? 'minor' : 'none') : r(9) < 0.1 ? 'minor' : 'none', soils: r(10) < 0.35 ? 'expansive' : 'good', easementAcres: r(11) < 0.2 ? Math.round(acres * 0.06 * 10) / 10 : 0 },
      });
    });
  });

  // existing buildings: every type, from safe and full to empty and tired
  const BQ: Record<Use, number> = { spec: 7, retail: 6, mf: 5, ios: 5, office: 4 };
  const buildings: Base[] = [];
  (Object.keys(BQ) as Use[]).forEach((use, ui) => {
    pickSpots(use, BQ[use], 700 + ui, 2, use === 'office' ? 0.25 : 0.4, 1.2).forEach((c, i) => {
      const r = (s: number) => hash(c.x, c.y, 720 + s), k = c.k, profile = (i + ui) % 5; // 0 full and safe, 1 full but rolling soon and under market, 2 half empty, 3 empty and tired, 4 full, tired, repairs due
      const tired = profile === 3 || profile === 4 || (profile === 2 && r(1) < 0.5);
      const sf = use === 'ios' ? 0 : use === 'spec' ? Math.round((60 + r(2) * 240) / 10) * 10000 : use === 'retail' ? Math.round(28 + r(2) * 80) * 1000 : use === 'office' ? Math.round((60 + r(2) * 150) / 5) * 5000 : Math.round(120 + r(2) * 200) * 900;
      const acres = use === 'ios' ? Math.round((3 + r(3) * 9) * 10) / 10 : use === 'spec' ? Math.round((sf / 43560 / 0.36) * 10) / 10 : use === 'retail' ? Math.round((sf / 43560 / 0.24) * 10) / 10 : use === 'office' ? Math.round((sf / 43560 / 0.5) * 10) / 10 : Math.round((sf / 900 / 22) * 10) / 10;
      const tile = placeRectAt(c.x + 0.5, c.y + 0.5, use === 'ios' && acres < 8 ? 1 : 2, 1, true, 3);
      if (!tile) return;
      const ten = (j: number) => `${TEN_A[Math.floor(hash(c.x + j, c.y, 760 + ui) * TEN_A.length)]} ${TEN_B[use as Exclude<Use, 'mf'>][Math.floor(hash(c.x, c.y + j, 761 + ui) * 6)]}`;
      const credit = (j: number) => (['A', 'B', 'B', 'C'] as const)[Math.floor(r(20 + j) * 4)];
      const full = profile === 0 || profile === 1 || profile === 4, two = (use === 'retail' || use === 'office' || (use === 'spec' && sf >= 100000)) && r(4) < 0.6;
      const factor = profile === 1 ? 0.78 + r(5) * 0.1 : profile === 4 ? 0.88 + r(5) * 0.06 : 0.96 + r(5) * 0.06, months = profile === 1 ? 8 + Math.floor(r(6) * 12) : profile === 4 ? 28 + Math.floor(r(6) * 24) : 55 + Math.floor(r(6) * 60);
      const leases: Existing['leases'] = use === 'mf' || profile === 3 ? [] : full ? (two ? [0, 1] : [0]).map((j) => ({ tenant: ten(j), credit: credit(j), factor: Math.round((factor + j * 0.03) * 100) / 100, monthsLeft: months + j * 9, share: two ? 0.5 : 1, rentAnnual: 0 }))
        : use === 'ios' ? [] : [{ tenant: ten(0), credit: credit(0), factor: Math.round(factor * 100) / 100, monthsLeft: 24 + Math.floor(r(6) * 40), share: 0.5, rentAnnual: 0 }];
      const occ = use === 'mf' ? [0.94, 0.9, 0.8, 0.68, 0.87][profile] : undefined;
      const deferred = tired ? Math.round(((use === 'ios' ? 0 : sf * (use === 'mf' ? 1.6 : use === 'office' ? 2.2 : 1.6)) * (0.6 + r(7) * 0.8)) / 5000) * 5000 : profile === 2 ? Math.round((sf * 0.4) / 5000) * 5000 : 0;
      const place = k.cityDist < 5 ? k.city : k.fw.name, name = uniq(place, k.cdir, BUILDING[use][Math.floor(r(8) * 5)]);
      const what = use === 'ios' ? `${acres} fenced acres` : use === 'mf' ? `${Math.round(sf / 900)} apartments` : `${Math.round(sf / 1000)},000 square feet of ${use === 'spec' ? 'warehouse' : use === 'retail' ? 'shops' : 'offices'}`;
      const story = ['Full, with long leases and nothing to fix. Safe, and priced like it.', 'Full today, but the rent is well under market and the lease is nearly up. The upside is the renewal; the risk is the tenant leaving.', 'Half of it is dark. You are paying a discount for the empty space.', 'Empty and worn out. Cheap, and every dollar of the upside has to be earned.', 'Leased, but tired. Expect a repair bill and softer rents until it is fixed up.'][profile];
      const mfStory = [`${Math.round(occ! * 100)}% occupied and well kept.`, `${Math.round(occ! * 100)}% occupied, with rents a little behind the newer places nearby.`, 'One unit in five is empty.', 'A third of the units are empty and the rest need new kitchens.', 'Mostly full, with a long list of repairs the owner has put off.'][profile];
      buildings.push({
        id: `gx-${use}-${i}`, name, area: k.city, district: c.d, acres, askPsf: 0, zoning: use === 'ios' || use === 'spec' ? 'I' : 'C', floodPct: 0, water: true, sewer: true, access: 3, rail: false, offMarket: false, tile, fit: [use] as DealType[],
        blurb: `${what[0].toUpperCase()}${what.slice(1)}. ${use === 'mf' ? mfStory : story}`, hidden: { env: 'none', soils: 'good', easementAcres: 0 },
        existing: { type: use as DealType, sf, cond: tired ? 'tired' : 'good', deferred, occ, leases },
      });
    });
  });
  return { land, buildings };
}
