import type { Gfx } from '../render/map3d';
import { create } from 'zustand';
import * as S from '../engine/sim';
import type { Game } from '../engine/types';
import { cloud, startCloud, type CloudUser } from '../services/cloud';
import { clearSave, loadGame, saveGame, savedAt } from '../services/save';

export type PanelId = 'deals' | 'rolodex' | 'capital' | 'portfolio' | 'market' | 'rivals' | 'almanac' | 'milestones';
export type Overlay = 'none' | 'zoning' | 'flood' | 'utilities' | 'land';
export interface Toast { id: number; text: string; tone: 'good' | 'bad' | 'info' }

interface UI {
  game: Game | null;
  rev: number;
  paused: boolean;
  speed: 1 | 2 | 4 | 8;
  sel: { kind: 'parcel' | 'deal'; id: string } | null;
  panel: PanelId | null;
  overlay: Overlay;
  toasts: Toast[];
  hasSave: boolean;
  /** Signed-in player, when Firebase is set up. */
  user: CloudUser | null;
  /** Firebase has loaded (always false when it is not set up). */
  cloudReady: boolean;
  /** Upload the game to the cloud save now, or at most once a minute when not forced. */
  sync: (force?: boolean) => void;
  /** Remove both the browser and cloud saves (after a career's score is posted). */
  forget: () => void;
  flat: boolean; // use the simple 2D map instead of 3D
  setFlat: (v: boolean) => void;
  gfx: Gfx; // 3D map picture settings
  setGfx: (g: Partial<Gfx>) => void;
  focusReq: { x: number; y: number; z: number; n: number } | null;
  focusOn: (x: number, y: number, z?: number) => void;
  start: (firmName: string, difficulty: Game['difficulty'], career: Game['career'], player: string) => void;
  resume: () => Promise<void>;
  quit: () => void;
  act: (fn: (g: Game) => S.Result | void) => S.Result | void;
  tick: (days: number) => void;
  set: (p: Partial<Pick<UI, 'paused' | 'speed' | 'sel' | 'panel' | 'overlay'>>) => void;
  toast: (text: string, tone?: Toast['tone']) => void;
  dismiss: (id: number) => void;
  save: () => void;
}

let toastId = 1;

export const useUI = create<UI>((set, get) => ({
  game: null, user: null, cloudReady: false, rev: 0, paused: true, speed: 1, sel: null, panel: null, overlay: 'none', toasts: [], hasSave: !!loadGame(), focusReq: null,
  flat: (() => { try { return localStorage.getItem('ground-up-dfw.flat') === '1' || location.hash === '#flat'; } catch { return false; } })(),
  gfx: (() => { const d: Gfx = { cycle: true, weather: true, quality: 'auto' }; try { return { ...d, ...JSON.parse(localStorage.getItem('ground-up-dfw.gfx') || '{}') }; } catch { return d; } })(),
  setGfx: (g) => { const gfx = { ...get().gfx, ...g }; try { localStorage.setItem('ground-up-dfw.gfx', JSON.stringify(gfx)); } catch { /* not saved */ } set({ gfx }); },
  setFlat: (v) => { try { localStorage.setItem('ground-up-dfw.flat', v ? '1' : '0'); } catch { /* not saved */ } set({ flat: v }); },
  focusOn: (x, y, z = 0.8) => set({ focusReq: { x, y, z, n: (get().focusReq?.n ?? 0) + 1 }, panel: null }),
  start: (firmName, difficulty, career, player) => { clearSave(); set({ game: S.newGame(undefined, firmName.trim() || 'Your Development Co.', difficulty, career, player.trim() || 'Player'), rev: 1, paused: true, sel: null, panel: null }); },
  resume: async () => {
    // the newer of the browser save and the cloud save wins
    let g = loadGame(), at = savedAt();
    try { const c = get().user ? await cloud()?.load() : null; if (c && (!g || c.at > at)) { g = c.game; saveGame(g); } } catch { /* offline: use the browser save */ }
    if (g) set({ game: g, rev: 1, paused: true, sel: null, panel: null });
  },
  sync: (() => {
    let last = 0;
    return (force = false) => {
      const g = get().game, c = cloud();
      if (!g || !c || !get().user || g.over) return;
      if (!force && Date.now() - last < 60000) return;
      last = Date.now();
      c.save(g).catch(() => { /* offline; the browser save still has it */ });
    };
  })(),
  forget: () => { clearSave(); cloud()?.clear().catch(() => { /* already gone or offline */ }); set({ hasSave: false }); },
  quit: () => set({ game: null, hasSave: !!loadGame(), sel: null, panel: null }),
  act: (fn) => {
    const g = get().game;
    if (!g) return;
    const r = fn(g);
    if (r && r.msg) get().toast(r.msg, r.ok ? 'good' : 'bad');
    set({ rev: get().rev + 1 });
    return r;
  },
  tick: (days) => {
    const g = get().game;
    if (!g) return;
    const before = g.news.length ? g.news[0] : null;
    const m0 = S.monthOf(g.day);
    for (let i = 0; i < days && !g.decisions.length && !g.over; i++) S.advanceDay(g);
    // surface fresh news as toasts
    const fresh = [];
    for (const n of g.news) { if (n === before) break; fresh.push(n); }
    for (const n of fresh.slice(0, 3).reverse()) get().toast(n.text, n.tone);
    if (S.monthOf(g.day) !== m0) { saveGame(g); get().sync(); }
    set({ rev: get().rev + 1 });
  },
  set: (p) => set(p),
  toast: (text, tone = 'info') => {
    const id = toastId++;
    set({ toasts: [...get().toasts.slice(-3), { id, text, tone }] });
    setTimeout(() => get().dismiss(id), 6000);
  },
  dismiss: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
  save: () => { const g = get().game; if (!g) return; const ok = saveGame(g); get().sync(true); get().toast(ok ? (get().user ? 'Game saved here and to your account.' : 'Game saved in this browser.') : 'This browser blocked saving.', ok ? 'good' : 'bad'); },
}));

/** Subscribe a component to every game change. */
export function useGame(): Game {
  useUI((s) => s.rev);
  return useUI.getState().game!;
}

// Handy for testing from the browser console.
if (typeof window !== 'undefined') Object.assign(window, { __groundUp: useUI, __groundUpEngine: S });

// connect to Firebase when it is set up; a signed-in player with a cloud save gets the Continue button
void startCloud((user) => {
  useUI.setState({ cloudReady: true });
  useUI.setState({ user });
  if (user) cloud()?.load().then((c) => { if (c && !useUI.getState().game) useUI.setState({ hasSave: true }); }).catch(() => { /* offline */ });
}).then((c) => { if (c) useUI.setState({ cloudReady: true }); }).catch(() => { /* Firebase failed to load; play on this device */ });
