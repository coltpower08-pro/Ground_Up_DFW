// Tuning numbers for the simulation. These are game-balance values chosen to feel
// plausible for DFW industrial; they are not market data.
export const SF_PER_ACRE = 43560;

export const IOS = {
  surface: {
    gravel: { label: 'Gravel', cost: 2.25, rent: 0.88, months: 3 },
    stabilized: { label: 'Stabilized base', cost: 3.5, rent: 1.0, months: 4 },
    paved: { label: 'Concrete paving', cost: 7.5, rent: 1.2, months: 5 },
  },
  security: {
    basic: { label: 'Fence and gate', base: 35000, perAcre: 6000, rent: 1.0, demand: 1.0 },
    premium: { label: 'Lighting, cameras, automatic gate', base: 90000, perAcre: 14000, rent: 1.05, demand: 1.2 },
  },
  softPct: 0.1, devFeePct: 0.04, contPct: 0.07, lcPct: 0.045, leaseUpMonths: 3, wellSeptic: 45000,
  soilsPsf: 0.35, arrival: 0.6,
} as const;

export const SPEC = {
  shell: { 28: 66, 32: 72, 36: 79 } as Record<number, number>,
  clearRent: { 28: 0.95, 32: 1.0, 36: 1.05 } as Record<number, number>,
  coverageRent: { 0.3: 1.02, 0.35: 1.0, 0.4: 0.97 } as Record<number, number>,
  extrasCost: 3, extrasRent: 1.03, extrasDemand: 1.2,
  softPct: 0.12, impactPsf: 1.25, devFeePct: 0.035, contPct: 0.05, tiPsf: 4, lcPct: 0.045,
  months: 10, leaseUpMonths: 6, sewerExt: 450000, waterExt: 250000, soilsPsf: 2.5, arrival: 0.34,
  minAcres: 6,
} as const;

export const COMMON = {
  closingPct: 0.015, saleCostPct: 0.0225, loanFeePct: 0.01, maxLtv: 0.7,
  cleanup: { none: 0, minor: 40000, major: 320000 },
  accessRent: [0.9, 0.9, 0.95, 1.0, 1.03, 1.06],
  railRent: 1.03, vacantCarryPctMonthly: 0.0014, holdMonths: 6, surprisePenalty: 1.6,
} as const;

export const REPORTS = {
  env: { label: 'Phase I environmental', cost: 4500, days: 25, blurb: 'Looks for contamination from past uses.' },
  survey: { label: 'ALTA survey and title', cost: 11000, days: 20, blurb: 'Finds easements and confirms usable acreage.' },
  geo: { label: 'Geotechnical (soils) report', cost: 14000, days: 25, blurb: 'Tests whether the soil can carry pavement and slabs.' },
} as const;

export const ENT = {
  none: { label: 'Allowed by right', odds: 1, days: 0, fee: 0 },
  plat: { label: 'Plat approval', odds: 0.88, days: 60, fee: 5000 },
  sup: { label: 'Specific Use Permit', odds: 0.6, days: 90, fee: 12000 },
  rezone: { label: 'Rezoning', odds: 0.5, days: 120, fee: 18000 },
} as const;
export const ATTORNEY_FEE = 22000;
export const OUTREACH_COST = 6000;

export const STAFF = {
  analyst: { label: 'Analyst', salary: 6500, blurb: 'Runs the numbers and chases reports. One more deal in pursuit, reports come back 30% faster, and investor pitches land a little more often.' },
  pm: { label: 'Project manager', salary: 8000, blurb: 'Lives on the job site. One more deal in pursuit, far fewer delays and change orders.' },
  leasing: { label: 'Leasing agent', salary: 6000, blurb: 'Works the tenant market full time. Proposals arrive faster and counters succeed more often.' },
} as const;

