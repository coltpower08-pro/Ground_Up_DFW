// 3D models for development sites: vacant land, yards and buildings at every stage.
// Everything is built from simple shapes and painted textures; no art files.
import * as THREE from 'three';
import type { Deal, Parcel } from '../engine/types';
import { hash } from './layout';

const UNIT = new THREE.BoxGeometry(1, 1, 1);
const PLANE = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
const BALL = new THREE.IcosahedronGeometry(0.55, 1);
const matCache = new Map<string, THREE.MeshStandardMaterial>();
export function mat(color: string, o: { rough?: number; metal?: number; emissive?: string; opacity?: number } = {}): THREE.MeshStandardMaterial {
  const key = color + JSON.stringify(o);
  let m = matCache.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, roughness: o.rough ?? 0.85, metalness: o.metal ?? 0, emissive: o.emissive ?? '#000000', transparent: o.opacity !== undefined, opacity: o.opacity ?? 1 });
    matCache.set(key, m);
  }
  return m;
}
/** Shared light-bulb materials: invisible by day, bright enough at night to bloom. The map sets their opacity. */
export const GLOW = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.5, 1.9, 1.1), transparent: true, opacity: 0, depthWrite: false, fog: false });
export const GLOW_RED = new THREE.MeshBasicMaterial({ color: new THREE.Color(3.2, 0.3, 0.2), transparent: true, opacity: 0, depthWrite: false, fog: false });
GLOW.visible = GLOW_RED.visible = false;
/** Turn window light up or down on every glass surface in a model. k runs 0 (day) to 1 (night). */
export function applyNight(g: THREE.Object3D, k: number) {
  g.traverse((o) => { const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined; for (const x of Array.isArray(m) ? m : m ? [m] : []) if (x.userData.night) (x as THREE.MeshStandardMaterial).emissiveIntensity = k * x.userData.night; });
}
/** Glass that shows a scatter of lit windows after dark. */
function litGlass(rx: number, ry: number, tint = '#ffffff', night = 1): THREE.MeshStandardMaterial {
  const t = tex(), a = t.glass.clone(), b = t.lit.clone();
  a.repeat.set(rx, ry); a.needsUpdate = true; b.repeat.set(rx / 4, ry / 4); b.needsUpdate = true;
  const m = new THREE.MeshStandardMaterial({ map: a, color: tint, roughness: 0.12, metalness: 0.55, emissive: '#ffffff', emissiveMap: b, emissiveIntensity: 0, envMapIntensity: 1.4 });
  m.userData.own = true; m.userData.night = night;
  return m;
}
export function canvasTex(w: number, h: number, draw: (c: CanvasRenderingContext2D) => void, repeat = false): THREE.CanvasTexture {
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  draw(cv.getContext('2d')!);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
const speckle = (c: CanvasRenderingContext2D, w: number, h: number, base: string, dots: string[], n: number, r = 1.4) => {
  c.fillStyle = base; c.fillRect(0, 0, w, h);
  for (let i = 0; i < n; i++) { c.fillStyle = dots[i % dots.length]; c.globalAlpha = 0.25 + hash(i, 7, 3) * 0.5; c.fillRect(hash(i, 1) * w, hash(i, 2) * h, r + hash(i, 4) * r, r + hash(i, 5) * r); }
  c.globalAlpha = 1;
};

let T: ReturnType<typeof makeTextures> | null = null;
function makeTextures() {
  const surf = (base: string, dots: string[], n: number, extra?: (c: CanvasRenderingContext2D) => void) => canvasTex(256, 256, (c) => { speckle(c, 256, 256, base, dots, n); extra?.(c); }, true);
  return {
    vacant: surf('#b59a63', ['#8f9a55', '#a38a52', '#c9b27a', '#7d8a4a'], 2600, (c) => { c.globalAlpha = 0.35; for (let i = 0; i < 26; i++) { c.fillStyle = i % 2 ? '#8c9a52' : '#c2a66c'; c.beginPath(); c.ellipse(hash(i, 3) * 256, hash(i, 9) * 256, 14 + hash(i, 5) * 30, 8 + hash(i, 6) * 16, hash(i, 8) * 3, 0, 7); c.fill(); } c.globalAlpha = 1; }),
    dirt: surf('#b08a55', ['#9a7646', '#c29c66', '#8a6a3e'], 2200, (c) => { c.strokeStyle = 'rgba(90,65,35,.35)'; c.lineWidth = 2; for (let i = 0; i < 9; i++) { c.beginPath(); c.moveTo(0, i * 30 + 8); c.bezierCurveTo(80, i * 30, 170, i * 30 + 18, 256, i * 30 + 6); c.stroke(); } }),
    gravel: surf('#a39f95', ['#8d897f', '#b9b5aa', '#77736a', '#c6c2b8'], 5200, undefined),
    stabilized: surf('#b6ad9a', ['#a59c88', '#c6bda9', '#978e7b'], 3200, undefined),
    paved: surf('#cfcdc6', ['#c3c1ba', '#d9d7d0'], 900, (c) => { c.strokeStyle = 'rgba(120,118,110,.55)'; c.lineWidth = 1.5; for (let i = 0; i <= 4; i++) { c.beginPath(); c.moveTo(i * 64, 0); c.lineTo(i * 64, 256); c.moveTo(0, i * 64); c.lineTo(256, i * 64); c.stroke(); } }),
    asphalt: surf('#55534f', ['#4a4844', '#63615c'], 1800, (c) => { c.strokeStyle = '#e9e4d2'; c.lineWidth = 2; for (let i = 0; i < 8; i++) { c.beginPath(); c.moveTo(i * 32 + 16, 40); c.lineTo(i * 32 + 16, 110); c.moveTo(i * 32 + 16, 150); c.lineTo(i * 32 + 16, 220); c.stroke(); } }),
    wall: canvasTex(128, 128, (c) => { c.fillStyle = '#e9e3d5'; c.fillRect(0, 0, 128, 128); c.fillStyle = '#d8d1c0'; c.fillRect(0, 96, 128, 32); c.strokeStyle = 'rgba(120,110,95,.5)'; c.lineWidth = 2; c.strokeRect(1, 0, 126, 128); c.fillStyle = '#3c4a57'; c.fillRect(34, 18, 60, 12); }, true),
    dock: canvasTex(128, 128, (c) => { c.fillStyle = '#e9e3d5'; c.fillRect(0, 0, 128, 128); c.fillStyle = '#d8d1c0'; c.fillRect(0, 96, 128, 32); c.strokeStyle = 'rgba(120,110,95,.5)'; c.lineWidth = 2; c.strokeRect(1, 0, 126, 128); c.fillStyle = '#4b5661'; c.fillRect(30, 62, 68, 58); c.strokeStyle = '#7b8792'; c.lineWidth = 1; for (let i = 1; i < 5; i++) { c.beginPath(); c.moveTo(30, 62 + i * 11.6); c.lineTo(98, 62 + i * 11.6); c.stroke(); } c.fillStyle = '#1f2327'; c.fillRect(26, 118, 8, 10); c.fillRect(94, 118, 8, 10); c.fillStyle = '#f0c040'; c.fillRect(58, 48, 12, 8); }, true),
    roof: canvasTex(128, 128, (c) => { c.fillStyle = '#f1eee6'; c.fillRect(0, 0, 128, 128); c.strokeStyle = 'rgba(160,155,145,.5)'; c.lineWidth = 1; for (let i = 0; i < 128; i += 16) { c.beginPath(); c.moveTo(0, i); c.lineTo(128, i); c.stroke(); } c.fillStyle = '#bcd3de'; c.fillRect(24, 26, 18, 12); c.fillRect(86, 90, 18, 12); }, true),
    fence: canvasTex(64, 64, (c) => { c.clearRect(0, 0, 64, 64); c.strokeStyle = 'rgba(70,76,82,.9)'; c.lineWidth = 1.2; for (let i = -64; i < 128; i += 8) { c.beginPath(); c.moveTo(i, 0); c.lineTo(i + 64, 64); c.moveTo(i + 64, 0); c.lineTo(i, 64); c.stroke(); } c.lineWidth = 3; c.beginPath(); c.moveTo(0, 2); c.lineTo(64, 2); c.stroke(); }, true),
    lit: canvasTex(64, 64, (c) => { c.fillStyle = '#000'; c.fillRect(0, 0, 64, 64); for (let y = 0; y < 4; y++) for (let x = 0; x < 8; x++) { const r = hash(x, y, 41); if (r < 0.45) { c.fillStyle = r < 0.08 ? '#bfe0ff' : r < 0.3 ? '#ffd9a0' : '#ffc470'; c.fillRect(x * 8 + 1, y * 16 + 3, 6, 10); } } }, true),
    glass: canvasTex(64, 64, (c) => { c.fillStyle = '#7fa9c0'; c.fillRect(0, 0, 64, 64); c.strokeStyle = '#dfe9ee'; c.lineWidth = 3; c.strokeRect(0, 0, 64, 64); c.beginPath(); c.moveTo(32, 0); c.lineTo(32, 64); c.stroke(); c.fillStyle = 'rgba(255,255,255,.25)'; c.beginPath(); c.moveTo(4, 60); c.lineTo(28, 4); c.lineTo(40, 4); c.lineTo(16, 60); c.fill(); }, true),
  };
}
const tex = () => (T ??= makeTextures());
export const siteTex = tex;
const texMat = (t: THREE.Texture, rx: number, ry: number, o: { color?: string; rough?: number; transparent?: boolean } = {}) => {
  const tt = t.clone(); tt.repeat.set(rx, ry); tt.needsUpdate = true;
  const own = new THREE.MeshStandardMaterial({ map: tt, color: o.color ?? '#ffffff', roughness: o.rough ?? 0.9, transparent: !!o.transparent, alphaTest: o.transparent ? 0.3 : 0, side: o.transparent ? THREE.DoubleSide : THREE.FrontSide });
  own.userData.own = true; // disposed with the site that created it
  return own;
};

const signCache = new Map<string, THREE.Texture>();
function signTex(lines: string[], bg: string, fg: string): THREE.Texture {
  const key = lines.join('|') + bg;
  let t = signCache.get(key);
  if (!t) {
    t = canvasTex(256, 128, (c) => {
      c.fillStyle = bg; c.fillRect(0, 0, 256, 128); c.strokeStyle = fg; c.lineWidth = 6; c.strokeRect(5, 5, 246, 118);
      c.fillStyle = fg; c.textAlign = 'center'; c.textBaseline = 'middle';
      lines.forEach((l, i) => { c.font = `700 ${i === 0 ? 44 : 30}px 'Barlow Condensed', 'Arial Narrow', sans-serif`; c.fillText(l, 128, lines.length === 1 ? 64 : 44 + i * 44, 236); });
    });
    signCache.set(key, t);
  }
  return t;
}

function box(g: THREE.Object3D, w: number, h: number, d: number, x: number, y: number, z: number, m: THREE.Material | THREE.Material[], shadow = true): THREE.Mesh {
  const mesh = new THREE.Mesh(UNIT, m);
  mesh.scale.set(w, h, d); mesh.position.set(x, y + h / 2, z);
  mesh.castShadow = shadow; mesh.receiveShadow = true;
  g.add(mesh); return mesh;
}
function slab(g: THREE.Object3D, w: number, d: number, x: number, z: number, y: number, m: THREE.Material): THREE.Mesh {
  const mesh = new THREE.Mesh(PLANE, m);
  mesh.scale.set(w, 1, d); mesh.position.set(x, y, z); mesh.receiveShadow = true;
  g.add(mesh); return mesh;
}
/** Many copies of a box in one draw call. Each item: [x, y(base), z, w, h, d, rotY?, color?] */
function many(g: THREE.Object3D, items: (number | string | undefined)[][], m: THREE.Material, shadow = true, geom: THREE.BufferGeometry = UNIT) {
  if (!items.length) return;
  const im = new THREE.InstancedMesh(geom, m, items.length), o = new THREE.Object3D(), col = new THREE.Color();
  items.forEach((it, i) => {
    const [x, y, z, w, h, d, r, c] = it as [number, number, number, number, number, number, number | undefined, string | undefined];
    o.position.set(x, y + h / 2, z); o.scale.set(w, h, d); o.rotation.set(0, r ?? 0, 0); o.updateMatrix();
    im.setMatrixAt(i, o.matrix); im.setColorAt(i, col.set(c ?? '#ffffff'));
  });
  im.castShadow = shadow; im.receiveShadow = true; im.instanceMatrix.needsUpdate = true;
  if (im.instanceColor) im.instanceColor.needsUpdate = true;
  g.add(im);
}
function sign(g: THREE.Object3D, x: number, z: number, lines: string[], bg: string, fg: string, scale = 1) {
  const w = 0.17 * scale, h = 0.085 * scale, post = mat('#5a4630');
  box(g, 0.008, 0.06 * scale + h, 0.008, x - w * 0.35, 0, z, post); box(g, 0.008, 0.06 * scale + h, 0.008, x + w * 0.35, 0, z, post);
  const m = new THREE.MeshStandardMaterial({ map: signTex(lines, bg, fg), roughness: 0.7 });
  const face = new THREE.Mesh(UNIT, [mat(bg), mat(bg), mat(bg), mat(bg), m, mat(bg)]);
  face.scale.set(w, h, 0.006); face.position.set(x, 0.06 * scale + h / 2, z + 0.006); face.castShadow = true; g.add(face);
}
function tree(items: (number | string | undefined)[][], crowns: (number | string | undefined)[][], x: number, z: number, s = 1) {
  items.push([x, 0, z, 0.008 * s, 0.03 * s, 0.008 * s, 0, '#6b4f35']);
  crowns.push([x, 0.024 * s, z, 0.045 * s, 0.04 * s, 0.045 * s, hash(Math.round(x * 100), Math.round(z * 100)) * 3, hash(Math.round(x * 90), Math.round(z * 70), 2) < 0.5 ? '#5f8a4c' : '#74995a']);
}
const TRAILER_COLS = ['#f4f1ea', '#f4f1ea', '#e8e4da', '#c9502f', '#3f6f8f', '#e0b23f', '#f4f1ea'];
function truck(items: (number | string | undefined)[][], x: number, z: number, rot: number, withCab: boolean, seed: number) {
  // trailer lies along local Z before rotation
  const col = TRAILER_COLS[Math.floor(hash(seed, 5, 1) * TRAILER_COLS.length)];
  items.push([x, 0.008, z, 0.022, 0.026, 0.1, rot, col]);
  items.push([x, 0, z, 0.02, 0.008, 0.09, rot, '#2a2c2e']);
  if (withCab) { const dx = Math.sin(rot) * 0.066, dz = Math.cos(rot) * 0.066; items.push([x + dx, 0.004, z + dz, 0.022, 0.024, 0.028, rot, ['#b3402e', '#2f5f8a', '#f0efe9', '#3d7a52'][Math.floor(hash(seed, 9, 2) * 4)]]); }
}

const COMING: Record<string, string> = { ios: 'STORAGE YARD', spec: 'LOGISTICS CENTER', retail: 'SHOPPING CENTER', mf: 'APARTMENTS', office: 'OFFICE BUILDING' };

export interface SiteModel { group: THREE.Group; anim?: (t: number) => void }

/** A key that changes whenever the site should be rebuilt. */
export function siteKey(p: Parcel, d: Deal | undefined): string {
  if (!d) return p.status + (p.existing ? 'x' : '');
  const prog = d.con ? Math.floor(Math.min(1, d.con.daysDone / d.con.daysTotal) * 24) : 0;
  return [p.status, d.phase, d.type, prog, Math.round(d.occ * 10), d.reno, d.leases.map((l) => l.tenant + l.share).join(','), d.ios.surface, d.ios.security, d.spec.coverage, d.spec.clear, d.spec.extras].join('|');
}

function buildModel(p: Parcel, d: Deal | undefined): SiteModel {
  const g = new THREE.Group(), w = p.tile.w, h = p.tile.h, t = tex();
  g.position.set(p.tile.x, 0, p.tile.y);
  const seed = p.tile.x * 131 + p.tile.y * 17;
  const short = p.name.replace(/ \(.*\)/, '');

  if (p.status === 'rival') { spec(g, w, h, 1, { coverage: 0.35, clear: 32, extras: false }, 1, seed, '#4f6f8a', null); return { group: g }; }

  const pre = !d || ['dd', 'entitlement', 'predev'].includes(d.phase);
  if (pre && p.existing) {
    // an existing property is already standing: show it as built, with a sale sign out front
    const ex = p.existing, ls = ex.type === 'mf' ? Math.min(1, (ex.occ ?? 0) / 0.94) : Math.min(1, ex.leases.reduce((a, l) => a + l.share, 0));
    const who = ex.leases[0]?.tenant ?? null, tired = ex.cond === 'tired';
    let model: SiteModel;
    if (ex.type === 'ios') model = yard(g, w, h, 1, { ios: { surface: tired ? 'gravel' : 'stabilized', security: 'basic' } } as Deal, ls, who, seed, short);
    else if (ex.type === 'spec') model = spec(g, w, h, 1, { coverage: 0.35, clear: tired ? 28 : 32, extras: false }, ls, seed, tired ? '#8d8676' : '#3f6f8f', who, short);
    else model = commercial(g, w, h, 1, ex.type, false, ls, seed, tired ? '#8d8676' : '#3f6f8f', who, short);
    sign(g, w * 0.28, h - 0.05, d ? ['UNDER CONTRACT'] : ['FOR SALE', ex.type === 'ios' ? `${p.acres} ACRES` : ex.type === 'mf' ? `${Math.round(ex.sf / 900)} UNITS` : `${Math.round(ex.sf / 1000)}K SF`], d ? '#d9622b' : '#fbf6e9', d ? '#ffffff' : '#b3402e', 1.7);
    return model;
  }
  if (pre) {
    slab(g, w - 0.04, h - 0.04, w / 2, h / 2, 0.004, texMat(t.vacant, w * 2, h * 2));
    if (p.floodPct > 0) slab(g, (w - 0.04) * p.floodPct, h - 0.04, w - 0.02 - ((w - 0.04) * p.floodPct) / 2, h / 2, 0.006, mat('#4f8fb5', { opacity: 0.45, rough: 0.3 }));
    const posts: (number | string | undefined)[][] = [];
    for (const [x, z] of [[0.02, 0.02], [w - 0.02, 0.02], [w - 0.02, h - 0.02], [0.02, h - 0.02]]) posts.push([x, 0, z, 0.01, 0.035, 0.01, 0, '#e8e0cc']);
    const trunks: (number | string | undefined)[][] = [], crowns: (number | string | undefined)[][] = [];
    for (let i = 0; i < 5 + w * 3; i++) tree(trunks, crowns, 0.1 + hash(seed, i, 1) * (w - 0.2), 0.08 + hash(seed, i, 2) * (h - 0.4), 1.1 + hash(seed, i, 3) * 0.9);
    // scrub and tall grass
    for (let i = 0; i < 26 * w; i++) crowns.push([0.05 + hash(seed, i, 4) * (w - 0.1), 0, 0.05 + hash(seed, i, 5) * (h - 0.1), 0.02 + hash(seed, i, 6) * 0.02, 0.012, 0.02 + hash(seed, i, 7) * 0.02, 0, i % 2 ? '#8a9a52' : '#a39a5c']);
    if (!d) {
      sign(g, w * 0.5, h - 0.08, p.offMarket ? ['OFF MARKET', `${p.acres} ACRES`] : ['FOR SALE', `${p.acres} ACRES`], p.offMarket ? '#5f4a94' : '#fbf6e9', p.offMarket ? '#ffffff' : '#b3402e', 1.5);
    } else {
      sign(g, w * 0.5, h - 0.08, d.phase === 'dd' ? ['UNDER CONTRACT'] : d.phase === 'entitlement' ? ['ZONING CASE', 'PUBLIC HEARING'] : ['COMING SOON', COMING[d.type]], '#d9622b', '#ffffff', 1.5);
      for (let i = 0; i < 6 + w * 4; i++) { const x = 0.06 + hash(seed, i, 11) * (w - 0.12), z = 0.06 + hash(seed, i, 12) * (h - 0.12); posts.push([x, 0, z, 0.004, 0.03, 0.004, 0, '#6b4f35']); posts.push([x + 0.008, 0.022, z, 0.016, 0.009, 0.002, 0, '#f06a2a']); }
      posts.push([w * 0.3, 0.004, h - 0.16, 0.03, 0.02, 0.06, 0.3, '#f4f1ea'], [w * 0.3, 0, h - 0.16, 0.028, 0.008, 0.05, 0.3, '#2a2c2e']);
    }
    many(g, posts, mat('#ffffff')); many(g, trunks, mat('#ffffff')); many(g, crowns, mat('#ffffff', { rough: 1 }), true, BALL);
    return { group: g };
  }

  const prog = d!.phase === 'construction' && d!.con ? Math.min(1, d!.con.daysDone / d!.con.daysTotal) : 1;
  const leased = d!.type === 'mf' ? Math.min(1, d!.occ / 0.94) : Math.min(1, d!.leases.reduce((s, l) => s + l.share, 0));
  const tenant = d!.leases[0]?.tenant ?? null;
  const show = d!.acq ? 1 : prog; // a purchased property stays standing while it is renovated
  if (d!.acq && prog < 1) { const sc: (number | string | undefined)[][] = []; for (let i = 0; i < 5; i++) sc.push([0.1 + i * 0.05, 0.004, h - 0.1, 0.03, 0.02 + (i % 2) * 0.012, 0.03, 0, i % 2 ? '#e0b23f' : '#c8a66a']); sc.push([w - 0.2, 0.004, h - 0.1, 0.1, 0.03, 0.035, 0, '#f4f1ea']); many(g, sc, mat('#ffffff')); }
  if (d!.type === 'ios') return yard(g, w, h, show, d!, leased, tenant, seed, short);
  if (d!.type !== 'spec') return commercial(g, w, h, show, d!.type, d!.spec.extras || d!.reno === 'reposition', leased, seed, '#d9622b', tenant, short);
  return spec(g, w, h, show, d!.spec, leased, seed, '#d9622b', tenant, short);
}

function yard(g: THREE.Group, w: number, h: number, prog: number, d: Deal, leased: number, tenant: string | null, seed: number, name: string): SiteModel {
  const t = tex(), m = 0.03, yw = w - m * 2, yh = h - m * 2, done = prog >= 1;
  slab(g, w - 0.02, h - 0.02, w / 2, h / 2, 0.004, texMat(t.dirt, w * 2, h * 2));
  const cover = Math.max(0.03, prog);
  slab(g, yw * cover, yh, m + (yw * cover) / 2, h / 2, 0.007, texMat(t[d.ios.surface], w * 5 * cover, h * 5));
  const items: (number | string | undefined)[][] = [];
  let anim: ((time: number) => void) | undefined;

  if (!done) {
    // grader and roller working the leading edge, a dump truck, and a material pile
    const rig = new THREE.Group(); g.add(rig);
    box(rig, 0.04, 0.02, 0.07, 0, 0.006, 0, mat('#e0b23f')); box(rig, 0.03, 0.018, 0.025, 0, 0.026, -0.012, mat('#2f3336')); box(rig, 0.06, 0.008, 0.006, 0, 0.004, 0.045, mat('#3a3d40'));
    const roller = new THREE.Group(); g.add(roller);
    box(roller, 0.03, 0.02, 0.04, 0, 0.006, 0, mat('#d9a520')); box(roller, 0.034, 0.014, 0.016, 0, 0, 0.026, mat('#4a4d50'));
    anim = (time) => { const x = m + yw * cover; rig.position.set(x, 0, m + 0.08 + (Math.sin(time * 0.5) * 0.5 + 0.5) * (yh - 0.16)); roller.position.set(Math.max(m + 0.05, x - 0.09), 0, m + 0.08 + (Math.cos(time * 0.4) * 0.5 + 0.5) * (yh - 0.16)); };
    truck(items, Math.min(w - 0.1, m + yw * cover + 0.1), h - 0.14, 1.2, true, seed);
    for (let i = 0; i < 5; i++) items.push([w - 0.12 - hash(seed, i, 31) * 0.1, 0, 0.1 + i * 0.03, 0.05, 0.012 + hash(seed, i, 32) * 0.02, 0.04, hash(seed, i, 33), '#9c978c']);
  }
  if (prog > 0.7) {
    // chain-link fence with posts, gate on the south side
    const fm = texMat(t.fence, 1, 1, { transparent: true }), fh = 0.03;
    const side = (len: number, x: number, z: number, rot: number) => { const f = new THREE.Mesh(new THREE.PlaneGeometry(len, fh), texMat(t.fence, len * 40, 1.6, { transparent: true })); f.position.set(x, fh / 2 + 0.004, z); f.rotation.y = rot; g.add(f); void fm; };
    side(yw, w / 2, m, 0); side(yh, m, h / 2, Math.PI / 2); side(yh, w - m, h / 2, Math.PI / 2);
    const gate = 0.14, half = (yw - gate) / 2;
    side(half, m + half / 2, h - m, 0); side(half, w - m - half / 2, h - m, 0);
    for (let x = m; x <= w - m + 0.001; x += yw / Math.round(yw / 0.1)) { items.push([x, 0, m, 0.005, fh + 0.006, 0.005, 0, '#6d747a']); if (Math.abs(x - w / 2) > gate / 2) items.push([x, 0, h - m, 0.005, fh + 0.006, 0.005, 0, '#6d747a']); }
    for (let z = m; z <= h - m + 0.001; z += yh / Math.round(yh / 0.1)) { items.push([m, 0, z, 0.005, fh + 0.006, 0.005, 0, '#6d747a']); items.push([w - m, 0, z, 0.005, fh + 0.006, 0.005, 0, '#6d747a']); }
    items.push([w / 2 - gate / 2, 0, h - m, 0.012, 0.045, 0.012, 0, '#3d4248'], [w / 2 + gate / 2, 0, h - m, 0.012, 0.045, 0.012, 0, '#3d4248']);
    if (done) items.push([w / 2 + gate * 0.9, 0.004, h - m + 0.004, gate, 0.026, 0.004, 0, '#8a9198']);
  }
  if (done) {
    const premium = d.ios.security === 'premium', glow: Items = [];
    const poles: number[][] = premium ? [[m + 0.04, m + 0.04], [w - m - 0.04, m + 0.04], [m + 0.04, h - m - 0.04], [w - m - 0.04, h - m - 0.04], [w / 2, m + 0.04], [w / 2, h / 2]] : [[m + 0.04, h - m - 0.04], [w - m - 0.04, m + 0.04]];
    for (const [x, z] of poles) { items.push([x, 0, z, 0.006, 0.11, 0.006, 0, '#4a4f55'], [x, 0.108, z, 0.03, 0.006, 0.012, 0.6, '#3a3d40']); glow.push([x + 0.008, 0.103, z, 0.024, 0.004, 0.012, 0.6]); }
    many(g, glow, GLOW, false);
    if (premium) { box(g, 0.04, 0.03, 0.04, w / 2 - 0.13, 0.004, h - m - 0.04, mat('#e9e3d5')); box(g, 0.046, 0.004, 0.046, w / 2 - 0.13, 0.034, h - m - 0.04, mat('#55606a')); }
    sign(g, w / 2 + 0.2, h - 0.012, tenant ? [tenant.split(' ').slice(0, 2).join(' ').toUpperCase()] : ['YARD FOR LEASE', name.toUpperCase().slice(0, 18)], tenant ? '#26323c' : '#fbf6e9', tenant ? '#ffffff' : '#b3402e', 0.8);
    if (leased > 0) {
      // rows of trailers, some containers, a few pieces of yellow iron, pickups by the gate
      const kind = tenant ? hash(tenant.length, tenant.charCodeAt(0), 3) : 0.5;
      let i = 0;
      for (let z = m + 0.09; z < h - m - 0.16; z += 0.15) for (let x = m + 0.05; x < w - m - 0.04; x += 0.034) {
        i++;
        if (hash(seed, i, 41) > 0.78) continue;
        if (kind < 0.33 && hash(seed, i, 42) < 0.5) { const hh = hash(seed, i, 43) < 0.4 ? 2 : 1; for (let s = 0; s < hh; s++) items.push([x, 0.002 + s * 0.026, z, 0.024, 0.026, 0.06 + (i % 2) * 0.05, 0, ['#c9502f', '#3f6f8f', '#e0b23f', '#5c8a5a', '#7d4b8f'][Math.floor(hash(seed, i, 44 + s) * 5)]]); }
        else if (kind > 0.66 && hash(seed, i, 45) < 0.3) { items.push([x, 0.004, z, 0.03, 0.022, 0.05, 0, '#e0b23f'], [x, 0.026, z - 0.008, 0.02, 0.018, 0.022, 0, '#2f3336'], [x, 0.03, z + 0.035, 0.008, 0.008, 0.06, 0.2, '#d9a520']); }
        else truck(items, x, z, 0, hash(seed, i, 46) < 0.25, seed + i);
      }
      for (let k = 0; k < 4; k++) items.push([w / 2 - 0.2 - k * 0.035, 0.003, h - m - 0.045, 0.02, 0.014, 0.04, 0, ['#f4f1ea', '#b3402e', '#3d4248', '#2f5f8a'][k]]);
    }
  }
  many(g, items, mat('#ffffff'));
  return { group: g, anim };
}

function spec(g: THREE.Group, w: number, h: number, prog: number, design: { coverage: number; clear: number; extras: boolean }, leased: number, seed: number, accent: string, tenant: string | null, name = ''): SiteModel {
  const t = tex(), m = 0.04, done = prog >= 1;
  const lotW = w > 1 ? 0.24 : 0.14; // car lot and office at the east end
  const availW = w - m * 2 - lotW, bw = availW * (design.coverage >= 0.4 ? 1 : design.coverage >= 0.35 ? 0.92 : 0.82);
  const bd = (h - m * 2) * (h > 1 ? 0.5 : 0.46), bh = 0.1 + (design.clear - 28) * 0.004;
  const bx = m + bw / 2, bz = m + 0.02 + bd / 2, south = bz + bd / 2;
  const items: (number | string | undefined)[][] = [], trunks: (number | string | undefined)[][] = [], crowns: (number | string | undefined)[][] = [];
  let anim: ((time: number) => void) | undefined;

  slab(g, w - 0.02, h - 0.02, w / 2, h / 2, 0.004, texMat(t.dirt, w * 2, h * 2));
  if (prog > 0.9) {
    slab(g, w - m * 2, h - m - south + 0.0, w / 2, (south + h - m) / 2, 0.006, texMat(t.paved, w * 4, 2)); // truck court
    slab(g, lotW - 0.02, bd, w - m - lotW / 2 + 0.01, bz, 0.0065, texMat(t.asphalt, Math.max(1, Math.round(lotW * 8)), 1)); // car lot
  }
  if (prog > 0.15) box(g, bw + 0.012, 0.006, bd + 0.012, bx, 0.004, bz, mat('#c9c5bb'), false); // slab

  const docks = Math.max(4, Math.round(bw * 15));
  if (prog > 0.88) {
    // finished shell: tilt-wall sides, dock doors on the south face, white roof
    const side = (rep: number) => texMat(t.wall, rep, 1), roof = texMat(t.roof, Math.round(bw * 6), Math.round(bd * 6));
    const body = box(g, bw, bh, bd, bx, 0.008, bz, [side(Math.round(bd * 12)), side(Math.round(bd * 12)), roof, roof, texMat(t.dock, docks, 1), side(Math.round(bw * 12))]);
    void body;
    box(g, bw + 0.004, 0.008, bd + 0.004, bx, 0.008 + bh * 0.8, bz, mat(accent)); // color band
    box(g, bw + 0.006, 0.004, bd + 0.006, bx, 0.008 + bh, bz, mat('#d8d3c7')); // parapet cap
    for (let i = 0; i < Math.round(bw * 5); i++) items.push([bx - bw / 2 + 0.08 + i * (bw - 0.16) / Math.max(1, Math.round(bw * 5) - 1), 0.012 + bh, bz - bd * 0.2 + (i % 2) * bd * 0.4, 0.028, 0.012, 0.022, 0, '#aab1b6']);
    // glass office corner with an entry canopy
    const gl = litGlass(3, 2);
    { const glow: Items = []; for (let i = 0; i < Math.round(bw * 6); i++) glow.push([bx - bw / 2 + 0.05 + i * ((bw - 0.1) / Math.max(1, Math.round(bw * 6) - 1)), 0.008 + bh * 0.72, bz + bd / 2 + 0.004, 0.016, 0.005, 0.006]); many(g, glow, GLOW, false); }
    box(g, 0.07, bh * 0.62, 0.09, bx + bw / 2 + 0.02, 0.008, bz + bd / 2 - 0.06, gl);
    box(g, 0.085, 0.004, 0.05, bx + bw / 2 + 0.03, 0.008 + bh * 0.3, bz + bd / 2 - 0.0, mat(accent));
  } else if (prog > 0.3) {
    // tilt-wall panels going up one at a time, then roof steel
    const f = Math.min(1, (prog - 0.3) / 0.42), pw = 0.07;
    const spots: number[][] = [];
    const nx = Math.max(2, Math.round(bw / pw)), nz = Math.max(2, Math.round(bd / pw));
    for (let i = 0; i < nx; i++) spots.push([bx - bw / 2 + (i + 0.5) * (bw / nx), bz - bd / 2, bw / nx, 0]);
    for (let i = 0; i < nz; i++) spots.push([bx - bw / 2, bz - bd / 2 + (i + 0.5) * (bd / nz), bd / nz, 1]);
    for (let i = 0; i < nz; i++) spots.push([bx + bw / 2, bz - bd / 2 + (i + 0.5) * (bd / nz), bd / nz, 1]);
    for (let i = 0; i < nx; i++) spots.push([bx - bw / 2 + (i + 0.5) * (bw / nx), bz + bd / 2, bw / nx, 0]);
    const up = Math.floor(spots.length * f);
    spots.slice(0, up).forEach(([x, z, len, turn], i) => { items.push([x, 0.008, z, turn ? 0.008 : len * 0.94, bh, turn ? len * 0.94 : 0.008, 0, i % 2 ? '#d9d4c8' : '#cfc9bc']); items.push([x + (turn ? (x < bx ? 0.03 : -0.03) : 0), 0.008, z + (turn ? 0 : z < bz ? 0.03 : -0.03), 0.004, bh * 0.7, 0.004, 0, '#8a6d3b']); });
    if (prog > 0.72) for (let i = 0; i < Math.round(bw / 0.06); i++) items.push([bx - bw / 2 + 0.03 + i * 0.06, 0.008 + bh - 0.006, bz, 0.005, 0.006, bd, 0, '#b3402e']);
    if (prog > 0.82) items.push([bx - bw * (1 - (prog - 0.82) / 0.06) * 0.5, 0.008 + bh, bz, bw * Math.min(1, (prog - 0.82) / 0.06), 0.003, bd, 0, '#f1eee6']);
  }

  if (!done) {
    // crawler crane, site trailer, material stacks, an excavator in early stages
    const crane = new THREE.Group(); crane.position.set(Math.min(w - m - 0.1, bx + bw / 2 + 0.07), 0, south + 0.09); g.add(crane);
    box(crane, 0.05, 0.016, 0.06, 0, 0.004, 0, mat('#2f3336')); const top = new THREE.Group(); top.position.y = 0.02; crane.add(top);
    box(top, 0.04, 0.026, 0.05, 0, 0, 0, mat('#e0b23f'));
    const boom = new THREE.Mesh(UNIT, mat('#d9a520')); boom.scale.set(0.008, 0.26, 0.008); boom.position.set(0, 0.12, -0.07); boom.rotation.x = -0.5; boom.castShadow = true; top.add(boom);
    const line = new THREE.Mesh(UNIT, mat('#3a3d40')); line.scale.set(0.002, 0.14, 0.002); line.position.set(0, 0.15, -0.134); top.add(line);
    if (prog > 0.1) anim = (time) => { top.rotation.y = Math.sin(time * 0.35 + seed) * 1.1 + 0.6; };
    items.push([w - m - 0.08, 0.004, h - m - 0.06, 0.1, 0.03, 0.035, 0, '#f4f1ea'], [w - m - 0.08, 0.034, h - m - 0.06, 0.104, 0.003, 0.039, 0, '#8a9198']);
    for (let i = 0; i < 7; i++) items.push([m + 0.08 + i * 0.07, 0.004, h - m - 0.05 - (i % 2) * 0.05, 0.05, 0.01 + hash(seed, i, 61) * 0.02, 0.03, 0, i % 3 ? '#b9b3a6' : '#c8a66a']);
    if (prog < 0.3) { items.push([bx, 0.004, bz + 0.05, 0.04, 0.02, 0.06, 0.7, '#e0b23f'], [bx + 0.03, 0.02, bz + 0.09, 0.008, 0.008, 0.07, 0.7, '#d9a520']); truck(items, bx - 0.15, bz, 1.57, true, seed); }
  } else {
    // trucks at the docks and trailers along the south line, scaled by how much is leased
    const active = Math.round(docks * leased * 0.6);
    for (let i = 0; i < docks; i++) if (i < docks * leased && hash(seed, i, 71) < 0.62 && active > 0) truck(items, bx - bw / 2 + (i + 0.5) * (bw / docks), south + 0.058, 0, hash(seed, i, 72) < 0.4, seed + i);
    for (let x = m + 0.05; x < w - m - 0.05; x += 0.036) if (hash(seed, Math.round(x * 100), 73) < 0.75 * leased) truck(items, x, h - m - 0.07, 0, false, seed + Math.round(x * 50));
    for (let i = 0; i < Math.round(lotW * 30); i++) if (hash(seed, i, 74) < 0.2 + leased * 0.6) items.push([w - m - lotW + 0.035 + (i % 4) * ((lotW - 0.05) / 4), 0.004, bz - bd / 2 + 0.04 + Math.floor(i / 4) * 0.05, 0.02, 0.013, 0.036, 0, ['#f4f1ea', '#b3402e', '#3d4248', '#2f5f8a', '#c9c5bb', '#1f2327'][Math.floor(hash(seed, i, 75) * 6)]]);
    for (let x = m + 0.05; x < w - m; x += 0.11) tree(trunks, crowns, x, h - 0.022, 0.8);
    for (let z = m + 0.05; z < h - m; z += 0.11) tree(trunks, crowns, w - 0.022, z, 0.8);
    sign(g, w - m - 0.1, h - 0.02, leased >= 0.999 && tenant ? [tenant.split(' ').slice(0, 2).join(' ').toUpperCase()] : leased > 0 ? ['50% LEASED', 'SPACE AVAILABLE'] : name ? ['FOR LEASE', name.toUpperCase().slice(0, 18)] : ['INDUSTRIAL'], leased >= 0.999 ? '#26323c' : '#fbf6e9', leased >= 0.999 ? '#ffffff' : '#b3402e', 0.9);
    if (leased < 0.999 && name) { const b = new THREE.Mesh(UNIT, [mat('#fff'), mat('#fff'), mat('#fff'), mat('#fff'), new THREE.MeshStandardMaterial({ map: signTex(['FOR LEASE'], '#b3402e', '#ffffff') }), mat('#fff')]); b.scale.set(0.2, 0.04, 0.004); b.position.set(bx + bw * (leased > 0 ? 0.25 : 0), bh * 0.62, south + 0.003); g.add(b); }
  }
  many(g, items, mat('#ffffff')); many(g, trunks, mat('#ffffff')); many(g, crowns, mat('#ffffff', { rough: 1 }), true, BALL);
  return { group: g, anim };
}

type Items = (number | string | undefined)[][];
const CARS = ['#f4f1ea', '#b3402e', '#3d4248', '#2f5f8a', '#c9c5bb', '#1f2326', '#8a9198'];

/** A crawler crane that swings while work is under way. */
function crane(g: THREE.Group, x: number, z: number, seed: number, tall = 0.26): (time: number) => void {
  const c = new THREE.Group(); c.position.set(x, 0, z); g.add(c);
  box(c, 0.05, 0.016, 0.06, 0, 0.004, 0, mat('#2f3336')); const top = new THREE.Group(); top.position.y = 0.02; c.add(top);
  box(top, 0.04, 0.026, 0.05, 0, 0, 0, mat('#e0b23f'));
  const boom = new THREE.Mesh(UNIT, mat('#d9a520')); boom.scale.set(0.008, tall, 0.008); boom.position.set(0, tall * 0.46, -tall * 0.27); boom.rotation.x = -0.5; boom.castShadow = true; top.add(boom);
  return (time) => { top.rotation.y = Math.sin(time * 0.35 + seed) * 1.1 + 0.6; };
}

/** Rows of parked cars on a lot. fill is the share of stalls taken. */
function carLot(items: Items, x0: number, z0: number, x1: number, z1: number, fill: number, seed: number) {
  let n = 0;
  for (let z = z0 + 0.03; z < z1 - 0.02; z += 0.062) for (let x = x0 + 0.02; x < x1 - 0.015; x += 0.027) { n++; if (hash(seed, n, 81) < fill) items.push([x, 0.006, z, 0.018, 0.012, 0.034, 0, CARS[Math.floor(hash(seed, n, 82) * CARS.length)]]); }
}

/** Shopping centers, office buildings and apartments, from bare dirt to a finished property. */
function commercial(g: THREE.Group, w: number, h: number, prog: number, type: 'retail' | 'office' | 'mf', premium: boolean, leased: number, seed: number, accent: string, tenant: string | null, name: string): SiteModel {
  const t = tex(), m = 0.04, done = prog >= 1, shell = prog > 0.88;
  const items: Items = [], trunks: Items = [], crowns: Items = [];
  let anim: ((time: number) => void) | undefined;
  const glass = (rx: number, ry: number, tint = '#ffffff') => litGlass(rx, ry, tint, type === 'office' ? 1 : 1.3);
  const glow: Items = [];
  slab(g, w - 0.02, h - 0.02, w / 2, h / 2, 0.004, texMat(t.dirt, w * 2, h * 2));

  // building volumes: [center x, center z, width, depth, height]
  const vols: number[][] = [];
  let lot: number[]; // parking: x0, z0, x1, z1
  if (type === 'retail') {
    const bd = 0.17, bw = w - m * 2 - 0.02;
    vols.push([m + 0.01 + bw * 0.36, m + 0.02 + bd / 2, bw * 0.72, bd, 0.05], [m + 0.01 + bw * 0.86, m + 0.02 + (bd + 0.05) / 2, bw * 0.28, bd + 0.05, 0.078]);
    lot = [m + 0.02, m + bd + 0.09, w - m - 0.02, h - m - 0.06];
  } else if (type === 'office') {
    const bw = w > 1 ? 0.5 : 0.34, bd = 0.24, floors = (w > 1 ? 6 : 5) + (premium ? 1 : 0);
    vols.push([m + 0.05 + bw / 2, m + 0.05 + bd / 2, bw, bd, floors * 0.036]);
    if (w > 1) vols.push([w - m - 0.3, m + 0.04 + 0.12, 0.42, 0.24, 0.07]); // parking deck
    lot = [m + 0.02, m + bd + 0.13, w - m - 0.02, h - m - 0.05];
  } else {
    const n = w > 1 ? 4 : 2, bw = (w - m * 2 - 0.06 - (n - 1) * 0.05) / n, top = 0.108 + (premium ? 0.036 : 0);
    for (let i = 0; i < n; i++) vols.push([m + 0.03 + bw / 2 + i * (bw + 0.05), m + 0.03 + 0.085, bw, 0.17, top]);
    for (let i = 0; i < n; i += 2) vols.push([n === 2 ? m + 0.01 + (w - m * 2 - 0.3) / 2 : m + 0.03 + bw + 0.025 + i * (bw + 0.05), h - m - 0.2, n === 2 ? w - m * 2 - 0.3 : bw * 1.4, 0.13, top]);
    lot = [m + 0.02, m + 0.24, w - m - 0.02, h - m - 0.3];
  }

  if (prog > 0.9) slab(g, lot[2] - lot[0], Math.max(0.05, lot[3] - lot[1]), (lot[0] + lot[2]) / 2, (lot[1] + lot[3]) / 2, 0.0065, texMat(t.asphalt, Math.max(1, Math.round((lot[2] - lot[0]) * 8)), Math.max(1, Math.round((lot[3] - lot[1]) * 6))));
  for (const [x, z, bw, bd] of vols) if (prog > 0.12) box(g, bw + 0.012, 0.006, bd + 0.012, x, 0.004, z, mat('#c9c5bb'), false);

  if (shell) {
    vols.forEach(([x, z, bw, bd, bh], i) => {
      if (type === 'retail') {
        const wall = mat(i ? '#d9cdb8' : '#e6ddca');
        box(g, bw, bh, bd, x, 0.008, z, [wall, wall, texMat(t.roof, 4, 2), wall, glass(Math.max(2, Math.round(bw * 14)), 1), wall]);
        box(g, bw + 0.006, 0.012, bd + 0.006, x, 0.008 + bh, z, mat(i ? accent : '#cfc4ae')); // parapet
        const bays = Math.max(2, Math.round(bw / 0.085));
        if (!i) for (let b = 0; b < bays; b++) items.push([x - bw / 2 + (b + 0.5) * (bw / bays), 0.008 + bh * 0.62, z + bd / 2 + 0.012, (bw / bays) * 0.82, 0.006, 0.03, 0, b < Math.ceil(bays * leased) ? ['#b3402e', '#2f6f73', '#c98a2b', '#3f5f8a', '#6c5a9c'][b % 5] : '#bdb6a6']);
        else items.push([x, 0.008 + bh * 0.7, z + bd / 2 + 0.014, bw * 0.7, 0.008, 0.034, 0, leased > 0.4 ? accent : '#bdb6a6']);
      } else if (type === 'office') {
        if (i) { // parking deck
          const lv = 3; for (let k = 0; k < lv; k++) { items.push([x, 0.008 + k * (bh / lv), z, bw, 0.006, bd, 0, '#bdb8ad']); for (const sx of [-1, 1]) for (const sz of [-1, 0, 1]) items.push([x + sx * (bw / 2 - 0.01), 0.008 + k * (bh / lv), z + sz * (bd / 2 - 0.01), 0.012, bh / lv, 0.012, 0, '#a9a498']); }
          items.push([x, 0.008 + bh, z, bw, 0.006, bd, 0, '#c9c5bb']); carLot(items, x - bw / 2, z - bd / 2, x + bw / 2, z + bd / 2, 0.15 + leased * 0.6, seed + 5); for (let k = items.length - 1; k >= 0 && items[k].length === 8 && items[k][4] === 0.012; k--) items[k][1] = 0.016 + bh;
        } else {
          const fl = Math.round(bh / 0.036), gm = glass(Math.max(3, Math.round(bw * 16)), fl, premium ? '#bfe0ea' : '#ffffff'), gs = glass(Math.max(3, Math.round(bd * 16)), fl, premium ? '#bfe0ea' : '#ffffff');
          box(g, bw, bh, bd, x, 0.008, z, [gs, gs, texMat(t.roof, 3, 3), gs, gm, gm]);
          for (let k = 0; k <= fl; k++) items.push([x, 0.008 + k * 0.036 - 0.002, z, bw + 0.006, 0.004, bd + 0.006, 0, '#ece7db']);
          items.push([x - bw * 0.2, 0.01 + bh, z, bw * 0.3, 0.02, bd * 0.4, 0, '#aab1b6'], [x + bw * 0.25, 0.01 + bh, z - bd * 0.15, 0.04, 0.03, 0.04, 0, '#8f979c']);
          items.push([x, 0.008 + 0.04, z + bd / 2 + 0.03, bw * 0.34, 0.005, 0.06, 0, accent], [x - bw * 0.15, 0.008, z + bd / 2 + 0.055, 0.006, 0.04, 0.006, 0, '#8a9198'], [x + bw * 0.15, 0.008, z + bd / 2 + 0.055, 0.006, 0.04, 0.006, 0, '#8a9198']);
        }
      } else {
        const wall = mat(['#e3d2b8', '#d8b99a', '#cfd2c4', '#e6dccb'][(i + (seed % 4)) % 4]);
        box(g, bw, bh, bd, x, 0.008, z, wall);
        box(g, bw + 0.014, 0.01, bd + 0.014, x, 0.008 + bh, z, mat(premium ? '#4b5560' : '#7a5a45')); // roof
        const fl = Math.round(bh / 0.036), cols = Math.max(2, Math.round(bw / 0.06));
        for (let k = 0; k < fl; k++) for (let c = 0; c < cols; c++) for (const sz of [-1, 1]) {
          const cx = x - bw / 2 + (c + 0.5) * (bw / cols), lit = hash(seed, i * 97 + k * 13 + c, sz + 3) < leased;
          items.push([cx, 0.014 + k * 0.036, z + sz * (bd / 2 + 0.001), (bw / cols) * 0.5, 0.018, 0.003, 0, lit ? '#7fa9c0' : '#5e6a72']);
          if (lit && hash(seed + 3, i * 31 + k * 7 + c, sz + 9) < 0.6) glow.push([cx, 0.015 + k * 0.036, z + sz * (bd / 2 + 0.0035), (bw / cols) * 0.44, 0.015, 0.002]);
          if (k > 0) items.push([cx, 0.008 + k * 0.036, z + sz * (bd / 2 + 0.01), (bw / cols) * 0.62, 0.003, 0.02, 0, '#f1ece0']);
        }
      }
    });
  } else if (prog > 0.25) {
    // structure rising floor by floor
    const f = Math.min(1, (prog - 0.25) / 0.6);
    for (const [x, z, bw, bd, bh] of vols) {
      const fl = Math.max(1, Math.round(bh / 0.036)), up = Math.max(1, Math.ceil(fl * f));
      for (let k = 0; k < up; k++) {
        items.push([x, 0.008 + (k + 1) * (bh / fl) - 0.004, z, bw, 0.004, bd, 0, '#bdb8ad']);
        const nx = Math.max(2, Math.round(bw / 0.08));
        for (let c = 0; c <= nx; c++) for (const sz of [-1, 1]) items.push([x - bw / 2 + c * (bw / nx), 0.008 + k * (bh / fl), z + sz * (bd / 2 - 0.004), 0.006, bh / fl, 0.006, 0, type === 'mf' ? '#c8a66a' : '#9aa0a4']);
      }
      if (f > 0.75) items.push([x, 0.008, z - bd / 2, bw, (bh * up) / fl, 0.004, 0, type === 'mf' ? '#e9e1cf' : '#d6dde0']);
    }
  }

  if (!done) {
    const v = vols[0];
    anim = crane(g, Math.min(w - m - 0.08, v[0] + v[2] / 2 + 0.07), Math.min(h - m - 0.12, v[1] + v[3] / 2 + 0.1), seed, type === 'office' ? 0.36 : 0.26);
    items.push([w - m - 0.08, 0.004, h - m - 0.06, 0.1, 0.03, 0.035, 0, '#f4f1ea'], [w - m - 0.08, 0.034, h - m - 0.06, 0.104, 0.003, 0.039, 0, '#8a9198']);
    for (let i = 0; i < 6; i++) items.push([m + 0.08 + i * 0.07, 0.004, h - m - 0.05 - (i % 2) * 0.05, 0.05, 0.01 + hash(seed, i, 61) * 0.02, 0.03, 0, i % 3 ? '#b9b3a6' : '#c8a66a']);
    if (prog < 0.25) { items.push([v[0], 0.004, v[1] + 0.05, 0.04, 0.02, 0.06, 0.7, '#e0b23f'], [v[0] + 0.03, 0.02, v[1] + 0.09, 0.008, 0.008, 0.07, 0.7, '#d9a520']); truck(items, v[0] - 0.12, v[1], 1.57, true, seed); }
  } else {
    carLot(items, lot[0], lot[1], lot[2], lot[3], type === 'retail' ? 0.12 + leased * 0.55 : 0.15 + leased * 0.6, seed);
    if (type === 'mf') {
      // courtyard: pool, deck and clubhouse
      const cx = w > 1 ? w / 2 : w * 0.8, cz = h - m - 0.2;
      slab(g, 0.16, 0.11, cx, cz, 0.0075, mat('#d8cfbc')); slab(g, 0.1, 0.055, cx, cz, 0.009, mat('#49b6d6', { rough: 0.15 }));
      if (w > 1) items.push([cx, 0.006, cz - 0.1, 0.12, 0.03, 0.05, 0, '#e6ddca'], [cx, 0.036, cz - 0.1, 0.13, 0.006, 0.06, 0, '#7a5a45']);
      for (let i = 0; i < 14 * w; i++) tree(trunks, crowns, m + 0.03 + hash(seed, i, 91) * (w - 0.14), h - m - 0.3 + hash(seed, i, 92) * 0.27, 0.8 + hash(seed, i, 93) * 0.5);
    } else if (type === 'office') {
      for (let i = 0; i < 6; i++) tree(trunks, crowns, vols[0][0] - vols[0][2] / 2 + i * (vols[0][2] / 5), vols[0][1] + vols[0][3] / 2 + 0.09, 0.9);
      slab(g, vols[0][2], 0.05, vols[0][0], vols[0][1] + vols[0][3] / 2 + 0.045, 0.007, mat('#d8cfbc'));
    } else {
      for (let x = lot[0] + 0.1; x < lot[2]; x += 0.22) tree(trunks, crowns, x, (lot[1] + lot[3]) / 2 + 0.03, 0.7);
      // pylon sign by the road
      box(g, 0.014, 0.13, 0.014, m + 0.07, 0, h - 0.035, mat('#5c6166')); box(g, 0.075, 0.05, 0.012, m + 0.07, 0.1, h - 0.035, mat(accent));
    }
    for (let x = m + 0.05; x < w - m; x += 0.11) tree(trunks, crowns, x, h - 0.022, 0.8);
    for (let z = m + 0.05; z < h - m; z += 0.11) tree(trunks, crowns, w - 0.022, z, 0.8);
    const full = leased >= 0.999, label = type === 'mf' ? (full ? [name.toUpperCase().slice(0, 18), 'APARTMENTS'] : ['NOW LEASING', `${Math.round(leased * 94)}% OCCUPIED`]) : full && tenant ? [tenant.split(' ').slice(0, 2).join(' ').toUpperCase()] : leased > 0 ? ['50% LEASED', 'SPACE AVAILABLE'] : ['FOR LEASE', name.toUpperCase().slice(0, 18)];
    sign(g, w - m - 0.12, h - 0.02, label, full ? '#26323c' : '#fbf6e9', full ? '#f3ead2' : '#b3402e', 1.25);
  }
  if (done) for (let x = lot[0] + 0.12; x < lot[2] - 0.05; x += 0.26) for (let z = lot[1] + 0.06; z < lot[3]; z += 0.2) { items.push([x, 0, z, 0.005, 0.085, 0.005, 0, '#4a4f55']); glow.push([x, 0.083, z, 0.022, 0.004, 0.022]); }
  many(g, items, mat('#ffffff')); many(g, trunks, mat('#ffffff')); many(g, crowns, mat('#ffffff', { rough: 1 }), true, BALL); many(g, glow, GLOW, false);
  return { group: g, anim };
}

const HIVIS = ['#f2c230', '#f07a1e', '#f2c230', '#e9e4d8'], STREET = ['#2f5f8a', '#b3402e', '#3d4248', '#e9e4d8', '#5c8a5a', '#c98a2b', '#7d4b8f'];
/** Small figures that walk back and forth inside a rectangle of the site: crews during construction, visitors once it is open. */
function people(g: THREE.Group, n: number, x0: number, z0: number, x1: number, z1: number, seed: number, cols: string[], hardhat = false): (time: number) => void {
  const body = new THREE.InstancedMesh(UNIT, mat('#ffffff'), n), head = new THREE.InstancedMesh(UNIT, mat('#ffffff'), n), o = new THREE.Object3D(), col = new THREE.Color();
  const path = Array.from({ length: n }, (_, i) => ({ ax: x0 + hash(seed, i, 11) * (x1 - x0), az: z0 + hash(seed, i, 12) * (z1 - z0), bx: x0 + hash(seed, i, 13) * (x1 - x0), bz: z0 + hash(seed, i, 14) * (z1 - z0), sp: 0.05 + hash(seed, i, 15) * 0.05, ph: hash(seed, i, 16) * 9 }));
  for (let i = 0; i < n; i++) { body.setColorAt(i, col.set(cols[Math.floor(hash(seed, i, 17) * cols.length)])); head.setColorAt(i, col.set(hardhat ? (i % 3 ? '#f4f1ea' : '#f2c230') : ['#e0b08a', '#c68e62', '#8d5a3b', '#f0c9a4'][i % 4])); }
  body.castShadow = true; body.frustumCulled = head.frustumCulled = false; g.add(body, head);
  return (time) => {
    path.forEach((p, i) => {
      const len = Math.hypot(p.bx - p.ax, p.bz - p.az) || 1, u = (time * p.sp) / len + p.ph, f = Math.abs(((u % 2) + 2) % 2 - 1), e = Math.min(1, Math.max(0, f * 1.3 - 0.15)), walking = e > 0 && e < 1;
      const x = p.ax + (p.bx - p.ax) * e, z = p.az + (p.bz - p.az) * e, bob = walking ? Math.abs(Math.sin(time * 9 + i)) * 0.0012 : 0;
      o.rotation.set(0, Math.atan2(p.bx - p.ax, p.bz - p.az), 0);
      o.position.set(x, 0.013 + bob, z); o.scale.set(0.007, 0.014, 0.005); o.updateMatrix(); body.setMatrixAt(i, o.matrix);
      o.position.set(x, 0.0235 + bob, z); o.scale.set(0.0055, 0.0055, 0.0055); o.updateMatrix(); head.setMatrixAt(i, o.matrix);
    });
    body.instanceMatrix.needsUpdate = head.instanceMatrix.needsUpdate = true;
  };
}
/** A forklift shuttling along a line in a working yard or truck court. */
function forklift(g: THREE.Group, ax: number, az: number, bx: number, bz: number, seed: number): (time: number) => void {
  const f = new THREE.Group(); g.add(f);
  box(f, 0.018, 0.014, 0.026, 0, 0.004, 0, mat('#e0b23f')); box(f, 0.016, 0.014, 0.012, 0, 0.018, -0.005, mat('#2f3336')); box(f, 0.003, 0.034, 0.003, 0.006, 0.004, 0.014, mat('#3a3d40')); box(f, 0.003, 0.034, 0.003, -0.006, 0.004, 0.014, mat('#3a3d40')); box(f, 0.02, 0.012, 0.016, 0, 0.012, 0.024, mat('#b98a55'));
  const ang = Math.atan2(bx - ax, bz - az), len = Math.hypot(bx - ax, bz - az) || 1;
  return (time) => { const u = (time * 0.07) / len + seed, k = Math.abs(((u % 2) + 2) % 2 - 1), e = k * k * (3 - 2 * k); f.position.set(ax + (bx - ax) * e, 0, az + (bz - az) * e); f.rotation.y = ang + (Math.floor(u) % 2 ? Math.PI : 0); };
}

/** The model for a site at its current stage, plus the people and machines moving on it. */
export function buildSite(p: Parcel, d: Deal | undefined): SiteModel {
  const model = buildModel(p, d), g = model.group, w = p.tile.w, h = p.tile.h, seed = p.tile.x * 131 + p.tile.y * 17, anims: ((t: number) => void)[] = model.anim ? [model.anim] : [];
  const building = !!d && d.phase === 'construction', open = !!d && ['leasing', 'operations', 'sold'].includes(d.phase), type = d?.type ?? p.existing?.type;
  const leased = d ? (d.type === 'mf' ? d.occ : d.leases.reduce((a, l) => a + l.share, 0)) : p.existing ? (p.existing.type === 'mf' ? p.existing.occ ?? 0 : p.existing.leases.reduce((a, l) => a + l.share, 0)) : 0;
  if (building) anims.push(people(g, Math.round(7 * w), 0.08, 0.08, w - 0.08, h - 0.1, seed, HIVIS, true));
  else if ((open || (p.existing && p.status !== 'rival')) && leased > 0.05) {
    if (type === 'ios') { anims.push(forklift(g, w * 0.25, h * 0.55, w * 0.75, h * 0.7, seed % 7)); anims.push(people(g, 3, 0.1, h * 0.6, w - 0.1, h - 0.1, seed, HIVIS, true)); }
    else if (type === 'spec') { anims.push(forklift(g, w * 0.2, h - 0.2, w * 0.7, h - 0.16, seed % 7)); anims.push(people(g, 4, 0.1, h - 0.24, w - 0.1, h - 0.08, seed, HIVIS, true)); }
    else anims.push(people(g, Math.round((type === 'retail' ? 14 : 9) * w * Math.min(1, leased + 0.2)), 0.08, type === 'mf' ? h - 0.3 : h * 0.34, w - 0.08, h - 0.07, seed, STREET));
  } else if (d && ['dd', 'entitlement', 'predev'].includes(d.phase) && !p.existing) anims.push(people(g, 2, w * 0.2, h * 0.3, w * 0.8, h * 0.8, seed, HIVIS, true)); // surveyors
  return { group: g, anim: anims.length ? (t) => { for (const a of anims) a(t); } : undefined };
}
