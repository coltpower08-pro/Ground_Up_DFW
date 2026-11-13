// Left-rail panels: Deals, Rolodex, Capital, Portfolio, Market, Almanac.
import { scoreGame } from '../engine/score';
import { ACHIEVEMENTS } from '../content/achievements';
import { useState } from 'react';
import { GLOSSARY } from '../content/glossary';
import { DISTRICTS } from '../content/world';
import { ll } from '../render/layout';
import * as S from '../engine/sim';
import { CYCLE, STAFF } from '../engine/params';
import { lenderRate } from '../engine/proforma';
import { LOC_LIMIT, OVERHEAD, type Game, type Npc, type StaffKey } from '../engine/types';
import { dateStr, money, mult, pct } from './format';
import { Bar, Btn, Chip, PHASE_LABEL, Row, Section, Term } from './kit';
import { useGame, useUI, type PanelId } from './store';

const TITLES: Record<PanelId, string> = { deals: 'Deals', rolodex: 'Rolodex', capital: 'Capital', portfolio: 'Portfolio', market: 'Market', almanac: 'Almanac', milestones: 'Milestones' };

export function Panel() {
  const g = useGame();
  const panel = useUI((s) => s.panel), set = useUI((s) => s.set);
  if (!panel) return null;
  return (
    <div className="glass rise absolute bottom-[124px] left-[92px] top-[72px] z-30 flex w-[480px] max-w-[calc(100vw-104px)] flex-col overflow-hidden">
      <header className="flex items-center justify-between border-b border-line px-5 py-3">
        <h2 className="display text-[26px] font-semibold">{TITLES[panel]}</h2>
        <button type="button" aria-label="Close panel" onClick={() => set({ panel: null })} className="flex h-7 w-7 items-center justify-center rounded-full text-ink2 hover:bg-black/10">✕</button>
      </header>
      <div className="scroll flex-1 px-5 py-4">
        {panel === 'deals' && <Deals g={g} />}
        {panel === 'rolodex' && <Rolodex g={g} />}
        {panel === 'capital' && <Capital g={g} />}
        {panel === 'portfolio' && <Portfolio g={g} />}
        {panel === 'market' && <Market g={g} />}
        {panel === 'almanac' && <Almanac g={g} />}
        {panel === 'milestones' && <Milestones g={g} />}
      </div>
    </div>
  );
}

function Deals({ g }: { g: Game }) {
  const set = useUI((s) => s.set);
  const live = g.deals.filter((d) => !['sold', 'dead'].includes(d.phase));
  const sold = g.deals.filter((d) => d.phase === 'sold').sort((a, b) => (b.result!.lpIrr || 0) - (a.result!.lpIrr || 0));
  const dead = g.deals.filter((d) => d.phase === 'dead');
  const open = (id: string) => set({ sel: { kind: 'deal', id }, panel: null });
  return (
    <>
      <Section title={`Active (${live.length})`}>
        {live.length === 0 && <p className="text-ink2">No active deals. Click a site with a dashed outline on the map to make an offer.</p>}
        <div className="space-y-1.5">{live.map((d) => (
          <button key={d.id} type="button" onClick={() => open(d.id)} className="flex w-full items-center justify-between rounded-xl border border-line bg-white/60 p-2.5 text-left hover:bg-white">
            <span className="font-medium">{d.name}</span><Chip tone="accent">{PHASE_LABEL[d.phase]}</Chip>
          </button>))}
        </div>
      </Section>
      <Section title="Hall of fame">
        {sold.length === 0 && <p className="text-ink2">Your completed deals will rank here by investor return.</p>}
        <div className="space-y-1.5">{sold.map((d, i) => (
          <button key={d.id} type="button" onClick={() => open(d.id)} className="grid w-full grid-cols-[22px_1fr_auto] items-center gap-2 rounded-xl border border-line bg-white/60 p-2.5 text-left hover:bg-white">
            <span className="display text-[18px] font-bold text-ink2">{i + 1}</span>
            <span><span className="block font-medium">{d.name}</span><span className="num block text-[12px] text-ink2">Profit {money(d.result!.profit)} · {d.result!.months} months</span></span>
            <span className="num text-right"><span className="display block text-[20px] font-semibold leading-none">{pct(d.result!.lpIrr, 0)}</span><span className="text-[11.5px] text-ink2">{mult(d.result!.lpMultiple)} to investors</span></span>
          </button>))}
        </div>
      </Section>
      {dead.length > 0 && <Section title="Dropped"><p className="text-[13px] text-ink2">{dead.map((d) => d.name).join(', ')}. Dead-deal costs so far: {money(g.stats.deadDealCosts)}.</p></Section>}
    </>
  );
}

