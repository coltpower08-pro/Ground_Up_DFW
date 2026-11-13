// Market news that nudges the district. Rookie mode keeps these gentle.
import type { Game } from '../engine/types';

export const WORLD_EVENTS: { text: string; tone: 'good' | 'bad' | 'info'; apply: (g: Game) => void }[] = [
  { text: 'A national e-commerce company signs for a million square feet near the airport. Industrial rents tick up.', tone: 'good',
    apply: (g) => { g.market.indRent *= 1.03; } },
  { text: 'A container depot expands at the intermodal yard. Demand for outdoor storage jumps.', tone: 'good',
    apply: (g) => { g.market.iosRent *= 1.035; } },
  { text: 'TxDOT announces a new interchange on SH-170. Nearby land owners raise their prices.', tone: 'info',
    apply: (g) => { g.market.landIndex *= 1.04; } },
  { text: 'Steel tariffs push material prices higher. Construction costs rise.', tone: 'bad',
    apply: (g) => { g.market.costIndex *= 1.025; } },
  { text: 'Interest rates nudge up. Buyers want slightly higher cap rates.', tone: 'bad',
    apply: (g) => { g.market.indCap += 0.001; g.market.iosCap += 0.001; } },
  { text: 'Institutional buyers pile into Texas industrial. Cap rates tighten.', tone: 'good',
    apply: (g) => { g.market.indCap -= 0.001; g.market.iosCap -= 0.0015; } },
  { text: 'A wet spring slows every job site in North Texas. Contractors raise their bids a little.', tone: 'bad',
    apply: (g) => { g.market.costIndex *= 1.01; } },
  { text: 'Two rival spec buildings deliver empty in the corridor. Tenants get pickier on rent.', tone: 'bad',
    apply: (g) => { g.market.indRent *= 0.985; } },
  { text: 'A city council election brings in members who want more jobs and industry.', tone: 'good',
    apply: (g) => { g.rep.city = Math.min(100, g.rep.city + 4); } },
  { text: 'A winter freeze shuts down concrete pours for a week across DFW.', tone: 'info',
    apply: (g) => { for (const d of g.deals) if (d.phase === 'construction' && d.con) d.con.delayDays += 7; } },
];
