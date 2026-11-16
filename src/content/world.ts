// The Alliance / North Fort Worth district: parcels and characters.
// Geography (highways, towns, rail) is real. Parcels, firms and people are invented,
// and every price and rent is a game-balance number, not market data.
import type { Existing, Npc, Parcel } from '../engine/types';
import { hash, ll, placeRect, type XY } from '../render/layout';
const hash2 = (x: number, y: number) => hash(x, y, 950);
import { buildRoadNet, setRoadNet, type SiteRoad } from './roads';
import { context, generateSites, suitability } from './sitegen';
import { ACRE_RANGE } from '../engine/params';
import { computeSiteData, districtCapAdj, residualLandPsf, residualSpecPsf, residualYardPsf, type DistrictProfile, type SiteData } from './sitedata';
import type { DealType } from '../engine/types';

/** How strong each district is for retail, apartments and offices (rooftops and incomes, not truck access). */
const URBAN: Record<string, number> = { alliance: 0.95, dfw: 1.15, gsw: 1.0, netarrant: 1.08, southdallas: 0.8, eastdallas: 0.9, southtarrant: 0.92, westfw: 0.92, denton: 0.95, collin: 1.2, cbd: 1.3, fwcbd: 1.08 };
export interface District extends DistrictProfile { id: string; name: string; blurb: string; urban: number; ind: number; ios: number; cap: number; ent: number; at: [number, number] }
// [wealth, job growth %, rent: retail office apartments, demand: retail office apartments, usual vacancy: retail office apartments]
const PEOPLE: Record<string, number[]> = {
  alliance: [0.55, 2.2, 1.0, 0.9, 1.0, 1.05, 0.8, 1.1, 0.06, 0.2, 0.08], dfw: [0.6, 1.5, 1.1, 1.15, 1.08, 1.0, 1.05, 1.0, 0.05, 0.2, 0.07], gsw: [0.3, 0.8, 0.95, 0.8, 0.92, 0.95, 0.75, 0.95, 0.07, 0.25, 0.08],
  netarrant: [0.7, 1.0, 1.08, 0.98, 1.02, 1.0, 0.85, 1.0, 0.05, 0.22, 0.07], southdallas: [0.1, 1.3, 0.8, 0.65, 0.8, 0.8, 0.55, 0.85, 0.09, 0.3, 0.1], eastdallas: [0.25, 1.6, 0.9, 0.7, 0.88, 0.95, 0.6, 0.95, 0.07, 0.28, 0.09],
  southtarrant: [0.35, 1.5, 0.92, 0.72, 0.9, 1.0, 0.65, 1.0, 0.07, 0.27, 0.08], westfw: [0.4, 1.4, 0.9, 0.75, 0.9, 0.9, 0.7, 0.9, 0.08, 0.26, 0.09], denton: [0.45, 2.0, 0.95, 0.78, 0.95, 1.0, 0.7, 1.05, 0.06, 0.24, 0.08],
  collin: [0.9, 2.4, 1.25, 1.2, 1.2, 1.15, 1.15, 1.15, 0.045, 0.19, 0.07], cbd: [0.8, 1.2, 1.3, 1.35, 1.35, 1.05, 1.1, 1.15, 0.06, 0.24, 0.085], fwcbd: [0.4, 1.1, 1.05, 1.0, 1.08, 0.95, 0.9, 1.0, 0.07, 0.17, 0.08],
};
const profile = (id: string, ind: number, ios: number, demand: number): DistrictProfile => { const v = PEOPLE[id]; return { wealth: v[0], growth: v[1], rent: { ios, spec: ind, retail: v[2], office: v[3], mf: v[4] }, demand: { ios: demand, spec: demand, retail: v[5], office: v[6], mf: v[7] }, vac: { ios: 0.04 / Math.max(0.6, demand), spec: 0.075 / Math.max(0.6, demand), retail: v[8], office: v[9], mf: v[10] } }; };
/** Each district scales the metro-wide market: rent multipliers, a cap-rate adjustment, approval odds and tenant demand. */
export const DISTRICTS: Record<string, District> = Object.fromEntries(([
  ['alliance', 'North Fort Worth / Alliance', 'Big-box and yard demand around the intermodal and the airport. Fast-growing, with ETJ land at the edges.', 1.0, 1.0, 0, 0, 1.0, 32.99, -97.3],
  ['dfw', 'DFW Airport / Coppell / Grapevine', 'The best address in the metro. Top rents, almost no land, and cities that do not want outdoor storage.', 1.2, 1.3, -0.0025, -0.12, 1.2, 32.94, -97.02],
  ['gsw', 'Great Southwest / Arlington', 'Old-line infill industrial between the two downtowns. Tight land, strong tenants, tired buildings.', 1.08, 1.15, -0.001, -0.05, 1.15, 32.75, -97.05],
  ['netarrant', 'Northeast Tarrant / HEB', 'Small-bay and yard infill for contractors and owner-users. Small sites, careful councils.', 1.1, 1.2, -0.0005, -0.1, 1.05, 32.83, -97.19],
  ['southdallas', 'South Dallas / Inland Port', 'Cheap land in big blocks along I-20 and I-45 by the Union Pacific intermodal. More supply, lower rents.', 0.94, 0.92, 0.0015, -0.03, 0.95, 32.61, -96.73],
  ['eastdallas', 'East Dallas County / Mesquite / Forney', 'The growth frontier out US-80 and I-20. Big tracts, improving demand.', 0.93, 0.95, 0.001, 0, 0.95, 32.76, -96.56],
  ['southtarrant', 'South Tarrant / I-35W South', 'Rail-served pockets and farmland from Everman to Burleson. Steady, never hot.', 0.95, 0.95, 0.001, 0.02, 0.9, 32.6, -97.3],
  ['westfw', 'West Fort Worth / Benbrook / Aledo', 'Emerging corridor west on I-20 and I-30. The cheapest dirt in the metro and the longest lease-ups.', 0.91, 0.9, 0.0025, 0.05, 0.75, 32.72, -97.48],
  ['denton', 'Denton / I-35 North', 'Edge greenfield where the two I-35s meet. Rail plays and patient capital.', 0.92, 0.9, 0.0015, 0.03, 0.85, 33.2, -97.17],
  ['cbd', 'Central and North Dallas', 'Downtown, Uptown, the Park Cities and the Tollway corridor up to Addison. The deepest office and apartment market in the metro, and the most expensive dirt.', 1.15, 1.25, -0.002, -0.15, 1.05, 32.8, -96.8],
  ['fwcbd', 'Central Fort Worth', 'Downtown Fort Worth and the near west side. Smaller and steadier than Dallas, with a city that wants its core filled in.', 1.02, 1.08, 0, -0.06, 0.95, 32.752, -97.335],
  ['collin', 'Collin County / Plano / Frisco / McKinney', 'Wealthy suburbs with flex and light industrial. High rents, expensive land, and little patience for trucks.', 1.05, 1.1, -0.001, -0.15, 0.9, 33.1, -96.72],
] as [string, string, string, number, number, number, number, number, number, number][]).map(([id, name, blurb, ind, ios, cap, ent, demand, la, lo]) => [id, { id, name, blurb, urban: URBAN[id], ind, ios, cap, ent, at: [la, lo], ...profile(id, ind, ios, demand) }]));
/** Cap-rate adjustment for a property type in a district. */
export const capAdj = (districtId: string, type: DealType) => districtCapAdj(type, DISTRICTS[districtId].cap, DISTRICTS[districtId]);