const ROLE_TITLE: Record<Npc['role'], string> = { broker: 'Brokers', tenantrep: 'Brokers', lp: 'Investors', lender: 'Lenders', city: 'City hall', gc: 'Contractors' };

function Rolodex({ g }: { g: Game }) {
  const act = useUI((s) => s.act);
  const groups = ['Brokers', 'Investors', 'Lenders', 'City hall', 'Contractors'];
  return (
    <>
      <div className="flex items-center justify-between rounded-xl border border-line bg-white/60 p-3">
        <div><div className="font-semibold">Attention this month</div><div className="text-[12.5px] text-ink2">Coffee costs 1 and $150. A dinner or a day at the lease costs 2 and $1,500. Refills on the 1st.</div></div>
        <div className="flex gap-1 pl-3">{[0, 1, 2, 3].map((i) => <i key={i} className={`h-3.5 w-3.5 rounded-full ${i < g.attention ? 'bg-accent' : 'bg-black/15'}`} />)}</div>
      </div>
      {groups.map((grp) => (
        <Section key={grp} title={grp}>
          <div className="space-y-2">{g.npcs.filter((n) => ROLE_TITLE[n.role] === grp).map((n) => (
            <div key={n.id} className="rounded-xl border border-line bg-white/60 p-3">
              <div className="flex items-baseline justify-between gap-2"><span className="font-semibold">{n.name}</span><span className="text-right text-[12px] text-ink2">{n.org}</span></div>
              <p className="mt-0.5 text-[12.5px] text-ink2">{n.blurb}</p>
              <div className="mt-2 flex items-center gap-2.5">
                <div className="flex-1"><Bar value={n.rel / 100} tone="sage" thin /></div><span className="num w-7 text-right text-[12.5px] font-semibold">{Math.round(n.rel)}</span>
                <Btn small disabled={g.attention < 1} onClick={() => act((gg) => S.network(gg, n.id, 'coffee'))}>Coffee</Btn>
                <Btn small disabled={g.attention < 2} onClick={() => act((gg) => S.network(gg, n.id, 'outing'))}>Outing</Btn>
              </div>
            </div>))}
          </div>
        </Section>
      ))}
    </>
  );
}

