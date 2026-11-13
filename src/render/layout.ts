// The DFW metro on a 96 x 76 tile grid (about three-quarters of a mile per tile).
// Real places are positioned from their latitude and longitude; shapes are simplified.
export const W = 96, H = 76;
const LON0 = -97.65, LON1 = -96.4, LAT0 = 33.27, LAT1 = 32.45;
export type XY = [number, number];
/** Latitude / longitude to fractional tile coordinates. */
export const ll = (lat: number, lon: number): XY => [((lon - LON0) / (LON1 - LON0)) * W, ((LAT0 - lat) / (LAT0 - LAT1)) * H];
const line = (...p: number[]): XY[] => { const out: XY[] = []; for (let i = 0; i < p.length; i += 2) out.push(ll(p[i], p[i + 1])); return out; };

export interface Road { name: string; kind: 'interstate' | 'highway' | 'arterial'; pts: XY[]; shieldAt: XY[] }
const road = (name: string, kind: Road['kind'], pts: XY[], shields: number[] = []): Road => ({ name, kind, pts, shieldAt: shields.map((i) => mid(pts, i)) });
function mid(pts: XY[], i: number): XY { const a = pts[i], b = pts[Math.min(pts.length - 1, i + 1)]; return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]; }

export const ROADS: Road[] = [
  road('I-35W', 'interstate', line(33.19, -97.17, 33.1, -97.24, 33.03, -97.28, 32.9, -97.31, 32.755, -97.32, 32.6, -97.32, 32.45, -97.3), [1, 3, 5]),
  road('I-35E', 'interstate', line(33.19, -97.14, 33.04, -97.01, 32.95, -96.91, 32.87, -96.9, 32.81, -96.87, 32.78, -96.815, 32.65, -96.83, 32.45, -96.84), [0, 4]),
  road('I-35', 'interstate', line(33.27, -97.17, 33.19, -97.155)),
  road('I-20', 'interstate', line(32.72, -97.65, 32.71, -97.57, 32.68, -97.42, 32.67, -97.32, 32.67, -97.11, 32.67, -97.0, 32.65, -96.9, 32.64, -96.82, 32.64, -96.7, 32.7, -96.62, 32.72, -96.52, 32.72, -96.4), [1, 4, 8, 10]),
  road('I-30', 'interstate', line(32.71, -97.57, 32.735, -97.45, 32.745, -97.33, 32.755, -97.1, 32.765, -97.0, 32.775, -96.81, 32.81, -96.63, 32.9, -96.47, 32.92, -96.4), [0, 3, 6]),
  road('I-45', 'interstate', line(32.77, -96.79, 32.64, -96.71, 32.59, -96.68, 32.45, -96.65), [2]),
  road('I-635', 'interstate', line(32.94, -97.01, 32.92, -96.97, 32.92, -96.9, 32.925, -96.77, 32.88, -96.68, 32.8, -96.63, 32.7, -96.62), [1]),
  road('Loop 820', 'interstate', line(32.84, -97.42, 32.84, -97.3, 32.83, -97.21, 32.76, -97.21, 32.68, -97.23, 32.67, -97.32, 32.7, -97.43, 32.78, -97.45, 32.84, -97.42), [0]),
  road('SH 114', 'highway', line(33.07, -97.6, 33.05, -97.48, 33.03, -97.28, 32.99, -97.2, 32.95, -97.13, 32.945, -97.075, 32.94, -97.01, 32.88, -96.96, 32.81, -96.87), [0, 3]),
  road('SH 121', 'highway', line(32.945, -97.075, 33.02, -96.98, 33.1, -96.8, 33.17, -96.65), [1]),
  road('SH 183', 'highway', line(32.78, -97.3, 32.83, -97.18, 32.84, -97.08, 32.84, -96.95, 32.81, -96.87), [1]),
  road('US 75', 'highway', line(32.79, -96.79, 32.95, -96.73, 33.02, -96.71, 33.2, -96.63, 33.27, -96.61), [2]),
  road('DNT', 'highway', line(32.8, -96.82, 32.95, -96.82, 33.15, -96.83, 33.27, -96.83), [1]),
  road('SH 360', 'highway', line(32.945, -97.075, 32.86, -97.08, 32.74, -97.065, 32.58, -97.08), [1]),
  road('SH 170', 'highway', line(32.97, -97.31, 32.965, -97.2, 32.99, -97.2), [0]),
  road('US 287', 'highway', line(33.27, -97.63, 33.05, -97.47, 32.97, -97.42, 32.86, -97.37, 32.8, -97.33), [0]),
  road('US 287', 'highway', line(32.72, -97.28, 32.57, -97.13, 32.48, -96.99, 32.45, -96.95), [0]),
  road('US 380', 'highway', line(33.225, -97.65, 33.225, -97.13, 33.22, -96.63, 33.22, -96.4), [0, 1]),
  road('US 80', 'highway', line(32.79, -96.68, 32.77, -96.6, 32.75, -96.47, 32.74, -96.4), [1]),
  road('US 67', 'highway', line(32.74, -96.84, 32.66, -96.9, 32.59, -96.95, 32.48, -96.99), [1]),
  road('PGBT', 'highway', line(32.87, -96.99, 32.99, -96.92, 33.0, -96.75, 32.95, -96.62, 32.86, -96.58), [1]),
  road('Chisholm Trail', 'arterial', line(32.73, -97.35, 32.6, -97.42, 32.45, -97.43)),
  road('FM 156', 'arterial', line(33.2, -97.29, 33.085, -97.3, 32.975, -97.35, 32.86, -97.345)),
  road('Westport', 'arterial', line(32.975, -97.3, 32.975, -97.21)),
  road('SH 199', 'arterial', line(32.78, -97.36, 32.86, -97.5, 32.95, -97.65)),
  road('FM 1187', 'arterial', line(32.6, -97.5, 32.58, -97.32, 32.58, -97.13)),
  road('Belt Line', 'arterial', line(32.59, -97.0, 32.59, -96.82, 32.6, -96.68, 32.72, -96.56)),
  road('US 377', 'arterial', line(33.2, -97.13, 33.08, -97.2, 32.94, -97.25, 32.86, -97.26)),
  road('SH 78', 'arterial', line(32.86, -96.7, 32.95, -96.62, 33.05, -96.53)),
];

