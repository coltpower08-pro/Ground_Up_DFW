// The guided campaign: two chapters whose steps tick off automatically from game state.
import { ACHIEVEMENTS } from './achievements';
import type { Deal, Game } from '../engine/types';

export interface Step { text: string; hint: string; done: boolean }
export interface Chapter { title: string; goal: string; steps: Step[]; complete: boolean }

const past = (d: Deal | undefined, phases: string[]) => !!d && phases.includes(d.phase);

export function currentChapter(g: Game): Chapter {
  const ios = g.deals.filter((d) => d.type === 'ios' && d.phase !== 'dead').sort((a, b) => (b.phase === 'sold' ? 1 : 0) - (a.phase === 'sold' ? 1 : 0))[0];
  const spec = g.deals.filter((d) => d.type === 'spec' && d.phase !== 'dead').sort((a, b) => (b.phase === 'sold' ? 1 : 0) - (a.phase === 'sold' ? 1 : 0))[0];
  const iosSold = g.deals.some((d) => d.type === 'ios' && d.phase === 'sold');

  if (!iosSold) {
    const steps: Step[] = [
      { text: 'Put a yard site under contract', hint: 'Click the pulsing Blue Mound Yard Site on the map, choose IOS yard and make an offer.', done: !!ios },
      { text: 'Order due diligence reports', hint: 'Open the deal and order the environmental report and the survey before the 60 days run out.', done: !!ios && (ios.phase !== 'dd' || Object.values(ios.reports).some((r) => r.status !== 'none')) },
      { text: 'Finish due diligence', hint: 'When the reports are back, click Finish due diligence. Your deposit is then at risk.', done: past(ios, ['entitlement', 'predev', 'construction', 'leasing', 'operations', 'sold']) },
      { text: 'Win the permit', hint: 'File for the Specific Use Permit. An attorney and neighborhood outreach raise your odds.', done: past(ios, ['predev', 'construction', 'leasing', 'operations', 'sold']) },
      { text: 'Line up design, contractor and investors, then close', hint: 'Pick a surface and contractor, pitch the Hollis family for equity, then close and break ground.', done: past(ios, ['construction', 'leasing', 'operations', 'sold']) },
      { text: 'Build the yard', hint: 'Let the clock run. Answer change orders as they come up.', done: past(ios, ['leasing', 'operations', 'sold']) },
      { text: 'Sign a tenant', hint: 'Set your asking rent and wait for proposals. Compare net effective rent and credit.', done: past(ios, ['operations', 'sold']) },
      { text: 'Sell the yard and pay your investors', hint: 'Once rent is flowing, take the property to market and pick a buyer.', done: past(ios, ['sold']) },
    ];
    return { title: 'Chapter 1: Your first yard', goal: 'Take a small IOS yard from raw land to a sale.', steps, complete: false };
  }
  const lpReady = g.npcs.some((n) => n.role === 'lp' && (n.maxCheck ?? 0) >= 5e6 && n.rel >= 40 && g.trackRecord >= (n.minDeals ?? 0));
  const steps: Step[] = [
    { text: 'Get to know a bigger investor', hint: 'Open the Rolodex and spend time with Caddo Creek Family Office until the relationship reaches 40.', done: lpReady || !!spec },
    { text: 'Put a building site under contract', hint: 'A spec building needs 6+ usable acres. Northlake Gateway 10 is zoned and served.', done: !!spec },
    { text: 'Close and break ground', hint: 'Finish due diligence, design the building, pick a contractor and raise the equity.', done: past(spec, ['construction', 'leasing', 'operations', 'sold']) },
    { text: 'Lease the building', hint: 'Pre-leasing starts when construction is half done. Some tenants only want half the building.', done: past(spec, ['operations', 'sold']) },
    { text: 'Sell and distribute the profits', hint: 'Take it to market once rent is flowing. Or refinance, pull cash out and keep it.', done: past(spec, ['sold']) },
  ];
  const complete = steps.every((s) => s.done);
  const next = ACHIEVEMENTS.find((a) => a.unlock && !g.achievements.includes(a.id)) ?? ACHIEVEMENTS.find((a) => !g.achievements.includes(a.id));
  return { title: complete ? 'Scenario complete: sandbox mode' : 'Chapter 2: Going vertical', goal: complete ? (next ? `Next milestone: ${next.title}. ${next.desc} ${next.reward}` : 'Every milestone reached. Keep building and beat your best returns.') : 'Deliver a spec industrial building with a bigger equity partner.', steps, complete };
}
