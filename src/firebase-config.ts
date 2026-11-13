import type { FirebaseOptions } from 'firebase/app';

// Firebase web app "Ground Up: DFW" in project ground-up-dfw (Firebase console > Project settings > General > Your apps).
// These values are not secret: every site that uses Firebase sends them to the browser. Access is controlled by firestore.rules.
// Set this to null to run the game on each device only, with no sign-in.
export const firebaseConfig: FirebaseOptions | null = {
  apiKey: 'AIzaSyBJp6FXba_skNHIC13aX9pB_xQ_dWyYb4M',
  authDomain: 'ground-up-dfw.firebaseapp.com',
  projectId: 'ground-up-dfw',
  storageBucket: 'ground-up-dfw.firebasestorage.app',
  messagingSenderId: '110526487227',
  appId: '1:110526487227:web:d2ea0cc469ecaff09ce79e',
};
