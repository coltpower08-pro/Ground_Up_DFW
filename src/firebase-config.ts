import type { FirebaseOptions } from 'firebase/app';

// Your Firebase web app settings (Firebase console > Project settings > General > Your apps > SDK setup and configuration > Config).
// These values are not secret: every site that uses Firebase sends them to the browser. Access is controlled by firestore.rules.
// While this is null the game runs on each device only: no sign-in, scores and saves stay in the browser.
export const firebaseConfig: FirebaseOptions | null = null;
