// Career score: what the high score boards rank.
// Balanced on purpose: getting rich yourself, paying your investors, picking good deals, and growing the firm all count.
import { payOut } from './finance';
import { COMMON } from './params';
import { estimateValue } from './sim';
import type { Game } from './types';

export const START_CASH = 450000;
export const CAREER_LENGTHS = [10, 25, 0] as const; // 0 is open-ended
export type Career = (typeof CAREER_LENGTHS)[number];
export const CAREER_LABEL: Record<Career, string> = { 10: '10-year career', 25: '25-year career', 0: 'Open-ended career' };

export interface ScoreBreakdown {
  total: number;
  /** Firm net worth: cash plus your share of what your properties would sell for today. */
  netWorth: number;
  /** What investors got back beyond what they put in, counting properties still owned at today's value. */
  lpProfit: number;
  parts: { key: string; label: string; detail: string; points: number }[];
}

/** What a property would pay the firm and its investors if sold today at estimated value, after the loan and selling costs. */
export function liquidation(g: Game, d: Game['deals'][number]): { gp: number; lp: number } {
  if (!d.budget || !d.acct || !d.loan || d.phase === 'sold' || d.phase === 'dead') return { gp: 0, lp: 0 };
  let value = estimateValue(g, d).value;
  if (d.phase === 'construction' && !d.acq) value = Math.max(value, d.costToDate * 0.85); // half-built projects trade below cost
  const cash = Math.max(0, d.cash + value * (1 - COMMON.saleCostPct) - d.loan.balance);
  const out = payOut(JSON.parse(JSON.stringify(d.acct)), cash);
  return { gp: out.gp, lp: out.lp };
}

export function scoreGame(g: Game): ScoreBreakdown {
  let heldGp = 0, heldLp = 0;
  for (const d of g.deals) { const x = liquidation(g, d); heldGp += x.gp; heldLp += x.lp; }
  const netWorth = g.cash + heldGp;
  const lpProfit = g.deals.reduce((s, d) => s + d.flows.reduce((a, f) => a + f.lp, 0), 0) + heldLp;

  // deal quality: each sale is judged on what it returned to the people who put up the money
  let dealPts = 0, sold = 0, losers = 0;
  for (const d of g.deals) {
    const r = d.result;
    if (!r) continue;
    sold++;
    const irr = Number.isFinite(r.lpIrr) ? r.lpIrr : r.gpIrr, mult = Number.isFinite(r.lpMultiple) ? r.lpMultiple : r.gpMultiple;
    const pts = 400 + Math.max(-1500, Math.min(2500, Math.round(2500 * ((Number.isFinite(irr) ? irr : 0) - 0.1)))) - (mult < 1 ? 800 : 0);
    if (mult < 1) losers++;
    dealPts += pts;
  }
  const repAvg = Object.values(g.rep).reduce((a, b) => a + b, 0) / Object.values(g.rep).length;
  const $m = (x: number) => `$${(x / 1e6).toFixed(1)}M`;
  const parts = [
    { key: 'wealth', label: 'Firm wealth', detail: `Net worth ${$m(netWorth)}, up from ${$m(START_CASH)} · 1 point per $1,000 gained`, points: Math.round((netWorth - START_CASH) / 1000) },
    { key: 'investors', label: 'Investor profit', detail: `Investors made ${$m(lpProfit)} beyond the money they put in${heldLp > 1000 ? ', counting properties you still own' : ''} · 1 point per $1,000`, points: Math.round(lpProfit / 1000) },
    { key: 'deals', label: 'Deal quality', detail: sold ? `${sold} deal${sold > 1 ? 's' : ''} sold${losers ? `, ${losers} lost investors money` : ''} · points for every IRR point above 10%` : 'No deals sold yet', points: dealPts },
    { key: 'milestones', label: 'Milestones', detail: `${g.achievements.length} reached · 300 each`, points: g.achievements.length * 300 },
    { key: 'reputation', label: 'Reputation', detail: `Average standing ${Math.round(repAvg)} of 100 (started at 36)`, points: Math.round((repAvg - 36) * 15) },
  ];
  return { total: Math.max(0, parts.reduce((s, p) => s + p.points, 0)), netWorth, lpProfit, parts };
}

/** In-game years played, to one decimal. */
export const yearsPlayed = (g: Game) => Math.round((g.day / 360) * 10) / 10;
