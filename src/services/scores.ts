// High score boards. One board per difficulty and career length; each is read as all-time, this year, this month and this week.
// This build keeps scores in the browser. The Firebase build replaces LocalBoard with a shared Firestore board behind the same interface.
import type { Career } from '../engine/score';
import type { Game } from '../engine/types';

export interface ScoreEntry {
  id: string;
  player: string;
  firm: string;
  difficulty: Game['difficulty'];
  career: Career;
  score: number;
  netWorth: number;
  lpProfit: number;
  dealsSold: number;
  years: number; // in-game years played
  how: 'complete' | 'retired' | 'bust';
  at: number; // real-world time posted, ms
  mine?: boolean; // posted from this device or account
}
export type Period = 'all' | 'year' | 'month' | 'week';
export const PERIODS: { id: Period; label: string }[] = [{ id: 'all', label: 'All time' }, { id: 'year', label: 'This year' }, { id: 'month', label: 'This month' }, { id: 'week', label: 'This week' }];

/** Start of the period in local time. Weeks start Monday. */
export function periodStart(p: Period, now = new Date()): number {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (p === 'all') return 0;
  if (p === 'year') return new Date(now.getFullYear(), 0, 1).getTime();
  if (p === 'month') return new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d.getTime();
}

/** The keys a score is filed under for each period, in the poster's local time. */
export function periodKeys(d: Date): Record<Exclude<Period, 'all'>, string> {
  const p2 = (n: number) => String(n).padStart(2, '0'), w = new Date(periodStart('week', d));
  return { year: String(d.getFullYear()), month: `${d.getFullYear()}-${p2(d.getMonth() + 1)}`, week: `${w.getFullYear()}-${p2(w.getMonth() + 1)}-${p2(w.getDate())}` };
}

export interface Board {
  submit(e: Omit<ScoreEntry, 'id' | 'mine'>): Promise<ScoreEntry>;
  top(difficulty: Game['difficulty'], career: Career, period: Period, n?: number): Promise<ScoreEntry[]>;
  /** Where a score would place on a board, 1 = first. */
  rank(entry: ScoreEntry, period: Period): Promise<number>;
  shared: boolean;
}

const KEY = 'ground-up-dfw.scores.v1';
class LocalBoard implements Board {
  shared = false;
  private all(): ScoreEntry[] { try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; } }
  async submit(e: Omit<ScoreEntry, 'id' | 'mine'>) {
    const entry: ScoreEntry = { ...e, id: `${e.at.toString(36)}-${Math.random().toString(36).slice(2, 7)}`, mine: true };
    const list = [...this.all(), entry].sort((a, b) => b.score - a.score).slice(0, 500);
    try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* storage full or blocked */ }
    return entry;
  }
  async top(difficulty: Game['difficulty'], career: Career, period: Period, n = 10) {
    const since = periodStart(period);
    return this.all().filter((e) => e.difficulty === difficulty && e.career === career && e.at >= since).sort((a, b) => b.score - a.score || a.at - b.at).slice(0, n);
  }
  async rank(entry: ScoreEntry, period: Period) {
    const list = await this.top(entry.difficulty, entry.career, period, 1000);
    const i = list.findIndex((e) => e.id === entry.id);
    return i >= 0 ? i + 1 : list.filter((e) => e.score > entry.score).length + 1;
  }
}

let board: Board = new LocalBoard();
export const getBoard = () => board;
/** The Firebase build calls this at startup with the shared board. */
export const setBoard = (b: Board) => { board = b; };
