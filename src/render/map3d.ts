// True 3D metro map (WebGL via three.js): lit, shadowed, with a camera you can pan, zoom, rotate and tilt.
// One tile is one world unit. X runs east, Z runs south, Y is up.
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { Atmosphere, type Weather } from './atmos';
import type { Deal, Game, Parcel } from '../engine/types';
import { AIRPORTS, CITIES, FLOOD, GROUND, H, INTERMODALS, LAKES, RAILS, RIVERS, ROADS, W, blockAt, hash, industry, isTaken, urbanity, type XY } from './layout';
import { GLOW, GLOW_RED, applyNight, buildSite, canvasTex, mat, siteKey, siteTex, type SiteModel } from './sites3d';

export type Quality = 'auto' | 'high' | 'medium' | 'low';
export interface Gfx { cycle: boolean; weather: boolean; quality: Quality }
export type OverlayMode = 'none' | 'zoning' | 'flood' | 'utilities' | 'land';
interface View { game: Game | null; selParcel: string | null; overlay: OverlayMode; visible: Set<string>; pulse: string | null }
const ZONE_COL: Record<string, string> = { I: '#5f7fa8', C: '#d2694c', AG: '#7fa35f', ETJ: '#c2a04a' };
const ACCENT = '#d9622b';
const UNIT = new THREE.BoxGeometry(1, 1, 1);
const FLAT = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);

/** A flat ribbon following a polyline, for roads, rail and rivers. */
function ribbon(pts: XY[], width: number, y: number): THREE.BufferGeometry {
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  let len = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    let dx = b[0] - a[0], dz = b[1] - a[1]; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
    if (i > 0) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    const nx = -dz * width / 2, nz = dx * width / 2;
    pos.push(pts[i][0] + nx, y, pts[i][1] + nz, pts[i][0] - nx, y, pts[i][1] - nz);
    uv.push(0, len / width, 1, len / width);
    if (i > 0) { const k = i * 2; idx.push(k - 2, k, k - 1, k - 1, k, k + 1); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}
/** Break long straight runs into short pieces so curves and texture tiling look right. */
function smooth(pts: XY[]): XY[] {
  const out: XY[] = [];
  for (let i = 0; i < pts.length - 1; i++) { const n = Math.max(1, Math.ceil(Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]) / 1.5)); for (let k = 0; k < n; k++) out.push([pts[i][0] + ((pts[i + 1][0] - pts[i][0]) * k) / n, pts[i][1] + ((pts[i + 1][1] - pts[i][1]) * k) / n]); }
  out.push(pts[pts.length - 1]);
  return out;
}

function paintGround(wpx: number): HTMLCanvasElement {
  const cv = document.createElement('canvas'), s = wpx / W; cv.width = wpx; cv.height = Math.round(s * H);
  const c = cv.getContext('2d')!;
  const base = [['#8fae62', '#88a85c', '#97b46a', '#82a257'], ['#a6b47c', '#a0af76', '#adb984', '#9aaa70'], ['#c4bfa2', '#bfba9c', '#c9c4a8', '#bab597'], ['#a09c95', '#9a968f', '#a6a29b', '#94908a'], ['#b5ae9b', '#b0a996', '#bab3a1', '#aba491']];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { c.fillStyle = base[GROUND[y * W + x]][Math.floor(hash(x, y) * 4)]; c.fillRect(x * s, y * s, s + 1, s + 1); }
  // soft blotches break up the tile grid
  for (let i = 0; i < 7000; i++) { const x = hash(i, 1, 9) * cv.width, y = hash(i, 2, 9) * cv.height; c.fillStyle = ['rgba(120,150,80,.07)', 'rgba(200,190,130,.07)', 'rgba(90,120,60,.06)', 'rgba(215,200,150,.06)'][i % 4]; c.beginPath(); c.ellipse(x, y, s * (0.5 + hash(i, 3, 9) * 1.8), s * (0.3 + hash(i, 4, 9) * 1.2), hash(i, 5, 9) * 3, 0, 7); c.fill(); }
  // dry ranch country to the west
  const dry = c.createLinearGradient(0, 0, cv.width * 0.32, 0); dry.addColorStop(0, 'rgba(196,168,108,.34)'); dry.addColorStop(1, 'rgba(196,168,108,0)'); c.fillStyle = dry; c.fillRect(0, 0, cv.width * 0.32, cv.height);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const g = GROUND[y * W + x], px = x * s, py = y * s;
    if (g === 0 && blockAt(x, y) !== 2) {
      // farm fields and pasture
      for (let k = 0; k < 2; k++) if (hash(x, y, 70 + k) < 0.42) {
        const fw = s * (0.3 + hash(x, y, 71 + k) * 0.5), fh = s * (0.25 + hash(x, y, 73 + k) * 0.45), fx = px + hash(x, y, 75 + k) * (s - fw), fy = py + hash(x, y, 77 + k) * (s - fh);
        c.fillStyle = ['#93ad62', '#c9bb7c', '#a98e5c', '#b7c47f', '#86a35a'][Math.floor(hash(x, y, 79 + k) * 5)]; c.globalAlpha = 0.75; c.fillRect(fx, fy, fw, fh);
        c.globalAlpha = 0.16; c.strokeStyle = '#3d3a22'; c.lineWidth = 1; const vert = hash(x, y, 81 + k) < 0.5;
        for (let q = 3; q < (vert ? fw : fh); q += 4) { c.beginPath(); if (vert) { c.moveTo(fx + q, fy); c.lineTo(fx + q, fy + fh); } else { c.moveTo(fx, fy + q); c.lineTo(fx + fw, fy + q); } c.stroke(); }
        c.globalAlpha = 1;
      }
    } else if (g === 1 || g === 2) {
      // neighborhood streets
      const n = g === 2 ? 4 : 3; c.strokeStyle = g === 2 ? '#a9a394' : '#b3ae9c'; c.lineWidth = Math.max(1.5, s * 0.035);
      for (let q = 0; q < n; q++) { c.beginPath(); c.moveTo(px, py + (q + 0.5) * (s / n)); c.lineTo(px + s, py + (q + 0.5) * (s / n)); c.moveTo(px + (q + 0.5) * (s / n), py); c.lineTo(px + (q + 0.5) * (s / n), py + s); c.stroke(); }
    } else if (g === 3) {
      c.fillStyle = '#8c8984'; c.fillRect(px, py, s + 1, s + 1); c.strokeStyle = '#6b6965'; c.lineWidth = Math.max(2, s * 0.06);
      for (let q = 0; q <= 4; q++) { c.beginPath(); c.moveTo(px, py + q * (s / 4)); c.lineTo(px + s, py + q * (s / 4)); c.moveTo(px + q * (s / 4), py); c.lineTo(px + q * (s / 4), py + s); c.stroke(); }
    } else if (g === 4) {
      for (let k = 0; k < 3; k++) { c.fillStyle = k % 2 ? '#a7a091' : '#9d968a'; c.fillRect(px + hash(x, y, 90 + k) * s * 0.5, py + hash(x, y, 93 + k) * s * 0.5, s * (0.3 + hash(x, y, 96 + k) * 0.3), s * (0.25 + hash(x, y, 99 + k) * 0.3)); }
    }
  }
  const path = (pts: XY[]) => { c.beginPath(); pts.forEach((p, i) => (i ? c.lineTo(p[0] * s, p[1] * s) : c.moveTo(p[0] * s, p[1] * s))); };
  c.lineJoin = c.lineCap = 'round';
  for (const r of RIVERS) { path(r); c.strokeStyle = 'rgba(84,122,66,.55)'; c.lineWidth = s * 0.9; c.stroke(); path(r); c.strokeStyle = '#6fa2b5'; c.lineWidth = s * 0.3; c.stroke(); }
  // tree-green margin and a sandy shore around every lake
  for (const [grow, col] of [[1.2, 'rgba(84,122,66,.4)'], [1.07, '#cdbf94']] as [number, string][]) for (const l of LAKES) { c.beginPath(); for (let i = 0; i <= 28; i++) { const a = (i / 28) * Math.PI * 2, wob = 1 + 0.12 * Math.sin((i % 28) * 2.3 + l.x), x = (l.x + Math.cos(a) * (l.rx * wob * grow + (grow - 1) * 0.5)) * s, y = (l.y + Math.sin(a) * (l.ry * wob * grow + (grow - 1) * 0.5)) * s; if (i) c.lineTo(x, y); else c.moveTo(x, y); } c.fillStyle = col; c.fill(); }
  for (const l of LAKES) { c.beginPath(); for (let i = 0; i <= 28; i++) { const a = (i / 28) * Math.PI * 2, wob = 1 + 0.12 * Math.sin((i % 28) * 2.3 + l.x); const x = (l.x + Math.cos(a) * l.rx * wob) * s, y = (l.y + Math.sin(a) * l.ry * wob) * s; if (i) c.lineTo(x, y); else c.moveTo(x, y); } c.fillStyle = '#6fa2b5'; c.fill(); c.strokeStyle = '#cdbf94'; c.lineWidth = s * 0.14; c.stroke(); }
  for (const a of AIRPORTS) {
    c.fillStyle = '#b3ad9f'; c.fillRect(a.x * s, a.y * s, a.w * s, a.h * s);
    const n = Math.max(1, Math.round(a.w));
    for (let i = 0; i < n; i++) { const rx = (a.x + 0.3 + i * (a.w / n)) * s; c.fillStyle = '#5d5b57'; c.fillRect(rx, (a.y + 0.12) * s, s * 0.2, (a.h - 0.24) * s); c.strokeStyle = '#f1ecdc'; c.lineWidth = 2; c.setLineDash([s * 0.12, s * 0.1]); c.beginPath(); c.moveTo(rx + s * 0.1, (a.y + 0.2) * s); c.lineTo(rx + s * 0.1, (a.y + a.h - 0.2) * s); c.stroke(); c.setLineDash([]); }
    c.fillStyle = '#8f8a80'; c.fillRect((a.x + a.w * 0.5 - 0.1) * s, (a.y + a.h * 0.4) * s, s * 0.2, s * 0.25);
  }
  return cv;
}