type Z = Parcel['zoning'];
type Raw = [id: string, name: string, area: string, district: string, lat: number, lon: number, acres: number, askPsf: number, zoning: Z, floodPct: number, water: 0 | 1, sewer: 0 | 1, access: number, rail: 0 | 1, offMarket: 0 | 1, env: 'none' | 'minor' | 'major', soils: 'good' | 'expansive', easement: number, blurb: string];
const RAW: Raw[] = [
  // North Fort Worth / Alliance
  ['bluemound', 'Blue Mound Yard Site', 'Fort Worth, near SH-170', 'alliance', 32.955, -97.3, 3.1, 7.25, 'C', 0, 1, 1, 4, 0, 0, 'none', 'good', 0.2, 'Flat corner tract a minute from SH-170. Commercial zoning, so outdoor storage needs a Specific Use Permit.'],
  ['railspur', 'Haslet Rail Spur Tract', 'Haslet', 'alliance', 32.975, -97.385, 6.5, 6.75, 'I', 0, 1, 1, 3, 1, 0, 'minor', 'good', 0, 'Industrial-zoned land beside the BNSF main line. An old fueling shed still stands in the back corner.'],
  ['fm156', 'FM 156 Corner', 'Justin', 'alliance', 33.06, -97.31, 4.2, 8.0, 'C', 0, 1, 1, 3, 0, 0, 'none', 'good', 0, 'Hard corner on FM 156 with good frontage. Priced like retail, but the traffic counts are real.'],
  ['justin12', 'Justin Prairie 12', 'Justin', 'alliance', 33.11, -97.34, 12, 4.25, 'AG', 0, 1, 0, 2, 0, 0, 'none', 'expansive', 0, 'Cheap pasture north of SH-114. Agricultural zoning and no sewer yet, so it needs patience.'],
  ['northlake10', 'Northlake Gateway 10', 'Northlake', 'alliance', 33.055, -97.255, 10.4, 6.5, 'I', 0, 1, 1, 5, 0, 0, 'none', 'good', 0, 'Shovel-ready industrial site at I-35W and SH-114. Zoned, served and visible from the freeway.'],
  ['speedway15', 'Speedway South 15', 'Fort Worth', 'alliance', 33.01, -97.26, 15, 5.5, 'AG', 0.12, 1, 1, 5, 0, 0, 'none', 'good', 0.6, 'Big frontage tract south of the speedway. Needs rezoning, and a creek clips the east end.'],
  ['westport8', 'Westport 8', 'Fort Worth', 'alliance', 32.985, -97.255, 8.3, 7.0, 'I', 0, 1, 1, 4, 0, 0, 'major', 'good', 0, 'Former truck wash and trailer lot on Westport Parkway. Zoned industrial and priced to move.'],
  ['roanoke5', 'Roanoke East 5', 'Roanoke', 'alliance', 33.02, -97.2, 5, 9.0, 'C', 0, 1, 1, 4, 0, 0, 'none', 'expansive', 0, 'Infill tract near downtown Roanoke. Expensive dirt in a city that guards its look.'],
  ['henrietta9', 'Henrietta Creek Bottoms', 'Fort Worth', 'alliance', 32.935, -97.275, 9, 3.9, 'I', 0.35, 1, 1, 3, 0, 0, 'none', 'expansive', 0, 'The cheapest industrial-zoned land in the corridor. There is a reason: the creek owns a third of it.'],
  ['avondale7', 'Avondale ETJ 7', 'Tarrant County ETJ', 'alliance', 32.95, -97.43, 7, 4.0, 'ETJ', 0, 0, 0, 2, 0, 0, 'none', 'good', 0.4, 'County land outside city limits. No zoning to fight, but no city water or sewer either.'],
  ['harmon4', 'Harmon Yard (pocket listing)', 'Fort Worth', 'alliance', 32.915, -97.33, 4, 6.9, 'I', 0, 1, 1, 5, 0, 1, 'none', 'good', 0, 'Off-market. A retiring owner would rather sell quietly to someone his broker trusts.'],
  ['elizabeth18', 'Elizabeth Creek 18 (pocket listing)', 'Fort Worth', 'alliance', 32.95, -97.225, 18, 4.4, 'AG', 0.08, 1, 1, 3, 0, 1, 'none', 'good', 0, 'Off-market. A family partnership is ready to sell the back pasture if the buyer can close.'],
  // DFW Airport
  ['coppell6', 'Coppell Freeport 6', 'Coppell', 'dfw', 32.965, -96.985, 6.4, 16.5, 'I', 0, 1, 1, 5, 0, 0, 'none', 'good', 0, 'One of the last vacant pads in the Freeport area. Every logistics broker in town knows about it.'],
  ['grapevine3', 'Grapevine Mills 3', 'Grapevine', 'dfw', 32.97, -97.045, 3, 18.0, 'C', 0, 1, 1, 5, 0, 0, 'none', 'good', 0.2, 'Three acres north of the airport. The city will want to know why a yard belongs next to a mall.'],
  ['irving11', 'Valley View 11 (pocket listing)', 'Irving', 'dfw', 32.895, -96.975, 11, 15.0, 'I', 0.15, 1, 1, 5, 0, 1, 'minor', 'good', 0, 'Off-market. An old distribution site by the Elm Fork whose owner is tired of flood insurance.'],
  // Great Southwest
  ['gsw3', 'Great Southwest Infill 3', 'Grand Prairie', 'gsw', 32.765, -97.035, 2.8, 14.5, 'I', 0, 1, 1, 5, 0, 0, 'minor', 'good', 0, 'A paved lot between two 1970s warehouses. Small, but tenants in this district rarely leave.'],
  ['avenuek7', 'Avenue K Redevelopment', 'Grand Prairie', 'gsw', 32.785, -97.025, 7.2, 12.0, 'I', 0, 1, 1, 5, 1, 0, 'major', 'good', 0, 'A shuttered metal-finishing plant on a rail spur. The location is perfect. Ask what is in the ground.'],
  ['arl360', 'SH-360 Corner 4', 'Arlington', 'gsw', 32.695, -97.075, 4.1, 13.0, 'C', 0, 1, 1, 4, 0, 0, 'none', 'expansive', 0, 'Commercial corner in south Arlington. Great visibility, and a council that prefers restaurants.'],
  // Northeast Tarrant
  ['heb2', 'Pipeline Road 2.5', 'Hurst', 'netarrant', 32.825, -97.155, 2.5, 11.0, 'I', 0, 1, 1, 4, 0, 0, 'none', 'good', 0, 'A small contractor yard site in the mid-cities. Everything here is small, and everything leases.'],
  ['richland5', 'Midway Road 5', 'Richland Hills', 'netarrant', 32.805, -97.235, 5, 9.5, 'C', 0, 1, 1, 4, 0, 0, 'none', 'good', 0.3, 'Five acres off Loop 820 behind a row of auto shops.'],
  ['keller8', 'Old Denton Road 8', 'Fort Worth, near Keller', 'netarrant', 32.9, -97.285, 8, 7.5, 'AG', 0, 1, 1, 4, 0, 0, 'none', 'expansive', 0, 'Pasture with rooftops closing in on three sides. The neighbors will come to the hearing.'],
  // South Dallas
  ['wilmer22', 'Wilmer Intermodal 22', 'Wilmer', 'southdallas', 32.585, -96.7, 22, 3.6, 'I', 0, 1, 1, 5, 1, 0, 'none', 'good', 0, 'Zoned, rail-adjacent land across from the Union Pacific terminal. Built for big boxes.'],
  ['hutchins9', 'Hutchins Yard Tract', 'Hutchins', 'southdallas', 32.655, -96.7, 9, 4.1, 'I', 0, 1, 1, 5, 0, 0, 'minor', 'good', 0, 'A gravel lot at I-45 and I-20 that truckers have used informally for years.'],
  ['lancaster30', 'Lancaster Logistics 30', 'Lancaster', 'southdallas', 32.605, -96.785, 30, 2.6, 'AG', 0.1, 1, 1, 4, 0, 0, 'none', 'expansive', 0, 'Thirty acres of blackland prairie near the airport. Cheap, flat, and sitting on famous clay.'],
  ['pleasant6', 'Pleasant Run 6 (pocket listing)', 'Lancaster', 'southdallas', 32.61, -96.735, 6, 3.9, 'C', 0, 1, 1, 4, 0, 1, 'none', 'good', 0, 'Off-market. An estate sale the heirs want finished before year-end.'],
  ['midlothian50', 'Midlothian RailPort 50', 'Midlothian', 'southdallas', 32.47, -97.02, 50, 2.2, 'I', 0, 1, 1, 3, 1, 0, 'none', 'good', 1.5, 'Fifty rail-served acres south of the metro. A long way out, with room for a very large building.'],
  // East Dallas County
  ['mesquite12', 'Skyline Mesquite 12', 'Mesquite', 'eastdallas', 32.785, -96.615, 12, 5.2, 'I', 0, 1, 1, 4, 1, 0, 'minor', 'good', 0, 'An old lumber yard in the Skyline industrial district, ready for a second life.'],
  ['forney40', 'Forney Gateway 40', 'Forney', 'eastdallas', 32.735, -96.455, 40, 2.4, 'AG', 0.05, 1, 0, 4, 0, 0, 'none', 'expansive', 0, 'Forty acres on US-80 where the houses have not arrived yet. No sewer until someone pays to extend it.'],
  ['balch7', 'Balch Springs I-20 7', 'Balch Springs', 'eastdallas', 32.705, -96.605, 7, 4.6, 'C', 0, 1, 1, 5, 0, 0, 'none', 'good', 0.5, 'Freeway frontage at I-20 and I-635.'],
  ['garland4', 'Shiloh Road 4', 'Garland', 'eastdallas', 32.9, -96.665, 4, 9.0, 'I', 0, 1, 1, 3, 0, 0, 'none', 'good', 0.4, 'Infill industrial land in Garland\'s old manufacturing district.'],
  // South Tarrant
  ['everman6', 'Everman Parkway 6', 'Everman', 'southtarrant', 32.635, -97.305, 6, 5.0, 'I', 0, 1, 1, 4, 1, 0, 'none', 'good', 0, 'Rail-served and zoned, just off I-35W south of Loop 820.'],
  ['burleson18', 'Hooper Tract 18', 'Burleson', 'southtarrant', 32.555, -97.335, 18, 2.9, 'AG', 0, 1, 0, 3, 0, 0, 'none', 'good', 0, 'Farmland at the south edge of the metro. The city wants jobs, which helps at a hearing.'],
  ['mansfield9', 'Mansfield 287 Frontage 9', 'Mansfield', 'southtarrant', 32.585, -97.115, 9, 5.8, 'C', 0, 1, 1, 4, 0, 0, 'none', 'expansive', 0.3, 'Highway frontage in a suburb that has industrial parks and strict design rules.'],
  // West Fort Worth
  ['aledo25', 'Aledo I-20 25', 'Parker County ETJ', 'westfw', 32.715, -97.585, 25, 1.9, 'ETJ', 0, 0, 0, 4, 0, 0, 'none', 'good', 0, 'Ranch land on the interstate outside any city. No zoning, no utilities, no neighbors.'],
  ['benbrook10', 'Winscott Road 10', 'Benbrook', 'westfw', 32.685, -97.445, 10, 4.2, 'I', 0, 1, 1, 3, 0, 0, 'none', 'expansive', 0, 'Industrial-zoned land near the lake that has waited years for the west side to arrive.'],
  ['settlement4', 'Clifford Street 4', 'White Settlement', 'westfw', 32.765, -97.47, 4, 5.5, 'C', 0, 1, 1, 3, 0, 0, 'minor', 'good', 0, 'A former equipment dealer lot near the aircraft plant.'],
  // Denton
  ['denton35', 'Denton Westpark 35', 'Denton', 'denton', 33.2, -97.185, 35, 3.0, 'I', 0, 1, 1, 4, 0, 0, 'none', 'good', 1, 'Thirty-five zoned acres where I-35E and I-35W meet. The big-box frontier of the north side.'],
  ['krum15', 'Krum Rail 15', 'Krum', 'denton', 33.25, -97.265, 15, 2.1, 'AG', 0, 1, 0, 2, 1, 0, 'none', 'good', 0, 'Rail frontage on the BNSF with nothing around it but wheat.'],
  ['corinth5', 'Corinth Parkway 5', 'Corinth', 'denton', 33.14, -97.08, 5, 7.0, 'C', 0.1, 1, 1, 4, 0, 0, 'none', 'good', 0, 'I-35E frontage near the lake.'],
  // Collin County
  ['mckinney10', 'McKinney Airport 10', 'McKinney', 'collin', 33.175, -96.6, 10, 8.5, 'I', 0, 1, 1, 3, 0, 0, 'none', 'expansive', 0, 'Industrial land beside the airport, the one part of town where trucks are welcome.'],
  ['plano3', 'Plano Tech Row 3', 'Plano', 'collin', 33.005, -96.69, 3, 15.0, 'I', 0, 1, 1, 4, 0, 0, 'none', 'good', 0.2, 'A leftover pad in a research and light-industrial park east of US-75.'],
  ['frisco5', 'Frisco 380 Corner 5', 'Frisco', 'collin', 33.205, -96.85, 5, 14.0, 'C', 0, 1, 1, 4, 0, 0, 'none', 'good', 0, 'Hard corner on US-380. The highest land price on the map, in the city least likely to approve a yard.'],
];

