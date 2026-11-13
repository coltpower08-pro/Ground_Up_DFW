// Browser saves (localStorage). Signed-in players also get a cloud copy through services/cloud.ts; the newer one wins.
import { migrate } from '../engine/sim';
import type { Game } from '../engine/types';

const KEY = 'ground-up-dfw.save.v3';

export function saveGame(g: Game): boolean {
  try { localStorage.setItem(KEY, JSON.stringify(g)); localStorage.setItem(KEY + '.at', String(Date.now())); return true; } catch { return false; }
}
/** When the browser save was written, ms; 0 if there is none. */
export function savedAt(): number { try { return localStorage.getItem(KEY) ? Number(localStorage.getItem(KEY + '.at') || 1) : 0; } catch { return 0; } }
export function loadGame(): Game | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const g = JSON.parse(raw) as Game;
    return g && g.version === 3 ? migrate(g) : null;
  } catch { return null; }
}
export function clearSave() { try { localStorage.removeItem(KEY); localStorage.removeItem(KEY + '.at'); } catch { /* storage unavailable */ } }
