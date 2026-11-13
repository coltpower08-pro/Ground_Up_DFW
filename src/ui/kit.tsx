// Small shared UI pieces.
import { useState, type ReactNode } from 'react';
import { TERM } from '../content/glossary';
import { ADVISORS } from '../content/world';
import type { Grade } from '../engine/types';

export function Btn(p: { children: ReactNode; onClick?: () => void; kind?: 'primary' | 'ghost' | 'danger' | 'plain'; disabled?: boolean; small?: boolean; full?: boolean; title?: string }) {
  const kind = p.kind ?? 'plain';
  const cls = {
    primary: 'bg-accent text-white border-accent-deep hover:bg-accent-deep shadow-[0_2px_0_rgba(0,0,0,.18)]',
    plain: 'bg-white/80 text-ink border-line hover:bg-white',
    ghost: 'bg-transparent text-ink2 border-transparent hover:bg-black/5',
    danger: 'bg-transparent text-bad border-bad/30 hover:bg-bad/10',
  }[kind];
  return (
    <button type="button" title={p.title} disabled={p.disabled} onClick={p.onClick}
      className={`${cls} ${p.small ? 'px-2.5 py-1 text-[12.5px]' : 'px-3.5 py-2'} ${p.full ? 'w-full' : ''} rounded-lg border font-medium transition-colors disabled:opacity-45`}>
      {p.children}
    </button>
  );
}

export function Chip(p: { children: ReactNode; tone?: 'neutral' | 'good' | 'warn' | 'bad' | 'accent' }) {
  const cls = { neutral: 'bg-black/7 text-ink2', good: 'bg-good/15 text-good', warn: 'bg-warn/15 text-warn', bad: 'bg-bad/12 text-bad', accent: 'bg-accent/15 text-accent-deep' }[p.tone ?? 'neutral'];
  return <span className={`${cls} display inline-block rounded-md px-2 py-0.5 text-[12px] font-semibold uppercase tracking-wider whitespace-nowrap`}>{p.children}</span>;
}

export function Bar(p: { value: number; tone?: 'accent' | 'good' | 'sage' | 'bad'; thin?: boolean }) {
  const col = { accent: 'bg-accent', good: 'bg-good', sage: 'bg-sage', bad: 'bg-bad' }[p.tone ?? 'accent'];
  return (
    <div className={`w-full rounded-full bg-black/10 ${p.thin ? 'h-1.5' : 'h-2.5'} overflow-hidden`}>
      <div className={`${col} h-full rounded-full transition-[width] duration-300`} style={{ width: `${Math.max(0, Math.min(1, p.value)) * 100}%` }} />
    </div>
  );
}

/** A glossary term with a "why it matters" popover. */
export function Term(p: { k: string; children?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const t = TERM[p.k];
  if (!t) return <>{p.children}</>;
  return (
    <span className="relative inline-block" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button type="button" onClick={() => setOpen(!open)} onBlur={() => setOpen(false)} className="border-b border-dotted border-ink2/70 text-left">
        {p.children ?? t.term}
      </button>
      {open && (
        <span className="glass absolute left-0 top-full z-50 mt-1 block w-64 p-3 text-[12.5px] font-normal normal-case tracking-normal text-ink">
          <span className="block font-semibold">{t.term}</span>
          <span className="mt-1 block">{t.short}</span>
          <span className="mt-1.5 block text-ink2">{t.more}</span>
        </span>
      )}
    </span>
  );
}

export function Row(p: { label: ReactNode; value: ReactNode; strong?: boolean; sub?: boolean }) {
  return (
    <div className={`flex items-baseline justify-between gap-3 py-[3px] ${p.strong ? 'font-semibold border-t border-line mt-1 pt-1.5' : ''} ${p.sub ? 'text-ink2 text-[13px]' : ''}`}>
      <span>{p.label}</span><span className="num text-right">{p.value}</span>
    </div>
  );
}

export function Section(p: { title: ReactNode; children: ReactNode; right?: ReactNode }) {
  return (
    <section className="mt-4 first:mt-0">
      <div className="mb-1.5 flex items-center justify-between"><h3 className="eyebrow">{p.title}</h3>{p.right}</div>
      {p.children}
    </section>
  );
}

export function Advisor(p: { who: keyof typeof ADVISORS; line: string }) {
  const a = ADVISORS[p.who];
  return (
    <div className="flex gap-3 rounded-xl border border-line bg-white/60 p-3">
      <div className="display flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[15px] font-bold text-white" style={{ background: a.color }}>
        {a.name.split(' ').map((s) => s[0]).join('')}
      </div>
      <div className="min-w-0">
        <div className="text-[12px] text-ink2"><span className="font-semibold text-ink">{a.name}</span> · {a.title}</div>
        <div className="mt-0.5 text-[13.5px]">{p.line}</div>
      </div>
    </div>
  );
}

export function Seg<T extends string | number>(p: { value: T; onChange: (v: T) => void; options: { value: T; label: string; sub?: string }[]; disabled?: boolean }) {
  return (
    <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${p.options.length}, minmax(0, 1fr))` }}>
      {p.options.map((o) => (
        <button key={String(o.value)} type="button" disabled={p.disabled} onClick={() => p.onChange(o.value)} aria-pressed={p.value === o.value}
          className={`rounded-lg border px-2 py-1.5 text-left leading-tight transition-colors ${p.value === o.value ? 'border-accent bg-accent/12 ring-1 ring-accent' : 'border-line bg-white/70 hover:bg-white'} disabled:opacity-60`}>
          <span className="block text-[13px] font-medium">{o.label}</span>
          {o.sub && <span className="num block text-[11.5px] text-ink2">{o.sub}</span>}
        </button>
      ))}
    </div>
  );
}

export function GradeBadge({ g }: { g: Grade }) {
  const col = { A: 'bg-good', B: 'bg-sage', C: 'bg-warn', D: 'bg-accent-deep', F: 'bg-bad' }[g];
  return <span className={`${col} display inline-flex h-9 w-9 items-center justify-center rounded-lg text-[22px] font-bold text-white`}>{g}</span>;
}

export const PHASE_LABEL: Record<string, string> = {
  dd: 'Due diligence', entitlement: 'Entitlement', predev: 'Design and capital', construction: 'Construction',
  leasing: 'Leasing', operations: 'Operating', sold: 'Sold', dead: 'Dropped',
};
export const PHASE_ORDER = ['dd', 'entitlement', 'predev', 'construction', 'leasing', 'operations', 'sold'];
