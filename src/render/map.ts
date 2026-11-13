// Isometric metro map renderer (Canvas 2D). Reads the live Game object every frame.
// Only what is on screen is drawn, and detail drops away as you zoom out.
import type { Deal, Game, Parcel } from '../engine/types';
import { AIRPORTS, CITIES, FLOOD, GROUND, H, INTERMODALS, LAKES, RAILS, RIVERS, ROADS, W, blockAt, hash, industry, isTaken, urbanity, type Rect, type XY } from './layout';

// Projection: east runs right and slightly down, south runs down and slightly left,
// so north is close to straight up and the metro reads like a map while buildings still stand up.
const EX = 45, EXY = 8, EYX = -12, EY = 27, DET = EX * EY - EXY * EYX;
const WX0 = EYX * H, WX1 = EX * W, WY1 = EXY * W + EY * H; // world pixel bounds
const dep = (x: number, y: number) => y + x * (EXY / EY);
export type OverlayMode = 'none' | 'zoning' | 'flood' | 'utilities' | 'land';
interface View { game: Game | null; selParcel: string | null; overlay: OverlayMode; visible: Set<string>; pulse: string | null }

const C = {
  sky0: '#f6dcae', sky1: '#e9b98c',
  ground: [['#b9c08a', '#b2bb84', '#c0c48f', '#aab57f'], ['#c3c298', '#bfbf93', '#c7c69d', '#bbbb8e'], ['#cfc8ad', '#cac3a7', '#d3ccb3', '#c6bfa2'], ['#d5d0c2', '#d0cbbc', '#d9d4c7', '#ccc7b8'], ['#beb7a3', '#b9b29e', '#c2bba8', '#b5ae99']],
  water: '#7fb0c2', road: '#6f6b66', arterial: '#8f897f', rail: '#3d342c', runway: '#77746f',
  dirt: '#cba36b', gravel: '#a8a49b', stabilized: '#b9b3a6', paved: '#dddbd4', slab: '#d6d2c8', lot: '#a39c8e',
  wallL: '#e8e1d2', wallR: '#c9bfad', roof: '#f4f0e6', accent: '#d9622b', ink: '#1d2730',
};
const ZONE_COL: Record<string, string> = { I: '#5f7fa8', C: '#d2694c', AG: '#7fa35f', ETJ: '#c2a04a' };
type Stat = { depth: number; x: number; y: number; kind: 0 | 1 | 2 | 3 | 4; a: number; b: number; r?: Rect };

