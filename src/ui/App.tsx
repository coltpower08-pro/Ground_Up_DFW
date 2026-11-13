import { useEffect, useState } from 'react';
import { currentChapter } from '../content/tutorial';
import * as S from '../engine/sim';
import type { Deal, Game } from '../engine/types';
import { DecisionModal } from './DecisionModal';
import { Drawer } from './Drawer';
import { dateStr, daysToWords, money } from './format';
import { Bar, Btn, Chip, PHASE_LABEL, PHASE_ORDER, Seg } from './kit';
import { MapView } from './MapView';
import { Panel } from './Panels';
import { CareerEnd, ScoresScreen } from './Scores';
import { Account } from './Account';
import { cloud } from '../services/cloud';
import { scoreGame, type Career } from '../engine/score';
import { useGame, useUI, type PanelId } from './store';

const MS_PER_DAY = 40000 / 30; // one game month is about 40 seconds at 1x

export function App() {
  const game = useUI((s) => s.game);
  return (
    <div className="relative h-full w-full overflow-hidden">
      <MapView dim={!game} />
      {game ? <GameScreen /> : <Title />}
    </div>
  );
}

function Title() {
  const start = useUI((s) => s.start), resume = useUI((s) => s.resume), hasSave = useUI((s) => s.hasSave);
  const [name, setName] = useState('');
  const [player, setPlayer] = useState(() => { try { return localStorage.getItem('ground-up-dfw.player') ?? ''; } catch { return ''; } });
  const user = useUI((s) => s.user);
  useEffect(() => { if (user && !player.trim()) setPlayer(user.name); }, [user]); // eslint-disable-line react-hooks/exhaustive-deps
  const [mode, setMode] = useState<'rookie' | 'pro'>('rookie');
  const [career, setCareer] = useState<Career>(10);
  const [scores, setScores] = useState(false);
  const go = () => { try { localStorage.setItem('ground-up-dfw.player', player.trim()); } catch { /* not saved */ } if (user && player.trim()) cloud()?.setName(player).catch(() => { /* keep playing */ }); start(name, mode, career, player); };
  return (
    <div className="absolute inset-0 z-10 flex items-center justify-center bg-[rgba(60,32,10,.28)] p-4">
      <div className="glass max-h-full w-[560px] max-w-full overflow-y-auto p-7">
        <div className="eyebrow">A real estate development game</div>
        <h1 className="display mt-1 text-[64px] font-bold leading-[0.95] tracking-tight">GROUND UP<span className="text-accent">:</span> DFW</h1>
        <p className="mt-3 max-w-[46ch] text-[15px]">Start a one-person development shop in Dallas-Fort Worth. Find land, win approvals, raise money, build, lease and sell. Then pay your investors and do it bigger.</p>
        <ul className="mt-4 grid gap-1.5 text-[13.5px] text-ink2">
          <li><span className="font-semibold text-ink">Click a site</span> with a dashed outline on the map to make an offer.</li>
          <li><span className="font-semibold text-ink">The clock runs</span> about 40 seconds a month at 1x and pauses when a decision needs you.</li>
          <li><span className="font-semibold text-ink">Dotted words</span> explain themselves. Hover or tap them.</li>
          <li><span className="font-semibold text-ink">Move the camera:</span> drag to pan, scroll or pinch to zoom, right-drag or twist two fingers to rotate.</li>
        </ul>
        <div className="mt-5"><div className="eyebrow mb-1">Difficulty</div>
          <Seg value={mode} onChange={setMode} options={[
            { value: 'rookie', label: 'Rookie', sub: 'Steady market, simple profit split, lender picked for you' },
            { value: 'pro', label: 'Pro', sub: 'Market cycles, floating-rate term sheets, tiered waterfall' },
          ]} />
        </div>
        <div className="mt-3"><div className="eyebrow mb-1">Career length</div>
          <Seg value={career} onChange={setCareer} options={[
            { value: 10, label: '10 years', sub: 'A quick career, then a final score' },
            { value: 25, label: '25 years', sub: 'Room to build an empire' },
            { value: 0, label: 'Open-ended', sub: 'Play on; retire to post a score' },
          ]} />
        </div>
        <form className="mt-4 flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); go(); }}>
          <div className="min-w-[140px] flex-1">
            <label htmlFor="player-name" className="eyebrow">Your name</label>
            <input id="player-name" value={player} onChange={(e) => setPlayer(e.target.value)} maxLength={24} placeholder="Shown on the high scores" className="mt-1 w-full rounded-lg border border-line bg-white/85 px-3 py-2 outline-none focus:border-accent" />
          </div>
          <div className="min-w-[160px] flex-1">
            <label htmlFor="firm-name" className="eyebrow">Name your firm</label>
            <input id="firm-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={32} placeholder="Your Development Co." className="mt-1 w-full rounded-lg border border-line bg-white/85 px-3 py-2 outline-none focus:border-accent" />
          </div>
          <button type="submit" className="rounded-lg border border-accent-deep bg-accent px-4 py-2 font-medium text-white shadow-[0_2px_0_rgba(0,0,0,.18)] hover:bg-accent-deep">Start a new game</button>
          {hasSave && <Btn onClick={resume}>Continue saved game</Btn>}
          <Btn kind="ghost" onClick={() => setScores(true)}>High scores</Btn>
        </form>
        <div className="mt-3"><Account name={player} /></div>
        <p className="mt-4 text-[12px] text-ink2">Places are real; parcels, companies, people and prices are invented for the game.</p>
      </div>
      {scores && <ScoresScreen onClose={() => setScores(false)} />}
    </div>
  );
}

