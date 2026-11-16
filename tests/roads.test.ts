// The road network and the fuller map: every site is reachable, roads stay out of water and airfields,
// and every property type has places where it belongs.
import { describe, expect, it } from 'vitest';
import { roadNet } from '../src/content/roads';
import { DISTRICTS, makeParcels, roadOf } from '../src/content/world';
import { ACRE_RANGE } from '../src/engine/params';
import { AIRPORTS, LAKES, ROADS, type XY } from '../src/render/layout';

const parcels = makeParcels(), net = roadNet();
const dSeg = (p: XY, a: XY, b: XY) => { const dx = b[0] - a[0], dy = b[1] - a[1], t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1))); return Math.hypot(p[0] - a[0] - dx * t, p[1] - a[1] - dy * t); };
const dLine = (p: XY, l: XY[]) => Math.min(...l.slice(1).map((b, i) => dSeg(p, l[i], b)));

describe('road network', () => {
  it('every site and building can drive to a freeway interchange, and every freeway leads to an interstate', () => {
    for (const p of parcels) {
      const r = roadOf(p.id);
      expect(r, p.id).toBeTruthy();
      expect(r.rampMi, `${p.name} has no route to a freeway`).toBeLessThan(40);
      expect(r.rampName.length, p.name).toBeGreaterThan(0);
    }
    // freeways and highways form one connected system that includes the interstates
    const fw = ROADS.filter((r) => r.kind !== 'arterial'), seen = new Set<number>(), q: number[] = [];
    fw.forEach((r, i) => { if (r.kind === 'interstate') { seen.add(i); q.push(i); } });
    for (let h = 0; h < q.length; h++) fw.forEach((r, j) => { if (seen.has(j)) return; const a = fw[q[h]]; if (r.pts.some((p) => dLine(p, a.pts) < 0.8) || a.pts.some((p) => dLine(p, r.pts) < 0.8) || r.pts.some((p, i) => i > 0 && a.pts.some((_, k) => k > 0 && hit(r.pts[i - 1], p, a.pts[k - 1], a.pts[k])))) { seen.add(j); q.push(j); } });
    expect(fw.filter((_, i) => !seen.has(i)).map((r) => r.name)).toEqual([]);
  });
  it('every stretch of surface road connects to the rest', () => {
    // flood-fill the street grid from one segment; nothing may be left over
    const key = (p: XY) => `${p[0]},${p[1]}`, adj = new Map<string, Set<string>>();
    const link = (a: XY, b: XY) => { for (const [x, y] of [[a, b], [b, a]] as [XY, XY][]) { if (!adj.has(key(x))) adj.set(key(x), new Set()); adj.get(key(x))!.add(key(y)); } };
    for (const s of net.segs) { const dx = Math.sign(s.b[0] - s.a[0]), dy = Math.sign(s.b[1] - s.a[1]); for (let x = s.a[0], y = s.a[1]; x !== s.b[0] || y !== s.b[1]; x += dx, y += dy) link([x, y], [x + dx, y + dy]); }
    // freeway crossings join the pieces of grid on either side, so treat all interchange vertices as one hub
    const hubs = [...adj.keys()].filter((k) => { const [x, y] = k.split(',').map(Number); return [...adj.get(k)!].some((n) => { const [nx, ny] = n.split(',').map(Number); return ROADS.some((r) => r.kind !== 'arterial' && r.pts.some((p, i) => i > 0 && hit([x, y], [nx, ny], r.pts[i - 1], p))); }); });
    const seen = new Set<string>(hubs), q = [...hubs];
    for (let h = 0; h < q.length; h++) for (const n of adj.get(q[h]) ?? []) if (!seen.has(n)) { seen.add(n); q.push(n); }
    expect(adj.size - seen.size).toBe(0);
  });
  it('no highway or named arterial ends in the middle of nowhere', () => {
    const W = 96, H = 76, bad: string[] = [];
    for (const r of ROADS) for (const end of [r.pts[0], r.pts[r.pts.length - 1]]) {
      const edge = end[0] < 0.6 || end[1] < 0.6 || end[0] > W - 0.6 || end[1] > H - 0.6;
      const meets = ROADS.some((o) => o !== r && dLine(end, o.pts) < 0.25);
      const loop = r.pts.length > 3 && Math.hypot(r.pts[0][0] - r.pts[r.pts.length - 1][0], r.pts[0][1] - r.pts[r.pts.length - 1][1]) < 0.01;
      if (!edge && !meets && !loop) bad.push(`${r.name} ends at ${end[0].toFixed(1)},${end[1].toFixed(1)}`);
    }
    expect(bad).toEqual([]);
  });
  it('no surface street dead-ends: each end meets another street, a highway, the map edge, or a site it serves', () => {
    const W = 96, H = 76, deg = new Map<string, number>(), bump = (x: number, y: number) => deg.set(`${x},${y}`, (deg.get(`${x},${y}`) ?? 0) + 1);
    for (const s of net.segs) { const dx = Math.sign(s.b[0] - s.a[0]), dy = Math.sign(s.b[1] - s.a[1]); for (let x = s.a[0], y = s.a[1]; x !== s.b[0] || y !== s.b[1]; x += dx, y += dy) { bump(x, y); bump(x + dx, y + dy); } }
    const loose: string[] = [], served: string[] = [];
    for (const [k, n] of deg) {
      if (n !== 1) continue;
      const [x, y] = k.split(',').map(Number);
      if (x <= 0 || y <= 0 || x >= W || y >= H) continue;
      if (ROADS.some((r) => dLine([x, y], r.pts) < 0.36)) continue;
      if (parcels.some((p) => x >= p.tile.x && x <= p.tile.x + p.tile.w && y >= p.tile.y && y <= p.tile.y + p.tile.h)) { served.push(k); continue; }
      loose.push(k);
    }
    expect(loose).toEqual([]);
    expect(served.length, `cul-de-sacs at sites: ${served}`).toBeLessThanOrEqual(6);
  });
  it('streets run in whole lines: arterials every fourth line, and long straight runs', () => {
    const art = net.segs.filter((s) => s.cls === 'arterial'), len = (s: { a: XY; b: XY }) => Math.abs(s.b[0] - s.a[0]) + Math.abs(s.b[1] - s.a[1]);
    const total = net.segs.reduce((a, s) => a + len(s), 0);
    expect(art.reduce((a, s) => a + len(s), 0) / total).toBeGreaterThan(0.3);
    // very few one-tile stubs
    expect(net.segs.filter((s) => len(s) === 1).length / net.segs.length).toBeLessThan(0.2);
  });
  it('no surface road runs through a lake or across an airfield', () => {
    const bad: string[] = [];
    for (const s of [...net.segs.map((x) => [x.a, x.b] as XY[]), ...net.frontage]) for (let i = 0; i < s.length - 1; i++) for (let t = 0.05; t < 1; t += 0.1) {
      const x = s[i][0] + (s[i + 1][0] - s[i][0]) * t, y = s[i][1] + (s[i + 1][1] - s[i][1]) * t;
      if (LAKES.some((l) => ((x - l.x) / l.rx) ** 2 + ((y - l.y) / l.ry) ** 2 < 0.98)) bad.push(`lake at ${x.toFixed(1)},${y.toFixed(1)}`);
      if (AIRPORTS.some((a) => x > a.x + 0.05 && x < a.x + Math.ceil(a.w) - 0.05 && y > a.y + 0.05 && y < a.y + Math.ceil(a.h) - 0.05)) bad.push(`airport at ${x.toFixed(1)},${y.toFixed(1)}`);
    }
    expect([...new Set(bad)]).toEqual([]);
  });
  it('no road of any kind cuts through a site', () => {
    const bad: string[] = [];
    for (const p of parcels) {
      const t = p.tile, inSite = (x: number, y: number) => x > t.x + 0.06 && x < t.x + t.w - 0.06 && y > t.y + 0.06 && y < t.y + t.h - 0.06;
      for (const s of net.segs) for (let k = 0.5; k < Math.abs(s.b[0] - s.a[0]) + Math.abs(s.b[1] - s.a[1]); k += 0.5) { const f = k / (Math.abs(s.b[0] - s.a[0]) + Math.abs(s.b[1] - s.a[1])); if (inSite(s.a[0] + (s.b[0] - s.a[0]) * f, s.a[1] + (s.b[1] - s.a[1]) * f)) bad.push(p.name); }
      for (const r of ROADS) for (let i = 0; i < r.pts.length - 1; i++) for (let f = 0; f <= 1; f += 0.02) if (inSite(r.pts[i][0] + (r.pts[i + 1][0] - r.pts[i][0]) * f, r.pts[i][1] + (r.pts[i + 1][1] - r.pts[i][1]) * f)) bad.push(`${p.name} x ${r.name}`);
    }
    expect([...new Set(bad)]).toEqual([]);
  });
  it('sites do not overlap each other', () => {
    const used = new Map<string, string>();
    for (const p of parcels) for (let y = p.tile.y; y < p.tile.y + p.tile.h; y++) for (let x = p.tile.x; x < p.tile.x + p.tile.w; x++) { expect(used.get(`${x},${y}`), `${p.name} overlaps ${used.get(`${x},${y}`)}`).toBeUndefined(); used.set(`${x},${y}`, p.name); }
  });
});

