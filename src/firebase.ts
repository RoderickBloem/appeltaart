import { initializeApp } from 'firebase/app'
import { connectAuthEmulator, getAuth, GoogleAuthProvider, signInWithCredential } from 'firebase/auth'
import {
  connectFirestoreEmulator,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
} from 'firebase/firestore'

const env = import.meta.env

export const app = initializeApp({
  apiKey: env.VITE_FIREBASE_API_KEY,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: env.VITE_FIREBASE_PROJECT_ID,
  appId: env.VITE_FIREBASE_APP_ID,
})

// getAuth keeps the signed-in user in IndexedDB, so a cold start with no
// network still knows who is signed in.
export const auth = getAuth(app)

// The persistent cache keeps both the data and the queue of unsent writes in
// IndexedDB, so writes made offline survive closing the app. The default
// in-memory cache would lose them.
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
})

// Vite replaces the env value at build time, so a production build drops this
// whole branch.
if (import.meta.env.VITE_USE_EMULATORS === 'true') {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true })
  connectFirestoreEmulator(db, '127.0.0.1', 8080)

  // Lets tests sign in without the Google popup, which needs apis.google.com
  // even against the emulator. The emulator accepts an unsigned JSON token.
  window.emulatorSignIn = (name: string, email: string) =>
    signInWithCredential(
      auth,
      GoogleAuthProvider.credential(JSON.stringify({ sub: email, email, name, email_verified: true })),
    ).then(({ user }) => user.uid)
}