function Capital({ g }: { g: Game }) {
  const act = useUI((s) => s.act);
  const invested = g.deals.reduce((s, d) => s + (d.acct && d.phase !== 'sold' ? d.acct.gpCap : 0), 0);
  const pursuit = S.activeDeals(g).reduce((s, d) => s + (d.budget ? 0 : d.pursuit + d.earnest), 0);
  const reps: [keyof Game['rep'], string][] = [['investors', 'Investors'], ['lenders', 'Lenders'], ['city', 'City hall'], ['brokers', 'Brokers'], ['tenants', 'Tenants']];
  return (
    <>
      <Section title="Your firm">
        <Row label="Cash" value={money(g.cash)} strong />
        <Row label="Your equity in projects, at cost" value={money(invested)} />
        <Row label="Spent chasing open deals" value={money(pursuit)} sub />
        <Row label="Overhead and salaries" value={`${money(OVERHEAD + S.staffCost(g))} a month`} sub />
        <Row label="Bank line of credit" value={`Up to ${money(LOC_LIMIT)} at 15%`} sub />
      </Section>
      <Section title="Your team" right={<span className="num text-[12px] text-ink2">{S.activeDeals(g).length} of {S.maxActive(g)} deals in pursuit</span>}>
        <div className="space-y-1.5">{(Object.keys(STAFF) as StaffKey[]).map((k) => (
          <div key={k} className={`flex items-center gap-3 rounded-xl border p-2.5 ${g.staff[k] ? 'border-good bg-good/10' : 'border-line bg-white/60'}`}>
            <div className="min-w-0 flex-1"><div className="text-[13.5px] font-medium">{STAFF[k].label} <span className="num font-normal text-ink2">· {money(STAFF[k].salary)}/mo</span></div><div className="text-[12px] text-ink2">{STAFF[k].blurb}</div></div>
            <Btn small kind={g.staff[k] ? 'ghost' : 'plain'} onClick={() => act((gg) => S.setStaff(gg, k, !g.staff[k]))}>{g.staff[k] ? 'Let go' : 'Hire'}</Btn>
          </div>))}
        </div>
      </Section>
      <Section title="Earned so far">
        <Row label={<Term k="devfee">Development fees</Term>} value={money(g.stats.feesEarned)} />
        <Row label={<Term k="promote">Promote</Term>} value={money(g.stats.promoteEarned)} />
        <Row label="Paid out to investors" value={money(g.stats.lpDistributed)} />
        <Row label="Dead-deal costs" value={money(g.stats.deadDealCosts)} sub />
      </Section>
      <Section title="Reputation">
        {reps.map(([k, label]) => (<div key={k} className="mb-1.5 grid grid-cols-[84px_1fr_28px] items-center gap-2 text-[13px]"><span>{label}</span><Bar value={g.rep[k] / 100} tone="sage" thin /><span className="num text-right font-semibold">{Math.round(g.rep[k])}</span></div>))}
      </Section>
      <Section title={<Term k="lpgp">Investors</Term>}>
        <table className="num w-full text-[12.5px]"><thead><tr className="text-left text-ink2"><th className="py-1 font-medium">Name</th><th className="font-medium">Max check</th><th className="font-medium">Pref</th><th className="font-medium">Promote</th><th className="font-medium">Needs</th></tr></thead>
          <tbody>{g.npcs.filter((n) => n.role === 'lp').map((n) => (<tr key={n.id} className="border-t border-line"><td className="py-1.5 pr-2 font-medium">{n.name}</td><td>{money(n.maxCheck!)}</td><td>{pct(n.pref!, 0)}</td><td>{pct(n.promote!, 0)}</td><td>{n.minDeals ? `${n.minDeals} deal${n.minDeals > 1 ? 's' : ''}` : 'None'}</td></tr>))}</tbody></table>
      </Section>
      <Section title={<Term k="ltc">Lenders</Term>}>
        <table className="num w-full text-[12.5px]"><thead><tr className="text-left text-ink2"><th className="py-1 font-medium">Bank</th><th className="font-medium">Loan to cost</th><th className="font-medium">Rate</th><th className="font-medium">Max loan</th></tr></thead>
          <tbody>{g.npcs.filter((n) => n.role === 'lender' && (!n.proOnly || g.difficulty === 'pro')).map((n) => (<tr key={n.id} className="border-t border-line"><td className="py-1.5 pr-2 font-medium">{n.org}</td><td>{pct(n.ltc!, 0)}</td><td>{pct(lenderRate(g, n), 2)}</td><td>{money(n.maxLoan!)}</td></tr>))}</tbody></table>
        <p className="mt-1.5 text-[12.5px] text-ink2">{g.difficulty === 'pro' ? 'Rates float with the base rate. You choose the lender on each deal.' : 'In Rookie mode the best available lender is chosen for you.'} Trinity Regional opens after one completed deal or a relationship of 35.</p>
      </Section>
    </>
  );
}

function Portfolio({ g }: { g: Game }) {
  const set = useUI((s) => s.set);
  const owned = g.deals.filter((d) => ['construction', 'leasing', 'operations'].includes(d.phase));
  const rows = owned.map((d) => ({ d, est: d.phase === 'construction' ? null : S.estimateValue(g, d), rent: S.currentRent(g, d) }));
  const totalValue = rows.reduce((s, r) => s + (r.est?.value ?? r.d.costToDate), 0), totalDebt = owned.reduce((s, d) => s + (d.loan?.balance ?? 0), 0);
  return (
    <>
      <div className="grid grid-cols-3 gap-2">
        {[['Properties', String(owned.length)], ['Value', money(totalValue)], ['Debt', money(totalDebt)]].map(([k, v]) => (<div key={k} className="rounded-xl border border-line bg-white/60 px-3 py-2"><div className="text-[11.5px] text-ink2">{k}</div><div className="display num text-[24px] font-semibold leading-tight">{v}</div></div>))}
      </div>
      <Section title="Properties you own">
        {owned.length === 0 && <p className="text-ink2">Nothing yet. Properties appear here once you close on the land.</p>}
        <div className="space-y-1.5">{rows.map(({ d, est, rent }) => (
          <button key={d.id} type="button" onClick={() => set({ sel: { kind: 'deal', id: d.id }, panel: null })} className="w-full rounded-xl border border-line bg-white/60 p-2.5 text-left hover:bg-white">
            <div className="flex items-center justify-between"><span className="font-medium">{d.name}</span><Chip tone={S.fullyLeased(d) ? 'good' : d.phase === 'leasing' ? 'bad' : 'accent'}>{S.fullyLeased(d) ? 'Leased' : d.leases.length ? 'Half leased' : d.phase === 'leasing' ? 'Vacant' : 'Building'}</Chip></div>
            <div className="num mt-0.5 text-[12.5px] text-ink2">{est ? `Value ${money(est.value)}` : `Cost to date ${money(d.costToDate)}`} · Loan {money(d.loan?.balance ?? 0)} · Rent {rent > 0 ? `${money(rent)}/yr` : 'none yet'}</div>
          </button>))}
        </div>
      </Section>
    </>
  );
}

