// High score boards and the end-of-career screen.
import { useEffect, useMemo, useState } from 'react';
import { CAREER_LABEL, CAREER_LENGTHS, scoreGame, yearsPlayed, type Career, type ScoreBreakdown } from '../engine/score';
import type { Game } from '../engine/types';
import { saveGame } from '../services/save';
import { friendlyError } from '../services/cloud';
import { Account } from './Account';
import { PERIODS, getBoard, type Period, type ScoreEntry } from '../services/scores';
import { money } from './format';
import { Btn, Chip, Seg } from './kit';
import { useUI } from './store';

const pts = (n: number) => Math.round(n).toLocaleString('en-US');
const HOW: Record<ScoreEntry['how'], string> = { complete: 'Full career', retired: 'Retired early', bust: 'Went under' };
const when = (ms: number) => new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

/** The four period leaders plus a top-ten table for one difficulty and career length. */
export function ScoresScreen({ onClose, initial }: { onClose: () => void; initial?: { difficulty: Game['difficulty']; career: Career; highlight?: string } }) {
  const [difficulty, setDifficulty] = useState<Game['difficulty']>(initial?.difficulty ?? 'rookie');
  const [career, setCareer] = useState<Career>(initial?.career ?? 10);
  const [period, setPeriod] = useState<Period>('all');
  const [leaders, setLeaders] = useState<Record<Period, ScoreEntry[]> | null>(null), [failed, setFailed] = useState(false);
  const board = getBoard();
  useEffect(() => {
    let live = true;
    setLeaders(null); setFailed(false);
    Promise.all(PERIODS.map((p) => board.top(difficulty, career, p.id, 10))).then((r) => { if (live) setLeaders(Object.fromEntries(PERIODS.map((p, i) => [p.id, r[i]])) as Record<Period, ScoreEntry[]>); }).catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [difficulty, career, board]);
  const list = leaders?.[period] ?? [];
  return (
    <div className="absolute inset-0 z-[60] flex items-center justify-center bg-[rgba(30,18,8,.45)] p-4" role="dialog" aria-label="High scores">
      <div className="glass rise flex max-h-full w-[820px] max-w-full flex-col overflow-hidden">
        <header className="flex items-start justify-between border-b border-line px-6 py-4">
          <div>
            <h2 className="display text-[30px] font-semibold leading-none">High scores</h2>
            <p className="mt-1 text-[12.5px] text-ink2">{board.shared ? 'Every player, every device.' : 'Scores from this device. The shared board for all players arrives with the Firebase launch.'}</p>
          </div>
          <button type="button" aria-label="Close" onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-full text-ink2 hover:bg-black/10">✕</button>
        </header>
        <div className="scroll flex-1 px-6 py-4">
          <div className="grid gap-2 sm:grid-cols-[1fr_1.5fr]">
            <Seg value={difficulty} onChange={setDifficulty} options={[{ value: 'rookie', label: 'Rookie' }, { value: 'pro', label: 'Pro' }]} />
            <Seg value={career} onChange={setCareer} options={CAREER_LENGTHS.map((c) => ({ value: c, label: c ? `${c} years` : 'Open-ended' }))} />
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4">
            {PERIODS.map((p) => {
              const top = leaders?.[p.id][0], on = period === p.id;
              return (
                <button key={p.id} type="button" aria-pressed={on} onClick={() => setPeriod(p.id)} className={`rounded-xl border p-3 text-left ${on ? 'border-accent bg-accent/10 ring-1 ring-accent' : 'border-line bg-white/60 hover:bg-white'}`}>
                  <div className="eyebrow">{p.label}</div>
                  {top ? (
                    <>
                      <div className="display num mt-0.5 text-[26px] font-semibold leading-none">{pts(top.score)}</div>
                      <div className="mt-1 truncate text-[12.5px] font-medium">{top.player}</div>
                      <div className="truncate text-[11.5px] text-ink2">{top.firm}</div>
                    </>
                  ) : <div className="mt-2 text-[12.5px] text-ink2">{failed ? '—' : leaders ? 'No scores yet' : 'Loading…'}</div>}
                </button>
              );
            })}
          </div>
          <div className="mt-4 text-[13px] font-semibold">{PERIODS.find((p) => p.id === period)!.label} · {difficulty === 'pro' ? 'Pro' : 'Rookie'} · {CAREER_LABEL[career]}</div>
          {list.length === 0 ? (
            <p className="mt-2 rounded-xl border border-dashed border-line p-4 text-[13px] text-ink2">{failed ? 'Could not reach the high scores. Check your connection and open this again.' : leaders ? 'Nobody has finished a career here yet. Finish one, or retire from the menu, to post a score.' : 'Loading…'}</p>
          ) : (
            <table className="mt-2 w-full text-[13px]">
              <thead><tr className="text-left text-[11.5px] text-ink2"><th className="py-1 pr-2 font-medium">#</th><th className="font-medium">Player</th><th className="text-right font-medium">Score</th><th className="hidden text-right font-medium sm:table-cell">Net worth</th><th className="hidden text-right font-medium md:table-cell">Investor profit</th><th className="hidden text-right font-medium md:table-cell">Deals sold</th><th className="hidden pl-3 font-medium lg:table-cell">Finish</th></tr></thead>
              <tbody>
                {list.map((e, i) => (
                  <tr key={e.id} className={`border-t border-line ${e.id === initial?.highlight ? 'bg-accent/12' : e.mine ? 'bg-white/50' : ''}`}>
                    <td className="num py-1.5 pr-2 font-semibold">{i + 1}</td>
                    <td><div className="font-medium">{e.player}{e.id === initial?.highlight && <span className="ml-1.5"><Chip tone="accent">This game</Chip></span>}</div><div className="text-[11.5px] text-ink2">{e.firm} · {when(e.at)}</div></td>
                    <td className="num text-right font-semibold">{pts(e.score)}</td>
                    <td className="num hidden text-right sm:table-cell">{money(e.netWorth)}</td>
                    <td className="num hidden text-right md:table-cell">{money(e.lpProfit)}</td>
                    <td className="num hidden text-right md:table-cell">{e.dealsSold}</td>
                    <td className="hidden pl-3 text-[12px] text-ink2 lg:table-cell">{HOW[e.how]}{e.how !== 'complete' ? `, ${e.years} yrs` : ''}{e.rank ? ` · ${['', '1st', '2nd', '3rd', '4th', '5th', '6th', '7th'][e.rank]} of 7 firms` : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <details className="mt-4 text-[12.5px] text-ink2">
            <summary className="cursor-pointer font-medium text-ink">How scores work</summary>
            <ul className="mt-1.5 list-disc space-y-0.5 pl-5">
              <li><b>Firm wealth:</b> 1 point per $1,000 your net worth grew. Properties you still own count at what they would sell for, after the loan and your partners' share.</li>
              <li><b>Investor profit:</b> 1 point per $1,000 your investors made beyond the money they put in, counting properties you still own at today's value.</li>
              <li><b>Deal quality:</b> 400 points per sale, plus or minus 25 points for every point of investor IRR above or below 10%. A sale that loses investors money costs 800 more.</li>
              <li><b>Milestones:</b> 300 each. <b>Reputation:</b> 15 points for each point of average standing above where you started.</li>
              <li>Weeks start Monday. Each board ranks one difficulty and one career length.</li>
            </ul>
          </details>
        </div>
      </div>
    </div>
  );
}

/** Shown when a career ends: the score, how it was built, where it ranks, and a way back to the title. */
export function CareerEnd({ g }: { g: Game }) {
  const quit = useUI((s) => s.quit), forget = useUI((s) => s.forget), user = useUI((s) => s.user);
  const needsSignIn = getBoard().shared && !user;
  const score: ScoreBreakdown = useMemo(() => scoreGame(g), [g]);
  const [entry, setEntry] = useState<ScoreEntry | null>(null);
  const [ranks, setRanks] = useState<Record<Period, number> | null>(null);
  const [board, setBoard] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => {
    if (g.flags.posted || needsSignIn) return;
    g.flags.posted = true; setErr('');
    const board = getBoard();
    board.submit({
      player: g.player || 'Player', firm: g.firmName, difficulty: g.difficulty, career: g.career, score: score.total, netWorth: score.netWorth,
      lpProfit: score.lpProfit, dealsSold: g.deals.filter((d) => d.result).length, rank: score.rank, years: yearsPlayed(g), how: g.ending!.how, at: Date.now(),
    }).then(async (e) => {
      setEntry(e); forget();
      const r = await Promise.all(PERIODS.map((p) => board.rank(e, p.id))).catch(() => null);
      if (r) setRanks(Object.fromEntries(PERIODS.map((p, i) => [p.id, r[i]])) as Record<Period, number>);
    }).catch((x) => { g.flags.posted = false; saveGame(g); setErr(`${friendlyError(x)} The score was not posted yet; your game is saved, so you can try again.`); });
  }, [g, score, needsSignIn]);
  const ending = g.ending!;
  const title = ending.how === 'complete' ? 'Career complete' : ending.how === 'retired' ? 'Retired' : 'Out of business';
  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-[rgba(30,18,8,.45)] p-4" role="dialog" aria-label={title}>
      <div className="glass rise max-h-full w-[640px] max-w-full overflow-y-auto p-6">
        <div className="eyebrow">{g.difficulty === 'pro' ? 'Pro' : 'Rookie'} · {CAREER_LABEL[g.career]} · {yearsPlayed(g)} years played</div>
        <h2 className="display mt-1 text-[38px] font-bold leading-none">{title}</h2>
        <p className="mt-2 text-[14px]">{ending.text}</p>
        <div className="mt-4 flex items-end justify-between gap-3 rounded-xl border border-line bg-white/65 p-4">
          <div><div className="eyebrow">Final score</div><div className="display num text-[48px] font-bold leading-none text-accent-deep">{pts(score.total)}</div></div>
          {ranks && (
            <div className="flex flex-wrap justify-end gap-1.5">
              {PERIODS.map((p) => <span key={p.id} className={`rounded-lg border px-2 py-1 text-center text-[11.5px] leading-tight ${ranks[p.id] === 1 ? 'border-accent bg-accent text-white' : 'border-line bg-white/70'}`}><b className="num block text-[15px]">#{ranks[p.id]}</b>{p.label}</span>)}
            </div>
          )}
        </div>
        <table className="mt-3 w-full text-[13px]">
          <tbody>
            {score.parts.map((p) => (
              <tr key={p.key} className="border-t border-line">
                <td className="py-1.5 pr-3"><div className="font-medium">{p.label}</div><div className="text-[11.5px] text-ink2">{p.detail}</div></td>
                <td className={`num text-right font-semibold ${p.points < 0 ? 'text-bad' : ''}`}>{p.points >= 0 ? '+' : ''}{pts(p.points)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {needsSignIn && !entry && <div className="mt-3"><Account name={g.player} note="Sign in to post this score to the shared high scores. It posts as soon as you are in." /></div>}
        {err && <p className="mt-3 text-[13px] text-bad">{err}</p>}
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <Btn onClick={() => setBoard(true)} disabled={!entry}>See the high scores</Btn>
          {needsSignIn && !entry ? <Btn kind="ghost" onClick={() => { forget(); quit(); }}>Skip posting</Btn> : <Btn kind="primary" onClick={quit}>Back to the title screen</Btn>}
        </div>
      </div>
      {board && entry && <ScoresScreen onClose={() => setBoard(false)} initial={{ difficulty: g.difficulty, career: g.career, highlight: entry.id }} />}
    </div>
  );
}
