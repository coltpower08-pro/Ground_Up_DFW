// Milestones. Some unlock new asset classes or buying existing properties; the rest raise reputation.
import type { Game, RepKey } from '../engine/types';

export interface Achievement { id: string; title: string; desc: string; reward: string; unlock?: string; rep?: Partial<Record<RepKey, number>>; test: (g: Game) => boolean }

export const ACHIEVEMENTS: Achievement[] = [
  { id: 'first-exit', title: 'First exit', desc: 'Sell your first project.', reward: 'Investors and lenders take your calls: reputation +5 with each.', rep: { investors: 5, lenders: 5 }, test: (g) => g.trackRecord >= 1 },
  { id: 'track-record', title: 'Track record', desc: 'Complete two deals.', reward: 'Unlocks shopping centers.', unlock: 'retail', test: (g) => g.trackRecord >= 2 },
  { id: 'dry-powder', title: 'Dry powder', desc: 'Hold $2 million of firm cash.', reward: 'Unlocks buying existing properties.', unlock: 'acq', test: (g) => g.cash >= 2e6 },
  { id: 'home-run', title: 'Home run', desc: 'Return 1.5x or a 25% IRR to investors on one deal.', reward: 'Unlocks apartments.', unlock: 'mf', test: (g) => g.deals.some((d) => d.result && (d.result.lpMultiple >= 1.5 || d.result.lpIrr >= 0.25)) },
  { id: 'long-game', title: 'The long game', desc: 'Refinance a property and keep it.', reward: 'Unlocks office buildings.', unlock: 'office', test: (g) => !!g.flags.refi },
  { id: 'under-budget', title: 'Under budget', desc: 'Finish a construction job without spending all the contingency.', reward: 'Lender reputation +5.', rep: { lenders: 5 }, test: (g) => g.deals.some((d) => !d.acq && d.con && d.con.doneDay > 0 && d.con.overrun === 0 && d.con.contingencyLeft > 1000) },
  { id: 'landlord', title: 'Landlord', desc: 'Own three operating properties at the same time.', reward: 'Tenant reputation +8.', rep: { tenants: 8 }, test: (g) => g.deals.filter((d) => d.phase === 'operations').length >= 3 },
  { id: 'turnaround', title: 'Turnaround', desc: 'Buy a property with vacancy, fill it, and sell it.', reward: 'Broker reputation +8.', rep: { brokers: 8 }, test: (g) => g.deals.some((d) => d.acq && d.phase === 'sold' && g.flags[`vacant-${d.id}`]) },
  { id: 'big-box', title: 'Big box', desc: 'Deliver a building of 250,000 square feet or more.', reward: 'Broker reputation +8.', rep: { brokers: 8 }, test: (g) => g.deals.some((d) => !d.acq && d.uw && d.uw.buildingSf >= 250000 && d.con && d.con.doneDay > 0) },
  { id: 'paid-in-full', title: 'Paid in full', desc: 'Pay out $5 million to investors in total.', reward: 'Investor reputation +10.', rep: { investors: 10 }, test: (g) => g.stats.lpDistributed >= 5e6 },
];