export class IsoMap {
  private ctx: CanvasRenderingContext2D;
  private cam = { x: 0, y: 0, z: 1 };
  private view: View = { game: null, selParcel: null, overlay: 'none', visible: new Set(), pulse: null };
  private raf = 0;
  private hover: string | null = null;
  private pointers = new Map<number, { x: number; y: number }>();
  private drag: { x: number; y: number; moved: number; pinch: number; mini: boolean } | null = null;
  private statics: Stat[] = [];
  private trucks: { road: number; t: number; speed: number; dir: 1 | -1; col: string }[] = [];
  private roadLen: { seg: number[]; total: number }[] = [];
  private mini: HTMLCanvasElement | null = null;
  private fitted = false;
  private last = 0;
  onSelect: (parcelId: string | null) => void = () => {};

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
    canvas.addEventListener('pointerdown', this.down);
    canvas.addEventListener('pointermove', this.move);
    canvas.addEventListener('pointerup', this.up);
    canvas.addEventListener('pointercancel', this.up);
    canvas.addEventListener('pointerleave', () => { this.hover = null; });
    canvas.addEventListener('wheel', this.wheel, { passive: false });
    this.roadLen = ROADS.map((r) => { const seg = r.pts.slice(1).map((p, i) => Math.hypot(p[0] - r.pts[i][0], p[1] - r.pts[i][1])); return { seg, total: seg.reduce((a, b) => a + b, 0) }; });
    ROADS.forEach((r, i) => { if (r.kind === 'arterial') return; const n = Math.max(2, Math.round(this.roadLen[i].total / 9)); for (let k = 0; k < n; k++) this.trucks.push({ road: i, t: hash(i, k, 3), speed: (0.5 + hash(i, k, 5) * 0.4) / this.roadLen[i].total, dir: k % 2 ? 1 : -1, col: ['#f2efe8', '#c9502f', '#3f6f8f', '#e0b23f'][Math.floor(hash(i, k, 9) * 4)] }); });
    this.scatter();
    this.raf = requestAnimationFrame(this.frame);
  }
  destroy() { cancelAnimationFrame(this.raf); }
  setView(v: Partial<View>) {
    const first = !this.view.game && !!v.game;
    Object.assign(this.view, v);
    if (first) { this.fitted = true; this.focusParcel('bluemound', 0.95); }
    if (v.game === null) this.fitted = false;
  }

  /** Scenery: houses in towns, towers downtown, warehouses in industrial clusters, trees elsewhere. */
  private scatter() {
    const s = this.statics;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (blockAt(x, y) === 2 || blockAt(x, y) === 3 || isTaken(x, y)) continue;
      const onRoad = blockAt(x, y) !== 0, g = GROUND[y * W + x], u = urbanity(x, y);
      if (g === 3) { if (!onRoad || hash(x, y, 30) < 0.5) for (let k = 0; k < 3; k++) { const ox = 0.08 + hash(x, y, 31 + k) * 0.55, oy = 0.08 + hash(x, y, 41 + k) * 0.55; s.push({ depth: dep(x + ox + 0.3, y + oy + 0.3), x: x + ox, y: y + oy, kind: 3, a: 26 + hash(x, y, 51 + k) * 70, b: Math.floor(hash(x, y, 61 + k) * 3) }); } continue; }
      if (onRoad) continue;
      const ind = industry(x, y);
      if (ind > 0) {
        // up to two warehouses per tile in industrial clusters
        let any = false;
        for (let q = 0; q < 2; q++) if (hash(x, y, 20 + q * 5) < ind * 1.5) {
          const w = 0.3 + hash(x, y, 21 + q) * 0.14, h = 0.3 + hash(x, y, 26 + q) * 0.3;
          const r = { x: x + 0.05 + q * 0.5, y: y + (0.9 - h) * hash(x, y, 28 + q), w, h };
          s.push({ depth: dep(r.x + r.w, r.y + r.h), x, y, kind: 2, a: 7 + hash(x, y, 23 + q) * 7, b: Math.floor(hash(x, y, 24 + q) * 3), r }); any = true;
        }
        if (any) continue;
      }
      if (u > 0.25) {
        const n = u > 0.55 ? 3 : hash(x, y, 1) < 0.75 ? 2 : 1;
        for (let k = 0; k < n; k++) { const ox = 0.1 + hash(x, y, 2 + k) * 0.6, oy = 0.1 + hash(x, y, 6 + k) * 0.6; s.push({ depth: dep(x + ox + 0.24, y + oy + 0.2), x: x + ox, y: y + oy, kind: 1, a: Math.floor(hash(x, y, 10 + k) * 4), b: 0 }); }
        if (hash(x, y, 14) < 0.4) s.push({ depth: dep(x + 0.5, y + 0.5), x: x + 0.5, y: y + 0.5, kind: 0, a: 0.6, b: 0 });
      } else {
        const near = FLOOD.has(y * W + x) ? 0.7 : x < 22 ? 0.12 : 0.3;
        for (let k = 0; k < 2; k++) if (hash(x, y, 4 + k * 7) < near) { const ox = 0.15 + hash(x, y, 6 + k) * 0.7, oy = 0.15 + hash(x, y, 16 + k) * 0.7; s.push({ depth: dep(x + ox, y + oy), x: x + ox, y: y + oy, kind: 0, a: 0.65 + hash(x, y, 8 + k) * 0.6, b: 0 }); }
      }
    }
    INTERMODALS.forEach(([ix, iy]) => { for (let i = 0; i < 12; i++) { const x = ix - 0.6 + (i % 3) * 0.42, y = iy - 0.9 + Math.floor(i / 3) * 0.45; s.push({ depth: dep(x + 0.36, y + 0.2), x, y, kind: 4, a: 6 + (i % 3) * 4, b: i % 4 }); } });
    s.sort((a, b) => a.depth - b.depth);
  }

  // ----- camera and input -----
  private iso(x: number, y: number): XY { return [x * EX + y * EYX, x * EXY + y * EY]; }
  private size() { const r = this.canvas.getBoundingClientRect(); return { w: r.width, h: r.height }; }
  private toTile(sx: number, sy: number): XY {
    const { w, h } = this.size();
    const wx = (sx - w / 2) / this.cam.z + this.cam.x, wy = (sy - h / 2) / this.cam.z + this.cam.y;
    return [(wx * EY - wy * EYX) / DET, (wy * EX - wx * EXY) / DET];
  }
  private parcelAt(sx: number, sy: number): Parcel | null {
    const [tx, ty] = this.toTile(sx, sy), pad = this.cam.z < 0.5 ? 0.6 : 0.1;
    return this.view.game?.parcels.find((p) => this.view.visible.has(p.id) && tx >= p.tile.x - pad && tx < p.tile.x + p.tile.w + pad && ty >= p.tile.y - pad && ty < p.tile.y + p.tile.h + pad) ?? null;
  }
  private local(e: PointerEvent | WheelEvent) { const r = this.canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
  private miniRect() { const { h } = this.size(); const mw = 176, mh = Math.round((mw * H) / W); return { x: 92, y: h - 176 - mh, w: mw, h: mh }; }
  private inMini(p: { x: number; y: number }) { const m = this.miniRect(); return !!this.view.game && p.x >= m.x && p.x <= m.x + m.w && p.y >= m.y && p.y <= m.y + m.h; }
  private miniJump(p: { x: number; y: number }) { const m = this.miniRect(); this.centerTile(((p.x - m.x) / m.w) * W, ((p.y - m.y) / m.h) * H); }
  private down = (e: PointerEvent) => {
    this.canvas.setPointerCapture(e.pointerId);
    const p = this.local(e);
    this.pointers.set(e.pointerId, p);
    const mini = this.inMini(p);
    this.drag = { x: p.x, y: p.y, moved: mini ? 99 : 0, pinch: this.pinchDist(), mini };
    if (mini) this.miniJump(p);
  };
  private pinchDist() { const p = [...this.pointers.values()]; return p.length >= 2 ? Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y) : 0; }
  private move = (e: PointerEvent) => {
    const p = this.local(e);
    if (this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, p);
    if (this.drag?.mini) { this.miniJump(p); return; }
    if (this.drag && this.pointers.size >= 2) {
      const d = this.pinchDist();
      if (this.drag.pinch > 0 && d > 0) this.zoomAt(this.size().w / 2, this.size().h / 2, d / this.drag.pinch);
      this.drag.pinch = d; this.drag.moved = 99;
    } else if (this.drag && this.pointers.size === 1) {
      const dx = p.x - this.drag.x, dy = p.y - this.drag.y;
      this.drag.moved += Math.abs(dx) + Math.abs(dy);
      this.cam.x -= dx / this.cam.z; this.cam.y -= dy / this.cam.z;
      this.drag.x = p.x; this.drag.y = p.y;
      this.clampCam();
    } else {
      this.hover = this.inMini(p) ? null : this.parcelAt(p.x, p.y)?.id ?? null;
      this.canvas.style.cursor = this.hover || this.inMini(p) ? 'pointer' : 'grab';
    }
  };
  private up = (e: PointerEvent) => {
    const p = this.local(e);
    this.pointers.delete(e.pointerId);
    if (this.drag && this.drag.moved < 6) this.onSelect(this.parcelAt(p.x, p.y)?.id ?? null);
    if (this.pointers.size === 0) this.drag = null;
    else { const q = [...this.pointers.values()][0]; this.drag = { x: q.x, y: q.y, moved: 99, pinch: 0, mini: false }; }
  };
  private wheel = (e: WheelEvent) => { e.preventDefault(); const p = this.local(e); this.zoomAt(p.x, p.y, Math.exp(-e.deltaY * 0.0015)); };
  private minZoom() { const { w, h } = this.size(); return Math.max(0.1, Math.min(w / (WX1 - WX0), h / WY1) * 0.92); }
  private zoomAt(sx: number, sy: number, f: number) {
    const { w, h } = this.size();
    const z0 = this.cam.z, z1 = Math.max(this.minZoom(), Math.min(2.4, z0 * f));
    const wx = (sx - w / 2) / z0 + this.cam.x, wy = (sy - h / 2) / z0 + this.cam.y;
    this.cam.z = z1; this.cam.x = wx - (sx - w / 2) / z1; this.cam.y = wy - (sy - h / 2) / z1;
    this.clampCam();
  }
  private clampCam() {
    this.cam.x = Math.max(WX0, Math.min(WX1, this.cam.x));
    this.cam.y = Math.max(0, Math.min(WY1, this.cam.y));
  }
  zoomBy(f: number) { const { w, h } = this.size(); this.zoomAt(w / 2, h / 2, f); }
  centerTile(tx: number, ty: number, zoom?: number) {
    const [x, y] = this.iso(tx, ty);
    if (zoom) this.cam.z = zoom;
    this.cam.x = x; this.cam.y = y; this.clampCam();
  }
  focusParcel(id: string, zoom?: number) {
    const p = this.view.game?.parcels.find((q) => q.id === id);
    if (!p) return;
    const [x, y] = this.iso(p.tile.x + p.tile.w / 2, p.tile.y + p.tile.h / 2);
    if (zoom) this.cam.z = zoom; else if (this.cam.z < 0.8) this.cam.z = 1;
    this.cam.x = x + 150 / this.cam.z; this.cam.y = y;
  }
  fitAll() { this.cam = { x: (WX0 + WX1) / 2, y: WY1 / 2, z: this.minZoom() * 1.2 }; }

  // ----- drawing primitives -----
  private poly(pts: XY[], fill?: string, stroke?: string, lw = 1) {
    const c = this.ctx;
    c.beginPath(); c.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) c.lineTo(pts[i][0], pts[i][1]);
    c.closePath();
    if (fill) { c.fillStyle = fill; c.fill(); }
    if (stroke) { c.strokeStyle = stroke; c.lineWidth = lw; c.stroke(); }
  }
  private diamond(r: Rect, lift = 0): XY[] {
    const up = (p: XY): XY => [p[0], p[1] - lift];
    return [up(this.iso(r.x, r.y)), up(this.iso(r.x + r.w, r.y)), up(this.iso(r.x + r.w, r.y + r.h)), up(this.iso(r.x, r.y + r.h))];
  }
  private box(r: Rect, ht: number, top: string, left: string, right: string, shadow = true) {
    const [, b, c, d] = this.diamond(r);
    if (shadow) { this.ctx.globalAlpha = 0.16; this.poly(this.diamond({ x: r.x + 0.25, y: r.y + 0.12, w: r.w + ht / 50, h: r.h }), '#3a2a1a'); this.ctx.globalAlpha = 1; }
    this.poly([d, c, [c[0], c[1] - ht], [d[0], d[1] - ht]], left);
    this.poly([c, b, [b[0], b[1] - ht], [c[0], c[1] - ht]], right);
    this.poly(this.diamond(r, ht), top);
  }
  private line(pts: XY[], color: string, width: number, dash?: number[]) {
    const c = this.ctx;
    c.beginPath();
    pts.forEach((p, i) => { const [x, y] = this.iso(p[0], p[1]); if (i) c.lineTo(x, y); else c.moveTo(x, y); });
    c.strokeStyle = color; c.lineWidth = width; c.lineJoin = 'round'; c.lineCap = 'round';
    c.setLineDash(dash ?? []); c.stroke(); c.setLineDash([]);
  }
  private text(s: string, x: number, y: number, size: number, color: string, opts: { halo?: string; weight?: number; spacing?: number } = {}) {
    const c = this.ctx;
    c.font = `${opts.weight ?? 600} ${size}px 'Barlow Condensed', sans-serif`;
    c.textAlign = 'center'; c.textBaseline = 'middle';
    (c as unknown as { letterSpacing: string }).letterSpacing = `${opts.spacing ?? 0}px`;
    if (opts.halo) { c.strokeStyle = opts.halo; c.lineWidth = size / 4; c.lineJoin = 'round'; c.strokeText(s, x, y); }
    c.fillStyle = color; c.fillText(s, x, y);
    (c as unknown as { letterSpacing: string }).letterSpacing = '0px';
  }

  // ----- frame -----
  private frame = (now: number) => {
    this.raf = requestAnimationFrame(this.frame);
    if (now - this.last < 30) return; // about 30 frames a second is plenty
    const dt = Math.min(0.1, (now - this.last) / 1000); this.last = now;
    const { w, h } = this.size();
    if (!w || !h) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (this.canvas.width !== Math.round(w * dpr) || this.canvas.height !== Math.round(h * dpr)) { this.canvas.width = Math.round(w * dpr); this.canvas.height = Math.round(h * dpr); }
    if (!this.fitted) { this.fitAll(); if (this.view.game) this.fitted = true; }
    const c = this.ctx, g = this.view.game, t = now / 1000, z = this.cam.z, k = 1 / z;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    const sky = c.createLinearGradient(0, 0, 0, h); sky.addColorStop(0, C.sky0); sky.addColorStop(1, C.sky1);
    c.fillStyle = sky; c.fillRect(0, 0, w, h);
    c.translate(w / 2, h / 2); c.scale(z, z); c.translate(-this.cam.x, -this.cam.y);

    // what is on screen, in tiles and in world pixels
    const corners = [this.toTile(0, 0), this.toTile(w, 0), this.toTile(w, h), this.toTile(0, h)];
    const x0 = Math.max(0, Math.floor(Math.min(...corners.map((p) => p[0])) - 1)), x1 = Math.min(W - 1, Math.ceil(Math.max(...corners.map((p) => p[0])) + 1));
    const y0 = Math.max(0, Math.floor(Math.min(...corners.map((p) => p[1])) - 1)), y1 = Math.min(H - 1, Math.ceil(Math.max(...corners.map((p) => p[1])) + 1));
    const vx0 = this.cam.x - w / 2 / z - 90, vx1 = this.cam.x + w / 2 / z + 90, vy0 = this.cam.y - h / 2 / z - 110, vy1 = this.cam.y + h / 2 / z + 60;
    const seen = (x: number, y: number) => { const px = x * EX + y * EYX, py = x * EXY + y * EY; return px > vx0 && px < vx1 && py > vy0 && py < vy1; };

    if (z < 0.5) {
      // far zoom: draw the cached ground and road layer in one blit
      if (!this.far) this.buildFar();
      c.drawImage(this.far!, WX0 - 40, -40, WX1 - WX0 + 80, WY1 + 80);
    } else this.drawBase(x0, x1, y0, y1, seen, z);
    if (this.view.overlay === 'flood') { c.globalAlpha = 0.4; const p = new Path2D(); for (const i of FLOOD) { const x = i % W, y = Math.floor(i / W); if (x < x0 || x > x1 || y < y0 || y > y1) continue; const d = this.diamond({ x, y, w: 1, h: 1 }); p.moveTo(d[0][0], d[0][1]); d.slice(1).forEach((q) => p.lineTo(q[0], q[1])); p.closePath(); } c.fillStyle = '#3f87b5'; c.fill(p); c.globalAlpha = 1; }

    if (g) {
      const dealBy = new Map<string, Deal>();
      for (const d of g.deals) if (d.phase !== 'dead') dealBy.set(d.parcelId, d);
      const parcels = g.parcels.filter((p) => this.view.visible.has(p.id) && seen(p.tile.x + 1, p.tile.y + 1));
      for (const p of parcels) this.parcelGround(p, dealBy.get(p.id), t);

      // objects back to front: pre-sorted scenery merged with parcels and trucks
      const dyn: { depth: number; draw: () => void }[] = [];
      for (const p of parcels) { const d = dealBy.get(p.id); dyn.push({ depth: dep(p.tile.x + p.tile.w, p.tile.y + p.tile.h) - 0.02, draw: () => this.parcelObjects(p, d, t) }); }
      if (z > 0.42) this.trucks.forEach((tr) => {
        tr.t = (tr.t + tr.speed * dt * tr.dir + 1) % 1;
        const [x, y, ax] = this.along(tr.road, tr.t);
        if (seen(x, y)) dyn.push({ depth: dep(x, y + 0.15), draw: () => this.box(ax ? { x: x - 0.22, y: y - 0.06 + tr.dir * 0.07, w: 0.44, h: 0.12 } : { x: x - 0.06 + tr.dir * 0.07, y: y - 0.22, w: 0.12, h: 0.44 }, 4, tr.col, '#00000030', '#00000050', false) });
      });
      dyn.sort((a, b) => a.depth - b.depth);
      let di = 0;
      for (const s of this.statics) {
        while (di < dyn.length && dyn[di].depth <= s.depth) dyn[di++].draw();
        if (s.kind === 0 && z < 0.45) continue;
        if (s.kind === 1 && z < 0.3) continue;
        if (!seen(s.x, s.y)) continue;
        if (s.kind === 0) this.tree(s.x, s.y, s.a);
        else if (s.kind === 1) this.house(s.x, s.y, s.a, z < 0.6);
        else if (s.kind === 2) this.warehouse(s.r!, s.a, s.b, z > 0.7);
        else if (s.kind === 3) this.tower(s.x, s.y, s.a, s.b);
        else this.box({ x: s.x, y: s.y, w: 0.36, h: 0.2 }, s.a, ['#c9502f', '#3f6f8f', '#e0b23f', '#5c8a5a'][s.b], '#00000033', '#00000055', false);
      }
      while (di < dyn.length) dyn[di++].draw();

      // labels keep a constant size on screen
      for (const r of ROADS) if (r.kind !== 'arterial' && (r.kind === 'interstate' ? z > 0.22 : z > 0.45)) for (const [sx, sy] of r.shieldAt) {
        const [x, y] = this.iso(sx, sy); if (!seen(sx, sy)) continue;
        c.font = `600 ${10 * k}px 'Barlow Condensed', sans-serif`; const wd = c.measureText(r.name).width + 9 * k;
        c.fillStyle = r.kind === 'interstate' ? '#26435c' : '#26323c'; roundRect(c, x - wd / 2, y - 7.5 * k, wd, 15 * k, 4 * k); c.fill();
        this.text(r.name, x, y, 10 * k, '#f5efe2');
      }
      for (const ci of CITIES) if ((ci.major || z > 0.5) && seen(ci.x, ci.y)) { const [x, y] = this.iso(ci.x, ci.y); this.text(ci.name, x, y - (ci.core ? 64 : 18), (ci.core ? 17 : ci.major ? 14 : 11.5) * k, '#3f3426', { halo: '#f7ecd2dd', spacing: (ci.major ? 2.5 : 1.2) * k, weight: ci.major ? 700 : 600 }); }
      if (z > 0.5) {
        for (const l of LAKES) if (seen(l.x, l.y)) { const [x, y] = this.iso(l.x, l.y); this.text(l.name, x, y, 10.5 * k, '#2f5f73', { weight: 500 }); }
        for (const a of AIRPORTS) if (seen(a.x, a.y)) { const [x, y] = this.iso(a.x + a.w / 2, a.y + a.h / 2); this.text(a.name, x, y - 10 * k, 11 * k, '#4b3f2f', { halo: '#f7ecd2cc', weight: 500 }); }
      }
      for (const p of parcels) this.parcelTag(p, dealBy.get(p.id), t);
    }

    // warm vignette and the mini-map, in screen space
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    const v = c.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.max(w, h) * 0.75);
    v.addColorStop(0, 'rgba(255,190,120,0)'); v.addColorStop(1, 'rgba(120,60,20,0.22)');
    c.fillStyle = v; c.fillRect(0, 0, w, h);
    if (g) this.drawMini(corners);
  };

  private far: HTMLCanvasElement | null = null;
  private buildFar() {
    const S = 0.5, cv = document.createElement('canvas');
    cv.width = Math.ceil((WX1 - WX0 + 80) * S); cv.height = Math.ceil((WY1 + 80) * S);
    const real = this.ctx, x = cv.getContext('2d')!;
    x.scale(S, S); x.translate(-(WX0 - 40), 40);
    this.ctx = x;
    this.drawBase(0, W - 1, 0, H - 1, () => true, 0.45);
    this.ctx = real; this.far = cv;
  }

  /** Ground, water, airports, rail and roads for a range of tiles. */
  private drawBase(x0: number, x1: number, y0: number, y1: number, seen: (x: number, y: number) => boolean, z: number) {
    const c = this.ctx, k = 1 / z;
    this.poly(this.diamond({ x: -0.8, y: -0.8, w: W + 1.6, h: H + 1.6 }, -12), '#8f7a57');
    this.poly(this.diamond({ x: -0.8, y: -0.8, w: W + 1.6, h: H + 1.6 }), '#a89468');
    const paths = new Map<string, Path2D>();
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      if (!seen(x + 0.5, y + 0.5)) continue;
      const col = C.ground[GROUND[y * W + x]][Math.floor(hash(x, y) * 4)];
      let p = paths.get(col); if (!p) paths.set(col, (p = new Path2D()));
      const a = this.iso(x, y), b = this.iso(x + 1.03, y), d = this.iso(x + 1.03, y + 1.03), e = this.iso(x, y + 1.03);
      p.moveTo(a[0], a[1]); p.lineTo(b[0], b[1]); p.lineTo(d[0], d[1]); p.lineTo(e[0], e[1]); p.closePath();
    }
    for (const [col, p] of paths) { c.fillStyle = col; c.fill(p); }
    for (const l of LAKES) { const pts: XY[] = []; for (let i = 0; i < 28; i++) { const a = (i / 28) * Math.PI * 2, wob = 1 + 0.12 * Math.sin(i * 2.3 + l.x); pts.push(this.iso(l.x + Math.cos(a) * l.rx * wob, l.y + Math.sin(a) * l.ry * wob)); } this.poly(pts, C.water, '#6a9db0', 1.5); }
    for (const r of RIVERS) { this.line(r, '#6a9db0', 11); this.line(r, C.water, 8); }
    for (const a of AIRPORTS) { this.poly(this.diamond(a), '#a9a498'); for (let i = 0; i < Math.max(1, Math.round(a.w)); i++) { const rx = a.x + 0.3 + i * (a.w / Math.max(1, Math.round(a.w))); this.poly(this.diamond({ x: rx, y: a.y + 0.15, w: 0.22, h: a.h - 0.3 }), C.runway); this.line([[rx + 0.11, a.y + 0.3], [rx + 0.11, a.y + a.h - 0.3]], '#efe9d8', 1, [8, 7]); } }
    for (const r of RAILS) { this.line(r, C.rail, 2.4 * Math.max(1, k * 0.5)); if (z > 0.5) this.line(r, '#8a7c6c', 5, [1.5, 5]); }
    const wide = Math.max(1, k * 0.55);
    for (const r of ROADS) if (r.kind === 'arterial') this.line(r.pts, C.arterial, 5 * wide);
    for (const r of ROADS) if (r.kind !== 'arterial') this.line(r.pts, '#55514c', (r.kind === 'interstate' ? 14 : 10) * wide);
    for (const r of ROADS) if (r.kind !== 'arterial') { this.line(r.pts, C.road, (r.kind === 'interstate' ? 11 : 7.5) * wide); if (z > 0.55) this.line(r.pts, '#f1e6c8', 1.1, [6, 8]); }
  }

  /** Position along a road by fraction of its length, and whether that stretch runs mostly east-west. */
  private along(i: number, t: number): [number, number, boolean] {
    const r = ROADS[i], L = this.roadLen[i];
    let d = t * L.total;
    for (let s = 0; s < L.seg.length; s++) {
      if (d <= L.seg[s] || s === L.seg.length - 1) { const f = Math.min(1, d / (L.seg[s] || 1)), a = r.pts[s], b = r.pts[s + 1]; return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, Math.abs(b[0] - a[0]) > Math.abs(b[1] - a[1])]; }
      d -= L.seg[s];
    }
    return [r.pts[0][0], r.pts[0][1], true];
  }

  private drawMini(corners: XY[]) {
    const c = this.ctx, m = this.miniRect(), g = this.view.game!;
    if (!this.mini) {
      const s = 3, cv = document.createElement('canvas'); cv.width = W * s; cv.height = H * s;
      const x = cv.getContext('2d')!;
      for (let ty = 0; ty < H; ty++) for (let tx = 0; tx < W; tx++) { x.fillStyle = blockAt(tx, ty) === 2 ? C.water : ['#b9c08a', '#c6c49a', '#d3ccb3', '#8d8779', '#b5ae99'][GROUND[ty * W + tx]]; x.fillRect(tx * s, ty * s, s, s); }
      const ln = (pts: XY[], col: string, lw: number) => { x.beginPath(); pts.forEach((p, i) => (i ? x.lineTo(p[0] * s, p[1] * s) : x.moveTo(p[0] * s, p[1] * s))); x.strokeStyle = col; x.lineWidth = lw; x.stroke(); };
      for (const r of RIVERS) ln(r, C.water, 2);
      for (const r of ROADS) if (r.kind !== 'arterial') ln(r.pts, r.kind === 'interstate' ? '#4f4a45' : '#7a746c', r.kind === 'interstate' ? 2 : 1.2);
      this.mini = cv;
    }
    c.save();
    c.shadowColor = 'rgba(70,40,12,.3)'; c.shadowBlur = 14; c.shadowOffsetY = 5;
    c.fillStyle = 'rgba(250,245,234,.95)'; roundRect(c, m.x - 5, m.y - 5, m.w + 10, m.h + 10, 12); c.fill();
    c.restore();
    c.save(); roundRect(c, m.x, m.y, m.w, m.h, 8); c.clip();
    c.drawImage(this.mini, m.x, m.y, m.w, m.h);
    const sx = m.w / W, sy = m.h / H;
    for (const p of g.parcels) {
      if (!this.view.visible.has(p.id)) continue;
      const d = g.deals.find((q) => q.parcelId === p.id && q.phase !== 'dead');
      if (!d && p.status !== 'available') continue;
      c.fillStyle = d ? C.accent : '#fffaf0'; c.strokeStyle = d ? '#fff' : '#5a4630'; c.lineWidth = 0.8;
      c.beginPath(); c.arc(m.x + (p.tile.x + 0.5) * sx, m.y + (p.tile.y + 0.5) * sy, d ? 3.2 : 2, 0, 7); c.fill(); c.stroke();
    }
    c.beginPath(); corners.forEach((p, i) => { const x = m.x + p[0] * sx, y = m.y + p[1] * sy; if (i) c.lineTo(x, y); else c.moveTo(x, y); }); c.closePath();
    c.fillStyle = 'rgba(255,255,255,.18)'; c.fill(); c.strokeStyle = C.ink; c.lineWidth = 1.4; c.stroke();
    c.restore();
  }

  private overlayColor(p: Parcel): string | null {
    switch (this.view.overlay) {
      case 'zoning': return ZONE_COL[p.zoning];
      case 'utilities': return p.water && p.sewer ? '#2f8f8a' : p.water ? '#d09a2e' : '#8a8580';
      case 'land': { const f = Math.max(0, Math.min(1, (p.askPsf - 2) / 14)); return `hsl(${38 - f * 26}, 80%, ${78 - f * 34}%)`; }
      default: return null;
    }
  }

  private parcelGround(p: Parcel, d: Deal | undefined, t: number) {
    const c = this.ctx, r = p.tile, sel = this.view.selParcel === p.id, hov = this.hover === p.id, k = Math.max(1, 0.7 / this.cam.z);
    const built = d && ['construction', 'leasing', 'operations', 'sold'].includes(d.phase);
    if (built && d) {
      const prog = d.con ? Math.min(1, d.con.daysDone / d.con.daysTotal) : 1;
      this.poly(this.diamond(r), C.dirt);
      if (d.type === 'ios') this.poly(this.diamond({ x: r.x + 0.06, y: r.y + 0.06, w: (r.w - 0.12) * Math.max(0.04, prog), h: r.h - 0.12 }), C[d.ios.surface]);
      else if (prog > 0.05) this.poly(this.diamond({ x: r.x + 0.08, y: r.y + 0.08, w: r.w - 0.16, h: r.h - 0.16 }), prog > 0.3 ? '#b9b3a6' : '#c6a878');
    } else {
      c.globalAlpha = p.status === 'available' ? 0.85 : 0.95;
      this.poly(this.diamond(r), p.status === 'rival' ? C.lot : C.dirt); c.globalAlpha = 1;
    }
    if (p.floodPct > 0 && (this.view.overlay === 'flood' || !built)) {
      c.globalAlpha = this.view.overlay === 'flood' ? 0.6 : 0.3;
      this.poly(this.diamond({ x: r.x + r.w * (1 - p.floodPct), y: r.y, w: r.w * p.floodPct, h: r.h }), '#3f87b5'); c.globalAlpha = 1;
    }
    const oc = this.overlayColor(p);
    if (oc) { c.globalAlpha = 0.7; this.poly(this.diamond(r), oc); c.globalAlpha = 1; }
    const mine = d && d.phase !== 'sold';
    const stroke = sel ? '#ffffff' : mine ? C.accent : p.status === 'available' ? (p.offMarket ? '#7a5fb0' : '#fff8e6') : '#00000022';
    if (p.status === 'available' && !sel) c.setLineDash([5 * k, 4 * k]);
    this.poly(this.diamond(r), undefined, stroke, (sel ? 3 : hov ? 2.4 : mine ? 2 : 1.4) * k);
    c.setLineDash([]);
    if (this.view.pulse === p.id) {
      const q = (t % 1.6) / 1.6, s = q * 0.9 * k;
      c.globalAlpha = 1 - q; this.poly(this.diamond({ x: r.x - s, y: r.y - s, w: r.w + s * 2, h: r.h + s * 2 }), undefined, C.accent, 3 * k); c.globalAlpha = 1;
    }
  }

  private parcelObjects(p: Parcel, d: Deal | undefined, t: number) {
    const r = p.tile, c = this.ctx;
    if (p.status === 'rival') { this.warehouse({ x: r.x + 0.12, y: r.y + 0.12, w: r.w - 0.24, h: r.h - 0.24 }, 13, 1, true); return; }
    if (p.existing && p.existing.type !== 'ios' && (!d || ['dd', 'entitlement', 'predev'].includes(d.phase))) this.warehouse({ x: r.x + 0.14, y: r.y + 0.14, w: r.w - 0.28, h: r.h - 0.4 }, p.existing.type === 'office' ? 26 : 12, 1, false);
    if (this.cam.z < 0.35) return;
    if (!d) {
      if (p.status === 'available') { const [x, y] = this.iso(r.x + r.w - 0.12, r.y + r.h - 0.12); c.fillStyle = '#5a4630'; c.fillRect(x - 0.6, y - 11, 1.2, 11); c.fillStyle = p.offMarket ? '#7a5fb0' : '#fff8e6'; c.fillRect(x - 6, y - 17, 12, 7); c.strokeStyle = '#5a4630'; c.lineWidth = 0.6; c.strokeRect(x - 6, y - 17, 12, 7); }
      return;
    }
    const prog = d.con ? Math.min(1, d.con.daysDone / d.con.daysTotal) : 0;
    if (['dd', 'entitlement', 'predev'].includes(d.phase)) {
      for (const [sx, sy] of [[r.x, r.y], [r.x + r.w, r.y], [r.x + r.w, r.y + r.h], [r.x, r.y + r.h]]) {
        const [x, y] = this.iso(sx, sy); c.fillStyle = '#5a4630'; c.fillRect(x - 0.6, y - 10, 1.2, 10);
        c.fillStyle = C.accent; c.beginPath(); c.moveTo(x, y - 10); c.lineTo(x + 6, y - 8); c.lineTo(x, y - 6); c.fill();
      }
      return;
    }
    const done = d.phase !== 'construction', leased = d.leases.length > 0;
    if (d.type === 'ios') {
      const yard = { x: r.x + 0.06, y: r.y + 0.06, w: r.w - 0.12, h: r.h - 0.12 };
      if (!done) { const gx = yard.x + yard.w * prog, gy = yard.y + 0.15 + ((t * 0.25) % 1) * (yard.h - 0.4); this.box({ x: gx - 0.1, y: gy, w: 0.2, h: 0.15 }, 5, '#e0b23f', '#b38a22', '#96721a', false); }
      if (prog > 0.7 || done) {
        const pts = this.diamond(yard, 4), base = this.diamond(yard);
        c.strokeStyle = '#4a4f55'; c.lineWidth = 0.9;
        c.beginPath(); c.moveTo(pts[3][0], pts[3][1]); c.lineTo(pts[2][0], pts[2][1]); c.lineTo(pts[1][0], pts[1][1]); c.stroke();
        for (const i of [1, 2, 3]) { c.beginPath(); c.moveTo(base[i][0], base[i][1]); c.lineTo(pts[i][0], pts[i][1]); c.stroke(); }
        if (d.ios.security === 'premium') for (const [lx, ly] of [[yard.x + 0.08, yard.y + 0.08], [yard.x + yard.w - 0.08, yard.y + yard.h - 0.08], [yard.x + yard.w - 0.08, yard.y + 0.08], [yard.x + 0.08, yard.y + yard.h - 0.08]]) {
          const [x, y] = this.iso(lx, ly); c.fillStyle = '#3d4248'; c.fillRect(x - 0.5, y - 16, 1, 16); c.fillStyle = '#ffe9a8'; c.beginPath(); c.arc(x, y - 16, 1.8, 0, 7); c.fill();
        }
      }
      if (leased && done) {
        const cols = ['#f2efe8', '#c9502f', '#3f6f8f', '#f2efe8', '#e0b23f'];
        let i = 0;
        for (let yy = yard.y + 0.12; yy < yard.y + yard.h - 0.16; yy += 0.2) for (let xx = yard.x + 0.12; xx < yard.x + yard.w - 0.4; xx += 0.42) { if (hash(Math.round(xx * 20), Math.round(yy * 20), 21) < 0.72) this.box({ x: xx, y: yy, w: 0.32, h: 0.09 }, 3.5, cols[i++ % 5], '#00000030', '#00000050', false); }
      }
    } else {
      const inset = (0.5 - d.spec.coverage) * 0.9;
      const b = { x: r.x + inset * r.w * 0.5 + 0.08, y: r.y + 0.1, w: r.w * (1 - inset) - 0.16, h: r.h * 0.6 };
      const full = (13 + (d.spec.clear - 28) * 0.8) * (r.w > 1 ? 1.15 : 1);
      if (prog > 0.15 || done) {
        const q = done ? 1 : Math.min(1, (prog - 0.15) / 0.65);
        this.box(b, Math.max(1.5, full * q), done || prog > 0.85 ? C.roof : C.slab, C.wallL, C.wallR);
        if (done || prog > 0.85) {
          const n = Math.max(3, Math.round(b.w * 5));
          for (let i = 0; i < n; i++) { const [x, y] = this.iso(b.x + (i + 0.5) * (b.w / n), b.y + b.h); c.fillStyle = '#55606a'; c.fillRect(x - 1.8, y - 5.5, 3.6, 4.2); }
          const [a0, a1] = [this.iso(b.x, b.y + b.h), this.iso(b.x + b.w, b.y + b.h)];
          c.strokeStyle = C.accent; c.lineWidth = 1.5; c.beginPath(); c.moveTo(a0[0], a0[1] - full + 2.2); c.lineTo(a1[0], a1[1] - full + 2.2); c.stroke();
          const docks = Math.round(n * Math.min(1, d.leases.reduce((s, l) => s + l.share, 0)));
          for (let i = 0; i < docks; i += 2) this.box({ x: b.x + (i + 0.5) * (b.w / n) - 0.04, y: b.y + b.h + 0.03, w: 0.08, h: 0.26 }, 3.5, '#f2efe8', '#00000030', '#00000050', false);
        }
      }
      if (!done && prog > 0.1 && prog < 0.92) {
        const [x, y] = this.iso(b.x + b.w * 0.5, b.y - 0.03); const sw = Math.sin(t * 0.6) * 12;
        c.strokeStyle = '#d0a020'; c.lineWidth = 1.5; c.beginPath(); c.moveTo(x, y); c.lineTo(x, y - 38); c.stroke();
        c.beginPath(); c.moveTo(x - 8, y - 38); c.lineTo(x + 22 + sw * 0.2, y - 38); c.stroke();
        c.strokeStyle = '#444'; c.lineWidth = 0.6; c.beginPath(); c.moveTo(x + 15 + sw * 0.2, y - 38); c.lineTo(x + 15 + sw * 0.2, y - 25); c.stroke();
      }
    }
  }

  private parcelTag(p: Parcel, d: Deal | undefined, t: number) {
    const sel = this.view.selParcel === p.id, hov = this.hover === p.id, z = this.cam.z, k = 1 / z;
    const [x, y] = this.iso(p.tile.x + p.tile.w / 2, p.tile.y + p.tile.h / 2);
    const c = this.ctx;
    if (d && d.phase !== 'sold') {
      const py = y - (z < 0.6 ? 10 * k : 30 + (d.type === 'spec' && d.con ? 12 : 0)) + Math.sin(t * 2 + x) * 1.5 * k, s = Math.max(1, k * 0.9);
      c.fillStyle = C.accent; c.beginPath(); c.moveTo(x, py); c.lineTo(x + 7 * s, py - 9 * s); c.lineTo(x - 7 * s, py - 9 * s); c.closePath(); c.fill();
      c.strokeStyle = '#fff'; c.lineWidth = s; c.stroke();
    } else if (p.status === 'available' && z < 0.6) {
      c.fillStyle = p.offMarket ? '#7a5fb0' : '#fffaf0'; c.strokeStyle = '#5a4630'; c.lineWidth = 1.2 * k;
      c.beginPath(); c.arc(x, y, 4.2 * k, 0, 7); c.fill(); c.stroke();
    }
    if (sel || hov) this.text(p.name.replace(/ \(.*\)/, ''), x, y - 34 - 14 * k, 13 * k, '#1d2730', { halo: '#fffaf0', weight: 600 });
    else if (p.status === 'available' && z >= 0.75) this.text(`${p.acres} ac`, x, y - 1, 10.5 * k, '#4b3f2f', { halo: '#fff8e6cc', weight: 600 });
  }

  private tree(x: number, y: number, s: number) {
    const [px, py] = this.iso(x, y), c = this.ctx;
    c.fillStyle = '#6b8a52'; c.beginPath(); c.arc(px, py - 5 * s, 4.6 * s, 0, 7); c.fill();
    if (this.cam.z > 0.7) { c.fillStyle = '#86a565'; c.beginPath(); c.arc(px - 1.2 * s, py - 6.6 * s, 2.8 * s, 0, 7); c.fill(); }
  }
  private house(x: number, y: number, ci: number, flat: boolean) {
    const roof = ['#b5654a', '#8b6b52', '#77808a', '#a9744f'][ci];
    if (flat) { this.poly(this.diamond({ x, y, w: 0.24, h: 0.2 }, 3), roof); return; }
    this.box({ x, y, w: 0.24, h: 0.2 }, 4.5, roof, '#efe5d2', '#d3c5ab', false);
  }
  private tower(x: number, y: number, ht: number, tone: number) {
    const tops = ['#dfe7ea', '#e9e3d6', '#cfd9de'], l = ['#b9c9d1', '#d6ccb8', '#a9bcc7'], r = ['#8fa5b1', '#b5aa93', '#8198a5'];
    this.box({ x, y, w: 0.3, h: 0.3 }, ht, tops[tone], l[tone], r[tone], this.cam.z > 0.5);
  }
  private warehouse(r: Rect, ht: number, tone: number, detail: boolean) {
    const tops = ['#ece7da', '#e3ddd0', '#dfe3e2'], l = ['#d8d0be', '#cfc8b8', '#c9ced0'], rt = ['#b9b09c', '#b0a996', '#a9b0b3'];
    this.box(r, ht, tops[tone], l[tone], rt[tone], detail);
    if (!detail) return;
    const n = Math.max(2, Math.round(r.w * 5)), c = this.ctx;
    for (let i = 0; i < n; i++) { const [x, y] = this.iso(r.x + (i + 0.5) * (r.w / n), r.y + r.h); c.fillStyle = '#6a737b'; c.fillRect(x - 1.5, y - 4.6, 3, 3.4); }
  }
}

function roundRect(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
}
