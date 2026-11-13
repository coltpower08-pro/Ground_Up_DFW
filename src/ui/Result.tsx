// Exit summary and post-mortem: who got paid what, and plan versus actual.
import type { Deal } from '../engine/types';
import { money, mult, pct } from './format';
import { Advisor, Row, Section, Term } from './kit';

export function ResultSummary({ d }: { d: Deal }) {
  const r = d.result!;
  const better = (a: number, p: number, lowerIsBetter = false) => (lowerIsBetter ? a <= p : a >= p);
  const Cmp = (p: { label: React.ReactNode; plan: string; actual: string; good: boolean }) => (
    <div className="grid grid-cols-[1fr_84px_84px] items-baseline gap-2 py-[3px] text-[13px]">
      <span>{p.label}</span><span className="num text-right text-ink2">{p.plan}</span>
      <span className={`num text-right font-semibold ${p.good ? 'text-good' : 'text-bad'}`}>{p.actual}</span>
    </div>
  );
  const line = !Number.isFinite(r.lpIrr) ? 'You funded this one alone, so every dollar of profit is yours. So was every dollar of risk.'
    : r.lpIrr >= 0.18 ? 'Investors will take your next call. A return like this is how a track record starts.'
    : r.lpIrr >= 0.08 ? 'A solid result. Investors got their preferred return and then some.'
    : r.lpIrr >= 0 ? 'Investors got their money back, but not the return they signed up for. Look at where time or cost slipped.'
    : 'Investors lost money on this one. Expect harder conversations on the next raise.';
  return (
    <div>
      <div className="grid grid-cols-3 gap-2">
        {[['Investor IRR', pct(r.lpIrr, 1)], ['Investor multiple', mult(r.lpMultiple)], ['Your total take', money(r.gpOut - r.gpIn + r.devFee)]].map(([k, v]) => (
          <div key={k} className="rounded-xl border border-line bg-white/60 px-2.5 py-2"><div className="text-[11.5px] text-ink2">{k}</div><div className="display num text-[24px] font-semibold leading-tight">{v}</div></div>
        ))}
      </div>
      <Section title="Sale">
        <Row label="Sale price" value={money(r.salePrice)} />
        <Row label="Less sale costs" value={money(r.netProceeds - r.salePrice)} sub />
        <Row label="Less loan payoff" value={money(-r.loanRepaid)} sub />
        <Row label="Total project cost" value={money(r.totalCost)} />
        <Row label="Profit" value={money(r.profit)} strong />
      </Section>
      <Section title={<Term k="waterfall">Who got paid</Term>}>
        <Row label="Investors put in" value={money(r.lpIn)} sub />
        <Row label="Investors got back" value={money(r.lpOut)} />
        <Row label="You put in" value={money(r.gpIn)} sub />
        <Row label="You got back" value={money(r.gpOut)} />
        <Row label={<Term k="promote">Of which promote</Term>} value={money(r.promote)} sub />
        <Row label={<Term k="devfee">Development fee</Term>} value={money(r.devFee)} />
        <Row label={<Term k="irr">IRR on your equity</Term>} value={`${pct(r.gpIrr, 0)} · ${mult(r.gpMultiple)}`} />
      </Section>
      <Section title="Plan vs. actual">
        <div className="grid grid-cols-[1fr_84px_84px] gap-2 text-[11.5px] text-ink2"><span /><span className="text-right">Plan</span><span className="text-right">Actual</span></div>
        <Cmp label="Total cost" plan={money(r.plan.cost)} actual={money(r.actual.cost)} good={better(r.actual.cost, r.plan.cost * 1.005, true)} />
        <Cmp label="NOI at sale" plan={money(r.plan.noi)} actual={money(r.actual.noi)} good={better(r.actual.noi, r.plan.noi * 0.995)} />
        <Cmp label="Exit cap rate" plan={pct(r.plan.cap, 2)} actual={pct(r.actual.cap, 2)} good={better(r.actual.cap, r.plan.cap + 0.0002, true)} />
        <Cmp label="Months from closing" plan={String(r.plan.months)} actual={String(r.actual.months)} good={better(r.actual.months, r.plan.months, true)} />
        <Cmp label="Investor IRR" plan={pct(r.plan.lpIrr, 0)} actual={pct(r.actual.lpIrr, 0)} good={better(r.actual.lpIrr, r.plan.lpIrr)} />
      </Section>
      <div className="mt-3"><Advisor who="analyst" line={line} /></div>
    </div>
  );
}