// Tiles are assigned once, when the module loads, so every game and every save agrees on where sites are.
const PARCELS: Omit<Parcel, 'status'>[] = RAW.map(([id, name, area, district, lat, lon, acres, askPsf, zoning, floodPct, water, sewer, access, rail, offMarket, env, soils, easementAcres, blurb]) => ({
  id, name, area, district, acres, askPsf, zoning, floodPct, water: !!water, sewer: !!sewer, access, rail: !!rail, offMarket: !!offMarket, blurb,
  tile: placeRect(lat, lon, acres >= 6 ? 2 : 1, acres > 20 ? 2 : 1), hidden: { env, soils, easementAcres },
}));

// Existing properties for sale. Rents are set as a share of market when a game starts.
type Ex = [id: string, name: string, area: string, district: string, lat: number, lon: number, acres: number, zoning: Z, access: number, blurb: string, ex: Omit<Existing, 'leases'> & { leases: [tenant: string, credit: 'A' | 'B' | 'C', factor: number, monthsLeft: number, share: number][] }];
const EXISTING: Ex[] = [
  ['ex-saginaw', 'Saginaw Truck Yard', 'Saginaw', 'alliance', 32.872, -97.39, 5.2, 'I', 4, 'A working truck yard with a tenant paying well under today\'s rent and a lease that ends in about a year.',
    { type: 'ios', sf: 0, cond: 'good', deferred: 0, leases: [['Red Dirt Trucking', 'B', 0.8, 13, 1]] }],
  ['ex-avenue-e', 'Avenue E Warehouse', 'Arlington', 'gsw', 32.745, -97.075, 5, 'I', 5, 'An empty 1980s warehouse in a great location. Low ceilings, tired paint, and a roof nobody has looked at lately.',
    { type: 'spec', sf: 86000, cond: 'tired', deferred: 180000, leases: [] }],
  ['ex-towneast', 'Town East Commerce Center', 'Mesquite', 'eastdallas', 32.8, -96.64, 7, 'I', 4, 'A two-tenant building that lost one of them. Half leased, half dark.',
    { type: 'spec', sf: 120000, cond: 'good', deferred: 60000, leases: [['Caprock Auto Parts', 'B', 0.95, 40, 0.5]] }],
  ['ex-i45yard', 'I-45 Container Yard', 'Hutchins', 'southdallas', 32.628, -96.7, 11, 'I', 5, 'Eleven fenced acres by the intermodal, vacant since the last operator left. The gravel has seen better days.',
    { type: 'ios', sf: 0, cond: 'tired', deferred: 0, leases: [] }],
  ['ex-westport1', 'Westport Distribution One', 'Fort Worth', 'alliance', 32.962, -97.235, 12, 'I', 5, 'A modern building with a strong tenant and eight years of lease left. Safe, and priced like it.',
    { type: 'spec', sf: 210000, cond: 'good', deferred: 0, leases: [['Comanche Peak Logistics', 'A', 1.0, 96, 1]] }],
  ['ex-parker', 'Parker Road Shops', 'Plano', 'collin', 33.042, -96.74, 4.5, 'C', 4, 'A neighborhood center that kept its grocer and lost the small shops. Dated storefronts in a rich trade area.',
    { type: 'retail', sf: 42000, cond: 'tired', deferred: 120000, leases: [['Llano Fresh Market', 'A', 0.9, 60, 0.5]] }],
  ['ex-cooper', 'Cooper Street Flats', 'Arlington', 'gsw', 32.705, -97.118, 8, 'C', 4, 'A 180-unit apartment community from the 1990s. One in five units is empty and the rest need new kitchens.',
    { type: 'mf', sf: 162000, cond: 'tired', deferred: 250000, occ: 0.74, leases: [] }],
  ['ex-plaza2', 'Las Colinas Plaza II', 'Irving', 'dfw', 32.875, -96.945, 5, 'C', 5, 'A half-empty suburban office building. Cheap for a reason, in a district where offices can still work.',
    { type: 'office', sf: 95000, cond: 'tired', deferred: 200000, leases: [['Pecos Title & Escrow', 'B', 0.92, 30, 0.5]] }],
];
const EX_PARCELS: Omit<Parcel, 'status'>[] = EXISTING.map(([id, name, area, district, lat, lon, acres, zoning, access, blurb, ex]) => ({
  id, name, area, district, acres, askPsf: 0, zoning, floodPct: 0, water: true, sewer: true, access, rail: false, offMarket: false, blurb,
  tile: placeRect(lat, lon, ex.type === 'ios' && acres < 8 ? 1 : 2, 1), hidden: { env: 'none', soils: 'good', easementAcres: 0 },
  existing: { ...ex, leases: ex.leases.map(([tenant, credit, factor, monthsLeft, share]) => ({ tenant, credit, factor, monthsLeft, share, rentAnnual: 0 })) },
}));

