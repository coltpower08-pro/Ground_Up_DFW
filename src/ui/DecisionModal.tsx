// Decisions pause the clock until the player answers.
import * as S from '../engine/sim';
import type { Bid, Decision, Prospect } from '../engine/types';
import { money, pct } from './format';
import { Advisor, Btn, Chip, Row, Term } from './kit';
import { ResultSummary } from './Result';
import { useGame, useUI } from './store';

export function DecisionModal() {
  const g = useGame();
  const act = useUI((s) => s.act), quit = useUI((s) => s.quit), set = useUI((s) => s.set);
  const dec: Decision | undefined = g.decisions[0];
  if (!dec) return null;
  const d = dec.dealId ? g.deals.find((x) => x.id === dec.dealId) : undefined;
  const choose = (id: string) => {
    if (dec.kind === 'gameover') { quit(); return; }
    act((gg) => S.resolveDecision(gg, dec.id, id));
    if (dec.kind === 'result' && d) set({ sel: { kind: 'deal', id: d.id } });
  };
  const p = dec.kind === 'prospect' ? (dec.data as unknown as Prospect) : null;
  const bids = dec.kind === 'bids' ? (dec.data as { bids: Bid[] }).bids : null;
  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-[rgba(40,24,10,.45)] p-4" role="dialog" aria-modal="true" aria-label={dec.title}>
      <div key={dec.id} className="glass rise scroll max-h-full w-[520px] max-w-full p-5">
        <div className="eyebrow">{d ? d.name : g.firmName}{g.decisions.length > 1 ? ` · ${g.decisions.length} items waiting` : ''}</div>
        <h2 className="display mt-0.5 text-[28px] font-semibold leading-tight">{dec.title}</h2>
        {dec.body && <p className="mt-2 text-[14.5px]">{dec.body}</p>}

        {p && d && (
          <div className="mt-3 rounded-xl border border-line bg-white/60 p-3">
            <div className="mb-1 flex items-center justify-between"><span className="font-semibold">Proposed terms</span><Chip tone={p.credit === 'A' ? 'good' : p.credit === 'C' ? 'bad' : 'neutral'}>{p.credit} credit</Chip></div>
            {p.share < 1 && <Row label="Space" value={`Half the building, ${Math.round((d.uw!.buildingSf * p.share) / 1000)}k SF`} />}
            <Row label={<Term k="nnn">Starting rent (NNN)</Term>} value={`${money(p.rentAnnual)}/yr`} />
            <Row label="Compared with market" value={pct(p.rentAnnual / (S.marketNoi(g, d) * p.share) - 1, 1)} sub />
            <Row label="Term" value={`${p.termMonths / 12} years, ${pct(p.escal, 1)} annual bumps`} />
            <Row label="Free rent" value={`${p.freeMonths} month${p.freeMonths === 1 ? '' : 's'}`} />
            {p.ti > 0 && <Row label="Tenant improvement allowance" value={money(p.ti)} />}
            <Row label="Leasing commission" value={money(p.lc)} />
            <Row label={<Term k="ner">Net effective rent</Term>} value={`${money(S.netEffectiveRent(p))}/yr`} strong />
          </div>
        )}
        {dec.kind === 'result' && d?.result && <div className="mt-3"><ResultSummary d={d} /></div>}
        {dec.advisor && <div className="mt-3"><Advisor who={dec.advisor.who} line={dec.advisor.line} /></div>}

        <div className="mt-4 flex flex-col gap-2">
          {dec.options.map((o, i) => {
            const bid = bids && o.id.startsWith('b') ? bids[Number(o.id.slice(1))] : null;
            return (
              <button key={o.id} type="button" onClick={() => choose(o.id)}
                className={`rounded-xl border px-3.5 py-2.5 text-left transition-colors ${i === 0 && dec.options.length <= 2 && !bids ? 'border-accent-deep bg-accent text-white hover:bg-accent-deep' : 'border-line bg-white/80 hover:bg-white'}`}>
                <span className="block font-medium">{o.label}{bid ? <span className="ml-2 text-[12px] font-normal opacity-70">{bid.kind === 'institution' ? 'Institution' : bid.kind === 'private' ? 'Private buyer' : 'Syndicator'}</span> : null}</span>
                {o.detail && <span className="block text-[12.5px] opacity-75">{o.detail}</span>}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
export { Btn };
