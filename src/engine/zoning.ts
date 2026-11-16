// Which approval a use needs on a given piece of land. Kept free of other imports so content and engine can both use it.
import type { DealType, Parcel } from './types';

export type EntKind = 'none' | 'plat' | 'sup' | 'rezone';
export function entitlementKind(p: Pick<Parcel, 'zoning' | 'existing'>, type: DealType): EntKind {
  if (p.existing) return 'none';
  if (p.zoning === 'ETJ') return 'plat';
  if (type === 'ios' || type === 'spec') return p.zoning === 'I' ? 'none' : p.zoning === 'C' ? (type === 'ios' ? 'sup' : 'rezone') : 'rezone';
  if (type === 'mf') return p.zoning === 'C' ? 'sup' : 'rezone'; // apartments almost always need a hearing
  return p.zoning === 'C' ? 'none' : p.zoning === 'I' ? 'sup' : 'rezone'; // retail and office belong on commercial land
}