// --- the rest of the map: rule-built sites and buildings, then the road network that ties every one of them in ---
// each district is a set of anchor points; a spot belongs to the district with the nearest anchor
const ANCHORS: Record<string, [number, number][]> = {
  collin: [[33.1, -96.72], [33.0, -96.72], [33.15, -96.83], [33.2, -96.64]], cbd: [[32.79, -96.8], [32.86, -96.8], [32.93, -96.82]], eastdallas: [[32.76, -96.56], [32.9, -96.64], [32.72, -96.62]],
  dfw: [[32.94, -97.02], [32.86, -96.95], [32.97, -96.93]], gsw: [[32.75, -97.05], [32.7, -97.1]], southdallas: [[32.61, -96.73], [32.6, -96.9], [32.48, -97.0], [32.68, -96.82]],
  fwcbd: [[32.752, -97.335]], netarrant: [[32.83, -97.19], [32.92, -97.2]], alliance: [[32.99, -97.3], [33.07, -97.3], [32.9, -97.36]], southtarrant: [[32.6, -97.3], [32.57, -97.14]],
  westfw: [[32.72, -97.48], [32.78, -97.45]], denton: [[33.2, -97.17], [33.12, -97.08]],
};
const DCENTERS: [string, XY][] = Object.entries(ANCHORS).flatMap(([id, pts]) => pts.map(([la, lo]) => [id, ll(la, lo)] as [string, XY]));
/** The district a spot belongs to. */
export function districtAt(x: number, y: number): string {
  let best = '', bd = 1e9;
  for (const [id, [cx, cy]] of DCENTERS) { const d = Math.hypot(cx - x - 0.5, cy - y - 0.5) * (id === 'fwcbd' ? 2.2 : 1); if (d < bd) { bd = d; best = id; } }
  return best;
}
const TUTORIAL = ['bluemound', 'northlake10']; // the two guided deals keep their hand-set prices and access
const GEN = generateSites(districtAt, [...PARCELS, ...EX_PARCELS]);
const ALL: Omit<Parcel, 'status'>[] = [...PARCELS, ...EX_PARCELS, ...GEN.land, ...GEN.buildings];
const NET = buildRoadNet(ALL.map((p) => ({ id: p.id, tile: p.tile })));
setRoadNet(NET);
for (const p of ALL) {
  const r = NET.site[p.id];
  if (p.blurb.includes('{front}')) p.blurb = p.blurb.replace('{front}', r.hard ? 'A hard corner where two arterials meet' : r.front === 'interstate' || r.front === 'highway' ? `Freeway-visible frontage on ${r.frontName.replace(' frontage', '')}` : r.corner ? 'A corner site on a busy street' : 'A mid-block retail site');
  // the old hand-set access dots now come from the drive to the nearest interchange
  if (!TUTORIAL.includes(p.id)) p.access = r.rampMi <= 0.65 ? 5 : r.rampMi <= 1.1 ? 4 : r.rampMi <= 2 ? 3 : r.rampMi <= 3.5 ? 2 : 1;
  if (!p.fit) { const s = suitability(context(p.tile.x, p.tile.y)), ua = p.acres * (1 - p.floodPct); p.fit = (Object.keys(s) as (keyof typeof s)[]).filter((t) => s[t] >= 0.55 && ua >= ACRE_RANGE[t][0] && ua <= ACRE_RANGE[t][1]).sort((a, b) => s[b] - s[a]); if (!p.fit.length) p.fit = [p.acres >= 6 ? 'spec' : 'ios']; }
}
// what drives each property type at each site, then land priced at its highest and best use
const SITE: Record<string, SiteData> = {};
for (const p of ALL) {
  const k = context(p.tile.x, p.tile.y), d = DISTRICTS[p.district], s = TUTORIAL.includes(p.id) ? { ios: 0.8, spec: 0.565, retail: 0, office: 0, mf: 0 } : suitability(k), sd = (SITE[p.id] = computeSiteData(p, NET.site[p.id], k, d, s));
  if (p.existing || TUTORIAL.includes(p.id)) continue;
  // industrial value is the floor; if shops, offices or apartments are worth more here, the seller prices to that
  // each use is worth a different amount here; the seller prices to the best of them, and never gives land away
  const ua = p.acres * (1 - p.floodPct), fits = (t: DealType) => ua >= ACRE_RANGE[t][0] && ua <= ACRE_RANGE[t][1];
  const worth: Record<DealType, number> = { ios: residualYardPsf(p, sd, d, d.cap), spec: fits('spec') ? residualSpecPsf(p, sd, d.ind, d.cap) : 0, retail: 0, office: 0, mf: 0 };
  // the use the site was laid out for always counts; another use has to be a strong match to move the price
  const meant = p.id.startsWith('g-') ? (p.id.split('-')[1] as DealType) : null, counts = (t: DealType) => (t === meant ? true : s[t] >= (t === 'ios' || t === 'spec' ? (meant && meant !== 'ios' && meant !== 'spec' ? 0.7 : 0.3) : 0.62));
  for (const t of ['retail', 'office', 'mf'] as const) if (counts(t) && fits(t)) worth[t] = residualLandPsf(p, t, sd, d, d.cap);
  for (const t of ['ios', 'spec'] as const) if (!counts(t)) worth[t] = 0;
  if (ua > 12 && meant !== 'ios' && worth.spec > 0) worth.ios = Math.min(worth.ios, worth.spec * 0.7); // big tracts sell to building developers, not yard operators
  const best = Math.max(p.askPsf * 0.45, ...Object.values(worth));
  p.askPsf = Math.min(140, Math.max(0.6, Math.round(best * (0.92 + hash2(p.tile.x, p.tile.y) * 0.2) * 20) / 20));
  // "suits" means the location works for the use and the use can pay something close to the price
  const keep = (Object.keys(worth) as DealType[]).filter((t) => worth[t] > 0 && worth[t] >= p.askPsf * 0.7).sort((a, b) => worth[b] - worth[a]);
  p.fit = keep.length ? keep : [meant ?? (Object.keys(worth) as DealType[]).sort((a, b) => worth[b] - worth[a])[0]];
}
/** The numbers that drive each property type at a site. */
export const siteDataOf = (id: string): SiteData => SITE[id];
/** Frontage, corner and distance to a freeway for a site. */
export const roadOf = (id: string): SiteRoad => NET.site[id];

