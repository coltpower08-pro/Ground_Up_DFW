// The surface road network: arterials, collectors and local access roads, plus frontage roads along the interstates.
// It is data, not paint: sites read their frontage, corner and distance to a highway ramp from it,
// and both maps draw it. Built once, deterministically, so every game and every save agrees.
//
// Surface roads run along tile boundaries (a tile is about three-quarters of a mile), which is how
// the real North Texas section-line grid works, and it guarantees no road ever cuts through a site.
import { AIRPORTS, H, LAKES, RIVERS, ROADS, W, hash, industry, urbanity, type Rect, type XY } from '../render/layout';

export type RoadClass = 'interstate' | 'highway' | 'arterial' | 'collector' | 'local';
export const MILES_PER_TILE = 0.75;
/** A straight run of surface road along a grid line. */
export interface Seg { a: XY; b: XY; cls: 'arterial' | 'collector' | 'local' }
export interface SiteRoad {
  /** Best road the site fronts. */
  front: RoadClass;
  frontName: string;
  /** Roads on two adjoining sides. "hard" means both are arterials: a signalized intersection. */
  corner: boolean; hard: boolean;
  /** Driving miles to the nearest freeway or highway interchange, and which one. */
  rampMi: number; rampName: string;
  /** Miles of surface road to the nearest interstate specifically. */
  interstateMi: number;
  /** Where the driveway meets the road, in tile coordinates, and which side of the site it is on. */
  drive: XY; side: 'S' | 'E' | 'W' | 'N';
}
export interface RoadNet {
  segs: Seg[];
  /** Intersections of three or more legs: [x, y, widest class]. */
  nodes: [number, number, Seg['cls']][];
  /** Frontage road centerlines beside the interstates. */
  frontage: XY[][];
  site: Record<string, SiteRoad>;
  /** Raw edge classes, for tests and traffic: 0 none, 1 local, 2 collector, 3 arterial. */
  hEdge: Uint8Array; vEdge: Uint8Array;
}

const CLS: Seg['cls'][] = ['local', 'local', 'collector', 'arterial'];
const cross = (ax: number, ay: number, bx: number, by: number) => ax * by - ay * bx;
function segHit(p: XY, q: XY, a: XY, b: XY): boolean {
  const d1 = cross(q[0] - p[0], q[1] - p[1], a[0] - p[0], a[1] - p[1]), d2 = cross(q[0] - p[0], q[1] - p[1], b[0] - p[0], b[1] - p[1]);
  const d3 = cross(b[0] - a[0], b[1] - a[1], p[0] - a[0], p[1] - a[1]), d4 = cross(b[0] - a[0], b[1] - a[1], q[0] - a[0], q[1] - a[1]);
  return d1 * d2 < 0 && d3 * d4 < 0;
}
const hitsLine = (p: XY, q: XY, line: XY[]) => { for (let i = 0; i < line.length - 1; i++) if (segHit(p, q, line[i], line[i + 1])) return true; return false; };
function distToLine(p: XY, line: XY[]): number {
  let best = 1e9;
  for (let i = 0; i < line.length - 1; i++) {
    const [ax, ay] = line[i], [bx, by] = line[i + 1], dx = bx - ax, dy = by - ay, t = Math.max(0, Math.min(1, ((p[0] - ax) * dx + (p[1] - ay) * dy) / (dx * dx + dy * dy || 1)));
    best = Math.min(best, Math.hypot(p[0] - ax - dx * t, p[1] - ay - dy * t));
  }
  return best;
}
const inLake = (x: number, y: number, grow = 1.06) => LAKES.some((l) => ((x - l.x) / (l.rx * grow)) ** 2 + ((y - l.y) / (l.ry * grow)) ** 2 <= 1);
const inAirport = (x: number, y: number) => AIRPORTS.some((a) => x > a.x + 0.01 && x < a.x + Math.ceil(a.w) - 0.01 && y > a.y + 0.01 && y < a.y + Math.ceil(a.h) - 0.01);
const FREEWAYS = ROADS.filter((r) => r.kind !== 'arterial');