function GameScreen() {
  const tick = useUI((s) => s.tick);
  // game loop: advance whole days while unpaused
  useEffect(() => {
    let last = performance.now(), acc = 0;
    const id = setInterval(() => {
      const now = performance.now(), dt = Math.min(500, now - last);
      last = now;
      const s = useUI.getState();
      if (!s.game || s.paused || s.game.decisions.length || s.game.over) { acc = 0; return; }
      acc += dt * s.speed;
      const days = Math.floor(acc / MS_PER_DAY);
      if (days > 0) { acc -= days * MS_PER_DAY; tick(days); }
    }, 60);
    return () => clearInterval(id);
  }, [tick]);
  // keyboard: space toggles pause
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || (e.target as HTMLElement).closest('input, button, textarea')) return;
      e.preventDefault(); useUI.getState().set({ paused: !useUI.getState().paused });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return (
    <>
      <TopBar />
      <Rail />
      <TutorialCard />
      <Panel />
      <Drawer />
      <Pipeline />
      <Toasts />
      <DecisionModal />
      <Ending />
    </>
  );
}

function Ending() {
  const g = useGame();
  return g.over && g.ending ? <CareerEnd g={g} /> : null;
}

function TopBar() {
  const g = useGame();
  const flat = useUI((s) => s.flat), setFlat = useUI((s) => s.setFlat), gfx = useUI((s) => s.gfx), setGfx = useUI((s) => s.setGfx);
  const paused = useUI((s) => s.paused), speed = useUI((s) => s.speed), set = useUI((s) => s.set), save = useUI((s) => s.save), quit = useUI((s) => s.quit);
  const [menu, setMenu] = useState(false), [confirm, setConfirm] = useState(false), [scores, setScores] = useState(false), act = useUI((s) => s.act);
  const score = scoreGame(g).total, year = Math.floor(g.day / 360) + 1;
  const invested = g.deals.reduce((s, d) => s + (d.acct && d.phase !== 'sold' ? d.acct.gpCap : 0), 0);
  const Stat = (p: { label: string; value: string; warn?: boolean }) => (
    <div className="px-3 leading-tight"><div className="text-[11px] text-ink2">{p.label}</div><div className={`display num text-[21px] font-semibold ${p.warn ? 'text-bad' : ''}`}>{p.value}</div></div>
  );
  return (
    <header className="glass absolute left-3 right-3 top-3 z-30 flex h-[52px] items-center gap-1 px-3">
      <div className="display mr-2 truncate text-[21px] font-bold tracking-tight">{g.firmName}</div>
      {g.difficulty === 'pro' && <Chip tone="accent">Pro</Chip>}
      <div className="hidden h-7 w-px bg-line sm:block" />
      <Stat label="Cash" value={money(g.cash)} warn={g.cash < 0} />
      <Stat label="Invested" value={money(invested)} />
      <div className="hidden px-3 leading-tight md:block"><div className="text-[11px] text-ink2">Attention</div><div className="mt-1.5 flex gap-1">{[0, 1, 2, 3].map((i) => <i key={i} className={`h-2.5 w-2.5 rounded-full ${i < g.attention ? 'bg-accent' : 'bg-black/15'}`} />)}</div></div>
      <div className="hidden px-3 leading-tight xl:block" title="Your score if you retired today. Open Goals for the breakdown."><div className="text-[11px] text-ink2">Score{g.career ? ` · year ${Math.min(year, g.career)} of ${g.career}` : ''}</div><div className="display num text-[21px] font-semibold">{score.toLocaleString('en-US')}</div></div>
      <div className="hidden px-3 leading-tight lg:block"><div className="text-[11px] text-ink2">Deals done</div><div className="display num text-[21px] font-semibold">{g.trackRecord}</div></div>
      <div className="flex-1" />
      <div className="display num mr-1 whitespace-nowrap text-[20px] font-semibold">{dateStr(g.day)}</div>
      <div className="flex items-center gap-0.5 rounded-lg bg-black/7 p-0.5">
        <button type="button" aria-label={paused ? 'Play' : 'Pause'} aria-pressed={paused} onClick={() => set({ paused: !paused })} className={`h-8 w-9 rounded-md text-[13px] font-semibold ${paused ? 'bg-accent text-white' : 'hover:bg-white/70'}`}>{paused ? '▶' : '❚❚'}</button>
        {([1, 2, 4, 8] as const).map((s) => (
          <button key={s} type="button" aria-pressed={!paused && speed === s} onClick={() => set({ speed: s, paused: false })} className={`num h-8 w-9 rounded-md text-[13px] font-semibold ${!paused && speed === s ? 'bg-ink text-white' : 'hover:bg-white/70'}`}>{s}x</button>
        ))}
      </div>
      <div className="relative ml-1">
        <button type="button" aria-label="Menu" aria-expanded={menu} onClick={() => { setMenu(!menu); setConfirm(false); }} className="h-8 w-9 rounded-md text-[18px] hover:bg-black/8">≡</button>
        {menu && (
          <div className="glass absolute right-0 top-10 z-50 flex w-60 flex-col p-1.5">
            <button type="button" className="rounded-md px-3 py-2 text-left hover:bg-black/7" onClick={() => { save(); setMenu(false); }}>Save game</button>
            <button type="button" className="rounded-md px-3 py-2 text-left hover:bg-black/7" onClick={() => { setFlat(!flat); setMenu(false); }}>{flat ? 'Switch to 3D map' : 'Switch to simple 2D map'}</button>
            {!flat && (
              <>
                <div className="eyebrow px-3 pb-1 pt-2">Picture</div>
                <button type="button" className="flex justify-between rounded-md px-3 py-2 text-left hover:bg-black/7" onClick={() => setGfx({ cycle: !gfx.cycle })}><span>Day and night</span><span className="text-ink2">{gfx.cycle ? 'On' : 'Off'}</span></button>
                <button type="button" className="flex justify-between rounded-md px-3 py-2 text-left hover:bg-black/7" onClick={() => setGfx({ weather: !gfx.weather })}><span>Weather</span><span className="text-ink2">{gfx.weather ? 'On' : 'Off'}</span></button>
                <button type="button" className="flex justify-between rounded-md px-3 py-2 text-left hover:bg-black/7" onClick={() => setGfx({ quality: ({ auto: 'high', high: 'medium', medium: 'low', low: 'auto' } as const)[gfx.quality] })}><span>Quality</span><span className="text-ink2">{{ auto: 'Auto', high: 'High', medium: 'Medium', low: 'Low' }[gfx.quality]}</span></button>
                <div className="my-1 border-t border-line" />
              </>
            )}
            <button type="button" className="rounded-md px-3 py-2 text-left hover:bg-black/7" onClick={() => { setScores(true); setMenu(false); }}>High scores</button>
            {!confirm ? (
              <button type="button" className="rounded-md px-3 py-2 text-left hover:bg-black/7" onClick={() => setConfirm(true)}>Retire and post score…</button>
            ) : (
              <div className="rounded-md bg-black/5 px-3 py-2 text-[13px]">
                <div>End this career now and post <b className="num">{score.toLocaleString('en-US')}</b> points? Properties you own count at today's values.</div>
                <div className="mt-2 flex gap-1.5"><Btn small kind="primary" onClick={() => { act((gg) => S.retire(gg)); setMenu(false); setConfirm(false); }}>Retire</Btn><Btn small kind="ghost" onClick={() => setConfirm(false)}>Keep playing</Btn></div>
              </div>
            )}
            <button type="button" className="rounded-md px-3 py-2 text-left hover:bg-black/7" onClick={() => { save(); quit(); }}>Save and exit to title</button>
          </div>
        )}
      </div>
      {scores && <ScoresScreen onClose={() => setScores(false)} initial={{ difficulty: g.difficulty, career: g.career }} />}
    </header>
  );
}