function Spark({ values }: { values: number[] }) {
  if (values.length < 2) return <div className="h-12" />;
  const lo = Math.min(...values), hi = Math.max(...values), w = 200, h = 48;
  const pts = values.map((v, i) => [(i / (values.length - 1)) * w, h - 5 - ((v - lo) / (hi - lo || 1)) * (h - 10)]);
  const path = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join('');
  const last = pts[pts.length - 1];
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-12 w-full" preserveAspectRatio="none" role="img" aria-label="Rent trend">
      <path d={`${path}L${w},${h}L0,${h}Z`} fill="var(--accent)" opacity="0.12" /><path d={path} fill="none" stroke="var(--accent)" strokeWidth="1.8" vectorEffect="non-scaling-stroke" /><circle cx={last[0] - 2} cy={last[1]} r="2.6" fill="var(--accent)" />
    </svg>
  );
}

function Market({ g }: { g: Game }) {
  const m = g.market, focusOn = useUI((st) => st.focusOn);
  return (
    <>
      <div className="eyebrow">Dallas-Fort Worth, metro average</div>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <div className="rounded-xl border border-line bg-white/60 p-3"><div className="text-[12px] text-ink2"><Term k="ios">IOS rent</Term> per acre, monthly</div><div className="display num text-[26px] font-semibold leading-tight">{money(m.iosRent)}</div><Spark values={g.marketHistory.map((x) => x.iosRent)} /></div>
        <div className="rounded-xl border border-line bg-white/60 p-3"><div className="text-[12px] text-ink2">Industrial rent per SF, yearly <Term k="nnn">NNN</Term></div><div className="display num text-[26px] font-semibold leading-tight">${m.indRent.toFixed(2)}</div><Spark values={g.marketHistory.map((x) => x.indRent)} /></div>
      </div>
      {g.difficulty === 'pro' && (
        <div className="mt-2 flex items-center justify-between rounded-xl border border-line bg-white/60 p-3">
          <div><div className="text-[12px] text-ink2"><Term k="cycle">Market cycle</Term></div><div className="display text-[22px] font-semibold leading-tight">{CYCLE[g.cycle.phase].label}</div></div>
          <div className="text-right"><div className="text-[12px] text-ink2"><Term k="floating">Base rate</Term></div><div className="display num text-[22px] font-semibold leading-tight">{pct(m.baseRate, 2)}</div></div>
        </div>
      )}
      <Section title="Pricing">
        <Row label={<><Term k="caprate">Cap rate</Term>, IOS</>} value={pct(m.iosCap, 2)} />
        <Row label="Cap rate, industrial buildings" value={pct(m.indCap, 2)} />
        <Row label="Land prices since 2027" value={pct(m.landIndex - 1, 1)} />
        <Row label="Construction costs since 2027" value={pct(m.costIndex - 1, 1)} />
      </Section>
      <Section title="News">
        <ul className="space-y-2">{g.news.slice(0, 14).map((n, i) => (<li key={i} className="grid grid-cols-[8px_1fr] gap-2 text-[13px]"><i className={`mt-1.5 h-2 w-2 rounded-full ${n.tone === 'good' ? 'bg-good' : n.tone === 'bad' ? 'bg-bad' : 'bg-ink2/50'}`} /><span><span className="num text-[11.5px] text-ink2">{dateStr(n.day)}</span><br />{n.text}</span></li>))}</ul>
      </Section>
      <Section title="Districts">
        <p className="mb-2 text-[12.5px] text-ink2">Each district prices off the metro average. Rents and cap rates below are today's numbers; approval shows how much harder or easier hearings are.</p>
        <div className="space-y-1.5">{Object.values(DISTRICTS).map((d) => {
          const open = g.parcels.filter((p) => p.district === d.id && p.status === 'available' && (!p.offMarket || g.npcs.find((n) => n.id === 'dusty')!.rel >= 60)).length;
          const [x, y] = ll(d.at[0], d.at[1]);
          return (
            <button key={d.id} type="button" onClick={() => focusOn(x, y, 0.75)} className="w-full rounded-xl border border-line bg-white/60 p-2.5 text-left hover:bg-white">
              <div className="flex items-baseline justify-between gap-2"><span className="text-[13.5px] font-semibold">{d.name}</span><span className="num shrink-0 text-[12px] text-ink2">{open} site{open === 1 ? '' : 's'} for sale</span></div>
              <div className="text-[12px] text-ink2">{d.blurb}</div>
              <div className="num mt-1 grid grid-cols-4 gap-1 text-[12px]">
                <span>Yard {money(m.iosRent * d.ios)}/ac</span><span>Bldg ${(m.indRent * d.ind).toFixed(2)}/SF</span><span>Cap {pct(m.indCap + d.cap, 2)}</span>
                <span className={d.ent < -0.06 ? 'text-bad' : d.ent > 0 ? 'text-good' : ''}>Approval {d.ent === 0 ? 'average' : `${d.ent > 0 ? '+' : ''}${Math.round(d.ent * 100)} pts`}</span>
              </div>
            </button>
          );
        })}</div>
      </Section>
    </>
  );
}

