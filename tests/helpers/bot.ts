// A scripted player for balance tests. "skilled" picks well-graded sites it can afford and keeps several deals moving;
// "passive" only ever does the two tutorial-sized yard deals it stumbles into, slowly.
import { ACRE_RANGE } from '../../src/engine/params';
import { askPrice, computeProforma, usableAcres } from '../../src/engine/proforma';
import * as S from '../../src/engine/sim';
import type { Deal, DealType, Game } from '../../src/engine/types';

const GRADE = 'FDCBA';
function answer(g: Game) {
  let guard = 0;
  while (g.decisions.length && guard++ < 50) {
    const dec = g.decisions[0];
    const opt = ({ finding: 'credit', ddDeadline: 'proceed', entDenied: 'reapply', changeOrder: 'approve', prospect: 'accept', bids: 'b0', retrade: 'accept' } as Record<string, string>)[dec.kind] ?? dec.options[0]?.id ?? 'ok';
    if (!S.resolveDecision(g, dec.id, opt).ok) S.resolveDecision(g, dec.id, dec.options[0]?.id ?? 'ok');
    if (g.decisions[0] === dec) g.decisions.shift();
  }
}
const live = (g: Game) => g.deals.filter((d) => !['dead', 'sold'].includes(d.phase));

function work(g: Game, d: Deal) {
  if (d.phase === 'dd') {
    for (const r of ['env', 'survey', 'geo'] as const) if (d.reports[r].status === 'none') S.orderReport(g, d.id, r);
    if (Object.values(d.reports).every((x) => x.status === 'done')) {
      if (GRADE.indexOf(computeProforma(g, d).score) < 2) S.walkDeal(g, d.id); else S.finishDD(g, d.id);
    }
  } else if (d.phase === 'entitlement') {
    if (d.ent.status !== 'pending') S.startEntitlement(g, d.id, true, true);
  } else if (d.phase === 'predev' && !d.budget) {
    if (d.acq) S.setReno(g, d.id, 'refresh');
    if (!d.gcId) S.setGc(g, d.id, 'cowtown');
    const pf = computeProforma(g, d);
    const lps = g.npcs.filter((n) => n.role === 'lp' && g.trackRecord >= (n.minDeals ?? 0)).sort((a, b) => (a.maxCheck ?? 0) - (b.maxCheck ?? 0));
    const lp = lps.find((n) => (n.maxCheck ?? 0) >= pf.budget.equity * (1 - Math.max(0.1, n.minCoinvest ?? 0.05))) ?? lps[lps.length - 1];
    if (!d.lpId && lp) {
      S.setGpPct(g, d.id, Math.min(1, Math.max(lp.minCoinvest ?? 0.05, 0.1, Math.ceil((1 - ((lp.maxCheck ?? 0) * 0.95) / pf.budget.equity) * 20) / 20)));
      if (g.attention >= 1) S.pitchLp(g, d.id, lp.id);
    }
    if (d.lpId && S.closeBlockers(g, d).length === 0) S.closeDeal(g, d.id);
    else if (d.lpId && g.day - d.startDay > 720) S.walkDeal(g, d.id);
  } else if (d.phase === 'operations' && d.sale.stage === 'none') S.listForSale(g, d.id);
}

function prospect(g: Game) {
  const types = (['ios', 'spec', 'retail', 'mf', 'office'] as DealType[]).filter((t) => g.unlocked.includes(t));
  const lpMax = Math.max(...g.npcs.filter((n) => n.role === 'lp' && g.trackRecord >= (n.minDeals ?? 0)).map((n) => n.maxCheck ?? 0));
  let best: { id: string; type: DealType; price: number; v: number } | null = null;
  for (const p of S.visibleParcels(g)) {
    if (p.status !== 'available') continue;
    if (p.existing && !g.unlocked.includes('acq')) continue;
    for (const t of p.existing ? [p.existing.type] : types.filter((x) => p.fit?.includes(x))) {
      if (!p.existing && (usableAcres(p) < ACRE_RANGE[t][0] || usableAcres(p) > ACRE_RANGE[t][1])) continue;
      const price = p.counterPrice ?? Math.round(askPrice(g, p) * 0.93), pf = S.previewProforma(g, p.id, t, price);
      if (GRADE.indexOf(pf.score) < 3 || !pf.lenderId) continue;
      if (pf.budget.equity * 0.9 > lpMax || pf.budget.equity * 0.12 + price * 0.03 > g.cash * 0.55) continue;
      const v = pf.spread * Math.sqrt(pf.budget.total);
      if (!best || v > best.v) best = { id: p.id, type: t, price, v };
    }
  }
  if (best) S.makeOffer(g, best.id, best.type, best.price);
}

export function botPlay(g: Game, years: number, mode: 'skilled' | 'passive' = 'skilled'): Game {
  const end = years * 360;
  while (g.day < end && !g.over) {
    S.advanceDay(g); answer(g);
    if (mode === 'passive') continue;
    for (const d of live(g)) work(g, d);
    if (g.day % 10 === 0 && live(g).filter((d) => !d.budget).length < 2 && live(g).length < 3 + (g.staff.analyst ? 1 : 0)) prospect(g);
    if (g.day % 30 === 20) {
      // spend what attention is left on the people who fund deals
      const who = [...g.npcs.filter((n) => n.role === 'lp' || n.role === 'lender')].sort((a, b) => a.rel - b.rel);
      for (const n of who) if (g.attention >= 2 && n.rel < 80) S.network(g, n.id, 'coffee');
      if (g.cash > 1.5e6 && !g.staff.pm) S.setStaff(g, 'pm', true);
      if (g.cash > 3e6 && !g.staff.analyst) S.setStaff(g, 'analyst', true);
    }
  }
  return g;
}