const copy = (p: Omit<Parcel, 'status'>): Parcel => ({ ...p, fit: p.fit ? [...p.fit] : undefined, tile: { ...p.tile }, hidden: { ...p.hidden }, existing: p.existing ? { ...p.existing, leases: p.existing.leases.map((l) => ({ ...l })) } : undefined, status: 'available' });
export const makeParcels = (): Parcel[] => ALL.map(copy);

export const makeNpcs = (): Npc[] => [
  { id: 'dusty', name: 'Dusty Rhodes', org: 'Rhodes Land Company', role: 'broker', rel: 52,
    blurb: 'Land broker and old friend. Knows which owners are ready to sell before they do. At 60+ he shares pocket listings and sellers take your offers more seriously.' },
  { id: 'priya', name: 'Priya Raman', org: 'Trinity Tenant Advisors', role: 'tenantrep', rel: 25,
    blurb: 'Tenant-rep broker for logistics and equipment users. A better relationship means she brings her clients to your buildings first.' },
  { id: 'hollis', name: 'The Hollis Family', org: 'Friends and family', role: 'lp', rel: 60,
    maxCheck: 900000, pref: 0.08, promote: 0.2, hurdle2: 0.16, promote2: 0.3, minCoinvest: 0.05, minDeals: 0,
    blurb: 'Your first believers. Small checks, simple terms: an 8% preferred return, then profits split 80/20.' },
  { id: 'dental', name: 'Trinity Trail Dental Partners', org: 'High-net-worth group', role: 'lp', rel: 30,
    maxCheck: 2500000, pref: 0.08, promote: 0.25, hurdle2: 0.15, promote2: 0.35, minCoinvest: 0.05, minDeals: 0,
    blurb: 'Six dentists who pool their investments. Bigger checks, and they let you keep a 25% promote if you perform.' },
  { id: 'caddo', name: 'Caddo Creek Family Office', org: 'Family office', role: 'lp', rel: 15,
    maxCheck: 10000000, pref: 0.09, promote: 0.25, hurdle2: 0.16, promote2: 0.35, minCoinvest: 0.05, minDeals: 1,
    blurb: 'Patient oil-and-gas money. They want a 9% preferred return and at least one completed deal on your record.' },
  { id: 'educators', name: 'Lone Star Educators Fund', org: 'Institutional investor', role: 'lp', rel: 5,
    maxCheck: 40000000, pref: 0.09, promote: 0.2, hurdle2: 0.15, promote2: 0.3, minCoinvest: 0.1, minDeals: 3,
    blurb: 'An institution with a long checklist. They only back developers with three or more completed deals.' },
  { id: 'crosstimbers', name: 'Wes Amador', org: 'Cross Timbers Community Bank', role: 'lender', rel: 40,
    ltc: 0.6, rate: 0.08, spread: 0.035, fee: 0.01, maxLoan: 3500000,
    blurb: 'Community banker who lends on character. Smaller loans at 60% of cost.' },
  { id: 'trinityregional', name: 'Joanna Brandt', org: 'Trinity Regional Bank', role: 'lender', rel: 20,
    ltc: 0.6, rate: 0.075, spread: 0.03, fee: 0.01, maxLoan: 25000000,
    blurb: 'Regional construction lender. Bigger loans at a better rate, and 65% of cost once she trusts you (50+).' },
  { id: 'mesa', name: 'Dana Whitfield', org: 'Mesa Verde Capital (debt fund)', role: 'lender', rel: 15,
    ltc: 0.72, rate: 0.1, spread: 0.055, fee: 0.015, maxLoan: 40000000, proOnly: true,
    blurb: 'Private debt fund. Lends 72% of cost to almost anyone, at a rate and fee that remind you why banks exist.' },
  { id: 'lifeco', name: 'Martin Oyelaran', org: 'Republic Plains Life', role: 'lender', rel: 10,
    ltc: 0.55, rate: 0.07, spread: 0.025, fee: 0.01, maxLoan: 90000000,
    blurb: 'Life insurance company. The cheapest money and the biggest loans, for developers with three completed deals.' },
  { id: 'vega', name: 'Marisol Vega', org: 'Municipal planning staff', role: 'city', rel: 30,
    blurb: 'Career planner. She cannot vote, but a staff recommendation carries real weight at a hearing.' },
  { id: 'redriver', name: 'Red River Dirtworks', org: 'Low-bid contractor', role: 'gc', rel: 30,
    costFactor: 0.94, delayRisk: 0.2, monthsDelta: 0,
    blurb: 'Cheapest number on bid day. Thin crews, and change orders have a way of showing up.' },
  { id: 'cowtown', name: 'Cowtown Constructors', org: 'Established regional contractor', role: 'gc', rel: 35,
    costFactor: 1.0, delayRisk: 0.09, monthsDelta: 0,
    blurb: 'Fair price, steady crews, few surprises.' },
  { id: 'meridian', name: 'Meridian Tilt-Wall', org: 'Premium contractor', role: 'gc', rel: 25,
    costFactor: 1.06, delayRisk: 0.04, monthsDelta: -1,
    blurb: 'Costs about 6% more and finishes a month sooner. Lenders like seeing their name on the contract.' },
];