export const RAILS: XY[][] = [
  line(33.27, -97.285, 33.085, -97.295, 32.975, -97.345, 32.86, -97.355, 32.75, -97.335, 32.6, -97.345, 32.45, -97.36), // BNSF
  line(32.75, -97.335, 32.737, -97.11, 32.745, -96.95, 32.765, -96.8, 32.76, -96.6, 32.74, -96.4), // UP east-west
  line(32.765, -96.8, 32.64, -96.725, 32.57, -96.67, 32.45, -96.63), // UP to the inland port
  line(32.57, -97.33, 32.5, -97.1, 32.47, -96.99), // to Midlothian
];

export const RIVERS: XY[][] = [
  line(32.85, -97.5, 32.79, -97.4, 32.76, -97.33, 32.78, -97.2, 32.775, -97.05, 32.79, -96.93, 32.775, -96.83, 32.72, -96.74, 32.62, -96.63, 32.5, -96.52, 32.45, -96.5), // Trinity
  line(33.06, -96.96, 32.96, -96.94, 32.86, -96.91, 32.79, -96.87), // Elm Fork
  line(33.14, -97.3, 33.07, -97.22, 33.02, -97.14, 32.985, -97.1), // Denton Creek
  line(32.95, -97.36, 32.93, -97.3, 32.92, -97.24), // Henrietta Creek
  line(32.92, -96.55, 32.8, -96.5, 32.66, -96.5, 32.56, -96.55), // East Fork
  line(32.6, -97.02, 32.68, -96.96, 32.76, -96.93), // Mountain Creek
];

export const LAKES: { name: string; x: number; y: number; rx: number; ry: number }[] = ([
  ['Lewisville Lake', 33.11, -96.99, 3.2, 3.6], ['Grapevine Lake', 32.985, -97.085, 2.6, 1.2], ['Eagle Mountain Lake', 32.9, -97.49, 1.3, 3.2],
  ['Lake Worth', 32.805, -97.44, 1.6, 0.9], ['Benbrook Lake', 32.63, -97.46, 1.2, 1.5], ['Lake Arlington', 32.71, -97.2, 0.8, 1.6],
  ['Joe Pool Lake', 32.62, -97.01, 1.4, 2.4], ['Mountain Creek Lake', 32.72, -96.945, 0.9, 1.4], ['White Rock Lake', 32.83, -96.725, 0.7, 1.2],
  ['Lake Ray Hubbard', 32.85, -96.515, 1.6, 4.2], ['Lavon Lake', 33.06, -96.5, 2.4, 3.4],
] as [string, number, number, number, number][]).map(([name, la, lo, rx, ry]) => { const [x, y] = ll(la, lo); return { name, x, y, rx, ry }; });

