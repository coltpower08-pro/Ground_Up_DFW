// The game's link to Firebase: sign-in, the shared high score board and cloud saves.
// Firebase loads only when a config is present, so the single-file preview stays small and works offline.
import { firebaseConfig } from '../firebase-config';
import type { Game } from '../engine/types';

declare const __LOCAL_ONLY__: boolean;

export interface CloudUser { uid: string; name: string; email: string }
export interface Cloud {
  signInGoogle(): Promise<void>;
  signInEmail(email: string, password: string): Promise<void>;
  signUpEmail(email: string, password: string, name: string): Promise<void>;
  resetPassword(email: string): Promise<void>;
  signOut(): Promise<void>;
  setName(name: string): Promise<void>;
  save(g: Game): Promise<void>;
  load(): Promise<{ game: Game; at: number } | null>;
  clear(): Promise<void>;
}

let impl: Cloud | null = null;
export const cloudEnabled = !__LOCAL_ONLY__ && !!firebaseConfig;
export const cloud = () => impl;

export async function startCloud(onUser: (u: CloudUser | null) => void): Promise<Cloud | null> {
  if (!__LOCAL_ONLY__ && firebaseConfig) {
    const m = await import('./firebase-impl');
    impl = m.start(firebaseConfig, onUser);
  }
  return impl;
}

/** Plain-English versions of Firebase's error codes. */
export function friendlyError(e: unknown): string {
  const code = (e as { code?: string })?.code ?? (e as Error)?.message ?? '';
  const map: Record<string, string> = {
    'auth/invalid-credential': 'That email and password do not match an account.',
    'auth/wrong-password': 'That password is not right.',
    'auth/user-not-found': 'There is no account with that email.',
    'auth/email-already-in-use': 'An account already uses that email. Sign in instead.',
    'auth/weak-password': 'Use a password of at least 6 characters.',
    'auth/invalid-email': 'That email address does not look right.',
    'auth/popup-closed-by-user': 'The Google window was closed before signing in.',
    'auth/cancelled-popup-request': 'The Google window was closed before signing in.',
    'auth/network-request-failed': 'Could not reach the server. Check your connection.',
    'auth/too-many-requests': 'Too many tries. Wait a minute and try again.',
    'auth/unauthorized-domain': 'This website is not on the sign-in allow list in Firebase (Authentication > Settings > Authorized domains).',
    'auth/operation-not-allowed': 'This sign-in method is turned off in Firebase (Authentication > Sign-in method).',
    'permission-denied': 'The server refused that. Sign in and try again.',
    signin: 'Sign in to post to the shared board.',
  };
  return map[code] ?? 'Something went wrong. Try again.';
}