export const TENANTS: { name: string; business: string; type: 'ios' | 'spec' | 'retail' | 'office' }[] = [
  { name: 'Brazos Crane & Rigging', business: 'crane rental', type: 'ios' },
  { name: 'Lonestar Container Depot', business: 'container storage', type: 'ios' },
  { name: 'Panhandle Pipe Supply', business: 'pipe and steel yard', type: 'ios' },
  { name: 'Red Dirt Trucking', business: 'regional trucking terminal', type: 'ios' },
  { name: 'Mustang Equipment Rental', business: 'heavy equipment rental', type: 'ios' },
  { name: 'Guadalupe Trailer Leasing', business: 'trailer leasing', type: 'ios' },
  { name: 'Comanche Peak Logistics', business: 'third-party logistics', type: 'spec' },
  { name: 'Bluebonnet Building Products', business: 'building materials distribution', type: 'spec' },
  { name: 'Trinity Cold Chain', business: 'food distribution', type: 'spec' },
  { name: 'Pecos Home Goods', business: 'e-commerce fulfillment', type: 'spec' },
  { name: 'Caprock Auto Parts', business: 'parts distribution', type: 'spec' },
  { name: 'Llano Beverage Co.', business: 'beverage distribution', type: 'spec' },
  { name: 'Llano Fresh Market', business: 'grocery', type: 'retail' },
  { name: 'Bluestem Fitness', business: 'fitness', type: 'retail' },
  { name: 'Mesa Taqueria Group', business: 'restaurant', type: 'retail' },
  { name: 'Prairie Pet Supply', business: 'pet supply', type: 'retail' },
  { name: 'Lone Oak Urgent Care', business: 'medical clinic', type: 'retail' },
  { name: 'Cross Timbers Hardware', business: 'hardware', type: 'retail' },
  { name: 'Pecos Title & Escrow', business: 'title insurance', type: 'office' },
  { name: 'Brazos Engineering', business: 'civil engineering', type: 'office' },
  { name: 'Caddo Wealth Advisors', business: 'financial advisory', type: 'office' },
  { name: 'Trinity Health Billing', business: 'medical billing', type: 'office' },
  { name: 'Red River Software', business: 'software', type: 'office' },
];

export const BUYERS = {
  institution: ['Meridian Industrial REIT', 'Cedar Elm Capital'],
  private: ['Hartwell 1031 Trust', 'The Dupree Family'],
  syndicator: ['Sunbelt Yield Partners', 'Apex Net Lease Group'],
};

export const RIVALS = ['Stonegate Industrial', 'Prairie Line Partners', 'Bison Ridge Development'];

export const ADVISORS = {
  analyst: { name: 'Maya Okafor', title: 'Analyst', color: '#2f7f86' },
  broker: { name: 'Dusty Rhodes', title: 'Land broker', color: '#c8632c' },
  attorney: { name: 'Elena Garza', title: 'Land-use attorney', color: '#6c5a9c' },
  cm: { name: 'Hank Bledsoe', title: 'Construction manager', color: '#8a6d2f' },
} as const;