describe('the fuller map', () => {
  const land = parcels.filter((p) => !p.existing), built = parcels.filter((p) => p.existing);
  const fits = (t: string) => land.filter((p) => p.fit!.includes(t as never) && p.acres * (1 - p.floodPct) >= ACRE_RANGE[t][0] && p.acres * (1 - p.floodPct) <= ACRE_RANGE[t][1]);
  it('has about 120 land sites and 35 existing buildings, about one in ten a pocket listing', () => {
    expect(land.length).toBeGreaterThanOrEqual(115); expect(land.length).toBeLessThanOrEqual(125);
    expect(built.length).toBeGreaterThanOrEqual(33); expect(built.length).toBeLessThanOrEqual(37);
    const pocket = land.filter((p) => p.offMarket).length / land.length;
    expect(pocket).toBeGreaterThan(0.05); expect(pocket).toBeLessThan(0.16);
    expect(new Set(parcels.map((p) => p.id)).size).toBe(parcels.length);
    expect(new Set(parcels.map((p) => p.name)).size).toBe(parcels.length);
  });
  it('gives every property type at least 15 suitable sites, and every type some existing buildings', () => {
    for (const t of ['ios', 'spec', 'retail', 'office', 'mf']) {
      expect(fits(t).length, `${t} sites`).toBeGreaterThanOrEqual(t === 'office' ? 12 : 15); // office is the scarcest by design
      expect(built.filter((p) => p.existing!.type === t).length, `${t} buildings`).toBeGreaterThanOrEqual(4);
    }
  });
  it('spreads sites across every district, with a mix of types in most', () => {
    for (const d of Object.keys(DISTRICTS)) {
      const here = land.filter((p) => p.district === d), types = new Set(here.flatMap((p) => p.fit!));
      expect(here.length, `${d} sites`).toBeGreaterThanOrEqual(3);
      expect(types.size, `${d} has only ${[...types]}`).toBeGreaterThanOrEqual(d === 'fwcbd' ? 2 : 3);
    }
  });
  it('existing buildings run from stabilized to value-add', () => {
    const occ = (p: (typeof built)[number]) => (p.existing!.type === 'mf' ? p.existing!.occ! : p.existing!.leases.reduce((a, l) => a + l.share, 0));
    expect(built.filter((p) => occ(p) >= 0.93).length).toBeGreaterThanOrEqual(8);
    expect(built.filter((p) => occ(p) < 0.6).length).toBeGreaterThanOrEqual(8);
    expect(built.filter((p) => p.existing!.cond === 'tired').length).toBeGreaterThanOrEqual(8);
    expect(built.filter((p) => p.existing!.leases.some((l) => l.factor < 0.9 && l.monthsLeft < 24)).length).toBeGreaterThanOrEqual(3);
  });
});

function hit(p: XY, q: XY, a: XY, b: XY): boolean {
  const c = (ax: number, ay: number, bx: number, by: number) => ax * by - ay * bx;
  const d1 = c(q[0] - p[0], q[1] - p[1], a[0] - p[0], a[1] - p[1]), d2 = c(q[0] - p[0], q[1] - p[1], b[0] - p[0], b[1] - p[1]), d3 = c(b[0] - a[0], b[1] - a[1], p[0] - a[0], p[1] - a[1]), d4 = c(b[0] - a[0], b[1] - a[1], q[0] - a[0], q[1] - a[1]);
  return d1 * d2 < 0 && d3 * d4 < 0;
}
