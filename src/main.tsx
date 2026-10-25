import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// The sync test harness, for e2e/sync.spec.ts. Vite replaces the env value at
// build time, so a production build drops this import and the harness code.
if (import.meta.env.VITE_USE_EMULATORS === 'true') void import('./harness')
