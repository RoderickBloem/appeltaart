import { FirebaseError } from 'firebase/app'
import { GoogleAuthProvider, signInWithPopup, signInWithRedirect } from 'firebase/auth'
import { useState } from 'react'
import { auth } from './firebase'

const provider = new GoogleAuthProvider()

export function SignIn() {
  const [error, setError] = useState<string | null>(null)

  async function signIn() {
    setError(null)
    try {
      await signInWithPopup(auth, provider)
    } catch (e) {
      // Some installed home-screen apps cannot open popups; a full-page
      // redirect works there.
      if (e instanceof FirebaseError && e.code === 'auth/popup-blocked') {
        await signInWithRedirect(auth, provider)
      } else if (!(e instanceof FirebaseError && e.code === 'auth/popup-closed-by-user')) {
        setError(navigator.onLine ? 'Sign-in failed. Try again.' : 'Sign-in needs a network connection.')
      }
    }
  }

  return (
    <main className="screen center">
      <img src="/icon.svg" alt="" width="96" height="96" />
      <h1>Appeltaart</h1>
      <button className="primary" onClick={signIn}>
        Sign in with Google
      </button>
      {error && <p role="alert">{error}</p>}
    </main>
  )
}