export function buildRoadNet(sites: { id: string; tile: Rect }[]): RoadNet {
  // edges: horizontal (x,y)-(x+1,y) for y in 0..H; vertical (x,y)-(x,y+1) for x in 0..W
  const hEdge = new Uint8Array(W * (H + 1)), vEdge = new Uint8Array((W + 1) * H);
  const hi = (x: number, y: number) => y * W + x, vi = (x: number, y: number) => y * (W + 1) + x;
  // edges that may never carry a road: under water, across an airfield, or through the middle of a site
  const hBan = new Uint8Array(hEdge.length), vBan = new Uint8Array(vEdge.length);
  for (const s of sites) {
    const t = s.tile;
    for (let y = t.y + 1; y < t.y + t.h; y++) for (let x = t.x; x < t.x + t.w; x++) hBan[hi(x, y)] = 1;
    for (let x = t.x + 1; x < t.x + t.w; x++) for (let y = t.y; y < t.y + t.h; y++) vBan[vi(x, y)] = 1;
  }
  const blockedPt = (x: number, y: number) => inLake(x, y) || inAirport(x, y);
  for (let y = 0; y <= H; y++) for (let x = 0; x < W; x++) if (blockedPt(x + 0.5, y) || blockedPt(x + 0.15, y) || blockedPt(x + 0.85, y)) hBan[hi(x, y)] = 1;
  for (let y = 0; y < H; y++) for (let x = 0; x <= W; x++) if (blockedPt(x, y + 0.5) || blockedPt(x, y + 0.15) || blockedPt(x, y + 0.85)) vBan[vi(x, y)] = 1;

  // --- the grid: every line downtown, every other line in the suburbs, every fourth (the old farm roads) in the country ---
  const dense = (x: number, y: number) => (x < 0 || y < 0 || x >= W || y >= H ? 0 : Math.max(urbanity(x, y), industry(x, y) * 1.6));
  const want = (line: number, u: number, x: number, y: number, s: number) => {
    const step = u > 0.5 ? 1 : u > 0.18 ? 2 : 4;
    if (line % step !== 0) return 0;
    if (line % 4 === 0) return 3;
    return step === 4 || (u < 0.3 && hash(x, y, s) < 0.18) ? 0 : 2; // a few gaps keep the suburbs from looking like graph paper
  };
  for (let y = 1; y < H; y++) for (let x = 0; x < W; x++) {
    if (hBan[hi(x, y)]) continue;
    const a: XY = [x, y], b: XY = [x + 1, y], m: XY = [x + 0.5, y];
    const c = want(y, Math.max(dense(x, y - 1), dense(x, y)), x, y, 301);
    if (!c) continue;
    // a freeway already running along this line replaces the surface road; one that crosses it gets an overpass
    if (FREEWAYS.some((r) => distToLine(m, r.pts) < 0.3 && !hitsLine(a, b, r.pts))) continue;
    if (RIVERS.some((r) => hitsLine(a, b, r)) && c < 3 && hash(x, y, 302) > 0.3) continue; // few bridges
    hEdge[hi(x, y)] = c;
  }
  for (let y = 0; y < H; y++) for (let x = 1; x < W; x++) {
    if (vBan[vi(x, y)]) continue;
    const a: XY = [x, y], b: XY = [x, y + 1], m: XY = [x, y + 0.5];
    const c = want(x, Math.max(dense(x - 1, y), dense(x, y)), x, y, 303);
    if (!c) continue;
    if (FREEWAYS.some((r) => distToLine(m, r.pts) < 0.3 && !hitsLine(a, b, r.pts))) continue;
    if (RIVERS.some((r) => hitsLine(a, b, r)) && c < 3 && hash(x, y, 304) > 0.3) continue;
    vEdge[vi(x, y)] = c;
  }

  // lattice helpers: the four edges at a vertex, as [edge array, index, neighbour x, neighbour y]
  const legs = (x: number, y: number): [Uint8Array, Uint8Array, number, number, number][] => {
    const out: [Uint8Array, Uint8Array, number, number, number][] = [];
    if (x < W && y >= 0 && y <= H) out.push([hEdge, hBan, hi(x, y), x + 1, y]);
    if (x > 0 && y >= 0 && y <= H) out.push([hEdge, hBan, hi(x - 1, y), x - 1, y]);
    if (y < H && x >= 0 && x <= W) out.push([vEdge, vBan, vi(x, y), x, y + 1]);
    if (y > 0 && x >= 0 && x <= W) out.push([vEdge, vBan, vi(x, y - 1), x, y - 1]);
    return out;
  };
  const vid = (x: number, y: number) => y * (W + 1) + x;
  const hasRoad = (x: number, y: number) => legs(x, y).some(([e, , i]) => e[i] > 0);

  // --- interchanges: where a surface road crosses a freeway ---
  const ramp = new Map<number, { name: string; interstate: boolean }>();
  const markRamp = (a: XY, b: XY) => {
    for (const r of FREEWAYS) if (hitsLine(a, b, r.pts)) for (const p of [a, b]) { const k = vid(p[0], p[1]), cur = ramp.get(k); if (!cur || (r.kind === 'interstate' && !cur.interstate)) ramp.set(k, { name: r.name, interstate: r.kind === 'interstate' }); }
  };
  const scanRamps = () => {
    ramp.clear();
    for (let y = 0; y <= H; y++) for (let x = 0; x < W; x++) if (hEdge[hi(x, y)]) markRamp([x, y], [x + 1, y]);
    for (let y = 0; y < H; y++) for (let x = 0; x <= W; x++) if (vEdge[vi(x, y)]) markRamp([x, y], [x, y + 1]);
  };
  scanRamps();

  // every grid road must lead to a freeway: join stranded pieces to the main network with a local road
  const reach = () => {
    const d = new Float32Array((W + 1) * (H + 1)).fill(1e9), q: number[] = [];
    for (const k of ramp.keys()) { d[k] = 0; q.push(k); }
    for (let h = 0; h < q.length; h++) { const k = q[h], x = k % (W + 1), y = Math.floor(k / (W + 1)); for (const [e, , i, nx, ny] of legs(x, y)) if (e[i] && d[vid(nx, ny)] > d[k] + 1) { d[vid(nx, ny)] = d[k] + 1; q.push(vid(nx, ny)); } }
    return d;
  };
  /** Lay a local road from (sx, sy) across open ground to the nearest vertex that satisfies `goal`. */
  const connect = (starts: XY[], goal: (x: number, y: number) => boolean): boolean => {
    const prev = new Map<number, number>(), q: number[] = [];
    for (const [x, y] of starts) { prev.set(vid(x, y), -1); q.push(vid(x, y)); }
    for (let h = 0; h < q.length; h++) {
      const k = q[h], x = k % (W + 1), y = Math.floor(k / (W + 1));
      if (goal(x, y)) {
        for (let c = k; prev.get(c)! >= 0; c = prev.get(c)!) { const p = prev.get(c)!, px = p % (W + 1), py = Math.floor(p / (W + 1)), cx = c % (W + 1), cy = Math.floor(c / (W + 1)); if (py === cy) { const i = hi(Math.min(px, cx), cy); if (!hEdge[i]) hEdge[i] = 1; } else { const i = vi(cx, Math.min(py, cy)); if (!vEdge[i]) vEdge[i] = 1; } }
        return true;
      }
      for (const [, ban, i, nx, ny] of legs(x, y)) if (!ban[i] && !prev.has(vid(nx, ny))) { prev.set(vid(nx, ny), k); q.push(vid(nx, ny)); }
    }
    return false;
  };
  for (let pass = 0; pass < 40; pass++) {
    const d = reach();
    let stray: XY | null = null;
    for (let y = 0; y <= H && !stray; y++) for (let x = 0; x <= W; x++) if (d[vid(x, y)] > 1e8 && hasRoad(x, y)) { stray = [x, y]; break; }
    if (!stray) break;
    connect([stray], (x, y) => d[vid(x, y)] < 1e8);
    scanRamps();
  }

  // --- site access: every site gets a road on at least one side, tied into the network ---
  const sideEdges = (t: Rect, side: SiteRoad['side']): [Uint8Array, number][] => {
    const out: [Uint8Array, number][] = [];
    if (side === 'S' || side === 'N') { const y = side === 'S' ? t.y + t.h : t.y; for (let x = t.x; x < t.x + t.w; x++) out.push([hEdge, hi(x, y)]); }
    else { const x = side === 'E' ? t.x + t.w : t.x; for (let y = t.y; y < t.y + t.h; y++) out.push([vEdge, vi(x, y)]); }
    return out;
  };
  const sideBan = (t: Rect, side: SiteRoad['side']) => (side === 'S' || side === 'N' ? [...Array(t.w)].some((_, i) => hBan[hi(t.x + i, side === 'S' ? t.y + t.h : t.y)]) : [...Array(t.h)].some((_, i) => vBan[vi(side === 'E' ? t.x + t.w : t.x, t.y + i)]));
  const sideCls = (t: Rect, side: SiteRoad['side']) => { const e = sideEdges(t, side); return e.every(([a, i]) => a[i] > 0) ? Math.min(...e.map(([a, i]) => a[i])) : 0; };
  const SIDES: SiteRoad['side'][] = ['S', 'E', 'W', 'N'];
  for (const s of sites) {
    const t = s.tile;
    if (SIDES.some((sd) => sideCls(t, sd) > 0)) continue;
    const side = SIDES.find((sd) => !sideBan(t, sd)) ?? 'S';
    for (const [a, i] of sideEdges(t, side)) if (!a[i]) a[i] = 1;
  }
  // tie in any access road that does not yet reach a freeway
  for (let pass = 0; pass < 200; pass++) {
    const d = reach();
    let stray: XY | null = null;
    for (let y = 0; y <= H && !stray; y++) for (let x = 0; x <= W; x++) if (d[vid(x, y)] > 1e8 && hasRoad(x, y)) { stray = [x, y]; break; }
    if (!stray) break;
    if (!connect([stray], (x, y) => d[vid(x, y)] < 1e8)) break;
    scanRamps();
  }

  // --- drive distances to the nearest interchange, and to the nearest interstate ---
  const dijkstra = (only: (r: { interstate: boolean }) => boolean) => {
    const d = new Float32Array((W + 1) * (H + 1)).fill(1e9), who = new Map<number, string>(), q: number[] = [];
    for (const [k, r] of ramp) if (only(r)) { d[k] = 0; who.set(k, r.name); q.push(k); }
    // edge cost: slower on small roads, so "miles" behaves like drive time
    for (let h = 0; h < q.length; h++) { const k = q[h], x = k % (W + 1), y = Math.floor(k / (W + 1)); for (const [e, , i, nx, ny] of legs(x, y)) { if (!e[i]) continue; const c = e[i] === 3 ? 1 : e[i] === 2 ? 1.15 : 1.35, n = vid(nx, ny); if (d[n] > d[k] + c + 1e-6) { d[n] = d[k] + c; who.set(n, who.get(k)!); q.push(n); } } }
    return { d, who };
  };
  const any = dijkstra(() => true), inter = dijkstra((r) => r.interstate);

  const site: Record<string, SiteRoad> = {};
  for (const s of sites) {
    const t = s.tile, cls = SIDES.map((sd) => sideCls(t, sd));
    let best = 0; for (let i = 1; i < 4; i++) if (cls[i] > cls[best]) best = i;
    const side = SIDES[best];
    const adj = (a: number, b: number) => cls[a] >= 2 && cls[b] >= 2; // a corner needs two real streets, not a driveway lane
    const pairs: [number, number][] = [[0, 1], [0, 2], [3, 1], [3, 2]]; // S-E, S-W, N-E, N-W
    const corner = pairs.some(([a, b]) => adj(a, b)), hard = pairs.some(([a, b]) => cls[a] === 3 && cls[b] === 3);
    const drive: XY = side === 'S' ? [t.x + t.w / 2, t.y + t.h] : side === 'N' ? [t.x + t.w / 2, t.y] : side === 'E' ? [t.x + t.w, t.y + t.h / 2] : [t.x, t.y + t.h / 2];
    const corners: XY[] = [[t.x, t.y], [t.x + t.w, t.y], [t.x, t.y + t.h], [t.x + t.w, t.y + t.h]];
    let rampD = 1e9, rampName = '', intD = 1e9;
    for (const [x, y] of corners) { if (!hasRoad(x, y)) continue; const k = vid(x, y); if (any.d[k] < rampD) { rampD = any.d[k]; rampName = any.who.get(k) ?? ''; } intD = Math.min(intD, inter.d[k]); }
    // a site beside a freeway fronts its frontage road
    const center: XY = [t.x + t.w / 2, t.y + t.h / 2];
    let front: RoadClass = CLS[cls[best]], frontName = front === 'arterial' ? 'a major arterial' : front === 'collector' ? 'a collector street' : 'a local access road';
    for (const r of FREEWAYS) { const dd = distToLine(center, r.pts) - Math.max(t.w, t.h) / 2; if (dd < 0.55) { front = r.kind as RoadClass; frontName = `${r.name} frontage`; rampD = Math.min(rampD, 0.5); if (!rampName || dd < 0.3) rampName = r.name; if (r.kind === 'interstate') intD = Math.min(intD, 0.6); break; } }
    // right at an interchange, the lattice distance is zero: use the real distance to the freeway instead
    if (rampD < 0.01) rampD = Math.max(0.3, Math.min(...FREEWAYS.map((r) => distToLine(center, r.pts)))) - 0.6;
    site[s.id] = { front, frontName, corner, hard, rampMi: Math.round((rampD + 0.6) * MILES_PER_TILE * 10) / 10, rampName, interstateMi: Math.round((intD + 0.6) * MILES_PER_TILE * 10) / 10, drive, side };
  }

  // --- geometry for the maps: straight runs, intersections and frontage roads ---
  const segs: Seg[] = [];
  for (let y = 0; y <= H; y++) { let x = 0; while (x < W) { const c = hEdge[hi(x, y)]; if (!c) { x++; continue; } let e = x; while (e < W && hEdge[hi(e, y)] === c) e++; segs.push({ a: [x, y], b: [e, y], cls: CLS[c] }); x = e; } }
  for (let x = 0; x <= W; x++) { let y = 0; while (y < H) { const c = vEdge[vi(x, y)]; if (!c) { y++; continue; } let e = y; while (e < H && vEdge[vi(x, e)] === c) e++; segs.push({ a: [x, y], b: [x, e], cls: CLS[c] }); y = e; } }
  const nodes: RoadNet['nodes'] = [];
  for (let y = 0; y <= H; y++) for (let x = 0; x <= W; x++) { const l = legs(x, y).map(([e, , i]) => e[i]).filter((c) => c > 0); if (l.length >= 3 || (l.length === 2 && l[0] !== l[1])) nodes.push([x, y, CLS[Math.max(...l)]]); }

  const frontage: XY[][] = [];
  for (const r of ROADS) {
    if (r.kind !== 'interstate') continue;
    for (const sgn of [1, -1]) {
      let run: XY[] = [];
      const flush = () => { if (run.length > 2) frontage.push(run); run = []; };
      for (let i = 0; i < r.pts.length - 1; i++) {
        const [ax, ay] = r.pts[i], [bx, by] = r.pts[i + 1], len = Math.hypot(bx - ax, by - ay) || 1, nx = (-(by - ay) / len) * sgn, ny = ((bx - ax) / len) * sgn, n = Math.ceil(len * 2);
        for (let k = 0; k <= n; k++) {
          const px = ax + ((bx - ax) * k) / n + nx * 0.2, py = ay + ((by - ay) * k) / n + ny * 0.2, tx = Math.floor(px), ty = Math.floor(py);
          const built = tx >= 0 && ty >= 0 && tx < W && ty < H && (urbanity(tx, ty) > 0.12 || industry(tx, ty) > 0.08) && !inLake(px, py, 1.15) && !inAirport(px, py);
          if (built) run.push([px, py]); else flush();
        }
      }
      flush();
    }
  }
  return { segs, nodes, frontage, site, hEdge, vEdge };
}

let net: RoadNet | null = null;
export const setRoadNet = (n: RoadNet) => { net = n; };
/** The network, once content/world has built it. */
export function roadNet(): RoadNet { if (!net) throw new Error('Road network not built yet: import content/world first.'); return net; }
