// Sign in with Google or email and password. Shown only when Firebase is set up.
import { useState } from 'react';
import { cloud, cloudEnabled, friendlyError } from '../services/cloud';
import { Btn } from './kit';
import { useUI } from './store';

export function Account({ name, note }: { name: string; note?: string }) {
  const user = useUI((s) => s.user), ready = useUI((s) => s.cloudReady);
  const [mode, setMode] = useState<'in' | 'up' | 'reset'>('in');
  const [email, setEmail] = useState(''), [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false), [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  if (!cloudEnabled) return null;
  const run = async (fn: () => Promise<void>, done?: string) => {
    setBusy(true); setMsg(null);
    try { await fn(); if (done) setMsg({ text: done, ok: true }); } catch (e) { setMsg({ text: friendlyError(e), ok: false }); }
    setBusy(false);
  };
  const c = cloud();
  if (user) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-white/60 px-3 py-2 text-[13px]">
        <span>Signed in as <b>{user.name}</b>{user.email ? <span className="text-ink2"> · {user.email}</span> : null}. Scores go to the shared board and saves follow you.</span>
        <Btn small kind="ghost" onClick={() => run(() => c!.signOut())}>Sign out</Btn>
      </div>
    );
  }
  if (!c || !ready) return <div className="rounded-xl border border-line bg-white/60 px-3 py-2 text-[13px] text-ink2">Connecting…</div>;
  const input = 'w-full rounded-lg border border-line bg-white/85 px-3 py-2 text-[14px] outline-none focus:border-accent';
  return (
    <div className="rounded-xl border border-line bg-white/60 p-3">
      <div className="text-[13px]">{note ?? 'Sign in to post to the shared high scores and pick up your saved game on any device. You can also play without signing in.'}</div>
      <div className="mt-2"><Btn full disabled={busy} onClick={() => run(() => c.signInGoogle())}>Continue with Google</Btn></div>
      <form className="mt-2 grid gap-1.5" onSubmit={(e) => {
        e.preventDefault();
        if (mode === 'reset') run(() => c.resetPassword(email), 'Check your email for a link to set a new password.');
        else if (mode === 'up') run(() => c.signUpEmail(email, pw, name));
        else run(() => c.signInEmail(email, pw));
      }}>
        <div className="flex items-center gap-2 text-[11.5px] text-ink2"><span className="h-px flex-1 bg-line" />or with email<span className="h-px flex-1 bg-line" /></div>
        <input type="email" autoComplete="email" required placeholder="Email" aria-label="Email" value={email} onChange={(e) => setEmail(e.target.value)} className={input} />
        {mode !== 'reset' && <input type="password" autoComplete={mode === 'up' ? 'new-password' : 'current-password'} required minLength={6} placeholder={mode === 'up' ? 'Choose a password (6+ characters)' : 'Password'} aria-label="Password" value={pw} onChange={(e) => setPw(e.target.value)} className={input} />}
        <button type="submit" disabled={busy} className="rounded-lg border border-ink bg-ink px-3 py-2 text-[14px] font-medium text-white disabled:opacity-60">{mode === 'up' ? 'Create account' : mode === 'reset' ? 'Email me a reset link' : 'Sign in'}</button>
        <div className="flex justify-between text-[12px]">
          {mode === 'in' ? <button type="button" className="text-accent-deep underline" onClick={() => { setMode('up'); setMsg(null); }}>New here? Create an account</button> : <button type="button" className="text-accent-deep underline" onClick={() => { setMode('in'); setMsg(null); }}>Back to sign in</button>}
          {mode === 'in' && <button type="button" className="text-ink2 underline" onClick={() => { setMode('reset'); setMsg(null); }}>Forgot password?</button>}
        </div>
        {mode === 'up' && <div className="text-[11.5px] text-ink2">Your name on the board comes from the Your name box{name.trim() ? `: ${name.trim()}` : ''}.</div>}
        {msg && <div className={`text-[12.5px] ${msg.ok ? 'text-good' : 'text-bad'}`}>{msg.text}</div>}
      </form>
    </div>
  );
}
