// Close-up detail models from Kenney's CC0 kits (www.kenney.nl): houses, industrial buildings, trees and cars.
// They load after the map is already on screen, and only the area around the camera ever uses them, so the
// first paint and the far view cost nothing extra. If loading fails, the map simply keeps its built-in shapes.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/** One model, merged to a single geometry, standing on the ground, centred, with its longer side one unit long. */
export interface KitModel { geo: THREE.BufferGeometry; mat: THREE.Material[]; sx: number; sz: number; h: number }
export interface Kit { house: KitModel[]; ware: KitModel[]; tree: KitModel[]; fall: KitModel[]; pine: KitModel[]; car: KitModel[] }

export const FILES: Record<keyof Kit, string[]> = {
  house: ['h', 'i', 'g', 'k', 'r', 'a', 'm', 'q', 'c', 'j'].map((m) => `sub/house-${m}`),
  ware: ['h', 'i', 'j', 'k', 'o', 's', 'p'].map((m) => `ind/bldg-${m}`),
  tree: ['tree_default', 'tree_oak', 'tree_fat', 'tree_simple', 'tree_tall'].map((m) => `nat/${m}`),
  fall: ['tree_default_fall', 'tree_oak_fall', 'tree_simple_fall'].map((m) => `nat/${m}`),
  pine: ['tree_pineRoundA', 'tree_pineTallA'].map((m) => `nat/${m}`),
  car: ['sedan', 'suv', 'van', 'truck'].map((m) => `car/${m}`),
};

function normalize(root: THREE.Object3D): KitModel | null {
  root.updateMatrixWorld(true);
  const byMat = new Map<THREE.Material, THREE.BufferGeometry[]>();
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const g = m.geometry.clone().applyMatrix4(m.matrixWorld), mat = (Array.isArray(m.material) ? m.material[0] : m.material) as THREE.Material;
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    if (!g.attributes.normal) g.computeVertexNormals();
    (byMat.get(mat) ?? byMat.set(mat, []).get(mat)!).push(g.index ? g.toNonIndexed() : g);
  });
  if (!byMat.size) return null;
  const mats = [...byMat.keys()], parts = mats.map((m) => mergeGeometries(byMat.get(m)!, false)!);
  const geo = mergeGeometries(parts, true);
  if (!geo) return null;
  geo.computeBoundingBox();
  const b = geo.boundingBox!, size = b.getSize(new THREE.Vector3()), k = 1 / Math.max(size.x, size.z, 1e-6);
  geo.translate(-(b.min.x + b.max.x) / 2, -b.min.y, -(b.min.z + b.max.z) / 2).scale(k, k, k);
  geo.computeBoundingSphere();
  // the nature kit's teal leaves become North Texas greens, and its trunks a darker bark
  const LEAF: Record<string, string> = { leafsGreen: '#5f8a4c', leafsDark: '#47743f', leafsFall: '#c8792e', woodBark: '#6b4a32', woodBarkDark: '#5a3f2c', woodBirch: '#8a7a66' };
  for (const m of mats) { const s = m as THREE.MeshStandardMaterial; if (s.isMeshStandardMaterial) { s.metalness = 0; s.roughness = 0.85; if (LEAF[s.name]) s.color.set(LEAF[s.name]); } }
  return { geo, mat: mats, sx: size.x * k, sz: size.z * k, h: size.y * k };
}

/** Load every model. Resolves to null if anything goes wrong, so the caller can carry on without them. */
export async function loadKit(base: string): Promise<Kit | null> {
  try {
    const loader = new GLTFLoader(), out = {} as Kit;
    await Promise.all((Object.keys(FILES) as (keyof Kit)[]).map(async (group) => {
      const models = await Promise.all(FILES[group].map((f) => loader.loadAsync(`${base}models/${f}.glb`).then((g) => normalize(g.scene))));
      out[group] = models.filter((m): m is KitModel => !!m);
      // the kit's candy colours are toned toward the map's warmer palette
      if (group === 'house') for (const m of out[group]) for (const mt of m.mat) (mt as THREE.MeshStandardMaterial).color?.set('#ecdfcc');
      if (!out[group].length) throw new Error(`no ${group} models`);
    }));
    return out;
  } catch { return null; }
}