/** Smooth random field, 0 to 1. */
function noise(x: number, y: number, seed = 0): number {
  const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi, u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  const a = hash(xi, yi, seed), b = hash(xi + 1, yi, seed), c = hash(xi, yi + 1, seed), d = hash(xi + 1, yi + 1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
const fbm = (x: number, y: number, seed = 0) => noise(x, y, seed) * 0.55 + noise(x * 2.1, y * 2.1, seed + 1) * 0.3 + noise(x * 4.3, y * 4.3, seed + 2) * 0.15;
/** A normal map built from a height function, so flat ground and water catch the light as if they had shape. */
function normalTex(n: number, height: (u: number, v: number) => number, strength: number, repeat: boolean): THREE.Texture {
  const cv = document.createElement('canvas'); cv.width = cv.height = n; const c = cv.getContext('2d')!, img = c.createImageData(n, n), e = 1 / n;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const u = x / n, v = y / n, dx = (height(u - e, v) - height(u + e, v)) * strength, dy = (height(u, v - e) - height(u, v + e)) * strength, l = Math.hypot(dx, dy, 1), i = (y * n + x) * 4;
    img.data[i] = (dx / l * 0.5 + 0.5) * 255; img.data[i + 1] = (-dy / l * 0.5 + 0.5) * 255; img.data[i + 2] = (1 / l * 0.5 + 0.5) * 255; img.data[i + 3] = 255;
  }
  c.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.NoColorSpace; if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

const roadTex = (lanes: number, median: boolean) => canvasTex(128, 128, (c) => {
  c.fillStyle = '#4c4a47'; c.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 400; i++) { c.fillStyle = i % 2 ? 'rgba(255,255,255,.04)' : 'rgba(0,0,0,.06)'; c.fillRect(hash(i, 1, 5) * 128, hash(i, 2, 5) * 128, 2, 2); }
  c.fillStyle = '#efe9d6'; c.fillRect(5, 0, 3, 128); c.fillRect(120, 0, 3, 128);
  if (median) { c.fillStyle = '#8b9a66'; c.fillRect(58, 0, 12, 128); c.fillStyle = '#e8c53a'; c.fillRect(55, 0, 2.5, 128); c.fillRect(70.5, 0, 2.5, 128); } else { c.fillStyle = '#e8c53a'; c.fillRect(62, 0, 2, 128); c.fillRect(66, 0, 2, 128); }
  c.fillStyle = '#efe9d6';
  const half = median ? 47 : 54;
  for (let l = 1; l < lanes; l++) { c.fillRect(8 + (half / lanes) * l, 0, 2, 56); c.fillRect(120 - (half / lanes) * l, 0, 2, 56); }
}, true);

export class Map3D {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(34, 1, 0.1, 800);
  private atmos!: Atmosphere;
  private gfx: Gfx = { cycle: true, weather: true, quality: 'auto' };
  private level: 'high' | 'medium' | 'low' = 'high'; // what is actually running; 'auto' steps this down on slow devices
  private composer: EffectComposer | null = null;
  private ao: GTAOPass | null = null; private bloom: UnrealBloomPass | null = null;
  private slow = 0; private warm = 0; private nightApplied = -1; private wetApplied = -1;
  private roadMats: THREE.MeshStandardMaterial[] = [];
  private water!: THREE.MeshStandardMaterial; private ripple!: THREE.Texture;
  private towerGlass: THREE.MeshStandardMaterial[] = [];
  private labels: HTMLCanvasElement;
  private lc: CanvasRenderingContext2D;
  private cam = { tx: W / 2, tz: H / 2, dist: 105, az: 0, pol: 0.62 };
  private view: View = { game: null, selParcel: null, overlay: 'none', visible: new Set(), pulse: null };
  private raf = 0;
  private hover: string | null = null;
  private pointers = new Map<number, { x: number; y: number }>();
  private drag: { x: number; y: number; moved: number; pinch: number; twist: number; mini: boolean; rotate: boolean } | null = null;
  private sites = new Map<string, { key: string; model: SiteModel; frame: THREE.Group; frameKey: string }>();
  private near: THREE.Object3D[] = []; // scenery hidden when far away
  private flood!: THREE.InstancedMesh;
  private trucks: { road: number; t: number; speed: number; dir: 1 | -1 }[] = [];
  private truckBody!: THREE.InstancedMesh; private truckCab!: THREE.InstancedMesh;
  private roadLen: { seg: number[]; total: number }[] = [];
  private mini: HTMLCanvasElement | null = null;
  private ray = new THREE.Raycaster();
  private plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private pulseRing: THREE.Group | null = null;
  private last = 0;
  private started = false;
  onSelect: (parcelId: string | null) => void = () => {};

  constructor(private canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.shadowMap.enabled = true; this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping; this.renderer.toneMappingExposure = 0.95;
    this.labels = document.createElement('canvas');
    this.labels.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none';
    canvas.parentElement!.insertBefore(this.labels, canvas.nextSibling);
    this.lc = this.labels.getContext('2d')!;

    this.atmos = new Atmosphere(this.scene, this.renderer, W, H);
    this.atmos.sun.shadow.mapSize.set(4096, 4096);
    try { this.setupPost(); } catch { this.composer = null; }

    this.buildGround(); this.buildScenery(); this.buildTraffic(); this.buildLife();
    canvas.addEventListener('pointerdown', this.down); canvas.addEventListener('pointermove', this.move);
    canvas.addEventListener('pointerup', this.up); canvas.addEventListener('pointercancel', this.up);
    canvas.addEventListener('pointerleave', () => { this.hover = null; });
    canvas.addEventListener('wheel', this.wheel, { passive: false });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('keydown', this.key);
    this.raf = requestAnimationFrame(this.frame);
  }
  destroy() { cancelAnimationFrame(this.raf); window.removeEventListener('keydown', this.key); this.labels.remove(); this.atmos.dispose(); this.composer?.dispose(); this.renderer.dispose(); }

  // ----- picture quality -----
  private setupPost() {
    const rt = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(this.renderer, rt);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    // soft shading where surfaces meet: under eaves, between buildings, at the foot of walls
    this.ao = new GTAOPass(this.scene, this.camera, 4, 4);
    this.ao.blendIntensity = 0.9;
    this.ao.updateGtaoMaterial({ radius: 0.09, distanceExponent: 1.4, thickness: 1.2, scale: 1.25, samples: 12, distanceFallOff: 1, screenSpaceRadius: false });
    this.ao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 4, radiusExponent: 1, rings: 2, samples: 12 });
    this.composer.addPass(this.ao);
    // glow around the sun, lit windows, street lights and headlights
    this.bloom = new UnrealBloomPass(new THREE.Vector2(4, 4), 0.5, 0.55, 1.6);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
  }
  setGfx(g: Partial<Gfx>) {
    Object.assign(this.gfx, g);
    if (g.quality) { this.level = g.quality === 'auto' ? 'high' : g.quality; this.slow = 0; this.warm = 0; this.canvas.width = 0; }
  }
  /** Clock and weather, for the chip next to the map controls. */
  status() { return this.atmos.status(); }
  skipTime(hours: number) { this.atmos.skip(hours); }
  debugSky(o: { hour?: number; weather?: Weather }) { this.atmos.set(o); }
  quality() { return this.level; }
  setView(v: Partial<View>) {
    const first = !this.view.game && !!v.game;
    Object.assign(this.view, v);
    if (first) { this.started = true; this.focusParcel('bluemound', 1); }
    if (v.game === null) { this.started = false; this.cam = { tx: W / 2, tz: H / 2 + 4, dist: 95, az: 0, pol: 0.75 }; }
  }

  // ----- world building -----
  private buildGround() {
    const max = this.renderer.capabilities.maxTextureSize;
    const tex = new THREE.CanvasTexture(paintGround(max >= 4096 ? 4096 : 2048)); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(W, H).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: tex, roughness: 1, normalMap: normalTex(512, (u, v) => fbm(u * 26, v * 20, 31), 26, false), normalScale: new THREE.Vector2(0.4, 0.4) }));
    ground.position.set(W / 2, 0, H / 2); ground.receiveShadow = true; this.scene.add(ground);
    // a fine-grain layer keeps the ground crisp up close, where the big texture runs out of pixels
    const grain = canvasTex(256, 256, (c) => { c.clearRect(0, 0, 256, 256); for (let i = 0; i < 5200; i++) { const dark = i % 3 !== 0; c.fillStyle = dark ? `rgba(60,80,35,${0.1 + hash(i, 1, 2) * 0.22})` : `rgba(235,225,170,${0.08 + hash(i, 2, 2) * 0.2})`; const x = hash(i, 3, 2) * 256, y = hash(i, 4, 2) * 256; if (i % 5 === 0) { c.fillRect(x, y, 1.2, 4 + hash(i, 5, 2) * 5); } else c.fillRect(x, y, 1.5 + hash(i, 6, 2) * 2.5, 1.5 + hash(i, 7, 2) * 2.5); } }, true);
    grain.repeat.set(W * 2.5, H * 2.5);
    const detail = new THREE.Mesh(new THREE.PlaneGeometry(W, H).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: grain, transparent: true, roughness: 1, depthWrite: false }));
    detail.position.set(W / 2, 0.003, H / 2); detail.receiveShadow = true; this.scene.add(detail);
    // beyond the map the land rolls away into low hills, so the horizon is not a flat line
    const og = new THREE.PlaneGeometry(1500, 1500, 150, 150).rotateX(-Math.PI / 2), op = og.attributes.position as THREE.BufferAttribute, ocol = new Float32Array(op.count * 3), lo = new THREE.Color('#8ea763'), mid = new THREE.Color('#a39a62'), hi = new THREE.Color('#7f8f78'), tmp = new THREE.Color();
    for (let i = 0; i < op.count; i++) {
      const x = op.getX(i) + W / 2, z = op.getZ(i) + H / 2, d = Math.hypot(Math.max(0, -x, x - W), Math.max(0, -z, z - H));
      const k = Math.max(0, Math.min(1, (d - 10) / 90)), ht = k * k * (3 - 2 * k) * (1.2 + fbm(x * 0.022 + 40, z * 0.022 + 40, 5) * 15) * (0.5 + noise(x * 0.006 + 9, z * 0.006 + 9, 8));
      op.setY(i, -0.03 + ht);
      tmp.copy(lo).lerp(mid, Math.min(1, ht / 3.5)).lerp(hi, Math.max(0, Math.min(1, (ht - 3) / 6))); tmp.multiplyScalar(0.9 + noise(x * 0.07, z * 0.07, 3) * 0.2); ocol.set([tmp.r, tmp.g, tmp.b], i * 3);
    }
    og.setAttribute('color', new THREE.BufferAttribute(ocol, 3)); og.computeVertexNormals();
    const outer = new THREE.Mesh(og, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }));
    outer.position.set(W / 2, 0, H / 2); this.scene.add(outer);

    // water: dark and glassy, with ripples that drift and a sky to reflect
    const TAU = Math.PI * 2, waves: [number, number, number, number][] = [[2, 1, 0.5, 0.3], [-1, 3, 0.4, 1.7], [4, -3, 0.25, 4.1], [-5, -2, 0.2, 2.2], [7, 4, 0.12, 5.3], [-3, 8, 0.1, 0.9], [9, -7, 0.07, 3.3]];
    this.ripple = normalTex(256, (u, v) => waves.reduce((h, [a, b, amp, ph]) => h + Math.sin((u * a + v * b) * TAU + ph + Math.sin((u * b - v * a) * TAU) * 0.8) * amp, 0), 5, true);
    this.ripple.repeat.set(0.45, 0.45);
    const water = this.water = new THREE.MeshStandardMaterial({ color: '#4b8ba6', roughness: 0.1, metalness: 0.45, normalMap: this.ripple, normalScale: new THREE.Vector2(0.22, 0.22), envMapIntensity: 1.5 });
    for (const l of LAKES) { const sh = new THREE.Shape(); for (let i = 0; i < 28; i++) { const a = (i / 28) * Math.PI * 2, wob = 1 + 0.12 * Math.sin(i * 2.3 + l.x); const x = l.x + Math.cos(a) * l.rx * wob, z = l.y + Math.sin(a) * l.ry * wob; if (i) sh.lineTo(x, -z); else sh.moveTo(x, -z); } const m = new THREE.Mesh(new THREE.ShapeGeometry(sh).rotateX(-Math.PI / 2), water); m.position.y = 0.007; m.receiveShadow = true; this.scene.add(m); }
    RIVERS.forEach((r, i) => { const m = new THREE.Mesh(ribbon(smooth(r), i === 0 ? 0.3 : 0.18, 0.008), water); m.receiveShadow = true; this.scene.add(m); });

    const mk = (t: THREE.Texture) => new THREE.MeshStandardMaterial({ map: t, roughness: 0.95 });
    const mats = { interstate: mk(roadTex(3, true)), highway: mk(roadTex(2, false)), arterial: mk(canvasTex(64, 64, (c) => { c.fillStyle = '#6a6762'; c.fillRect(0, 0, 64, 64); c.fillStyle = '#e8c53a'; c.fillRect(30, 0, 3, 34); c.fillStyle = '#d9d4c4'; c.fillRect(2, 0, 2, 64); c.fillRect(60, 0, 2, 64); }, true)) };
    this.roadMats = Object.values(mats);
    const railMat = mk(canvasTex(64, 32, (c) => { c.fillStyle = '#8f887c'; c.fillRect(0, 0, 64, 32); c.fillStyle = '#4b3a2a'; c.fillRect(8, 4, 48, 8); c.fillRect(8, 20, 48, 8); c.fillStyle = '#c9ccd0'; c.fillRect(18, 0, 3, 32); c.fillRect(43, 0, 3, 32); }, true));
    for (const r of RAILS) { const m = new THREE.Mesh(ribbon(smooth(r), 0.07, 0.014), railMat); m.receiveShadow = true; this.scene.add(m); }
    const order = { arterial: 0, highway: 1, interstate: 2 } as const;
    [...ROADS].sort((a, b) => order[a.kind] - order[b.kind]).forEach((r) => {
      const m = new THREE.Mesh(ribbon(smooth(r.pts), r.kind === 'interstate' ? 0.24 : r.kind === 'highway' ? 0.16 : 0.09, 0.018 + order[r.kind] * 0.004), mats[r.kind]);
      m.receiveShadow = true; this.scene.add(m);
    });

    const cells = [...FLOOD];
    this.flood = new THREE.InstancedMesh(FLAT, new THREE.MeshBasicMaterial({ color: '#3f87b5', transparent: true, opacity: 0.4, depthWrite: false }), cells.length);
    const o = new THREE.Object3D();
    cells.forEach((i, k) => { o.position.set((i % W) + 0.5, 0.03, Math.floor(i / W) + 0.5); o.updateMatrix(); this.flood.setMatrixAt(k, o.matrix); });
    this.flood.visible = false; this.scene.add(this.flood);
  }

  private buildScenery() {
    type Item = [x: number, y: number, z: number, w: number, h: number, d: number, rot: number, color: string];
    const CH = 12, chunks = new Map<string, Record<string, Item[]>>();
    const put = (kind: string, it: Item) => { const key = `${Math.floor(it[0] / CH)},${Math.floor(it[2] / CH)}`; let c = chunks.get(key); if (!c) chunks.set(key, (c = {})); (c[kind] ??= []).push(it); };
    const WALLS = ['#efe6d4', '#e2d3bb', '#d9c4a6', '#c9a98c', '#e9e1d2', '#b98f73'], ROOFS = ['#8a4f3c', '#6f5a4a', '#5f666d', '#7d5b41', '#4f5459', '#9a6a4c'];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const b = blockAt(x, y);
      if (b === 2 || b === 3 || isTaken(x, y)) continue;
      const g = GROUND[y * W + x], u = urbanity(x, y), onRoad = b !== 0;
      if (g === 3) {
        const core = CITIES.filter((c) => c.core).reduce((m, c) => Math.min(m, Math.hypot(x + 0.5 - c.x, y + 0.5 - c.y)), 9);
        for (let k = 0; k < 9; k++) {
          if (hash(x, y, 30 + k) < (onRoad ? 0.55 : 0.2)) continue;
          const fw = 0.14 + hash(x, y, 40 + k) * 0.08, ht = Math.max(0.25, (0.35 + hash(x, y, 50 + k) * 1.5) * (1.5 - core * 0.55) * (hash(x, y, 60 + k) < 0.12 ? 1.7 : 1));
          const cx = x + 0.17 + (k % 3) * 0.33, cz = y + 0.17 + Math.floor(k / 3) * 0.33, tint = ['#c9d6dd', '#e6dcc8', '#9fc0d6', '#f0ece2', '#7f9db3', '#d2b48f', '#b8c9c2'][Math.floor(hash(x, y, 70 + k) * 7)];
          put('tower', [cx, 0, cz, fw, ht, fw, 0, tint]);
          if (ht > 0.85) { put('tower', [cx, ht, cz, fw * 0.66, ht * 0.28, fw * 0.66, 0, tint]); if (hash(x, y, 80 + k) < 0.45) { put('box', [cx, ht * 1.28, cz, 0.012, 0.16 + hash(x, y, 81 + k) * 0.2, 0.012, 0, '#d5d9dc']); put('beacon', [cx, ht * 1.28 + 0.36, cz, 0.02, 0.02, 0.02, 0, '#ffffff']); } else put('box', [cx, ht * 1.28, cz, fw * 0.4, 0.03, fw * 0.3, 0, '#8d9499']); }
          else { put('box', [cx - fw * 0.15, ht, cz, fw * 0.45, 0.025, fw * 0.35, 0, '#8d9499']); if (hash(x, y, 82 + k) < 0.3) put('box', [cx + fw * 0.25, ht, cz + fw * 0.2, 0.03, 0.04, 0.03, 0, '#a9b0b5']); }
          put('box', [cx, 0, cz, fw * 1.25, 0.03, fw * 1.25, 0, '#cfc8b8']); // podium
        }
        continue;
      }
      if (onRoad) continue;
      const ind = industry(x, y);
      if (ind > 0) {
        let any = false;
        for (let q = 0; q < 3; q++) if (hash(x, y, 20 + q * 5) < ind * 1.6) { const turn = hash(x, y, 21 + q) < 0.3, bw = 0.26 + hash(x, y, 22 + q) * 0.12, bd = 0.14 + hash(x, y, 23 + q) * 0.08; put('ware', [x + 0.22 + (q % 2) * 0.5 + hash(x, y, 24 + q) * 0.06, 0, y + 0.18 + q * 0.3, bw, 0.05 + hash(x, y, 25 + q) * 0.035, bd, turn ? Math.PI / 2 : 0, ['#ffffff', '#f1ece0', '#e6ebee', '#f5efe2'][Math.floor(hash(x, y, 26 + q) * 4)]]); any = true; if (!turn) { const wx = x + 0.22 + (q % 2) * 0.5 + hash(x, y, 24 + q) * 0.06, wz = y + 0.18 + q * 0.3; for (let j = 0; j < 4; j++) if (hash(x, y, 130 + q * 4 + j) < 0.6) put('box', [wx - bw * 0.36 + j * (bw * 0.24), 0.006, wz + bd / 2 + 0.048, 0.02, 0.024, 0.085, 0, ['#f4f1ea', '#e8e4da', '#c9502f', '#3f6f8f', '#f4f1ea'][Math.floor(hash(x, y, 140 + j) * 5)]]); put('lamp', [wx, 0.04, wz + bd / 2 + 0.003, bw * 0.8, 0.004, 0.004, 0, '#ffffff']); } }
        if (any) { for (let k = 0; k < 4; k++) put('tree', [x + hash(x, y, 27 + k), 0, y + 0.92 + hash(x, y, 28 + k) * 0.07, 0.07, 0.08, 0.07, 0, '#6a8f52']); continue; }
      }
      if (u > 0.25) {
        const dense = u > 0.55, n = dense ? 4 : 3;
        for (let k = 0; k < n * n; k++) {
          if (hash(x, y, 2 + k) > (dense ? 0.9 : 0.55)) continue;
          const hx = x + (k % n + 0.5) / n + (hash(x, y, 12 + k) - 0.5) * 0.08, hz = y + (Math.floor(k / n) + 0.5) / n + (hash(x, y, 22 + k) - 0.5) * 0.08, turn = hash(x, y, 32 + k) < 0.5;
          const big = dense && u > 0.8 && hash(x, y, 42 + k) < 0.12;
          if (big) { put('tower', [hx, 0, hz, 0.13, 0.12 + hash(x, y, 43 + k) * 0.22, 0.11, 0, '#d9d2c2']); continue; }
          const hw = (dense ? 0.07 : 0.085) + hash(x, y, 52 + k) * 0.03, hd = dense ? 0.055 : 0.065, hh = 0.034 + hash(x, y, 62 + k) * 0.012;
          put('house', [hx, 0, hz, hw, hh, hd, turn ? Math.PI / 2 : 0, WALLS[Math.floor(hash(x, y, 72 + k) * WALLS.length)]]);
          put('roof', [hx, hh, hz, hw * 1.12, 0.026, hd * 1.16, turn ? Math.PI / 2 : 0, ROOFS[Math.floor(hash(x, y, 82 + k) * ROOFS.length)]]);
          if (hash(x, y, 102 + k) < 0.62) put('lamp', [hx, hh * 0.38, hz, hw * 0.42, 0.009, hd * 1.05, turn ? Math.PI / 2 : 0, '#ffffff']);
          if (dense && hash(x, y, 112 + k) < 0.1) put('pool', [hx - 0.05, 0.004, hz + 0.045, 0.035, 0.003, 0.022, 0, '#49b6d6']);
          if (hash(x, y, 92 + k) < 0.7) put('tree', [hx + 0.08, 0, hz + 0.07, 0.06 + hash(x, y, 93 + k) * 0.04, 0.07 + hash(x, y, 94 + k) * 0.04, 0.07, 0, hash(x, y, 95 + k) < 0.5 ? '#5f8a4c' : '#78a05c']);
        }
      } else {
        const wet = FLOOD.has(y * W + x), n = wet ? 12 : x < 22 ? 3 : 7;
        for (let k = 0; k < n; k++) if (hash(x, y, 4 + k * 7) < (wet ? 0.8 : 0.45)) { const s = 0.07 + hash(x, y, 8 + k) * 0.07; put('tree', [x + hash(x, y, 6 + k), 0, y + hash(x, y, 16 + k), s, s * (1 + hash(x, y, 9 + k) * 0.5), s, 0, ['#5f8a4c', '#6e9455', '#567f47', '#7d9f5e'][Math.floor(hash(x, y, 10 + k) * 4)]]); }
        if (hash(x, y, 55) < 0.07) { const bx = x + 0.3 + hash(x, y, 56) * 0.4, bz = y + 0.3 + hash(x, y, 57) * 0.4; put('house', [bx, 0, bz, 0.12, 0.05, 0.08, 0, '#9c3b2e']); put('roof', [bx, 0.05, bz, 0.135, 0.035, 0.095, 0, '#d9d4c8']); put('silo', [bx + 0.1, 0, bz, 0.035, 0.09, 0.035, 0, '#c9ccd0']); put('house', [bx - 0.14, 0, bz + 0.06, 0.07, 0.03, 0.05, 0, '#efe6d4']); put('roof', [bx - 0.14, 0.03, bz + 0.06, 0.08, 0.022, 0.058, 0, '#6f5a4a']); }
      }
    }
    for (const a of AIRPORTS) { put('ware', [a.x + a.w / 2, 0, a.y + a.h * 0.52, 0.5 * Math.min(1.6, a.w), 0.07, 0.16, 0, '#dfe4e6']); put('tower', [a.x + a.w / 2 + 0.2, 0, a.y + a.h * 0.42, 0.05, 0.3, 0.05, 0, '#d9d2c2']); }
    INTERMODALS.forEach(([ix, iy], n) => { for (let i = 0; i < 60; i++) { const lv = i % 3; put('box', [ix - 0.6 + (Math.floor(i / 3) % 5) * 0.2, lv * 0.03, iy - 0.8 + Math.floor(i / 15) * 0.1, 0.14, 0.03, 0.035, 0, ['#c9502f', '#3f6f8f', '#e0b23f', '#5c8a5a', '#7d4b8f', '#d9d4c8'][Math.floor(hash(i, n, 7) * 6)]]); } put('box', [ix, 0, iy - 0.2, 1.1, 0.012, 0.02, 0, '#d9a520']); put('box', [ix - 0.5, 0, iy - 0.2, 0.02, 0.2, 0.02, 0, '#d9a520']); put('box', [ix + 0.5, 0, iy - 0.2, 0.02, 0.2, 0.02, 0, '#d9a520']); put('box', [ix, 0.2, iy - 0.2, 1.1, 0.02, 0.03, 0, '#d9a520']); });

    // trees crowd the river banks and lake shores
    const free = (px: number, pz: number) => px > 0.5 && pz > 0.5 && px < W - 0.5 && pz < H - 0.5 && blockAt(Math.floor(px), Math.floor(pz)) !== 1 && blockAt(Math.floor(px), Math.floor(pz)) !== 3 && !isTaken(Math.floor(px), Math.floor(pz)) && GROUND[Math.floor(pz) * W + Math.floor(px)] !== 3;
    const GREENS = ['#4f7f45', '#5f8a4c', '#6e9455', '#47743f', '#7d9f5e'];
    RIVERS.forEach((r, ri) => { const pts = smooth(r); for (let i = 0; i < pts.length - 1; i++) { const [ax, az] = pts[i], [bx, bz] = pts[i + 1], len = Math.hypot(bx - ax, bz - az) || 1, nx = -(bz - az) / len, nz = (bx - ax) / len; for (let k = 0; k < len * 9; k++) { const f = hash(i, k, 200 + ri), off = (0.2 + hash(i, k, 201 + ri) * 0.42) * (hash(i, k, 202 + ri) < 0.5 ? 1 : -1), px = ax + (bx - ax) * f + nx * off, pz = az + (bz - az) * f + nz * off, sz = 0.07 + hash(i, k, 203 + ri) * 0.08; if (free(px, pz)) put('tree', [px, 0, pz, sz, sz * (1.1 + hash(i, k, 204) * 0.5), sz, 0, GREENS[Math.floor(hash(i, k, 205) * 5)]]); } } });
    LAKES.forEach((l, li) => { for (let i = 0; i < 46 * Math.max(l.rx, l.ry); i++) { const a = hash(i, li, 210) * Math.PI * 2, wob = 1 + 0.12 * Math.sin(((a / (Math.PI * 2)) * 28) * 2.3 + l.x), g = 1.12 + hash(i, li, 211) * 0.3, px = l.x + Math.cos(a) * (l.rx * wob * g + 0.08), pz = l.y + Math.sin(a) * (l.ry * wob * g + 0.08), sz = 0.07 + hash(i, li, 212) * 0.07; if (free(px, pz)) put(hash(i, li, 213) < 0.25 ? 'pine' : 'tree', [px, 0, pz, sz, sz * 1.5, sz, 0, GREENS[Math.floor(hash(i, li, 214) * 5)]]); } });
    // every Texas town has a water tower
    for (const c of CITIES) { if (c.core) continue; const px = c.x + 0.36, pz = c.y + 0.3; if (!free(px, pz)) continue; put('silo', [px, 0, pz, 0.026, 0.19, 0.026, 0, '#dfe5e8']); put('ball', [px, 0.16, pz, 0.12, 0.085, 0.12, 0, hash(Math.round(c.x), Math.round(c.y), 5) < 0.5 ? '#eef2f4' : '#bfd9e6']); }
    // landmarks: a ball-topped observation tower downtown, and a domed stadium
    const dal = CITIES.find((c) => c.name === 'Dallas'), arl = CITIES.find((c) => c.name === 'Arlington');
    if (dal) { put('silo', [dal.x - 0.75, 0, dal.y + 0.55, 0.035, 1.35, 0.035, 0, '#c9ccd0']); put('ball', [dal.x - 0.75, 1.3, dal.y + 0.55, 0.2, 0.2, 0.2, 0, '#e3e9ec']); put('beacon', [dal.x - 0.75, 1.5, dal.y + 0.55, 0.03, 0.03, 0.03, 0, '#ffffff']); }
    if (arl && free(arl.x + 0.8, arl.y - 0.5)) { put('silo', [arl.x + 0.8, 0, arl.y - 0.5, 0.52, 0.11, 0.52, 0, '#e6e9ec']); put('ball', [arl.x + 0.8, 0.06, arl.y - 0.5, 0.5, 0.2, 0.5, 0, '#f1f3f4']); }
    // transmission lines across the open country
    for (const [x0, z0, x1, z1] of [[6, 14, 44, 3], [8, 58, 40, 72], [70, 8, 92, 30], [62, 70, 92, 52]]) { const n = Math.round(Math.hypot(x1 - x0, z1 - z0) / 1.1), ang = Math.atan2(x1 - x0, z1 - z0); for (let i = 0; i <= n; i++) { const px = x0 + ((x1 - x0) * i) / n, pz = z0 + ((z1 - z0) * i) / n; if (!free(px, pz) || urbanity(Math.floor(px), Math.floor(pz)) > 0.45) continue; put('box', [px, 0, pz, 0.014, 0.24, 0.014, 0, '#9aa0a4']); put('box', [px, 0.2, pz, 0.11, 0.006, 0.008, ang, '#9aa0a4']); put('box', [px, 0.15, pz, 0.08, 0.006, 0.008, ang, '#9aa0a4']); } }
    // cattle on the western ranch land
    for (let y = 0; y < H; y++) for (let x = 0; x < 34; x++) if (GROUND[y * W + x] === 0 && blockAt(x, y) === 0 && !isTaken(x, y) && hash(x, y, 220) < 0.16) for (let k = 0; k < 7; k++) put('cow', [x + 0.3 + hash(x, y, 221 + k) * 0.4, 0.006, y + 0.3 + hash(x, y, 231 + k) * 0.4, 0.012, 0.012, 0.022, hash(x, y, 241 + k) * 6, ['#3a2e26', '#6b4a32', '#e9e4d8', '#2a2623'][Math.floor(hash(x, y, 251 + k) * 4)]]);
    // street lights along the freeways
    ROADS.forEach((r) => { if (r.kind === 'arterial') return; const pts = smooth(r.pts), half = (r.kind === 'interstate' ? 0.12 : 0.08) + 0.018; let acc = 0, side = 1; for (let i = 0; i < pts.length - 1; i++) { const [ax, az] = pts[i], [bx, bz] = pts[i + 1], len = Math.hypot(bx - ax, bz - az) || 1; acc += len; if (acc < 0.55) continue; acc = 0; side = -side; const px = ax - ((bz - az) / len) * half * side, pz = az + ((bx - ax) / len) * half * side; if (px < 0 || pz < 0 || px >= W || pz >= H) continue; put('box', [px, 0, pz, 0.006, 0.075, 0.006, 0, '#5a6066']); put('lamp', [px + ((bz - az) / len) * 0.012 * side, 0.074, pz - ((bx - ax) / len) * 0.012 * side, 0.022, 0.004, 0.022, 0, '#ffffff']); } });

    const t = siteTex();
    const rep = (tx: THREE.Texture, rx: number, ry: number) => { const c = tx.clone(); c.repeat.set(rx, ry); c.needsUpdate = true; return c; };
    const wall = new THREE.MeshStandardMaterial({ map: rep(t.wall, 4, 1), roughness: 0.9 }), dock = new THREE.MeshStandardMaterial({ map: rep(t.dock, 5, 1), roughness: 0.9 }), roof = new THREE.MeshStandardMaterial({ map: rep(t.roof, 3, 2), roughness: 0.8 });
    const win = canvasTex(64, 128, (c) => { c.fillStyle = '#ffffff'; c.fillRect(0, 0, 64, 128); for (let yy = 0; yy < 16; yy++) for (let xx = 0; xx < 4; xx++) { c.fillStyle = hash(xx, yy, 3) < 0.22 ? '#f6e3a8' : hash(xx, yy, 4) < 0.5 ? '#5d7f96' : '#6f93aa'; c.fillRect(xx * 16 + 2, yy * 8 + 1.5, 12, 5); } }, true);
    const winLit = canvasTex(64, 128, (c) => { c.fillStyle = '#000'; c.fillRect(0, 0, 64, 128); for (let yy = 0; yy < 16; yy++) for (let xx = 0; xx < 4; xx++) { const r = hash(xx, yy, 3), q = hash(xx, yy, 9); if (r < 0.22 || q < 0.3) { c.fillStyle = q < 0.06 ? '#cfe6ff' : r < 0.22 ? '#ffe0a8' : '#ffc878'; c.fillRect(xx * 16 + 2, yy * 8 + 1.5, 12, 5); } } }, true);
    const glass = new THREE.MeshStandardMaterial({ map: rep(win, 2, 5), roughness: 0.16, metalness: 0.5, envMapIntensity: 1.35, emissive: '#ffffff', emissiveMap: rep(winLit, 2, 5), emissiveIntensity: 0 }), cap = mat('#8d9499');
    this.towerGlass.push(glass);
    const geo: Record<string, { g: THREE.BufferGeometry; m: THREE.Material | THREE.Material[]; near: boolean; shadow: boolean }> = {
      house: { g: UNIT, m: mat('#ffffff'), near: true, shadow: true },
      roof: { g: new THREE.ConeGeometry(0.707, 1, 4).rotateY(Math.PI / 4).translate(0, 0, 0), m: mat('#ffffff', { rough: 0.95 }), near: true, shadow: true },
      tree: { g: new THREE.IcosahedronGeometry(0.5, 1).translate(0, 0.1, 0), m: mat('#ffffff', { rough: 1 }), near: true, shadow: true },
      ware: { g: UNIT, m: [wall, wall, roof, roof, dock, wall], near: false, shadow: true },
      tower: { g: UNIT, m: [glass, glass, cap, cap, glass, glass], near: false, shadow: true },
      silo: { g: new THREE.CylinderGeometry(0.5, 0.5, 1, 10), m: mat('#ffffff', { metal: 0.4, rough: 0.5 }), near: true, shadow: true },
      box: { g: UNIT, m: mat('#ffffff'), near: false, shadow: true },
      pine: { g: new THREE.ConeGeometry(0.5, 1, 7), m: mat('#ffffff', { rough: 1 }), near: true, shadow: true },
      ball: { g: new THREE.SphereGeometry(0.5, 16, 10), m: mat('#ffffff', { rough: 0.5, metal: 0.2 }), near: false, shadow: true },
      cow: { g: UNIT, m: mat('#ffffff'), near: true, shadow: false },
      pool: { g: UNIT, m: mat('#ffffff', { rough: 0.15 }), near: true, shadow: false },
      lamp: { g: UNIT, m: GLOW, near: true, shadow: false },
      beacon: { g: UNIT, m: GLOW_RED, near: false, shadow: false },
    };
    const o = new THREE.Object3D(), col = new THREE.Color();
    for (const c of chunks.values()) for (const kind of Object.keys(c)) {
      const items = c[kind], def = geo[kind], im = new THREE.InstancedMesh(def.g, def.m, items.length);
      items.forEach(([x, y, z, w, h, d, r, color], i) => { o.position.set(x, y + h / 2, z); o.scale.set(w, h, d); o.rotation.set(0, r, 0); o.updateMatrix(); im.setMatrixAt(i, o.matrix); im.setColorAt(i, col.set(color)); });
      im.castShadow = def.shadow; im.receiveShadow = def.m !== GLOW && def.m !== GLOW_RED; im.computeBoundingSphere();
      if (def.near) this.near.push(im);
      this.scene.add(im);
    }
  }

  private buildTraffic() {
    this.roadLen = ROADS.map((r) => { const seg = r.pts.slice(1).map((p, i) => Math.hypot(p[0] - r.pts[i][0], p[1] - r.pts[i][1])); return { seg, total: seg.reduce((a, b) => a + b, 0) }; });
    ROADS.forEach((r, i) => { if (r.kind === 'arterial') return; const n = Math.max(3, Math.round(this.roadLen[i].total / 4)); for (let k = 0; k < n; k++) this.trucks.push({ road: i, t: hash(i, k, 3), speed: (0.35 + hash(i, k, 5) * 0.3) / this.roadLen[i].total, dir: k % 2 ? 1 : -1 }); });
    const n = this.trucks.length, col = new THREE.Color();
    this.truckBody = new THREE.InstancedMesh(UNIT, mat('#ffffff'), n); this.truckCab = new THREE.InstancedMesh(UNIT, mat('#ffffff'), n);
    for (let i = 0; i < n; i++) { this.truckBody.setColorAt(i, col.set(['#f4f1ea', '#f4f1ea', '#c9502f', '#3f6f8f', '#e0b23f', '#e8e4da'][i % 6])); this.truckCab.setColorAt(i, col.set(['#b3402e', '#2f5f8a', '#f0efe9', '#3d7a52', '#1f2327'][i % 5])); }
    this.truckBody.castShadow = this.truckCab.castShadow = true; this.truckBody.frustumCulled = this.truckCab.frustumCulled = false;
    this.scene.add(this.truckBody, this.truckCab);
  }
  private cars: { road: number; t: number; speed: number; dir: 1 | -1; lane: number }[] = [];
  private carBody!: THREE.InstancedMesh; private carTop!: THREE.InstancedMesh; private headLights!: THREE.InstancedMesh; private tailLights!: THREE.InstancedMesh;
  private trains: { rail: number; d: number; speed: number; seg: number[]; total: number }[] = [];
  private trainMesh!: THREE.InstancedMesh;
  private planes: { g: THREE.Group; x: number; z0: number; z1: number; ph: number }[] = [];
  private boats: { g: THREE.Group; x: number; z: number; rx: number; rz: number; ph: number; sp: number }[] = [];
  private static readonly TRAIN_LEN = 16;

  /** Cars, trains, planes and sailboats: the things that move without the player doing anything. */
  private buildLife() {
    const col = new THREE.Color();
    ROADS.forEach((r, i) => { const n = Math.round(this.roadLen[i].total * (r.kind === 'interstate' ? 2.2 : r.kind === 'highway' ? 1.3 : 0.7)); for (let k = 0; k < n; k++) this.cars.push({ road: i, t: hash(i, k, 13), speed: (0.5 + hash(i, k, 15) * 0.45) * (r.kind === 'arterial' ? 0.6 : 1) / this.roadLen[i].total, dir: k % 2 ? 1 : -1, lane: r.kind === 'interstate' ? 0.028 + (k % 3 === 0 ? 0.03 : 0) : r.kind === 'highway' ? 0.035 : 0.02 }); });
    const n = this.cars.length, CARC = ['#f4f1ea', '#b3402e', '#3d4248', '#2f5f8a', '#c9c5bb', '#1f2326', '#8a9198', '#e8e4da', '#7a1f1a', '#d9d4c8'];
    this.carBody = new THREE.InstancedMesh(UNIT, mat('#ffffff', { rough: 0.4, metal: 0.3 }), n); this.carTop = new THREE.InstancedMesh(UNIT, mat('#1d2a33', { rough: 0.15, metal: 0.5 }), n);
    for (let i = 0; i < n; i++) this.carBody.setColorAt(i, col.set(CARC[Math.floor(hash(i, 3, 17) * CARC.length)]));
    const lights = n + this.trucks.length;
    this.headLights = new THREE.InstancedMesh(UNIT, GLOW, lights); this.tailLights = new THREE.InstancedMesh(UNIT, GLOW_RED, lights);
    for (const m of [this.carBody, this.carTop, this.headLights, this.tailLights]) { m.frustumCulled = false; this.scene.add(m); }
    this.carBody.castShadow = true;

    RAILS.forEach((r, i) => { const seg = r.slice(1).map((p, k) => Math.hypot(p[0] - r[k][0], p[1] - r[k][1])), total = seg.reduce((a, b) => a + b, 0); if (total > 14) this.trains.push({ rail: i, d: hash(i, 1, 19) * total, speed: 0.22 + hash(i, 2, 19) * 0.1, seg, total }); });
    const L = Map3D.TRAIN_LEN, TR = ['#7a4a2e', '#5c6166', '#8a2f25', '#3f5f4a', '#c9a23a', '#4a4f55', '#2f4f6f'];
    this.trainMesh = new THREE.InstancedMesh(UNIT, mat('#ffffff', { rough: 0.6 }), this.trains.length * L);
    for (let i = 0; i < this.trains.length * L; i++) this.trainMesh.setColorAt(i, col.set(i % L < 2 ? '#e0762b' : TR[Math.floor(hash(i, 5, 21) * TR.length)]));
    this.trainMesh.castShadow = true; this.trainMesh.frustumCulled = false; this.scene.add(this.trainMesh);

    AIRPORTS.forEach((a, i) => {
      const g = new THREE.Group(), white = mat('#f4f5f6', { rough: 0.35, metal: 0.2 }), add = (w: number, h: number, d: number, x: number, y: number, z: number, m = white) => { const b = new THREE.Mesh(UNIT, m); b.scale.set(w, h, d); b.position.set(x, y, z); b.castShadow = true; g.add(b); };
      add(0.022, 0.022, 0.17, 0, 0, 0); add(0.18, 0.004, 0.032, 0, -0.002, 0.005); add(0.06, 0.004, 0.02, 0, 0.004, 0.075); add(0.004, 0.03, 0.026, 0, 0.018, 0.075, mat(['#2f5f8a', '#b3402e', '#e0762b'][i % 3])); add(0.012, 0.012, 0.03, 0.045, -0.01, 0); add(0.012, 0.012, 0.03, -0.045, -0.01, 0);
      this.scene.add(g); this.planes.push({ g, x: a.x + 0.4, z0: a.y + a.h - 0.16, z1: a.y + 0.16, ph: i * 13 });
      // a few more parked at the terminal
      for (let k = 0; k < Math.round(a.w * 2); k++) { const p = g.clone(); p.position.set(a.x + a.w / 2 - 0.25 + k * 0.22, 0.03, a.y + a.h * 0.52 + 0.2); p.rotation.y = Math.PI; this.scene.add(p); }
    });

    LAKES.forEach((l, i) => { for (let k = 0; k < Math.round(Math.min(5, l.rx * l.ry * 1.6)); k++) {
      const g = new THREE.Group(), hull = new THREE.Mesh(UNIT, mat('#f4f1ea')), sail = new THREE.Mesh(new THREE.ConeGeometry(0.5, 1, 3), mat(['#ffffff', '#f2c230', '#d9622b', '#ffffff'][(i + k) % 4]));
      hull.scale.set(0.014, 0.008, 0.05); hull.position.y = 0.012; sail.scale.set(0.006, 0.06, 0.04); sail.position.set(0, 0.046, 0.002); sail.castShadow = true; g.add(hull, sail); this.scene.add(g);
      this.boats.push({ g, x: l.x + (hash(i, k, 23) - 0.5) * l.rx * 0.7, z: l.y + (hash(i, k, 24) - 0.5) * l.ry * 0.7, rx: l.rx * 0.22, rz: l.ry * 0.22, ph: hash(i, k, 25) * 6.3, sp: (0.03 + hash(i, k, 26) * 0.03) * (k % 2 ? 1 : -1) });
    } });
  }
  private moveLife(dt: number, t: number, near: boolean) {
    const o = new THREE.Object3D(), night = this.atmos.night > 0.3 && near && this.cam.dist < 30;
    this.carBody.visible = this.carTop.visible = near; this.headLights.visible = this.tailLights.visible = night;
    if (near) {
      let li = 0;
      const lamp = (px: number, pz: number, a: number, half: number, y: number) => {
        if (!night) return;
        o.rotation.set(0, a, 0);
        o.position.set(px + Math.sin(a) * half, y, pz + Math.cos(a) * half); o.scale.set(0.02, 0.006, 0.006); o.updateMatrix(); this.headLights.setMatrixAt(li, o.matrix);
        o.position.set(px - Math.sin(a) * half, y, pz - Math.cos(a) * half); o.scale.set(0.02, 0.005, 0.004); o.updateMatrix(); this.tailLights.setMatrixAt(li, o.matrix); li++;
      };
      this.cars.forEach((cr, i) => {
        cr.t = (cr.t + cr.speed * dt * cr.dir + 1) % 1;
        const [x, z, ang] = this.along(cr.road, cr.t), a = cr.dir === 1 ? ang : ang + Math.PI, px = x + Math.cos(a) * cr.lane, pz = z - Math.sin(a) * cr.lane;
        o.rotation.set(0, a, 0); o.position.set(px, 0.034, pz); o.scale.set(0.02, 0.011, 0.046); o.updateMatrix(); this.carBody.setMatrixAt(i, o.matrix);
        o.position.set(px - Math.sin(a) * 0.003, 0.043, pz - Math.cos(a) * 0.003); o.scale.set(0.017, 0.009, 0.024); o.updateMatrix(); this.carTop.setMatrixAt(i, o.matrix);
        lamp(px, pz, a, 0.024, 0.034);
      });
      if (night) this.trucks.forEach((tr) => { const [x, z, ang] = this.along(tr.road, tr.t), a = tr.dir === 1 ? ang : ang + Math.PI; lamp(x + Math.cos(a) * 0.055 + Math.sin(a) * 0.02, z - Math.sin(a) * 0.055 + Math.cos(a) * 0.02, a, 0.086, 0.04); });
      this.carBody.instanceMatrix.needsUpdate = this.carTop.instanceMatrix.needsUpdate = true;
      if (night) { this.headLights.count = this.tailLights.count = li; this.headLights.instanceMatrix.needsUpdate = this.tailLights.instanceMatrix.needsUpdate = true; }
    }
    this.trainMesh.visible = this.cam.dist < 70;
    if (this.trainMesh.visible) {
      const L = Map3D.TRAIN_LEN;
      this.trains.forEach((tr, n) => {
        tr.d = (tr.d + tr.speed * dt) % (tr.total + 3);
        const pts = RAILS[tr.rail];
        for (let k = 0; k < L; k++) {
          let d = tr.d - k * 0.078, x = 0, z = 0, ang = 0, ok = d >= 0 && d <= tr.total;
          if (ok) for (let sgi = 0; sgi < tr.seg.length; sgi++) { if (d <= tr.seg[sgi] || sgi === tr.seg.length - 1) { const f = Math.min(1, d / (tr.seg[sgi] || 1)), a = pts[sgi], b = pts[sgi + 1]; x = a[0] + (b[0] - a[0]) * f; z = a[1] + (b[1] - a[1]) * f; ang = Math.atan2(b[0] - a[0], b[1] - a[1]); break; } d -= tr.seg[sgi]; }
          o.rotation.set(0, ang, 0); o.position.set(x, ok ? 0.04 : -1, z); o.scale.set(0.028, k < 2 ? 0.04 : 0.034, 0.07); o.updateMatrix(); this.trainMesh.setMatrixAt(n * L + k, o.matrix);
        }
      });
      this.trainMesh.instanceMatrix.needsUpdate = true;
    }
    for (const p of this.planes) {
      const sec = (t + p.ph) % 46, len = p.z0 - p.z1;
      p.g.visible = sec < 24;
      if (sec < 9) { const q = sec / 9; p.g.position.set(p.x, 0.035, p.z0 - len * q * q); p.g.rotation.set(0, 0, 0); }
      else if (sec < 24) { const q = (sec - 9) / 15; p.g.position.set(p.x - q * q * 3, 0.035 + q * q * 7 + q * 0.6, p.z1 - q * 18); p.g.rotation.set(0.2, q * 0.35, -q * 0.25); }
    }
    for (const b of this.boats) { const a = t * b.sp + b.ph; b.g.position.set(b.x + Math.cos(a) * b.rx, 0.004 + Math.sin(t * 1.3 + b.ph) * 0.0015, b.z + Math.sin(a) * b.rz); b.g.rotation.set(0, -a + (b.sp > 0 ? Math.PI : 0), Math.sin(t * 0.9 + b.ph) * 0.06); }
  }
  private along(i: number, t: number): [number, number, number] {
    const r = ROADS[i], L = this.roadLen[i]; let d = t * L.total;
    for (let s = 0; s < L.seg.length; s++) { if (d <= L.seg[s] || s === L.seg.length - 1) { const f = Math.min(1, d / (L.seg[s] || 1)), a = r.pts[s], b = r.pts[s + 1]; return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, Math.atan2(b[0] - a[0], b[1] - a[1])]; } d -= L.seg[s]; }
    return [r.pts[0][0], r.pts[0][1], 0];
  }

  /** Night lights and wet pavement. Only touches materials when the value has moved enough to see. */
  private applyLight(night: number, wet: number, t: number) {
    this.ripple.offset.set(t * 0.006, t * 0.01);
    if (Math.abs(night - this.nightApplied) > 0.015) {
      this.nightApplied = night;
      const k = Math.max(0, (night - 0.25) / 0.75);
      GLOW.opacity = GLOW_RED.opacity = k; GLOW.visible = GLOW_RED.visible = k > 0.01;
      for (const m of this.towerGlass) m.emissiveIntensity = k * 0.95;
      for (const s of this.sites.values()) applyNight(s.model.group, k);
      this.water.roughness = 0.1 + night * 0.28;
      this.water.color.set('#4b8ba6').lerp(new THREE.Color('#0d1c2c'), night * 0.85);
    }
    if (Math.abs(wet - this.wetApplied) > 0.02) {
      this.wetApplied = wet;
      for (const m of this.roadMats) { m.roughness = 0.95 - wet * 0.62; m.color.setScalar(1 - wet * 0.3); }
    }
  }

  // ----- sites -----
  private syncSites() {
    const g = this.view.game;
    if (!g) return;
    const dealBy = new Map<string, Deal>();
    for (const d of g.deals) if (d.phase !== 'dead') dealBy.set(d.parcelId, d);
    for (const p of g.parcels) {
      const cur = this.sites.get(p.id);
      if (!this.view.visible.has(p.id)) { if (cur) { this.dropSite(cur); this.sites.delete(p.id); } continue; }
      const d = dealBy.get(p.id), key = siteKey(p, d);
      const mine = !!d && d.phase !== 'sold', sel = this.view.selParcel === p.id, hov = this.hover === p.id;
      const oc = this.overlayColor(p);
      const frameKey = [sel, hov, mine, p.status, oc, this.view.pulse === p.id].join('|');
      let s = cur;
      if (!s || s.key !== key) {
        if (s) { this.scene.remove(s.model.group); disposeGroup(s.model.group); }
        const model = buildSite(p, d); applyNight(model.group, Math.max(0, (this.atmos.night - 0.25) / 0.75)); this.scene.add(model.group);
        s = { key, model, frame: s?.frame ?? new THREE.Group(), frameKey: s?.frameKey ?? '' };
        if (!cur) this.scene.add(s.frame);
        this.sites.set(p.id, s);
      }
      if (s.frameKey !== frameKey) {
        s.frameKey = frameKey; s.frame.clear(); s.frame.position.set(p.tile.x, 0, p.tile.y);
        const w = p.tile.w, h = p.tile.h;
        const color = sel ? '#ffffff' : mine ? ACCENT : p.status === 'available' ? (p.offMarket ? '#7a5fb0' : '#fff8e6') : null;
        if (color) { const th = sel ? 0.026 : hov ? 0.022 : mine ? 0.014 : 0.012, m = new THREE.MeshBasicMaterial({ color }); for (const [bw, bd, x, z] of [[w + th, th, w / 2, 0], [w + th, th, w / 2, h], [th, h + th, 0, h / 2], [th, h + th, w, h / 2]]) { const b = new THREE.Mesh(UNIT, m); b.scale.set(bw, 0.012, bd); b.position.set(x, 0.012, z); s.frame.add(b); } }
        if (oc) { const t = new THREE.Mesh(FLAT, new THREE.MeshBasicMaterial({ color: oc, transparent: true, opacity: 0.62, depthWrite: false })); t.scale.set(w, 1, h); t.position.set(w / 2, 0.035, h / 2); s.frame.add(t); }
        if (this.view.pulse === p.id) { const ring = new THREE.Group(), m = new THREE.MeshBasicMaterial({ color: ACCENT, transparent: true }); for (const [bw, bd, x, z] of [[w, 0.04, 0, -h / 2], [w, 0.04, 0, h / 2], [0.04, h, -w / 2, 0], [0.04, h, w / 2, 0]]) { const b = new THREE.Mesh(UNIT, m); b.scale.set(bw + 0.04, 0.01, bd); b.position.set(x, 0, z); ring.add(b); } ring.position.set(w / 2, 0.02, h / 2); ring.userData.m = m; s.frame.add(ring); this.pulseRing = ring; }
        else if (this.pulseRing && this.pulseRing.parent === null) this.pulseRing = null;
      }
    }
  }
  private dropSite(s: { model: SiteModel; frame: THREE.Group }) { this.scene.remove(s.model.group, s.frame); disposeGroup(s.model.group); }
  private overlayColor(p: Parcel): string | null {
    switch (this.view.overlay) {
      case 'zoning': return ZONE_COL[p.zoning];
      case 'utilities': return p.water && p.sewer ? '#2f8f8a' : p.water ? '#d09a2e' : '#8a8580';
      case 'land': { const f = Math.max(0, Math.min(1, (p.askPsf - 2) / 14)); return `hsl(${38 - f * 26}, 80%, ${78 - f * 34}%)`; }
      default: return null;
    }
  }

  // ----- camera and input -----
  private applyCam() {
    const c = this.cam;
    c.tx = Math.max(0, Math.min(W, c.tx)); c.tz = Math.max(0, Math.min(H, c.tz));
    c.dist = Math.max(1.5, Math.min(140, c.dist)); c.pol = Math.max(0.2, Math.min(1.3, c.pol));
    const s = Math.sin(c.pol) * c.dist;
    this.camera.position.set(c.tx + Math.sin(c.az) * s, Math.cos(c.pol) * c.dist, c.tz + Math.cos(c.az) * s);
    this.camera.near = Math.max(0.05, c.dist * 0.04); this.camera.far = c.dist * 14 + 80;
    this.camera.lookAt(c.tx, 0, c.tz); this.camera.updateProjectionMatrix(); this.camera.updateMatrixWorld();
  }
  private size() { const r = this.canvas.getBoundingClientRect(); return { w: r.width, h: r.height }; }
  private ground(sx: number, sy: number): XY | null {
    const { w, h } = this.size();
    this.ray.setFromCamera(new THREE.Vector2((sx / w) * 2 - 1, -(sy / h) * 2 + 1), this.camera);
    const hit = this.ray.ray.intersectPlane(this.plane, new THREE.Vector3());
    return hit && hit.distanceTo(this.camera.position) < this.cam.dist * 12 ? [hit.x, hit.z] : null;
  }
  private parcelAt(sx: number, sy: number): Parcel | null {
    const g = this.ground(sx, sy); if (!g) return null;
    const pad = this.cam.dist > 30 ? 0.7 : this.cam.dist > 14 ? 0.3 : 0.03;
    return this.view.game?.parcels.find((p) => this.view.visible.has(p.id) && g[0] >= p.tile.x - pad && g[0] < p.tile.x + p.tile.w + pad && g[1] >= p.tile.y - pad && g[1] < p.tile.y + p.tile.h + pad) ?? null;
  }
  private local(e: PointerEvent | WheelEvent) { const r = this.canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
  private miniRect() { const { h } = this.size(); const mw = 176, mh = Math.round((mw * H) / W); return { x: 92, y: h - 176 - mh, w: mw, h: mh }; }
  private inMini(p: { x: number; y: number }) { const m = this.miniRect(); return !!this.view.game && p.x >= m.x && p.x <= m.x + m.w && p.y >= m.y && p.y <= m.y + m.h; }
  private miniJump(p: { x: number; y: number }) { const m = this.miniRect(); this.cam.tx = ((p.x - m.x) / m.w) * W; this.cam.tz = ((p.y - m.y) / m.h) * H; }
  private two() { const p = [...this.pointers.values()]; return p.length >= 2 ? { d: Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y), a: Math.atan2(p[1].y - p[0].y, p[1].x - p[0].x) } : { d: 0, a: 0 }; }
  private down = (e: PointerEvent) => {
    this.canvas.setPointerCapture(e.pointerId);
    const p = this.local(e); this.pointers.set(e.pointerId, p);
    const mini = this.inMini(p), t = this.two();
    this.drag = { x: p.x, y: p.y, moved: mini ? 99 : 0, pinch: t.d, twist: t.a, mini, rotate: e.button === 2 || e.button === 1 || e.ctrlKey || e.shiftKey || e.altKey };
    if (mini) this.miniJump(p);
  };
  private move = (e: PointerEvent) => {
    const p = this.local(e);
    if (this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, p);
    const d = this.drag;
    if (d?.mini) { this.miniJump(p); return; }
    if (d && this.pointers.size >= 2) {
      const t = this.two();
      if (d.pinch > 0 && t.d > 0) { this.cam.dist *= d.pinch / t.d; let da = t.a - d.twist; if (da > Math.PI) da -= 2 * Math.PI; if (da < -Math.PI) da += 2 * Math.PI; this.cam.az -= da; }
      d.pinch = t.d; d.twist = t.a; d.moved = 99;
    } else if (d && this.pointers.size === 1) {
      const dx = p.x - d.x, dy = p.y - d.y; d.moved += Math.abs(dx) + Math.abs(dy);
      if (d.rotate) { this.cam.az -= dx * 0.006; this.cam.pol -= dy * 0.005; }
      else { this.applyCam(); const a = this.ground(d.x, d.y), b = this.ground(p.x, p.y); if (a && b) { this.cam.tx += a[0] - b[0]; this.cam.tz += a[1] - b[1]; } }
      d.x = p.x; d.y = p.y;
    } else {
      this.hover = this.inMini(p) ? null : this.parcelAt(p.x, p.y)?.id ?? null;
      this.canvas.style.cursor = this.hover || this.inMini(p) ? 'pointer' : 'grab';
    }
  };
  private up = (e: PointerEvent) => {
    const p = this.local(e); this.pointers.delete(e.pointerId);
    if (this.drag && this.drag.moved < 6 && !this.drag.rotate) this.onSelect(this.parcelAt(p.x, p.y)?.id ?? null);
    if (this.pointers.size === 0) this.drag = null;
    else { const q = [...this.pointers.values()][0]; this.drag = { x: q.x, y: q.y, moved: 99, pinch: 0, twist: 0, mini: false, rotate: false }; }
  };
  private wheel = (e: WheelEvent) => {
    e.preventDefault(); const p = this.local(e);
    this.applyCam(); const a = this.ground(p.x, p.y);
    this.cam.dist *= Math.exp(e.deltaY * 0.0015);
    this.applyCam(); const b = this.ground(p.x, p.y);
    if (a && b) { this.cam.tx += a[0] - b[0]; this.cam.tz += a[1] - b[1]; }
  };
  private key = (e: KeyboardEvent) => {
    if ((e.target as HTMLElement).closest?.('input, textarea')) return;
    if (e.key === 'q' || e.key === 'Q') this.cam.az += 0.26; else if (e.key === 'e' || e.key === 'E') this.cam.az -= 0.26;
  };
  zoomBy(f: number) { this.cam.dist /= f; }
  rotateBy(r: number) { this.cam.az += r; }
  tiltBy(r: number) { this.cam.pol += r; }
  centerTile(tx: number, ty: number, zoom?: number) { this.cam.tx = tx; this.cam.tz = ty; if (zoom) this.cam.dist = 12 / zoom; }
  focusParcel(id: string, zoom?: number) {
    const p = this.view.game?.parcels.find((q) => q.id === id); if (!p) return;
    if (zoom) { this.cam.dist = 6.5 / zoom; this.cam.pol = 0.95; } else if (this.cam.dist > 9) this.cam.dist = 6;
    this.cam.tx = p.tile.x + p.tile.w / 2 + Math.cos(this.cam.az) * this.cam.dist * 0.11; this.cam.tz = p.tile.y + p.tile.h / 2 - Math.sin(this.cam.az) * this.cam.dist * 0.11;
  }

  // ----- frame -----
  private frame = (now: number) => {
    this.raf = requestAnimationFrame(this.frame);
    const dt = Math.min(0.1, (now - this.last) / 1000); this.last = now;
    const { w, h } = this.size(); if (!w || !h) return;
    // cap the pixel count so a large high-density screen does not pay for effects four times over
    const lv = this.level, cap = lv === 'high' ? 4.6e6 : lv === 'medium' ? 3e6 : 2.2e6, dpr = Math.min(lv === 'low' ? 1.5 : 2, window.devicePixelRatio || 1, Math.max(1, Math.sqrt(cap / (w * h)))), t = now / 1000, c = this.cam;
    if (this.canvas.width !== Math.round(w * dpr) || this.canvas.height !== Math.round(h * dpr)) {
      this.renderer.setPixelRatio(dpr); this.renderer.setSize(w, h, false);
      this.composer?.setPixelRatio(dpr); this.composer?.setSize(w, h);
      this.labels.width = Math.round(w * dpr); this.labels.height = Math.round(h * dpr); this.camera.aspect = w / h;
    }
    // on 'auto', step the effects down if this device cannot keep up
    if (this.gfx.quality === 'auto' && lv !== 'low' && document.hasFocus()) {
      this.warm += dt;
      if (this.warm > 4) { this.slow = dt > 0.045 ? this.slow + dt : Math.max(0, this.slow - dt * 2); if (this.slow > 3) { this.level = lv === 'high' ? 'medium' : 'low'; this.slow = 0; this.warm = 0; this.canvas.width = 0; } }
    }
    if (!this.started) c.az = Math.sin(t * 0.05) * 0.25; // slow drift behind the title screen
    this.applyCam();

    // light and atmosphere follow the camera
    const at = this.atmos, sun = at.sun;
    at.update(dt, t, { tx: c.tx, tz: c.tz, dist: c.dist, far: this.camera.far }, this.camera, this.gfx);
    this.renderer.toneMappingExposure = at.exposure;
    const S = Math.max(2.5, Math.min(26, c.dist * 0.8));
    sun.castShadow = c.dist < 34 && sun.intensity > 0.05;
    const sc = sun.shadow.camera; sc.left = -S; sc.right = S; sc.top = S; sc.bottom = -S; sc.near = 10; sc.far = 160; sc.updateProjectionMatrix();
    sun.shadow.radius = lv === 'low' ? 1 : 2.5;
    this.applyLight(at.night, at.wet, t);
    for (const o of this.near) o.visible = c.dist < 60;
    this.flood.visible = this.view.overlay === 'flood';

    this.syncSites();
    for (const s of this.sites.values()) s.model.anim?.(t);
    if (this.pulseRing?.parent) { const q = (t % 1.6) / 1.6; this.pulseRing.scale.setScalar(1 + q * 0.9); (this.pulseRing.userData.m as THREE.MeshBasicMaterial).opacity = 1 - q; }

    const show = c.dist < 45; this.truckBody.visible = this.truckCab.visible = show;
    if (show) {
      const o = new THREE.Object3D();
      this.trucks.forEach((tr, i) => {
        tr.t = (tr.t + tr.speed * dt * tr.dir + 1) % 1;
        const [x, z, ang] = this.along(tr.road, tr.t), a = tr.dir === 1 ? ang : ang + Math.PI, lane = 0.055;
        const px = x + Math.cos(a) * lane, pz = z - Math.sin(a) * lane;
        o.rotation.set(0, a, 0); o.position.set(px, 0.045, pz); o.scale.set(0.03, 0.036, 0.13); o.updateMatrix(); this.truckBody.setMatrixAt(i, o.matrix);
        o.position.set(px + Math.sin(a) * 0.085, 0.04, pz + Math.cos(a) * 0.085); o.scale.set(0.03, 0.03, 0.035); o.updateMatrix(); this.truckCab.setMatrixAt(i, o.matrix);
      });
      this.truckBody.instanceMatrix.needsUpdate = this.truckCab.instanceMatrix.needsUpdate = true;
    }
    this.moveLife(dt, t, show);
    if (this.composer && lv !== 'low') {
      this.ao!.enabled = lv === 'high' && c.dist < 26;
      this.bloom!.threshold = 1.75 - at.night * 0.55; this.bloom!.strength = 0.3 + at.night * 0.25;
      this.composer.render();
    } else this.renderer.render(this.scene, this.camera);
    this.drawLabels(w, h, dpr, t);
  };

  private project(x: number, y: number, z: number, w: number, h: number): XY | null {
    const v = new THREE.Vector3(x, y, z).project(this.camera);
    if (v.z > 1 || v.x < -1.1 || v.x > 1.1 || v.y < -1.1 || v.y > 1.1) return null;
    return [((v.x + 1) / 2) * w, ((1 - v.y) / 2) * h];
  }
  private text(s: string, x: number, y: number, size: number, color: string, o: { halo?: string; weight?: number; spacing?: number } = {}) {
    const c = this.lc;
    c.font = `${o.weight ?? 600} ${size}px 'Barlow Condensed', 'Arial Narrow', sans-serif`; c.textAlign = 'center'; c.textBaseline = 'middle';
    (c as unknown as { letterSpacing: string }).letterSpacing = `${o.spacing ?? 0}px`;
    if (o.halo) { c.strokeStyle = o.halo; c.lineWidth = size / 3.5; c.lineJoin = 'round'; c.strokeText(s, x, y); }
    c.fillStyle = color; c.fillText(s, x, y);
    (c as unknown as { letterSpacing: string }).letterSpacing = '0px';
  }
  private drawLabels(w: number, h: number, dpr: number, t: number) {
    const c = this.lc, g = this.view.game, dist = this.cam.dist;
    c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, w, h);
    if (!g) return;
    for (const r of ROADS) if (r.kind === 'interstate' || (r.kind === 'highway' && dist < 45)) for (const [sx, sy] of r.shieldAt) {
      const p = this.project(sx, 0.05, sy, w, h); if (!p) continue;
      c.font = "600 11px 'Barlow Condensed', 'Arial Narrow', sans-serif"; const wd = c.measureText(r.name).width + 10;
      c.fillStyle = r.kind === 'interstate' ? '#26435c' : '#26323c'; roundRect(c, p[0] - wd / 2, p[1] - 8, wd, 16, 4); c.fill();
      c.strokeStyle = 'rgba(255,255,255,.7)'; c.lineWidth = 1; c.stroke();
      this.text(r.name, p[0], p[1], 11, '#f5efe2');
    }
    for (const ci of CITIES) if (ci.major || dist < 42) { const p = this.project(ci.x, ci.core ? 2.6 : 0.3, ci.y, w, h); if (p) this.text(ci.name, p[0], p[1], ci.core ? 19 : ci.major ? 15 : 12, '#2f2a22', { halo: 'rgba(250,244,228,.92)', spacing: ci.major ? 2.5 : 1.2, weight: ci.major ? 700 : 600 }); }
    if (dist < 42) {
      for (const l of LAKES) { const p = this.project(l.x, 0.02, l.y, w, h); if (p) this.text(l.name, p[0], p[1], 11.5, '#1f4f63', { halo: 'rgba(214,236,244,.7)', weight: 500 }); }
      for (const a of AIRPORTS) { const p = this.project(a.x + a.w / 2, 0.35, a.y + a.h / 2, w, h); if (p) this.text(a.name, p[0], p[1], 12, '#3f3426', { halo: 'rgba(250,244,228,.9)', weight: 500 }); }
    }
    for (const p of g.parcels) {
      if (!this.view.visible.has(p.id)) continue;
      const d = g.deals.find((q) => q.parcelId === p.id && q.phase !== 'dead'), sel = this.view.selParcel === p.id, hov = this.hover === p.id;
      const built = d && ['construction', 'leasing', 'operations'].includes(d.phase);
      const pt = this.project(p.tile.x + p.tile.w / 2, built ? (d!.type === 'spec' ? 0.3 : 0.2) : 0.14, p.tile.y + p.tile.h / 2, w, h);
      if (!pt) continue;
      if (d && d.phase !== 'sold') {
        const y = pt[1] - 6 + Math.sin(t * 2 + p.tile.x) * 2;
        c.fillStyle = ACCENT; c.beginPath(); c.moveTo(pt[0], y); c.lineTo(pt[0] + 9, y - 12); c.lineTo(pt[0] - 9, y - 12); c.closePath(); c.fill(); c.strokeStyle = '#fff'; c.lineWidth = 1.5; c.stroke();
      } else if (p.status === 'available' && dist > 13) {
        c.fillStyle = p.offMarket ? '#7a5fb0' : '#fffaf0'; c.strokeStyle = '#5a4630'; c.lineWidth = 1.4; c.beginPath(); c.arc(pt[0], pt[1], 5, 0, 7); c.fill(); c.stroke();
      }
      if (sel || hov) this.text(p.name.replace(/ \(.*\)/, ''), pt[0], pt[1] - 30, 15, '#1d2730', { halo: '#fffaf0', weight: 700 });
    }
    this.drawMini();
  }
  private drawMini() {
    const c = this.lc, m = this.miniRect(), g = this.view.game!, { w, h } = this.size();
    if (!this.mini) {
      const s = 3, cv = document.createElement('canvas'); cv.width = W * s; cv.height = H * s; const x = cv.getContext('2d')!;
      for (let ty = 0; ty < H; ty++) for (let tx = 0; tx < W; tx++) { x.fillStyle = blockAt(tx, ty) === 2 ? '#7fb0c2' : ['#b9c08a', '#c6c49a', '#d3ccb3', '#8d8779', '#b5ae99'][GROUND[ty * W + tx]]; x.fillRect(tx * s, ty * s, s, s); }
      const ln = (pts: XY[], col: string, lw: number) => { x.beginPath(); pts.forEach((p, i) => (i ? x.lineTo(p[0] * s, p[1] * s) : x.moveTo(p[0] * s, p[1] * s))); x.strokeStyle = col; x.lineWidth = lw; x.stroke(); };
      for (const r of RIVERS) ln(r, '#7fb0c2', 2);
      for (const r of ROADS) if (r.kind !== 'arterial') ln(r.pts, r.kind === 'interstate' ? '#4f4a45' : '#7a746c', r.kind === 'interstate' ? 2 : 1.2);
      this.mini = cv;
    }
    c.save(); c.shadowColor = 'rgba(70,40,12,.3)'; c.shadowBlur = 14; c.shadowOffsetY = 5; c.fillStyle = 'rgba(250,245,234,.95)'; roundRect(c, m.x - 5, m.y - 5, m.w + 10, m.h + 10, 12); c.fill(); c.restore();
    c.save(); roundRect(c, m.x, m.y, m.w, m.h, 8); c.clip();
    c.drawImage(this.mini, m.x, m.y, m.w, m.h);
    const sx = m.w / W, sy = m.h / H;
    for (const p of g.parcels) {
      if (!this.view.visible.has(p.id)) continue;
      const d = g.deals.find((q) => q.parcelId === p.id && q.phase !== 'dead');
      if (!d && p.status !== 'available') continue;
      c.fillStyle = d ? ACCENT : '#fffaf0'; c.strokeStyle = d ? '#fff' : '#5a4630'; c.lineWidth = 0.8;
      c.beginPath(); c.arc(m.x + (p.tile.x + 0.5) * sx, m.y + (p.tile.y + 0.5) * sy, d ? 3.2 : 2, 0, 7); c.fill(); c.stroke();
    }
    const far = this.cam.dist * 6;
    const corner = (px: number, py: number): XY => this.ground(px, py) ?? [this.cam.tx - Math.sin(this.cam.az) * far + (px ? 1 : -1) * Math.cos(this.cam.az) * far * 0.6, this.cam.tz - Math.cos(this.cam.az) * far - (px ? 1 : -1) * Math.sin(this.cam.az) * far * 0.6];
    const cs = [corner(0, 0), corner(w, 0), corner(w, h), corner(0, h)];
    c.beginPath(); cs.forEach((p, i) => { const x = m.x + p[0] * sx, y = m.y + p[1] * sy; if (i) c.lineTo(x, y); else c.moveTo(x, y); }); c.closePath();
    c.fillStyle = 'rgba(255,255,255,.2)'; c.fill(); c.strokeStyle = '#1d2730'; c.lineWidth = 1.4; c.stroke();
    c.restore();
  }
}

function disposeGroup(g: THREE.Object3D) {
  g.traverse((o) => {
    const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
    for (const x of Array.isArray(m) ? m : m ? [m] : []) if (x.userData.own) { (x as THREE.MeshStandardMaterial).map?.dispose(); (x as THREE.MeshStandardMaterial).emissiveMap?.dispose(); x.dispose(); }
    if ((o as THREE.InstancedMesh).isInstancedMesh) (o as THREE.InstancedMesh).dispose();
  });
}
function roundRect(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
}
