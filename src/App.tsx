import { ShoppingList } from './ShoppingList'
import { SignIn } from './SignIn'
import { useAuth } from './useAuth'

function App() {
  const user = useAuth()

  if (user === undefined) return null
  if (user === null) return <SignIn />
  return <ShoppingList user={user} />
}

export default App
