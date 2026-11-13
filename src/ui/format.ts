import { DAYS_PER_MONTH } from '../engine/types';

export function money(v: number): string {
  const s = v < 0 ? '-' : '', a = Math.abs(v);
  if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(a >= 1e7 ? 1 : 2)}M`;
  if (a >= 1e4) return `${s}$${Math.round(a / 1000)}k`;
  return `${s}$${Math.round(a).toLocaleString('en-US')}`;
}
export const pct = (v: number, d = 1) => (Number.isFinite(v) ? `${(v * 100).toFixed(d)}%` : 'n/a');
export const bps = (v: number) => `${Math.round(v * 10000)} bps`;
export const mult = (v: number) => (Number.isFinite(v) ? `${v.toFixed(2)}x` : 'n/a');
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function dateStr(day: number): string {
  const m = Math.floor(day / DAYS_PER_MONTH);
  return `${MONTHS[m % 12]} ${(day % DAYS_PER_MONTH) + 1}, ${2027 + Math.floor(m / 12)}`;
}
export const daysToWords = (d: number) => (d >= 60 ? `${Math.round(d / 30)} months` : `${Math.max(0, Math.ceil(d))} days`);