const RAIL: { id: PanelId | 'map'; label: string; icon: string }[] = [
  { id: 'map', label: 'Map', icon: 'M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2zM9 4v14M15 6v14' },
  { id: 'deals', label: 'Deals', icon: 'M4 7h16v12H4zM9 7V5h6v2M4 12h16' },
  { id: 'rolodex', label: 'Rolodex', icon: 'M8 11a3 3 0 100-6 3 3 0 000 6zM2 19c0-3 3-5 6-5s6 2 6 5M17 11a2.5 2.5 0 100-5M16 14c3 0 6 2 6 5' },
  { id: 'capital', label: 'Capital', icon: 'M12 3v18M16 7c0-1.7-1.8-3-4-3S8 5.300 8 7s1.800 3 4 3 4 1.300 4 3-1.800 3-4 3-4-1.300-4-3' },
  { id: 'portfolio', label: 'Portfolio', icon: 'M3 20V9l6-4v15M9 20V11l12-3v12M2 20h20M13 13h4M13 16h4' },
  { id: 'market', label: 'Market', icon: 'M3 19h18M5 15l4-5 4 3 6-8M19 5v4h-4' },
  { id: 'milestones', label: 'Goals', icon: 'M7 4h10v5a5 5 0 01-10 0zM7 6H4a3 3 0 003 4M17 6h3a3 3 0 01-3 4M12 14v4M8 20h8' },
  { id: 'almanac', label: 'Almanac', icon: 'M5 4h11a3 3 0 013 3v13H8a3 3 0 01-3-3zM5 17a3 3 0 013-3h11M9 8h6' },
];

