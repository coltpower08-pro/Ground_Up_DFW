// Right-hand context drawer: a parcel dossier or the Deal Room for the selected deal.
import { useState } from 'react';
import { ACHIEVEMENTS } from '../content/achievements';
import { DISTRICTS, roadOf, siteDataOf } from '../content/world';
import { capFor, districtRent, leaseUpBase, leaseUpFor, vacancyFor } from '../engine/market';
import { ACRE_RANGE, ATTORNEY_FEE, ENT, IOS, MF_UNIT_SF, OUTREACH_COST, PERM, PRODUCTS, RENO, REPORTS, SPEC, TERMS, TYPE_SHORT } from '../engine/params';
import { askPrice, computeProforma, dealTerms, entitlementKind, explainGrade, existingLeased, existingMarketNoi, getNpc, getParcel, sensitivity, usableAcres } from '../engine/proforma';
import * as S from '../engine/sim';
import type { Deal, DealType, Game, Parcel, Proforma, ReportId } from '../engine/types';
import { bps, dateStr, daysToWords, money, mult, pct } from './format';
import { Advisor, Bar, Btn, Chip, GradeBadge, PHASE_LABEL, Row, Section, Seg, Term } from './kit';
import { ResultSummary } from './Result';
import { useGame, useUI } from './store';

const ZONING: Record<string, string> = { I: 'Industrial', C: 'Commercial', AG: 'Agricultural', ETJ: 'County (ETJ), no zoning' };

export function Drawer() {
  const g = useGame();
  const sel = useUI((s) => s.sel), set = useUI((s) => s.set);
  if (!sel) return null;
  const deal = sel.kind === 'deal' ? g.deals.find((d) => d.id === sel.id) : g.deals.find((d) => d.parcelId === sel.id && d.phase !== 'dead');
  return (
    <aside className="glass rise absolute bottom-[124px] right-3 top-[72px] z-20 flex w-[400px] max-w-[calc(100vw-110px)] flex-col overflow-hidden">
      <button type="button" aria-label="Close panel" onClick={() => set({ sel: null })} className="absolute right-2.5 top-2.5 z-10 flex h-7 w-7 items-center justify-center rounded-full text-ink2 hover:bg-black/10">✕</button>
      {deal ? <DealPanel key={deal.id} g={g} d={deal} /> : <ParcelPanel key={sel.id} g={g} p={getParcel(g, sel.id)} />}
    </aside>
  );
}

// ---------------------------------------------------------------- parcel

/** What the road network says about a site: what it fronts, whether it is a corner, and how far the freeway is. */
function RoadFacts({ p }: { p: Parcel }) {
  const r = roadOf(p.id);
  if (!r) return null;
  const front = r.front === 'interstate' || r.front === 'highway' ? `${r.frontName} road` : r.frontName[0].toUpperCase() + r.frontName.slice(1);
  return (
    <div className="mt-1 text-[13px]">
      <Row label={<Term k="frontage">Fronts</Term>} value={front} />
      <Row label={<Term k="hardcorner">Corner</Term>} value={r.hard ? 'Hard corner, two arterials' : r.corner ? 'Corner lot' : 'Mid-block'} />
      <Row label={<Term k="interchange">Nearest freeway</Term>} value={`${r.rampMi.toFixed(1)} mi to ${r.rampName || 'a highway'}`} />
      <Row label="Highway access" value={'●'.repeat(p.access) + '○'.repeat(5 - p.access)} />
      {!p.existing && p.fit && p.fit.length > 0 && <Row label="Location suits" value={p.fit.map((t) => TYPE_SHORT[t]).join(', ')} />}
    </div>
  );
}

/** The numbers that drive one property type at this site, and what they do to its rent and lease-up. */
function SiteFacts({ g, p, type }: { g: Game; p: Parcel; type: DealType }) {
  const sd = siteDataOf(p.id), f = sd.f[type], n = (x: number) => x.toLocaleString('en-US');
  const vs = (x: number) => (Math.abs(x - 1) < 0.005 ? 'in line with' : `${Math.round(Math.abs(x - 1) * 100)}% ${x > 1 ? 'above' : 'below'}`);
  const lu = leaseUpFor(g, p, type), base = leaseUpBase(type);
  const unit = type === 'ios' ? '/acre/mo' : type === 'mf' ? '/SF/yr net' : '/SF/yr';
  const dr = districtRent(g, p.district, type);
  return (
    <div className="mt-2 rounded-xl border border-line bg-white/55 p-3 text-[13px]">
      <div className="mb-1 text-[12px] font-semibold uppercase tracking-wide text-ink2">What drives {{ ios: 'yard', spec: 'warehouse', retail: 'shopping-center', mf: 'apartment', office: 'office' }[type]} rents here</div>
      {type === 'retail' && <>
        <Row label={<Term k="traffic">Traffic count</Term>} value={`${n(sd.traffic)} cars a day`} />
        <Row label={<Term k="rooftops">Rooftops, 3 miles</Term>} value={`${n(sd.rooftops)} households`} />
        <Row label="Median household income" value={money(sd.income)} />
        <Row label={<Term k="anchor">Anchors nearby</Term>} value={sd.anchors === 0 ? 'None' : sd.anchors === 1 ? 'One grocer' : `${sd.anchors} anchors`} />
      </>}
      {type === 'office' && <>
        <Row label={<Term k="officejobs">Office jobs, 5 miles</Term>} value={n(sd.jobs)} />
        <Row label="Restaurants and services" value={'●'.repeat(sd.amenities) + '○'.repeat(5 - sd.amenities)} />
        <Row label={<><Term k="classa">Class A</Term> space empty nearby</>} value={pct(sd.officeVac, 0)} />
      </>}
      {type === 'mf' && <>
        <Row label={<Term k="renters">Renter households, 3 miles</Term>} value={n(sd.renters)} />
        <Row label="Median apartment rent" value={`$${n(sd.medRent)}/mo`} />
        <Row label="Job growth" value={`${sd.jobGrowth.toFixed(1)}% a year`} />
        <Row label={<Term k="schools">School rating</Term>} value={`${sd.schools} of 10`} />
      </>}
      {(type === 'ios' || type === 'spec') && <>
        <Row label={<Term k="laborpool">Labor pool</Term>} value={`${n(sd.labor)} workers`} />
        <Row label={<Term k="interchange">Drive to the freeway</Term>} value={`${roadOf(p.id)?.rampMi.toFixed(1) ?? '?'} mi`} />
      </>}
      <Row label="District rent" value={`${type === 'ios' ? money(dr) : `$${dr.toFixed(2)}`}${unit}`} />
      <Row label="This site against the district" value={`Rent ${vs((type === 'ios' || type === 'spec' ? [0.9, 0.9, 0.95, 1, 1.03, 1.06][p.access] : 1) * f.rent)}`} />
      <Row label={<><Term k="vacancy">Vacancy</Term> in this district</>} value={pct(vacancyFor(g, p.district, type), 1)} />
      <Row label={<><Term k="absorption">Lease-up</Term> expected</>} value={`${lu} months (typical ${base})`} />
      <Row label={<Term k="caprate">Cap rate here</Term>} value={pct(capFor(g, p.district, type), 2)} />
    </div>
  );
}