export const AIRPORTS: { name: string; x: number; y: number; w: number; h: number }[] = ([
  ['DFW Airport', 32.9, -97.04, 3, 4], ['Alliance Airport', 33.0, -97.31, 1, 2], ['Love Field', 32.847, -96.852, 1.4, 1.2],
] as [string, number, number, number, number][]).map(([name, la, lo, w, h]) => { const [x, y] = ll(la, lo); return { name, x: Math.round(x - w / 2), y: Math.round(y - h / 2), w, h }; });

export interface City { name: string; x: number; y: number; r: number; major: boolean; core?: boolean }
export const CITIES: City[] = ([
  ['DALLAS', 32.78, -96.8, 9, 1, 1], ['FORT WORTH', 32.755, -97.33, 7.5, 1, 1], ['ARLINGTON', 32.735, -97.11, 5, 1], ['PLANO', 33.02, -96.7, 4.5, 1],
  ['FRISCO', 33.15, -96.82, 3.6, 1], ['DENTON', 33.215, -97.13, 3.2, 1], ['MCKINNEY', 33.2, -96.64, 3, 1], ['IRVING', 32.83, -96.95, 3.6, 1],
  ['GARLAND', 32.91, -96.64, 3.4, 1], ['MESQUITE', 32.77, -96.6, 3, 1], ['GRAND PRAIRIE', 32.72, -97.0, 2.6, 0], ['LEWISVILLE', 33.045, -97.0, 2.2, 0],
  ['CARROLLTON', 32.96, -96.9, 2.8, 0], ['RICHARDSON', 32.95, -96.73, 2.6, 0], ['GRAPEVINE', 32.935, -97.08, 1.6, 0], ['SOUTHLAKE', 32.945, -97.14, 1.8, 0],
  ['KELLER', 32.93, -97.23, 2, 0], ['HURST', 32.83, -97.18, 2.4, 0], ['EULESS', 32.84, -97.085, 1.6, 0], ['N. RICHLAND HILLS', 32.86, -97.22, 2, 0],
  ['HASLET', 32.975, -97.36, 1, 0], ['JUSTIN', 33.085, -97.3, 1, 0], ['ROANOKE', 33.005, -97.225, 1.1, 0], ['NORTHLAKE', 33.07, -97.25, 0.9, 0],
  ['SAGINAW', 32.86, -97.37, 1.6, 0], ['BENBROOK', 32.675, -97.46, 1.6, 0], ['ALEDO', 32.7, -97.6, 1, 0], ['WHITE SETTLEMENT', 32.76, -97.46, 1.5, 0],
  ['BURLESON', 32.54, -97.32, 2.2, 0], ['MANSFIELD', 32.565, -97.14, 2.2, 0], ['CEDAR HILL', 32.59, -96.95, 1.8, 0], ['DESOTO', 32.59, -96.86, 2, 0],
  ['LANCASTER', 32.59, -96.76, 1.6, 0], ['HUTCHINS', 32.645, -96.715, 0.8, 0], ['WILMER', 32.59, -96.685, 0.7, 0], ['MIDLOTHIAN', 32.48, -96.99, 1.4, 0],
  ['FORNEY', 32.75, -96.47, 1.4, 0], ['ROCKWALL', 32.93, -96.46, 1.8, 0], ['ALLEN', 33.1, -96.67, 2.2, 0], ['THE COLONY', 33.09, -96.89, 1.4, 0],
  ['COPPELL', 32.955, -97.01, 1.3, 0], ['FLOWER MOUND', 33.03, -97.08, 2, 0], ['RHOME', 33.055, -97.475, 0.7, 0], ['KRUM', 33.26, -97.24, 0.7, 0],
  ['BALCH SPRINGS', 32.72, -96.62, 1.2, 0], ['EVERMAN', 32.63, -97.285, 1, 0],
] as [string, number, number, number, number, number?][]).map(([name, la, lo, r, major, core]) => { const [x, y] = ll(la, lo); return { name, x, y, r, major: !!major, core: !!core }; });

/** Industrial clusters: where existing warehouses stand. */
export const ZONES: { x: number; y: number; r: number; d: number }[] = ([
  [32.975, -97.3, 3.2, 0.3], [32.76, -97.04, 3, 0.5], [32.95, -96.99, 2.4, 0.45], [32.62, -96.72, 3.2, 0.35], [32.81, -97.22, 1.8, 0.4],
  [32.83, -96.88, 2.6, 0.45], [32.9, -96.67, 1.8, 0.4], [32.77, -96.62, 1.6, 0.35], [32.64, -97.31, 2.2, 0.35], [33.2, -97.18, 1.6, 0.3],
  [32.73, -97.4, 1.6, 0.3], [32.86, -97.34, 1.8, 0.4], [33.0, -96.72, 1.4, 0.3], [32.9, -96.95, 1.6, 0.4], [32.68, -96.97, 1.8, 0.35], [32.48, -96.98, 1.4, 0.3],
] as [number, number, number, number][]).map(([la, lo, r, d]) => { const [x, y] = ll(la, lo); return { x, y, r, d }; });