function Rail() {
  const panel = useUI((s) => s.panel), set = useUI((s) => s.set);
  return (
    <nav aria-label="Main" className="glass absolute bottom-[124px] left-3 top-[72px] z-30 flex w-[72px] flex-col items-center gap-1 overflow-hidden py-2">
      {RAIL.map((r) => {
        const on = r.id === 'map' ? panel === null : panel === r.id;
        return (
          <button key={r.id} type="button" aria-pressed={on} onClick={() => set({ panel: r.id === 'map' || panel === r.id ? null : r.id })}
            className={`flex w-[60px] flex-col items-center gap-0.5 rounded-xl py-1.5 text-[11px] font-medium ${on ? 'bg-ink text-white' : 'text-ink2 hover:bg-black/8'}`}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={r.icon} /></svg>
            {r.label}
          </button>
        );
      })}
    </nav>
  );
}

function nextStep(g: Game, d: Deal): string {
  switch (d.phase) {
    case 'dd': return `${daysToWords(d.ddDeadline - g.day)} of due diligence left`;
    case 'entitlement': return d.ent.status === 'pending' ? `Hearing in ${daysToWords(d.ent.decisionDay - g.day)}` : 'File your application';
    case 'predev': return 'Design it, fund it, close';
    case 'construction': return `${Math.round((d.con!.daysDone / d.con!.daysTotal) * 100)}% built`;
    case 'leasing': return 'Vacant: waiting on a tenant';
    case 'operations': return d.sale.stage === 'marketing' ? 'On the market' : d.sale.stage === 'closing' ? 'Sale closing' : S.currentRent(g, d) > 0 ? 'Collecting rent' : 'Tenant in free rent';
    case 'sold': return `Sold · ${Number.isFinite(d.result!.lpIrr) ? `${Math.round(d.result!.lpIrr * 100)}% investor IRR` : money(d.result!.profit)}`;
    default: return '';
  }
}

