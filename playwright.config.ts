import { defineConfig } from '@playwright/test'

// End-to-end tests run the production build (so the service worker is real)
// against the Auth and Firestore emulators. Start them with `npm run test:e2e`, which wraps
// this in `firebase emulators:exec`.
export default defineConfig({
  testDir: 'e2e',
  use: { baseURL: 'http://127.0.0.1:4173' },
  webServer: {
    command: 'npm run build -- --mode development && npm run preview -- --host 127.0.0.1 --port 4173 --strictPort',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: false,
    timeout: 120_000,
  },
})
