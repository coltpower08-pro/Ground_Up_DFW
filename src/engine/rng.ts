// Seeded random numbers (mulberry32). The state lives in the save file,
// so the same seed and the same choices always replay the same way.
import type { Game } from './types';

export function rand(g: Game): number {
  g.rng = (g.rng + 0x6d2b79f5) | 0;
  let t = g.rng;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
export const chance = (g: Game, p: number) => rand(g) < p;
export const between = (g: Game, lo: number, hi: number) => lo + rand(g) * (hi - lo);
export function pick<T>(g: Game, arr: T[]): T { return arr[Math.floor(rand(g) * arr.length)]; }