function Pipeline() {
  const g = useGame();
  const sel = useUI((s) => s.sel), set = useUI((s) => s.set);
  const deals = g.deals.filter((d) => d.phase !== 'dead').sort((a, b) => (a.phase === 'sold' ? 1 : 0) - (b.phase === 'sold' ? 1 : 0)).slice(0, 8);
  const needs = (d: Deal) => (d.phase === 'entitlement' && d.ent.status !== 'pending') || d.phase === 'predev' || (d.phase === 'operations' && d.sale.stage === 'none' && S.currentRent(g, d) > 0);
  return (
    <footer className="glass absolute bottom-3 left-3 right-3 z-20 flex h-[100px] items-stretch gap-2.5 overflow-x-auto p-2.5">
      <div className="flex w-[118px] shrink-0 flex-col justify-center px-1.5">
        <div className="display text-[19px] font-semibold leading-none">Deal pipeline</div>
        <div className="mt-1 text-[11.5px] leading-tight text-ink2">{S.activeDeals(g).length} of {S.maxActive(g)} deals in pursuit</div>
      </div>
      {deals.length === 0 && <div className="flex flex-1 items-center rounded-xl border border-dashed border-ink2/35 px-4 text-ink2">No deals yet. Click the pulsing site on the map to make your first offer.</div>}
      {deals.map((d) => {
        const on = sel?.kind === 'deal' && sel.id === d.id;
        const stage = PHASE_ORDER.indexOf(d.phase);
        return (
          <button key={d.id} type="button" onClick={() => set({ sel: { kind: 'deal', id: d.id }, panel: null })}
            className={`flex w-[220px] shrink-0 flex-col justify-between rounded-xl border p-2.5 text-left transition-colors ${on ? 'border-accent bg-white ring-1 ring-accent' : 'border-line bg-white/65 hover:bg-white'} ${d.phase === 'sold' ? 'opacity-70' : ''}`}>
            <div className="flex items-start justify-between gap-2">
              <span className="truncate text-[13.5px] font-semibold">{d.name}</span>
              {needs(d) && <i className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-accent" title="Needs your attention" />}
            </div>
            <div className="flex items-center justify-between gap-2"><Chip tone={d.phase === 'sold' ? 'good' : 'accent'}>{PHASE_LABEL[d.phase]}</Chip><span className="num truncate text-[12px] text-ink2">{nextStep(g, d)}</span></div>
            <div className="flex gap-[3px]">{PHASE_ORDER.map((ph, i) => <i key={ph} className={`h-1.5 flex-1 rounded-full ${i < stage ? 'bg-sage' : i === stage ? 'bg-accent' : 'bg-black/12'}`} />)}</div>
          </button>
        );
      })}
    </footer>
  );
}

function TutorialCard() {
  const g = useGame();
  const panel = useUI((s) => s.panel), sel = useUI((s) => s.sel);
  const [open, setOpen] = useState(true);
  const ch = currentChapter(g);
  const idx = ch.steps.findIndex((s) => !s.done);
  const step = idx >= 0 ? ch.steps[idx] : null;
  if (panel) return null;
  const done = ch.steps.filter((s) => s.done).length;
  return (
    <div className={`glass absolute left-[92px] top-[72px] z-10 w-[300px] p-3 ${sel ? 'max-[1100px]:hidden' : ''}`}>
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="flex w-full items-center justify-between text-left">
        <span className="display text-[17px] font-semibold leading-tight">{ch.title}</span><span className="num text-[12px] text-ink2">{done}/{ch.steps.length} {open ? '▾' : '▸'}</span>
      </button>
      <div className="mt-1.5"><Bar value={done / ch.steps.length} tone="sage" thin /></div>
      {open && (
        <div className="mt-2">
          {step ? (
            <>
              <div className="eyebrow">Next</div>
              <div className="text-[14px] font-semibold leading-snug">{step.text}</div>
              <p className="mt-1 text-[12.5px] text-ink2">{step.hint}</p>
            </>
          ) : <p className="text-[13px] text-ink2">{ch.goal}</p>}
        </div>
      )}
    </div>
  );
}

function Toasts() {
  const toasts = useUI((s) => s.toasts), dismiss = useUI((s) => s.dismiss);
  return (
    <div className="pointer-events-none absolute left-1/2 top-[76px] z-[35] flex w-[440px] max-w-[calc(100vw-24px)] -translate-x-1/2 flex-col gap-1.5" aria-live="polite">
      {toasts.map((t) => (
        <button key={t.id} type="button" onClick={() => dismiss(t.id)} className="glass rise pointer-events-auto grid grid-cols-[6px_1fr] gap-2.5 overflow-hidden p-0 text-left">
          <i className={`${t.tone === 'good' ? 'bg-good' : t.tone === 'bad' ? 'bg-bad' : 'bg-ink2'}`} /><span className="py-2 pr-3 text-[13px]">{t.text}</span>
        </button>
      ))}
    </div>
  );
}
