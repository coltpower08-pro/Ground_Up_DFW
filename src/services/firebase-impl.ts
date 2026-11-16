// Everything that talks to Firebase. Loaded on demand by cloud.ts.
import { initializeApp, type FirebaseOptions } from 'firebase/app';
import {
  GoogleAuthProvider, createUserWithEmailAndPassword, getAuth, onAuthStateChanged, sendPasswordResetEmail,
  signInWithEmailAndPassword, signInWithPopup, signInWithRedirect, signOut, updateProfile, type Auth, type User,
} from 'firebase/auth';
import {
  addDoc, collection, deleteDoc, doc, getCountFromServer, getDoc, getDocs, getFirestore, limit, orderBy, query,
  serverTimestamp, setDoc, where, type Firestore, type QueryConstraint, type Timestamp,
} from 'firebase/firestore';
import { migrate } from '../engine/sim';
import type { Career } from '../engine/score';
import type { Game } from '../engine/types';
import type { Cloud, CloudUser } from './cloud';
import { periodKeys, setBoard, type Board, type Period, type ScoreEntry } from './scores';

const MAX_SAVE = 900_000; // Firestore documents top out at 1 MiB

class FirestoreBoard implements Board {
  shared = true;
  constructor(private db: Firestore, private auth: Auth) {}
  async submit(e: Omit<ScoreEntry, 'id' | 'mine'>): Promise<ScoreEntry> {
    const u = this.auth.currentUser;
    if (!u) throw Object.assign(new Error('signin'), { code: 'signin' });
    const keys = periodKeys(new Date(e.at));
    const { at: _at, ...rest } = e;
    const ref = await addDoc(collection(this.db, 'scores'), { ...rest, uid: u.uid, at: serverTimestamp(), ...keys });
    return { ...e, id: ref.id, mine: true };
  }
  private where(d: Game['difficulty'], c: Career, p: Period): QueryConstraint[] {
    const w = [where('difficulty', '==', d), where('career', '==', c)];
    if (p !== 'all') w.push(where(p, '==', periodKeys(new Date())[p]));
    return w;
  }
  async top(d: Game['difficulty'], c: Career, p: Period, n = 10): Promise<ScoreEntry[]> {
    const snap = await getDocs(query(collection(this.db, 'scores'), ...this.where(d, c, p), orderBy('score', 'desc'), limit(n)));
    const me = this.auth.currentUser?.uid;
    return snap.docs.map((x) => {
      const v = x.data();
      return { id: x.id, player: v.player, firm: v.firm, difficulty: v.difficulty, career: v.career, score: v.score, netWorth: v.netWorth, lpProfit: v.lpProfit, dealsSold: v.dealsSold, rank: v.rank, years: v.years, how: v.how, at: (v.at as Timestamp | null)?.toMillis() ?? Date.now(), mine: v.uid === me };
    });
  }
  async rank(e: ScoreEntry, p: Period): Promise<number> {
    const s = await getCountFromServer(query(collection(this.db, 'scores'), ...this.where(e.difficulty, e.career, p), where('score', '>', e.score)));
    return s.data().count + 1;
  }
}

const toUser = (u: User | null): CloudUser | null => (u ? { uid: u.uid, name: u.displayName || u.email?.split('@')[0] || 'Player', email: u.email ?? '' } : null);

export function start(config: FirebaseOptions, onUser: (u: CloudUser | null) => void): Cloud {
  const app = initializeApp(config), auth = getAuth(app), db = getFirestore(app);
  setBoard(new FirestoreBoard(db, auth));
  onAuthStateChanged(auth, (u) => onUser(toUser(u)));
  const me = () => { const u = auth.currentUser; if (!u) throw Object.assign(new Error('signin'), { code: 'signin' }); return u; };
  return {
    async signInGoogle() {
      const provider = new GoogleAuthProvider();
      try { await signInWithPopup(auth, provider); }
      catch (e) { if ((e as { code?: string }).code === 'auth/popup-blocked') await signInWithRedirect(auth, provider); else throw e; }
    },
    async signInEmail(email, password) { await signInWithEmailAndPassword(auth, email.trim(), password); },
    async signUpEmail(email, password, name) {
      const c = await createUserWithEmailAndPassword(auth, email.trim(), password);
      if (name.trim()) { await updateProfile(c.user, { displayName: name.trim().slice(0, 24) }); onUser(toUser(c.user)); }
    },
    async resetPassword(email) { await sendPasswordResetEmail(auth, email.trim()); },
    async signOut() { await signOut(auth); },
    async setName(name) { const u = me(); if (name.trim() && name.trim() !== u.displayName) { await updateProfile(u, { displayName: name.trim().slice(0, 24) }); onUser(toUser(u)); } },
    async save(g) {
      const u = auth.currentUser; if (!u) return;
      const data = JSON.stringify(g);
      if (data.length > MAX_SAVE) return; // too big for one document; the browser save still has it
      await setDoc(doc(db, 'saves', u.uid), { data, firm: g.firmName.slice(0, 32), day: g.day, at: serverTimestamp() });
    },
    async load() {
      const u = auth.currentUser; if (!u) return null;
      const s = await getDoc(doc(db, 'saves', u.uid));
      if (!s.exists()) return null;
      const v = s.data();
      try { const g = JSON.parse(v.data) as Game; return g.version === 3 ? { game: migrate(g), at: (v.at as Timestamp | null)?.toMillis() ?? 0 } : null; } catch { return null; }
    },
    async clear() { const u = auth.currentUser; if (u) await deleteDoc(doc(db, 'saves', u.uid)); },
  };
}
