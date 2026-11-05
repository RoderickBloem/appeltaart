import { useState, type FormEvent } from 'react'
import { invite, nameOf, withdrawInvite, type Household, type HouseholdInfo } from './household'

/** Who uses the app, and inviting someone by their Gmail address. */
export function SharePanel({
  household,
  info,
  email: signedInAs,
  onDone,
}: {
  household: Household
  info: HouseholdInfo | undefined
  /** The address the user is signed in with. */
  email: string | null
  onDone: () => void
}) {
  const [email, setEmail] = useState('')

  function submit(event: FormEvent) {
    event.preventDefault()
    if (email.includes('@')) invite(household, email)
    setEmail('')
  }

  return (
    <section className="panel">
      <p data-testid="member-count">
        {info && (info.people.length === 1 ? 'Only you, so far' : `${info.people.length} people use these lists`)}
      </p>
      <ul data-testid="people">
        {info?.people.map((p) => (
          <li key={p.uid}>
            <span>{nameOf(p)}</span>
            {p.email && <span className="muted">{p.email}</span>}
          </li>
        ))}
      </ul>
      <ul data-testid="invites">
        {info?.invites.map(({ address, typed }) => (
          <li key={address}>
            <span>{typed}</span>
            <span className="muted">invited</span>
            <button aria-label={`Withdraw invitation for ${typed}`} onClick={() => withdrawInvite(household, address)}>
              ×
            </button>
          </li>
        ))}
      </ul>
      <form onSubmit={submit}>
        <input
          aria-label="Gmail address"
          type="email"
          placeholder="Their Gmail address"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          autoComplete="off"
        />
        <button className="primary">Invite</button>
      </form>
      <p className="muted">They join when they sign in to Appeltaart with that address. Each list shows who sees it.</p>
      {signedInAs && (
        <p className="muted" data-testid="signed-in-as">
          Signed in as {signedInAs}
        </p>
      )}
      <button onClick={onDone}>Done</button>
    </section>
  )
}
