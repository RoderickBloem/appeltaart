import { signOut } from 'firebase/auth'
import { auth } from './firebase'
import { SignIn } from './SignIn'
import { useAuth } from './useAuth'

function App() {
  const user = useAuth()

  if (user === undefined) return null
  if (user === null) return <SignIn />

  return (
    <main className="screen">
      <header className="bar">
        <h1>Appeltaart</h1>
        <button onClick={() => signOut(auth)}>Sign out</button>
      </header>
      <p>
        Signed in as <strong data-testid="user-name">{user.displayName ?? user.email}</strong>
      </p>
    </main>
  )
}

export default App