function Why({ lines }: { lines: string[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-2 border-t border-line pt-2 text-[12.5px]">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="font-semibold text-accent">{open ? 'Hide' : 'Why this grade?'}</button>
      {open && <ul className="mt-1 list-disc space-y-1 pl-4 text-ink2">{lines.map((l, i) => <li key={i}>{l}</li>)}</ul>}
    </div>
  );
}

const PRODUCT_SUB: Record<DealType, string> = { ios: 'Fast, simple, no building', spec: 'Bigger, slower, more capital', retail: 'Many small tenants, high rent', mf: 'Fills unit by unit, low cap rate', office: 'Slow to lease, costly build-outs' };
const TYPE_ARTICLE: Record<DealType, string> = { ios: 'an IOS yard', spec: 'a spec building', retail: 'a shopping center', mf: 'apartments', office: 'an office building' };

function parcelTake(p: Parcel, type: DealType): { who: 'analyst' | 'broker' | 'attorney' | 'cm'; line: string } {
  if (p.existing) {
    const ls = existingLeased(p);
    if (ls >= 0.999 && p.existing.leases.some((l) => l.factor < 0.9)) return { who: 'analyst', line: 'The tenant pays well under market and the lease ends soon. The upside is the renewal. The risk is that they leave instead.' };
    if (ls >= 0.999) return { who: 'analyst', line: 'Fully leased and priced that way. You are buying a safe income stream, so the return comes from the loan and time, not from a big gain.' };
    if (p.existing.cond === 'tired') return { who: 'cm', line: 'Order the property condition report. An older building always has a repair bill; the only question is whether you learn the number before or after you own it.' };
    return { who: 'broker', line: 'You are paying a discount for the empty space. Fill it and the value jumps. That is the whole value-add game.' };
  }
  // each type is judged on different things, so the advice starts with what matters for this one
  const sd = siteDataOf(p.id), road = roadOf(p.id), best = p.fit?.[0];
  if (best && !p.fit!.includes(type) && (best === 'retail' || best === 'mf' || best === 'office') !== (type === 'retail' || type === 'mf' || type === 'office'))
    return { who: 'broker', line: `The seller is pricing this as ${{ ios: 'a yard site', spec: 'a warehouse site', retail: 'a shopping-center site', mf: 'an apartment site', office: 'an office site' }[best]}, because that is what the location is worth most for. ${TYPE_SHORT[type]} will struggle to carry this land price.` };
  if (type === 'retail') {
    if (road?.hard) return { who: 'broker', line: `A hard corner with ${sd.traffic.toLocaleString('en-US')} cars a day. Retailers pay up for this, and so will you. Check that the rooftops and incomes back up the traffic.` };
    if (sd.traffic < 15000) return { who: 'analyst', line: `Only ${sd.traffic.toLocaleString('en-US')} cars a day pass this site. Shops live on traffic. Expect lower rents and a slow lease-up.` };
    if (sd.rooftops < 9000) return { who: 'analyst', line: `There are only ${sd.rooftops.toLocaleString('en-US')} households within three miles. The traffic is passing through, not shopping. Grocers will wait for more rooftops.` };
    return { who: 'broker', line: `${sd.traffic.toLocaleString('en-US')} cars a day and ${sd.rooftops.toLocaleString('en-US')} households nearby. Solid retail fundamentals. The question is what the land costs you.` };
  }
  if (type === 'mf' && p.zoning !== 'C') return { who: 'attorney', line: `Apartments are the hardest rezoning there is, and schools rated ${sd.schools} of 10 mean ${sd.schools >= 7 ? 'organized neighbors who will show up' : 'a council more open to new housing'}. Budget for outreach and a real chance of a no.` };
  if (type === 'mf') return { who: 'analyst', line: `Apartments here rent for about $${sd.medRent.toLocaleString('en-US')} a month and jobs are growing ${sd.jobGrowth.toFixed(1)}% a year. ${sd.jobGrowth >= 2.4 ? 'That is strong demand. Units should fill quickly.' : 'That is steady, not hot. Do not count on rent growth to save a thin deal.'}` };
  if (type === 'office') return { who: 'analyst', line: sd.officeVac >= 0.24 ? `About ${Math.round(sd.officeVac * 100)}% of the best office space nearby is empty. You would be competing with landlords giving away free rent. Underwrite a long lease-up.` : `${sd.jobs.toLocaleString('en-US')} office jobs within five miles and ${Math.round(sd.officeVac * 100)}% vacancy. This is one of the few places a new office can work. It still leases slowly, so keep cash in reserve.` };
  if ((type === 'ios' || type === 'spec') && road && road.rampMi > 2.5 && !p.offMarket) return { who: 'broker', line: `It is ${road.rampMi.toFixed(1)} miles to the freeway. Truck tenants measure that first. Expect to give on rent or wait longer for a tenant.` };
  if (p.floodPct >= 0.2) return { who: 'analyst', line: 'Price it on usable acres. A third of this tract is floodplain that will never earn rent.' };
  if (p.id === 'westport8') return { who: 'attorney', line: 'A former truck wash. Do not let the deposit go hard without a Phase I.' };
  if (p.zoning === 'AG') return { who: 'attorney', line: 'Agricultural zoning means a rezoning case. Budget four months and real odds of a no.' };
  if (p.zoning === 'ETJ') return { who: 'attorney', line: 'No zoning out here, so outdoor storage is allowed. You still need a plat, and there is no city water or sewer.' };
  if (p.zoning === 'C' && type === 'ios') return { who: 'attorney', line: 'Outdoor storage on commercial land needs a Specific Use Permit. Winnable, with screening and some outreach.' };
  if (!p.sewer && type === 'spec') return { who: 'analyst', line: 'No sewer. Extending the line adds about $450k to a building budget.' };
  if (p.offMarket) return { who: 'broker', line: 'Nobody else has seen this one. A clean, quick offer beats a high one here.' };
  return { who: 'broker', line: 'Zoned and served. You pay for that in the price, and you get it back in time and certainty.' };
}

function ParcelPanel({ g, p }: { g: Game; p: Parcel }) {
  const act = useUI((s) => s.act), set = useUI((s) => s.set);
  const ask = askPrice(g, p), usable = usableAcres(p);
  const ex = p.existing;
  const [pick, setType] = useState<DealType>(() => (p.fit ?? []).find((t) => g.unlocked.includes(t)) ?? (usable >= SPEC.minAcres && !(p.fit ?? []).includes('ios') ? 'spec' : 'ios'));
  const type: DealType = ex ? ex.type : pick;
  const fits = (t: DealType) => usable >= ACRE_RANGE[t][0] && usable <= ACRE_RANGE[t][1];
  const lockedBy = (key: string) => (g.unlocked.includes(key) ? null : ACHIEVEMENTS.find((a) => a.unlock === key) ?? null);
  const lock = ex ? lockedBy('acq') : lockedBy(type);
  const blocked = !!lock || (!ex && !fits(type));
  const [disc, setDisc] = useState<number>(p.counterPrice ? -1 : 0);
  const price = disc === -1 && p.counterPrice ? p.counterPrice : Math.round((ask * (1 - disc)) / 1000) * 1000;
  const short = p.name.replace(/ \(.*\)/, '');

  if (p.status !== 'available') {
    return <div className="p-5"><h2 className="display text-[26px] font-semibold leading-tight">{short}</h2><p className="mt-2 text-ink2">{p.status === 'rival' ? 'A rival developer bought this site.' : 'This site is no longer on the market.'}</p></div>;
  }
  const pf = S.previewProforma(g, p.id, type, price);
  const odds = S.offerOdds(g, p, price);
  const ent = ENT[entitlementKind(p, type)];
  const take = parcelTake(p, type);
  const earnest = Math.max(10000, Math.round((price * 0.02) / 1000) * 1000);
  const offer = () => {
    const r = act((gg) => S.makeOffer(gg, p.id, type, price));
    if (r && r.ok) { const d = g.deals[g.deals.length - 1]; set({ sel: { kind: 'deal', id: d.id }, paused: false }); }
    else if (p.counterPrice) setDisc(-1);
  };
  return (
    <>
      <header className="border-b border-line px-5 pb-3 pt-4 pr-11">
        <div className="eyebrow">{ex ? `Existing ${TYPE_SHORT[ex.type].toLowerCase()}` : p.offMarket ? 'Pocket listing' : 'For sale'} · {p.area}</div>
        <div className="text-[12px] text-ink2">{DISTRICTS[p.district].name}</div>
        <h2 className="display text-[26px] font-semibold leading-tight">{short}</h2>
        <p className="mt-1 text-[13.5px] text-ink2">{p.blurb}</p>
      </header>
      <div className="scroll flex-1 px-5 py-4">
        {ex && (
          <>
            <div className="grid grid-cols-2 gap-x-5">
              <Row label="Size" value={ex.type === 'ios' ? `${p.acres} acres` : ex.type === 'mf' ? `${Math.round(ex.sf / MF_UNIT_SF)} units` : `${ex.sf.toLocaleString('en-US')} SF`} />
              <Row label="Condition" value={ex.cond === 'tired' ? 'Tired' : 'Good'} />
              <Row label="Occupied" value={ex.type === 'mf' ? pct(ex.occ ?? 0, 0) : pct(existingLeased(p), 0)} />
              <Row label="Asking price" value={money(ask)} />
              <Row label={<Term k="noi">Income in place</Term>} value={money(ex.type === 'mf' ? existingMarketNoi(g, p, ex.cond === 'tired' ? RENO.asis.tired : 1) * existingLeased(p) : ex.leases.reduce((s, l) => s + l.rentAnnual, 0))} />
              <Row label="At full market rent" value={money(existingMarketNoi(g, p))} />
            </div>
            {ex.type !== 'mf' && (
              <Section title="Tenants in place">
                {ex.leases.length === 0 && <p className="text-[13px] text-ink2">Vacant. No rent until you find a tenant.</p>}
                {ex.leases.map((l) => (
                  <div key={l.tenant} className="mb-1.5 rounded-xl border border-line bg-white/60 p-2.5 text-[13px]">
                    <div className="flex items-baseline justify-between"><span className="font-medium">{l.tenant}</span><span className="num text-ink2">Credit {l.credit}</span></div>
                    <div className="text-[12px] text-ink2">{l.share < 1 ? 'Half the space' : 'The whole property'} · {money(l.rentAnnual)}/yr ({Math.round(l.factor * 100)}% of market) · {l.monthsLeft >= 24 ? `${Math.round(l.monthsLeft / 12)} years` : `${l.monthsLeft} months`} left</div>
                  </div>
                ))}
              </Section>
            )}
          </>
        )}
        {!ex && <div className="grid grid-cols-2 gap-x-5">
          <Row label="Gross acres" value={p.acres} />
          <Row label={<Term k="floodplain">Usable acres</Term>} value={`${usable.toFixed(1)}${p.floodPct ? ` (${Math.round(p.floodPct * 100)}% flood)` : ''}`} />
          <Row label="Asking price" value={money(ask)} />
          <Row label="Per square foot" value={`$${(p.askPsf * g.market.landIndex).toFixed(2)}`} />
          <Row label="Zoning" value={ZONING[p.zoning].split(',')[0]} />
          <Row label="Utilities" value={p.water && p.sewer ? 'Water, sewer' : p.water ? 'Water only' : 'None'} />
          <Row label="Rail" value={p.rail ? 'Rail-served' : 'No'} />
          <Row label="Flood plain" value={p.floodPct ? pct(p.floodPct, 0) : 'None'} />
        </div>}
        <RoadFacts p={p} />
        <SiteFacts g={g} p={p} type={type} />

        <Section title={ex ? 'If you buy it as it stands' : 'What would you build?'}>
          {!ex && (
            <div className="grid grid-cols-2 gap-1.5">
              {(['ios', 'spec', 'retail', 'mf', 'office'] as DealType[]).map((t) => {
                const lk = lockedBy(t), ok = fits(t), on = type === t;
                return (
                  <button key={t} type="button" aria-pressed={on} onClick={() => setType(t)} className={`rounded-xl border p-2 text-left ${on ? 'border-accent bg-accent/10 ring-1 ring-accent' : 'border-line bg-white/60 hover:bg-white'} ${lk || !ok ? 'opacity-60' : ''}`}>
                    <div className="text-[13.5px] font-medium">{lk ? '🔒 ' : ''}{TYPE_SHORT[t]}</div>
                    <div className="text-[11.5px] leading-snug text-ink2">{lk ? `Milestone: ${lk.title}` : !ok ? (usable < ACRE_RANGE[t][0] ? `Needs ${ACRE_RANGE[t][0]}+ usable acres` : `Needs ${ACRE_RANGE[t][1]} acres or less`) : PRODUCT_SUB[t]}</div>
                  </button>
                );
              })}
            </div>
          )}
          {lock && <div className="mt-2 rounded-xl border border-line bg-white/70 p-3 text-[13px]"><span className="font-semibold">Locked.</span> {ex ? 'Buying existing properties' : TYPE_SHORT[type]} opens with the milestone <span className="font-semibold">{lock.title}</span>: {lock.desc}</div>}
          <div className="mt-2 rounded-xl border border-line bg-white/55 p-3">
            <div className="flex items-center gap-3">
              <GradeBadge g={pf.score} />
              <div className="text-[13px] leading-snug"><span className="font-semibold">First look at this price.</span> <span className="text-ink2">Before reports, permits and surprises.</span></div>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-x-5 text-[13px]">
              <Row label="Total cost" value={money(pf.budget.total)} />
              <Row label={<Term k="noi">NOI</Term>} value={money(pf.noi)} />
              <Row label={<Term k="yoc">Yield on cost</Term>} value={pct(pf.yoc, 2)} />
              <Row label={<Term k="spread">Spread</Term>} value={bps(pf.spread)} />
              <Row label="Equity needed" value={money(pf.budget.equity)} />
              <Row label="Loan" value={money(pf.budget.loan)} />
            </div>
            <div className="text-[13px]"><Row label={<Term k="entitlement">Approval needed</Term>} value={ex ? 'None. It is already built.' : ent.label} /></div>
            <Why lines={S.previewWhy(g, p.id, type, price)} />
          </div>
        </Section>

        <Section title={<Term k="loi">Your offer</Term>}>
          <Seg value={disc} onChange={setDisc} options={[
            { value: 0, label: 'Full ask', sub: money(ask) },
            { value: 0.05, label: '5% under', sub: money(ask * 0.95) },
            { value: 0.1, label: '10% under', sub: money(ask * 0.9) },
            ...(p.counterPrice ? [{ value: -1, label: 'Their counter', sub: money(p.counterPrice) }] : [{ value: 0.15, label: '15% under', sub: money(ask * 0.85) }]),
          ]} />
          <div className="mt-2 flex items-center justify-between text-[13px]">
            <span>Chance the seller accepts</span><span className="num font-semibold">{Math.round(odds * 100)}%</span>
          </div>
          <Bar value={odds} tone={odds > 0.6 ? 'good' : odds > 0.3 ? 'accent' : 'bad'} thin />
          <p className="mt-2 text-[12.5px] text-ink2"><Term k="earnest">Earnest money</Term> of {money(earnest)} is due now. You get 60 days of <Term k="dd">due diligence</Term> to back out and get it back.</p>
        </Section>
        <div className="mt-3"><Advisor who={take.who} line={take.line} /></div>
      </div>
      <footer className="border-t border-line p-3">
        <Btn kind="primary" full disabled={blocked} onClick={offer}>{lock ? `Locked: ${lock.title}` : ex ? `Offer ${money(price)} for the property` : `Offer ${money(price)} for ${TYPE_ARTICLE[type]}`}</Btn>
      </footer>
    </>
  );
}

// ---------------------------------------------------------------- deal room

function ConfirmBtn({ label, confirm, onConfirm }: { label: string; confirm: string; onConfirm: () => void }) {
  const [armed, setArmed] = useState(false);
  return armed
    ? <Btn kind="danger" small onClick={onConfirm}>{confirm}</Btn>
    : <Btn kind="ghost" small onClick={() => { setArmed(true); setTimeout(() => setArmed(false), 4000); }}>{label}</Btn>;
}

function DealPanel({ g, d }: { g: Game; d: Deal }) {
  const [tab, setTab] = useState<'step' | 'numbers' | 'log'>('step');
  const p = getParcel(g, d.parcelId);
  const pf = d.uw ?? computeProforma(g, d);
  return (
    <>
      <header className="border-b border-line px-5 pb-0 pt-4 pr-11">
        <div className="flex items-center gap-2"><Chip tone={d.phase === 'dead' ? 'bad' : d.phase === 'sold' ? 'good' : 'accent'}>{PHASE_LABEL[d.phase]}</Chip><span className="eyebrow">{p.area}</span></div>
        <h2 className="display mt-1 text-[25px] font-semibold leading-tight">{d.name}</h2>
        <div className="mt-2 flex gap-1">
          {([['step', d.phase === 'sold' ? 'Results' : 'Next step'], ['numbers', 'Pro forma'], ['log', 'History']] as const).map(([k, label]) => (
            <button key={k} type="button" onClick={() => setTab(k)} className={`-mb-px border-b-2 px-3 py-1.5 text-[13.5px] font-medium ${tab === k ? 'border-accent text-ink' : 'border-transparent text-ink2 hover:text-ink'}`}>{label}</button>
          ))}
        </div>
      </header>
      <div className="scroll flex-1 px-5 py-4">
        {tab === 'step' && <Step g={g} d={d} p={p} pf={pf} />}
        {tab === 'numbers' && <Numbers g={g} d={d} pf={pf} />}
        {tab === 'log' && (
          <ul className="space-y-2">{d.log.map((l, i) => <li key={i} className="text-[13px]"><span className="num text-ink2">{dateStr(l.day)}</span><br />{l.text}</li>)}</ul>
        )}
      </div>
    </>
  );
}

function Step({ g, d, p, pf }: { g: Game; d: Deal; p: Parcel; pf: Proforma }) {
  const act = useUI((s) => s.act), set = useUI((s) => s.set);
  const walk = <ConfirmBtn label="Walk away from this deal" confirm={`Confirm: lose ${money(d.pursuit + (d.earnestHard ? d.earnest : 0))}`} onConfirm={() => { act((gg) => S.walkDeal(gg, d.id)); set({ sel: null }); }} />;

  if (d.phase === 'dead') return <p className="text-ink2">You dropped this deal. Dead-deal costs are part of the business; the skill is keeping them small.</p>;
  if (d.phase === 'sold' && d.result) return <ResultSummary d={d} />;

  if (d.phase === 'dd') {
    const left = d.ddDeadline - g.day;
    return (
      <>
        <div className="flex items-baseline justify-between"><span className="font-semibold">Feasibility period</span><span className="num text-ink2">{daysToWords(left)} left</span></div>
        <Bar value={1 - left / 60} tone={left < 15 ? 'bad' : 'accent'} thin />
        <p className="mt-2 text-[13px] text-ink2">Your {money(d.earnest)} deposit is refundable until you finish. Reports cost money now and can save far more later.</p>
        <Section title="Order reports">
          <div className="space-y-2">
            {(Object.keys(REPORTS) as ReportId[]).map((r) => {
              const rep = REPORTS[r], st = d.reports[r];
              return (
                <div key={r} className="flex items-center gap-3 rounded-xl border border-line bg-white/60 p-2.5">
                  <div className="min-w-0 flex-1">
                    <div className="text-[13.5px] font-medium">{d.acq && r === 'geo' ? 'Property condition report' : rep.label}</div>
                    <div className="text-[12px] text-ink2">{d.acq && r === 'geo' ? 'An engineer walks the roof, paving and mechanical systems and prices the repairs.' : `${rep.blurb}${r === 'geo' && d.type === 'ios' ? ' Matters less for a yard.' : ''}`}</div>
                  </div>
                  {st.status === 'none' && <Btn small onClick={() => act((gg) => S.orderReport(gg, d.id, r))}>{money(rep.cost)} · {rep.days}d</Btn>}
                  {st.status === 'ordered' && <Chip tone="warn">{Math.max(0, st.doneDay - g.day)}d left</Chip>}
                  {st.status === 'done' && <Chip tone="good">Done</Chip>}
                </div>
              );
            })}
          </div>
        </Section>
        <div className="mt-4 flex flex-col gap-2">
          <Btn kind="primary" full onClick={() => act((gg) => S.finishDD(gg, d.id))}>Finish due diligence and go hard</Btn>
          <div className="text-center">{walk}</div>
        </div>
      </>
    );
  }

  if (d.phase === 'entitlement') return <Entitlement g={g} d={d} walk={walk} />;
  if (d.phase === 'predev') return <Predev g={g} d={d} p={p} walk={walk} />;

  const con = d.con!, b = d.budget!, loan = d.loan!;
  if (d.phase === 'construction') {
    const prog = con.daysDone / con.daysTotal;
    return (
      <>
        <div className="flex items-baseline justify-between"><span className="font-semibold">{d.acq ? 'Renovation' : 'Construction'}</span><span className="num text-ink2">{Math.round(prog * 100)}% · {daysToWords(con.daysTotal - con.daysDone + con.delayDays)} to go</span></div>
        <Bar value={prog} />
        {con.delayDays > 0 && <p className="mt-1.5 text-[12.5px] text-bad">Work is stopped for {con.delayDays} more days.</p>}
        <Section title="Budget">
          <Row label="Total budget" value={money(b.total)} />
          <Row label="Spent to date" value={money(d.costToDate)} />
          <Row label={<Term k="contingency">Contingency left</Term>} value={`${money(con.contingencyLeft)} of ${money(b.contingency)}`} />
          {con.overrun > 0 && <Row label="Over contingency" value={<span className="text-bad">{money(con.overrun)}</span>} />}
          <Row label="Loan drawn" value={`${money(loan.balance)} of ${money(loan.commit)}`} />
          <Row label={<Term k="devfee">Development fee earned</Term>} value={money(d.devFeePaid)} />
        </Section>
        {d.type === 'mf' ? <p className="mt-3 text-[13px] text-ink2">{d.acq ? `${Math.round(d.occ * 100)}% occupied during the work.` : 'Apartments start leasing when the buildings are finished.'}</p> : (d.type !== 'ios' || d.acq) && <LeasingBlock g={g} d={d} note={d.acq ? 'You can market the empty space while the work is under way.' : prog < 0.5 ? 'Pre-leasing opens when the building is half done.' : 'Pre-leasing is open. Proposals arrive more slowly before the building is finished.'} />}
        <LeaseCard g={g} d={d} />
      </>
    );
  }

  if (d.phase === 'leasing') {
    return (
      <>
        <p className="text-[13.5px]"><span className="font-semibold">{d.type === 'mf' ? `${Math.round(d.occ * 100)}% occupied.` : d.leases.length ? 'Half vacant.' : 'Vacant.'}</span> Every month without a tenant costs about {money(b.total * 0.0014 * (1 - S.leasedShare(d)) + loan.balance * loan.rate / 12)} in carrying costs and interest.</p>
        <LeaseCard g={g} d={d} />
        <LeasingBlock g={g} d={d} note={d.type === 'mf' ? 'Units fill a few at a time each month. Lower rents fill faster; higher rents settle at a lower occupancy.' : 'Proposals arrive at each month-end. A lower asking rent brings them faster.'} />
        <Section title="Capital">
          <Row label="Loan balance" value={`${money(loan.balance)} of ${money(loan.commit)}`} />
          <Row label={<Term k="interestreserve">Interest reserve left</Term>} value={money(Math.max(0, loan.commit - loan.balance))} />
        </Section>
      </>
    );
  }

  // operations
  const est = S.estimateValue(g, d), rent = S.currentRent(g, d);
  const equityNow = est.value * (1 - 0.0225) - loan.balance + d.cash;
  return (
    <>
      <LeaseCard g={g} d={d} />
      <Section title="Performance">
        <Row label="Rent this month" value={rent > 0 ? money(rent / 12) : 'Free rent period'} />
        <Row label="Loan interest this month" value={money(loan.balance * loan.rate / 12)} />
        <Row label={<Term k="caprate">Estimated value</Term>} value={`${money(est.value)} at ${pct(est.cap, 2)}`} />
        <Row label={loan.perm ? 'Permanent loan' : 'Construction loan'} value={`${money(loan.balance)} at ${pct(loan.rate, 2)}`} />
        <Row label="Equity if sold today" value={money(equityNow)} strong />
        <Row label="Total cost" value={money(d.costToDate)} sub />
      </Section>
      <Section title="Exit">
        {d.sale.stage === 'none' && (
          <>
            <p className="mb-2 text-[13px] text-ink2">Cash is paid out to you and your investors every quarter while you hold. Selling pays off the loan and runs everything left through the <Term k="waterfall">waterfall</Term>.</p>
            <Btn kind="primary" full onClick={() => act((gg) => S.listForSale(gg, d.id))}>Take it to market</Btn>
          </>
        )}
        {d.sale.stage === 'none' && <Refi g={g} d={d} />}
        {d.sale.stage === 'marketing' && <p className="text-[13.5px]">On the market. Offers are due in <span className="num font-semibold">{daysToWords(Math.min(60, d.sale.day - g.day))}</span>.</p>}
        {d.sale.stage === 'closing' && d.sale.bid && <p className="text-[13.5px]">Under contract with {d.sale.bid.buyer} at <span className="num font-semibold">{money(d.sale.bid.price)}</span>. Closing in {daysToWords(Math.max(0, d.sale.day - g.day))}.</p>}
      </Section>
    </>
  );
}

function LeaseCard({ g, d }: { g: Game; d: Deal }) {
  if (!d.leases.length) return null;
  return (
    <Section title={d.leases.length > 1 ? 'Leases' : 'Lease'}>
      <div className="space-y-2">
        {d.leases.map((l) => {
          const elapsed = Math.max(0, Math.floor((g.day - l.startDay) / 30));
          return (
            <div key={l.tenant + l.startDay} className="rounded-xl border border-line bg-white/60 p-3">
              <div className="flex items-center justify-between"><span className="font-semibold">{l.tenant}</span><Chip tone={l.credit === 'A' ? 'good' : l.credit === 'C' ? 'bad' : 'neutral'}><Term k="credit">{l.credit} credit</Term></Chip></div>
              {l.share < 1 && <Row label="Space" value={`Half the building, ${Math.round((d.uw!.buildingSf * l.share) / 1000)}k SF`} />}
              <Row label={<Term k="nnn">Rent (NNN)</Term>} value={`${money(l.rentAnnual)}/yr`} />
              <Row label="Term" value={`${l.termMonths / 12} years, ${pct(l.escal, 1)} annual bumps`} />
              <Row label="Remaining" value={d.phase === 'construction' ? 'Starts at completion' : `${Math.max(0, l.termMonths - elapsed)} months`} />
            </div>
          );
        })}
      </div>
    </Section>
  );
}

function Refi({ g, d }: { g: Game; d: Deal }) {
  const act = useUI((s) => s.act);
  const q = S.refiQuote(g, d);
  if (d.loan?.perm) return <p className="mt-3 text-[12.5px] text-ink2">Already refinanced with a permanent loan. You can still sell at any time.</p>;
  return (
    <div className="mt-3 rounded-xl border border-line bg-white/60 p-3">
      <div className="font-semibold"><Term k="refi">Or refinance and hold</Term></div>
      <p className="mt-0.5 text-[12.5px] text-ink2">A permanent lender replaces the construction loan. Any extra cash goes to you and your investors, and you keep the property. The loan is the lowest of three tests: {PERM.minDscr}x DSCR, {pct(PERM.maxLtv, 0)} of value, {pct(PERM.minDebtYield, 0)} debt yield.</p>
      <div className="mt-1.5 text-[13px]">
        <Row label="New loan" value={`${money(q.loan)} at ${pct(q.rate, 2)}`} />
        <Row label={<Term k="dscr">Limited by</Term>} value={q.binding} sub />
        <Row label="Pays off construction loan" value={money(-q.payoff)} sub />
        <Row label="Loan fee" value={money(-q.fee)} sub />
        <Row label="Cash out to the partners" value={<span className={q.proceeds < 0 ? 'text-bad' : ''}>{money(q.proceeds)}</span>} strong />
      </div>
      <div className="mt-2"><Btn full disabled={!q.eligible || q.proceeds < 0} onClick={() => act((gg) => S.refinance(gg, d.id))}>{!q.eligible ? 'Available once rent is flowing' : q.proceeds < 0 ? 'Loan too small to refinance' : 'Refinance and keep the property'}</Btn></div>
    </div>
  );
}

function LeasingBlock({ g, d, note }: { g: Game; d: Deal; note: string }) {
  const act = useUI((s) => s.act);
  if (S.fullyLeased(d) && d.type !== 'mf') return null;
  const mkt = S.marketNoi(g, d);
  const unit = d.type === 'mf' ? `${money(mkt / 12 / (d.uw!.buildingSf / MF_UNIT_SF))}/unit/mo net` : d.type === 'ios' ? `${money(mkt / 12 / d.uw!.usableAcres)}/acre/mo` : `$${(mkt / d.uw!.buildingSf).toFixed(2)}/SF/yr`;
  return (
    <Section title="Leasing">
      <Row label="Market rent today" value={`${money(mkt)}/yr (${unit})`} />
      {d.type === 'mf' && <Row label="Occupancy" value={pct(d.occ, 0)} />}
      <div className="mt-1.5 text-[13px] font-medium">Asking rent</div>
      <Seg value={d.askFactor} onChange={(v) => act((gg) => S.setAsk(gg, d.id, v))} options={[
        { value: 0.95, label: '5% under', sub: 'Leases fast' }, { value: 1, label: 'Market', sub: 'Normal pace' },
        { value: 1.05, label: '5% over', sub: 'Slower' }, { value: 1.1, label: '10% over', sub: 'Long wait' },
      ]} />
      <p className="mt-2 text-[12.5px] text-ink2">{note}</p>
    </Section>
  );
}

function Entitlement({ g, d, walk }: { g: Game; d: Deal; walk: React.ReactNode }) {
  const act = useUI((s) => s.act);
  const [attorney, setAttorney] = useState(true), [outreach, setOutreach] = useState(false);
  const e = ENT[d.ent.kind];
  if (d.ent.status === 'pending') {
    const left = d.ent.decisionDay - g.day;
    return (
      <>
        <div className="flex items-baseline justify-between"><span className="font-semibold">{e.label} filed</span><span className="num text-ink2">Hearing in {daysToWords(left)}</span></div>
        <Bar value={1 - left / (d.ent.attempts ? 60 : e.days)} thin />
        <p className="mt-3 text-[13.5px]">Staff is reviewing the case. Your odds at the hearing are about <span className="num font-semibold">{Math.round(d.ent.odds * 100)}%</span>.</p>
        <p className="mt-2 text-[13px] text-ink2">Time spent with planning staff in your Rolodex before the next case improves future odds.</p>
        <div className="mt-4 text-center">{walk}</div>
      </>
    );
  }
  const odds = S.entOdds(g, d, attorney, outreach);
  const cost = (d.ent.attempts ? 15000 : e.fee) + (attorney ? ATTORNEY_FEE : 0) + (outreach ? OUTREACH_COST : 0);
  const Toggle = (p: { on: boolean; set: (v: boolean) => void; label: string; sub: string }) => (
    <button type="button" aria-pressed={p.on} onClick={() => p.set(!p.on)} className={`flex w-full items-center gap-3 rounded-xl border p-2.5 text-left ${p.on ? 'border-accent bg-accent/10' : 'border-line bg-white/60'}`}>
      <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border ${p.on ? 'border-accent bg-accent text-white' : 'border-ink2/50'}`}>{p.on ? '✓' : ''}</span>
      <span><span className="block text-[13.5px] font-medium">{p.label}</span><span className="block text-[12px] text-ink2">{p.sub}</span></span>
    </button>
  );
  return (
    <>
      <p className="text-[13.5px]">This site needs a <span className="font-semibold">{e.label.toLowerCase()}</span> before you can build. The city decides at a public hearing in about {daysToWords(e.days)}.</p>
      <Section title={<Term k="entitlement">Your application</Term>}>
        <div className="space-y-2">
          <Toggle on={attorney} set={setAttorney} label="Hire a land-use attorney" sub={`${money(ATTORNEY_FEE)}. Knows the staff, the code and the council.`} />
          <Toggle on={outreach} set={setOutreach} label="Meet the neighbors first" sub={`${money(OUTREACH_COST)}. Fewer angry speakers at the hearing.`} />
        </div>
        <div className="mt-3 flex items-center justify-between text-[13px]"><span>Chance of approval</span><span className="num font-semibold">{Math.round(odds * 100)}%</span></div>
        <Bar value={odds} tone={odds > 0.7 ? 'good' : odds > 0.45 ? 'accent' : 'bad'} thin />
      </Section>
      <div className="mt-3"><Advisor who="attorney" line="If the vote fails, the land is worth what you paid at best, and your deposit is already at risk. Spend where it moves the odds." /></div>
      <div className="mt-4 flex flex-col gap-2">
        <Btn kind="primary" full onClick={() => act((gg) => S.startEntitlement(gg, d.id, attorney, outreach))}>File the application for {money(cost)}</Btn>
        <div className="text-center">{walk}</div>
      </div>
    </>
  );
}

function Predev({ g, d, p, walk }: { g: Game; d: Deal; p: Parcel; walk: React.ReactNode }) {
  const act = useUI((s) => s.act);
  const pf = computeProforma(g, d);
  const pro = g.difficulty === 'pro', terms = dealTerms(g, d), sens = sensitivity(g, d, pf);
  const blockers = S.closeBlockers(g, d);
  const lp = d.lpId ? getNpc(g, d.lpId) : null;
  const lender = pf.lenderId ? getNpc(g, pf.lenderId) : null;
  const usable = usableAcres(p, d);
  const need = pf.budget.gpEquity - d.pursuit - d.earnest;
  return (
    <>
      <Section title={d.acq ? '1. Renovation plan' : '1. Design'}>
        {d.acq ? (
          <>
            <Seg value={d.reno} onChange={(v) => act((gg) => S.setReno(gg, d.id, v))} options={(Object.keys(RENO) as (keyof typeof RENO)[]).map((k) => ({ value: k, label: RENO[k].label, sub: RENO[k].months ? `${RENO[k].sub} · ${RENO[k].months} mo` : RENO[k].sub }))} />
            <p className="mt-2 text-[12.5px] text-ink2">{p.existing!.cond === 'tired' ? 'This property is tired. Left as is, new tenants pay about 14% under market. A refresh closes most of that gap; a full reposition beats the market.' : 'This property is in good shape. Renovation adds a few percent of rent on space you lease from here on.'} Leases already in place keep their rent until they expire.</p>
          </>
        ) : d.type !== 'ios' && d.type !== 'spec' ? (
          <>
            <div className="mb-1 text-[13px] font-medium">{d.type === 'mf' ? `${Math.round(pf.buildingSf / MF_UNIT_SF)} units` : `${pf.buildingSf.toLocaleString('en-US')} SF`} on {usable.toFixed(1)} usable acres</div>
            <Seg value={d.spec.extras ? 1 : 0} onChange={(v) => act((gg) => S.setSpec(gg, d.id, { extras: v === 1 }))} options={[{ value: 0, label: 'Standard finish', sub: `$${PRODUCTS[d.type].cost}/SF` }, { value: 1, label: 'Premium finish', sub: `+$${PRODUCTS[d.type].premiumCost}/SF, +${Math.round((PRODUCTS[d.type].premiumRent - 1) * 100)}% rent` }]} />
          </>
        ) : d.type === 'ios' ? (
          <>
            <div className="mb-1 text-[13px] font-medium">Yard surface</div>
            <Seg value={d.ios.surface} onChange={(v) => act((gg) => S.setIos(gg, d.id, { surface: v }))} options={(Object.keys(IOS.surface) as (keyof typeof IOS.surface)[]).map((k) => ({ value: k, label: IOS.surface[k].label, sub: `$${IOS.surface[k].cost.toFixed(2)}/SF · ${IOS.surface[k].months} mo` }))} />
            <div className="mb-1 mt-2.5 text-[13px] font-medium">Security</div>
            <Seg value={d.ios.security} onChange={(v) => act((gg) => S.setIos(gg, d.id, { security: v }))} options={[
              { value: 'basic', label: 'Fence and gate', sub: 'Lower cost' }, { value: 'premium', label: 'Lights, cameras, auto gate', sub: '+5% rent, leases faster' }]} />
          </>
        ) : (
          <>
            <div className="mb-1 text-[13px] font-medium">Building size on {usable.toFixed(1)} usable acres</div>
            <Seg value={d.spec.coverage} onChange={(v) => act((gg) => S.setSpec(gg, d.id, { coverage: v }))} options={([0.3, 0.35, 0.4] as const).map((c) => ({ value: c, label: `${Math.round((usable * 43560 * c) / 1000)}k SF`, sub: c === 0.3 ? 'More trailer parking' : c === 0.4 ? 'Tight truck court' : 'Balanced' }))} />
            <div className="mb-1 mt-2.5 text-[13px] font-medium">Clear height</div>
            <Seg value={d.spec.clear} onChange={(v) => act((gg) => S.setSpec(gg, d.id, { clear: v }))} options={([28, 32, 36] as const).map((c) => ({ value: c, label: `${c} ft`, sub: `$${SPEC.shell[c]}/SF` }))} />
            <div className="mb-1 mt-2.5 text-[13px] font-medium">Extras</div>
            <Seg value={d.spec.extras ? 1 : 0} onChange={(v) => act((gg) => S.setSpec(gg, d.id, { extras: v === 1 }))} options={[{ value: 0, label: 'Standard', sub: 'Base spec' }, { value: 1, label: 'More docks and trailer stalls', sub: '+$3/SF, +3% rent' }]} />
          </>
        )}
      </Section>

      <Section title={<>2. <Term k="gc">Contractor</Term></>}>
        {d.acq && d.reno === 'asis' && <p className="mb-1.5 text-[12.5px] text-ink2">No work planned, so no contractor is needed.</p>}
        <div className="space-y-1.5">
          {g.npcs.filter((n) => n.role === 'gc').map((n) => (
            <button key={n.id} type="button" aria-pressed={d.gcId === n.id} onClick={() => act((gg) => S.setGc(gg, d.id, n.id))} className={`w-full rounded-xl border p-2.5 text-left ${d.gcId === n.id ? 'border-accent bg-accent/10 ring-1 ring-accent' : 'border-line bg-white/60 hover:bg-white'}`}>
              <div className="flex items-baseline justify-between"><span className="text-[13.5px] font-medium">{n.name}</span><span className="num text-[12px] text-ink2">{n.costFactor! < 1 ? `${Math.round((1 - n.costFactor!) * 100)}% cheaper` : n.costFactor! > 1 ? `${Math.round((n.costFactor! - 1) * 100)}% more` : 'Market price'}</span></div>
              <div className="text-[12px] text-ink2">{n.blurb}</div>
            </button>
          ))}
        </div>
      </Section>

      <Section title={<>3. <Term k="lpgp">Equity partner</Term></>} right={<span className="num text-[12px] text-ink2">Attention {g.attention}/4</span>}>
        <div className="space-y-1.5">
          {g.npcs.filter((n) => n.role === 'lp').map((n) => {
            const locked = g.trackRecord < (n.minDeals ?? 0), cooling = (d.lpCooldown[n.id] ?? 0) > g.day, on = d.lpId === n.id;
            return (
              <div key={n.id} className={`rounded-xl border p-2.5 ${on ? 'border-good bg-good/10' : 'border-line bg-white/60'} ${locked ? 'opacity-55' : ''}`}>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[13.5px] font-medium">{n.name}</span>
                  {on ? <Chip tone="good">Committed</Chip> : locked ? <Chip>Needs {n.minDeals} deal{n.minDeals === 1 ? '' : 's'}</Chip>
                    : <Btn small disabled={cooling || g.attention < 1} onClick={() => act((gg) => S.pitchLp(gg, d.id, n.id))}>{cooling ? 'Try next month' : `Pitch · ${Math.round(S.pitchOdds(g, d, n.id) * 100)}%`}</Btn>}
                </div>
                <div className="num mt-0.5 text-[12px] text-ink2">Up to {money(n.maxCheck!)} · <Term k="pref">{pct(n.pref!, 0)} pref</Term> · <Term k="promote">{pct(n.promote!, 0)}{pro ? `/${Math.round(n.promote2! * 100)}%` : ''} promote</Term> · relationship {Math.round(n.rel)}</div>
              </div>
            );
          })}
        </div>
        {pro && (
          <>
            <div className="mb-1 mt-2.5 text-[13px] font-medium"><Term k="catchup">Terms you offer</Term></div>
            <Seg value={d.terms} onChange={(v) => act((gg) => S.setTerms(gg, d.id, v))} options={(Object.keys(TERMS) as (keyof typeof TERMS)[]).map((k) => ({ value: k, label: TERMS[k].label, sub: TERMS[k].sub }))} />
            {lp && <p className="num mt-1.5 text-[12.5px] text-ink2">Agreed: {pct(terms.pref, 0)} pref, then {pct(terms.promote, 0)} promote up to a {pct(terms.hurdle2, 0)} investor IRR, then {pct(terms.promote2, 0)}{terms.catchUp ? ', with a GP catch-up' : ''}. Changing terms means pitching again.</p>}
          </>
        )}
        <div className="mb-1 mt-2.5 text-[13px] font-medium">Your co-investment share of the equity</div>
        <Seg value={d.gpPct} onChange={(v) => act((gg) => S.setGpPct(gg, d.id, v))} disabled={!lp} options={[0.05, 0.1, 0.2, 0.5].map((v) => ({ value: v, label: `${v * 100}%`, sub: money(pf.budget.equity * v) }))} />
        {!lp && <p className="mt-1.5 text-[12.5px] text-ink2">Without a partner you fund all {money(pf.budget.equity)} of equity yourself.</p>}
      </Section>

      {pro && (
        <Section title={<>4. <Term k="floating">Lender term sheets</Term></>}>
          <div className="space-y-1.5">
            {pf.lenderOptions.map((o) => { const n = getNpc(g, o.id), on = pf.lenderId === o.id; return (
              <button key={o.id} type="button" aria-pressed={on} onClick={() => act((gg) => S.setLender(gg, d.id, o.id))} className={`w-full rounded-xl border p-2.5 text-left ${on ? 'border-accent bg-accent/10 ring-1 ring-accent' : 'border-line bg-white/60 hover:bg-white'}`}>
                <div className="flex items-baseline justify-between gap-2"><span className="text-[13.5px] font-medium">{n.org}</span><span className="num text-[12.5px]">{money(o.loan)}</span></div>
                <div className="num text-[12px] text-ink2">{pct(o.loan / o.total, 0)} of cost · floating {pct(o.rate, 2)} (base {pct(g.market.baseRate, 2)} + {pct(n.spread ?? 0, 2)}) · {pct(o.fee, 1)} fee · you need {money(o.total - o.loan)} equity</div>
              </button>
            ); })}
          </div>
        </Section>
      )}

      <Section title={pro ? '5. Investment committee' : '4. Investment committee'}>
        <div className="rounded-xl border border-line bg-white/60 p-3">
          <div className="mb-2 flex items-center gap-3"><GradeBadge g={pf.score} /><div className="text-[13px] leading-snug"><span className="font-semibold">Deal score.</span> <span className="text-ink2">Based on the spread between what you build to and what buyers pay.</span></div></div>
          <Row label="Total project cost" value={money(pf.budget.total)} />
          <Row label={<><Term k="ltc">Loan</Term>{lender ? ` · ${lender.org}` : ''}</>} value={lender ? `${money(pf.budget.loan)} at ${pct(pf.rate, 1)}` : 'None'} />
          <Row label="Equity" value={`${money(pf.budget.lpEquity)} investor + ${money(pf.budget.gpEquity)} you`} />
          <Row label={<Term k="yoc">Yield on cost</Term>} value={pct(pf.yoc, 2)} />
          <Row label={<Term k="caprate">Market cap rate</Term>} value={pct(pf.cap, 2)} />
          <Row label={<Term k="spread">Development spread</Term>} value={bps(pf.spread)} />
          <Row label="Projected profit" value={`${money(pf.profit)} (${pct(pf.margin, 0)})`} />
          {lp && <Row label={<Term k="irr">Projected investor IRR</Term>} value={`${pct(pf.lpIrr, 0)} · ${mult(pf.lpMultiple)}`} />}
          <Row label={need >= 0 ? 'Cash you must bring to closing' : 'Pursuit costs repaid to you at closing'} value={money(Math.abs(need))} strong />
          <Why lines={explainGrade(g, d, pf)} />
        </div>
      </Section>
      {pro && lp && (
        <Section title="What if we miss? Investor IRR">
          <table className="num w-full text-center text-[12.5px]">
            <thead><tr className="text-ink2"><th className="py-1 text-left font-medium">Cost overrun</th>{sens.caps.map((c) => <th key={c} className="font-medium">{c === 0 ? 'Plan cap' : `${c > 0 ? '+' : ''}${Math.round(c * 10000)} bps`}</th>)}</tr></thead>
            <tbody>{sens.overs.map((o, i) => (<tr key={o} className="border-t border-line"><td className="py-1 text-left">{o === 0 ? 'On budget' : `${Math.round(o * 100)}% over`}</td>{sens.grid[i].map((v, j) => <td key={j} className={v < terms.pref ? 'font-semibold text-bad' : v >= 0.15 ? 'text-good' : ''}>{pct(v, 0)}</td>)}</tr>))}</tbody>
          </table>
          <p className="mt-1 text-[12px] text-ink2">Columns move the exit cap rate. Red means investors earn less than their preferred return.</p>
        </Section>
      )}
      <div className="mt-3"><Advisor who="analyst" line={pf.spread < 0.0075 ? 'The spread is thin. We would be taking construction risk for about the return of buying a finished property.' : pf.spread < 0.0125 ? 'It pencils, without much room for surprises. Cheaper land or a better design would help.' : 'Healthy spread. The numbers leave room for a delay or a slow lease-up.'} /></div>
      {blockers.length > 0 && <ul className="mt-3 list-disc space-y-1 pl-5 text-[13px] text-bad">{blockers.map((b) => <li key={b}>{b}</li>)}</ul>}
      <div className="mt-4 flex flex-col gap-2">
        <Btn kind="primary" full disabled={blockers.length > 0} onClick={() => act((gg) => S.closeDeal(gg, d.id))}>Close on the land and break ground</Btn>
        <div className="text-center">{walk}</div>
      </div>
    </>
  );
}

function Numbers({ g, d, pf }: { g: Game; d: Deal; pf: Proforma }) {
  const b = pf.budget, closed = !!d.budget;
  const live = closed ? S.marketNoi(g, d) : pf.noi;
  return (
    <>
      <Section title={closed ? 'Budget at closing' : 'Budget (live estimate)'}>
        <Row label={`${d.acq ? 'Purchase price' : 'Land'}${closed ? '' : ' (contract price)'}`} value={money(b.land)} />
        <Row label="Closing costs" value={money(b.closing)} sub />
        <Row label={<Term k="hardsoft">Hard costs</Term>} value={money(b.hard)} />
        <Row label="Soft costs" value={money(b.soft)} />
        <Row label="Pursuit costs to date" value={money(b.pursuit)} sub />
        <Row label={<Term k="devfee">Development fee</Term>} value={money(b.devFee)} />
        <Row label={<Term k="contingency">Contingency</Term>} value={money(b.contingency)} />
        <Row label="Leasing costs" value={money(b.leasing)} />
        <Row label={<Term k="interestreserve">Financing and interest</Term>} value={money(b.financing)} />
        <Row label="Total project cost" value={money(b.total)} strong />
      </Section>
      <Section title="Sources">
        <Row label={<Term k="ltc">{d.acq ? 'Acquisition loan' : 'Construction loan'}</Term>} value={`${money(b.loan)} (${pct(b.loan / b.total, 0)})`} />
        <Row label="Investor equity" value={money(b.lpEquity)} />
        <Row label="Your equity" value={money(b.gpEquity)} />
      </Section>
      <Section title="Returns">
        <Row label={d.type === 'ios' ? 'Usable acres' : d.type === 'mf' ? 'Units' : 'Building size'} value={d.type === 'ios' ? pf.usableAcres.toFixed(1) : d.type === 'mf' ? Math.round(pf.buildingSf / MF_UNIT_SF) : `${pf.buildingSf.toLocaleString('en-US')} SF`} />
        <Row label={<Term k="noi">Stabilized NOI</Term>} value={money(pf.noi)} />
        {closed && <Row label="NOI at today's market rent" value={money(live)} sub />}
        <Row label={<Term k="yoc">Yield on cost</Term>} value={pct(pf.yoc, 2)} />
        <Row label={<Term k="caprate">Cap rate</Term>} value={pct(pf.cap, 2)} />
        <Row label={<Term k="spread">Spread</Term>} value={bps(pf.spread)} />
        <Row label="Value when stabilized" value={money(pf.value)} />
        <Row label="Projected profit" value={money(pf.profit)} />
        <Row label={<Term k="irr">Projected investor IRR</Term>} value={pct(pf.lpIrr, 0)} />
        <Row label="Projected IRR on your equity" value={pct(pf.gpIrr, 0)} />
      </Section>
      {g.difficulty === 'pro' && (
        <Section title="Show the math">
          <div className="num space-y-1 text-[12.5px] text-ink2">
            <div>Yield on cost = NOI ÷ total cost = {money(pf.noi)} ÷ {money(b.total)} = <span className="text-ink">{pct(pf.yoc, 2)}</span></div>
            <div>Spread = yield on cost − cap rate = {pct(pf.yoc, 2)} − {pct(pf.cap, 2)} = <span className="text-ink">{bps(pf.spread)}</span></div>
            <div>Value = NOI ÷ cap rate = {money(pf.noi)} ÷ {pct(pf.cap, 2)} = <span className="text-ink">{money(pf.value)}</span></div>
            <div>Profit = value less 2.25% sale costs − total cost = <span className="text-ink">{money(pf.profit)}</span></div>
            <div>Loan = {pct(b.loan / b.total, 0)} of cost = <span className="text-ink">{money(b.loan)}</span>; equity = cost − loan = <span className="text-ink">{money(b.equity)}</span></div>
            <div>Interest-only debt service = {money(b.loan)} × {pct(pf.rate, 2)} = {money(b.loan * pf.rate)}; coverage = NOI ÷ that = <span className="text-ink">{(pf.noi / (b.loan * pf.rate || 1)).toFixed(2)}x</span></div>
          </div>
        </Section>
      )}
      {closed && d.acct && (
        <Section title={<Term k="waterfall">Partner accounts</Term>}>
          <Row label="Investor capital not yet returned" value={money(d.acct.lpCap)} />
          <Row label={<Term k="pref">Preferred return owed</Term>} value={money(d.acct.lpPref + d.acct.gpPref)} />
          <Row label="Your capital not yet returned" value={money(d.acct.gpCap)} />
          <Row label={<Term k="promote">Promote earned</Term>} value={money(d.promotePaid)} />
        </Section>
      )}
    </>
  );
}
