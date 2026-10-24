# Appeltaart

A shared grocery list for three family members that keeps working without signal in the shop. The plan is in [`docs/spec.md`](docs/spec.md); it is built one milestone at a time.

Status: milestone 1 (skeleton) — installable PWA with Google sign-in.

## Development

Requires Node 22 and Java 21 (for the Firebase emulators).

```sh
npm install
npm run emulators   # terminal 1: Auth and Firestore emulators, UI at http://127.0.0.1:4000
npm run dev         # terminal 2: app at http://localhost:5173
```

`npm run dev` reads `.env.development`, which points at the emulators with the demo project `demo-appeltaart`; no Firebase account is needed. Sign-in through the emulator shows a fake account chooser.

| Command | What it does |
| --- | --- |
| `npm run build` | Type-check and build to `dist/`, including the service worker |
| `npm run lint` | Lint with oxlint |
| `npm run test:e2e` | Start the Auth emulator, build, and run the Playwright tests in `e2e/` |
| `npm run icons` | Re-render the PNG icons from `public/icon.svg` |

`e2e/popup.spec.ts` signs in through the real button and the emulator's popup. That popup loads a script from `apis.google.com`, so the test needs access to that host. The other tests sign in through the emulator directly.

## Deploying to a real Firebase project

1. Create a project in the Firebase console and add a web app.
2. Under Authentication, enable the Google provider.
3. Copy `.env.production.example` to `.env.production` and fill in the web app's config.
4. `npx firebase login`, then `npm run build && npx firebase deploy --only hosting --project <project-id>`.
5. Open the hosted URL on the phone and use "Add to Home Screen".

Hosting on Firebase keeps the sign-in helper pages on the app's own domain, which Google sign-in needs in installed home-screen apps.