export const INTERMODALS: XY[] = [ll(32.995, -97.352), ll(32.572, -96.672)];

// ---------- derived grids ----------
/** 0 free, 1 road, 2 water, 3 airport, 4 rail */
const block = new Uint8Array(W * H);
const idx = (x: number, y: number) => y * W + x;
const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H;
function raster(pts: XY[], v: number) {
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, y0] = pts[i], [x1, y1] = pts[i + 1], n = Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 3);
    for (let k = 0; k <= n; k++) { const x = Math.floor(x0 + ((x1 - x0) * k) / n), y = Math.floor(y0 + ((y1 - y0) * k) / n); if (inside(x, y) && block[idx(x, y)] !== 2) block[idx(x, y)] = v; }
  }
}
export const FLOOD = new Set<number>();
for (const l of LAKES) for (let y = Math.floor(l.y - l.ry - 1); y <= l.y + l.ry + 1; y++) for (let x = Math.floor(l.x - l.rx - 1); x <= l.x + l.rx + 1; x++) {
  if (!inside(x, y)) continue;
  const e = ((x + 0.5 - l.x) / l.rx) ** 2 + ((y + 0.5 - l.y) / l.ry) ** 2;
  if (e <= 1.05) block[idx(x, y)] = 2; else if (e <= 1.9) FLOOD.add(idx(x, y));
}
for (const r of RIVERS) raster(r, 2);
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (block[idx(x, y)] === 2) for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) if (inside(x + dx, y + dy)) FLOOD.add(idx(x + dx, y + dy));
for (const r of RAILS) raster(r, 4);
for (const r of ROADS) raster(r.pts, 1);
for (const a of AIRPORTS) for (let y = a.y; y < a.y + a.h; y++) for (let x = a.x; x < a.x + a.w; x++) if (inside(x, y)) block[idx(x, y)] = 3;

export const blockAt = (x: number, y: number) => (inside(x, y) ? block[idx(x, y)] : 1);
export function urbanity(x: number, y: number): number {
  let u = 0;
  for (const c of CITIES) { const d = Math.hypot(x + 0.5 - c.x, y + 0.5 - c.y) / c.r; if (d < 1.15) u = Math.max(u, 1 - d * 0.75); }
  return u;
}
export function industry(x: number, y: number): number {
  let v = 0;
  for (const z of ZONES) { const d = Math.hypot(x + 0.5 - z.x, y + 0.5 - z.y) / z.r; if (d < 1) v = Math.max(v, z.d * (1 - d * 0.5)); }
  return v;
}
/** Ground type per tile: 0 grass, 1 suburban, 2 urban, 3 downtown, 4 industrial pad */
export const GROUND = new Uint8Array(W * H);
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const u = urbanity(x, y), core = CITIES.some((c) => c.core && Math.hypot(x + 0.5 - c.x, y + 0.5 - c.y) < 1.3);
  GROUND[idx(x, y)] = core ? 3 : industry(x, y) > 0.22 ? 4 : u > 0.55 ? 2 : u > 0.25 ? 1 : 0;
}

export interface Rect { x: number; y: number; w: number; h: number }
const taken = new Set<number>(), clear = new Set<number>();
/** Find the free rectangle of tiles nearest a real-world location. Deterministic, so saves stay valid. */
export function placeRect(lat: number, lon: number, w: number, h: number): Rect {
  const [fx, fy] = ll(lat, lon), cx = Math.floor(fx), cy = Math.floor(fy);
  const free = (x: number, y: number) => { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) { if (!inside(x + i, y + j) || block[idx(x + i, y + j)] !== 0 || taken.has(idx(x + i, y + j))) return false; } return true; };
  for (let r = 0; r < 7; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
    const x = cx + dx, y = cy + dy;
    if (free(x, y)) {
      for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) taken.add(idx(x + i, y + j));
      // keep scenery off the site and off the row in front of it, so nothing hides it
      for (let j = 0; j <= h; j++) for (let i = -1; i < w; i++) if (inside(x + i, y + j)) clear.add(idx(x + i, y + j));
      return { x, y, w, h };
    }
  }
  return { x: cx, y: cy, w, h };
}
export const isTaken = (x: number, y: number) => clear.has(idx(x, y));

/** Small deterministic hash for scattering scenery and tinting tiles. */
export function hash(x: number, y: number, s = 0): number {
  let h = (x * 374761393 + y * 668265263 + s * 2147483647) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