function ScoreCard({ g }: { g: Game }) {
  const s = scoreGame(g), year = Math.floor(g.day / 360) + 1;
  return (
    <div className="rounded-xl border border-line bg-white/65 p-3">
      <div className="flex items-end justify-between">
        <div><div className="eyebrow">Score if you retired today</div><div className="display num text-[32px] font-bold leading-none">{s.total.toLocaleString('en-US')}</div></div>
        <div className="text-right text-[12px] text-ink2">{g.career ? `Year ${Math.min(year, g.career)} of ${g.career}` : 'Open-ended career'}<br />{g.difficulty === 'pro' ? 'Pro' : 'Rookie'} board</div>
      </div>
      <div className="mt-2 space-y-0.5 text-[12.5px]">
        {s.parts.map((p) => <div key={p.key} className="flex justify-between gap-2"><span className="text-ink2">{p.label}</span><span className={`num font-medium ${p.points < 0 ? 'text-bad' : ''}`}>{p.points.toLocaleString('en-US')}</span></div>)}
      </div>
    </div>
  );
}

function Milestones({ g }: { g: Game }) {
  const done = ACHIEVEMENTS.filter((a) => g.achievements.includes(a.id)).length;
  const progress = (id: string): string | null => {
    if (id === 'track-record') return `${Math.min(2, g.trackRecord)} of 2 deals`;
    if (id === 'dry-powder') return `${money(Math.max(0, g.cash))} of $2.0M`;
    if (id === 'landlord') return `${g.deals.filter((d) => d.phase === 'operations').length} of 3 operating`;
    if (id === 'paid-in-full') return `${money(g.stats.lpDistributed)} of $5.0M`;
    return null;
  };
  return (
    <>
      <ScoreCard g={g} />
      <p className="mt-4 text-[13.5px] text-ink2">Your firm starts in industrial. Each milestone below opens a new kind of deal or raises your standing. <span className="num font-semibold text-ink">{done} of {ACHIEVEMENTS.length}</span> reached.</p>
      <div className="mt-3 space-y-2">
        {ACHIEVEMENTS.map((a) => {
          const got = g.achievements.includes(a.id), pr = got ? null : progress(a.id);
          return (
            <div key={a.id} className={`rounded-xl border p-3 ${got ? 'border-good/40 bg-good/10' : 'border-line bg-white/60'}`}>
              <div className="flex items-center justify-between gap-2">
                <span className="text-[14px] font-semibold">{a.title}</span>
                {got ? <Chip tone="good">Reached</Chip> : a.unlock ? <Chip tone="accent">Unlocks</Chip> : <Chip>Open</Chip>}
              </div>
              <div className="mt-0.5 text-[13px]">{a.desc}</div>
              <div className="mt-0.5 text-[12.5px] text-ink2">{a.reward}{pr ? ` · ${pr}` : ''}</div>
            </div>
          );
        })}
      </div>
    </>
  );
}

function Almanac({ g }: { g: Game }) {
  const [q, setQ] = useState('');
  const terms = GLOSSARY.filter((t) => g.almanac.includes(t.key)).filter((t) => (t.term + t.short).toLowerCase().includes(q.toLowerCase()));
  return (
    <>
      <label htmlFor="almanac-search" className="sr-only">Search the Almanac</label>
      <input id="almanac-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search terms" className="w-full rounded-lg border border-line bg-white/80 px-3 py-2 outline-none focus:border-accent" />
      <p className="mt-2 text-[12.5px] text-ink2">{g.almanac.length} of {GLOSSARY.length} entries unlocked. New ones appear as you meet each idea in a deal.</p>
      <div className="mt-3 space-y-3">{terms.map((t) => (<article key={t.key} className="border-b border-line pb-3"><h3 className="font-semibold">{t.term}</h3><p className="mt-0.5 text-[13.5px]">{t.short}</p><p className="mt-1 text-[13px] text-ink2">{t.more}</p></article>))}</div>
    </>
  );
}
