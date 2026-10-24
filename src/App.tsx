import { signOut } from 'firebase/auth'
import { auth } from './firebase'
import { ShoppingList } from './ShoppingList'
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
        <span className="who" data-testid="user-name">
          {user.displayName ?? user.email}
        </span>
        <button onClick={() => signOut(auth)}>Sign out</button>
      </header>
      <ShoppingList user={user} />
    </main>
  )
}

export default App