// Pro mode market cycle, per month. rent and cost are growth rates; cap and rate are drifts.
export const CYCLE = {
  expansion: { label: 'Expansion', rent: 0.0035, cap: -0.00005, rate: 0.00015, cost: 0.003, demand: 1.1, appetite: 0.05, months: [16, 28] },
  peak: { label: 'Peak', rent: 0.001, cap: 0.00005, rate: 0.00025, cost: 0.0035, demand: 1.0, appetite: 0, months: [6, 10] },
  contraction: { label: 'Contraction', rent: -0.0045, cap: 0.00025, rate: -0.0003, cost: 0, demand: 0.6, appetite: -0.15, months: [9, 15] },
  recovery: { label: 'Recovery', rent: 0.0015, cap: -0.0001, rate: -0.0001, cost: 0.001, demand: 0.85, appetite: -0.05, months: [9, 15] },
} as const;
export const CYCLE_NEXT = { expansion: 'peak', peak: 'contraction', contraction: 'recovery', recovery: 'expansion' } as const;

export const PERM = { rookieRate: 0.065, proSpread: 0.02, amortYears: 25, minDscr: 1.25, maxLtv: 0.65, minDebtYield: 0.09, fee: 0.01 } as const;
export const TERMS = {
  investor: { label: 'Investor-friendly', sub: 'Lower promote. Easier yes.', promote: -0.05, promote2: -0.05, catchUp: false, pitch: 0.12 },
  standard: { label: 'Standard', sub: 'Their usual terms.', promote: 0, promote2: 0, catchUp: false, pitch: 0 },
  sponsor: { label: 'Sponsor-friendly', sub: 'Catch-up and a richer top tier. Harder yes.', promote: 0, promote2: 0.05, catchUp: true, pitch: -0.18 },
} as const;

/** Asset classes beyond industrial. noiPsf is stabilized net income per building SF per year. */
export const PRODUCTS = {
  retail: { label: 'Shopping center', far: 0.22, cost: 185, noiPsf: 24.2, cap: 0.069, softPct: 0.14, tiPsf: 22, lcPct: 0.06, months: 9, leaseUp: 7, minAcres: 2, maxAcres: 14, arrival: 0.42, premiumCost: 14, premiumRent: 1.06, ti: [15, 30], terms: [60, 120], free: [2, 3, 4] },
  office: { label: 'Office building', far: 0.4, cost: 195, noiPsf: 28.8, cap: 0.074, softPct: 0.15, tiPsf: 34, lcPct: 0.06, months: 13, leaseUp: 12, minAcres: 2, maxAcres: 10, arrival: 0.24, premiumCost: 18, premiumRent: 1.07, ti: [28, 48], terms: [60, 84], free: [4, 6, 8] },
  mf: { label: 'Apartments', far: 0.5, cost: 158, noiPsf: 13.6, cap: 0.051, softPct: 0.14, tiPsf: 1.5, lcPct: 0, months: 15, leaseUp: 10, minAcres: 5, maxAcres: 25, arrival: 0, premiumCost: 12, premiumRent: 1.06, ti: [0, 0], terms: [12], free: [0] },
} as const;
export type ProductKey = keyof typeof PRODUCTS;
export const MF_UNIT_SF = 900, MF_FULL = 0.94;
export const TYPE_LABEL: Record<string, string> = { ios: 'IOS Yard', spec: 'Spec Building', retail: 'Shopping Center', mf: 'Apartments', office: 'Office Building' };
export const TYPE_SHORT: Record<string, string> = { ios: 'IOS yard', spec: 'Industrial building', retail: 'Shopping center', mf: 'Apartments', office: 'Office building' };
export const ACRE_RANGE: Record<string, [number, number]> = { ios: [0, 999], spec: [6, 999], retail: [2, 14], mf: [5, 25], office: [2, 10] };

/** Renovation plans for a purchased property. rent is the share of full market rent the space commands afterward. */
export const RENO = {
  asis: { label: 'As is', sub: 'No work', psf: 0, iosPsf: 0, months: 0, tired: 0.86, good: 1.0 },
  refresh: { label: 'Refresh', sub: 'Paint, lights, paving', psf: 7, iosPsf: 0.5, months: 2, tired: 0.97, good: 1.03 },
  reposition: { label: 'Reposition', sub: 'Full renovation', psf: 18, iosPsf: 1.4, months: 4, tired: 1.05, good: 1.07 },
} as const;
