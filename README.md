# Appeltaart

A shared grocery list for three family members that keeps working without signal in the shop. The plan is in [`docs/spec.md`](docs/spec.md); it is built one milestone at a time.

Status: milestone 4 (sharing) — one list shared by the family, working offline, with generated multi-phone sync tests.

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
| `npm run test:e2e` | Start the Auth and Firestore emulators, build, and run the Playwright tests in `e2e/` |
| `npm run icons` | Re-render the PNG icons from `public/icon.svg` |

`e2e/sync.spec.ts` checks the sync properties from the spec on three simulated phones over generated scenarios (100 per property by default; set `SYNC_RUNS` for more or fewer).

`e2e/popup.spec.ts` signs in through the real button and the emulator's popup. That popup loads a script from `apis.google.com`, so the test needs access to that host. The other tests sign in through the emulator directly.

## Deploying to a real Firebase project

`.github/workflows/deploy.yml` builds the app and deploys it, together with `firestore.rules`, to Firebase Hosting. It runs on every `v*` tag and by hand from the Actions tab (**Deploy > Run workflow**). It fetches the web app config from the project itself, so nothing has to be copied into the repository.

One-time setup, all in a browser:

1. **Firebase project.** At console.firebase.google.com, create a project (the free Spark plan is enough; Analytics is not needed).
2. **Web app and hosting.** Project settings > General > Your apps > Add app > Web. Tick **Also set up Firebase Hosting**.
3. **Google sign-in.** Build > Authentication > Get started > Sign-in method > Google > Enable.
4. **Database.** Build > Firestore Database > Create database, in production mode, location `eur3` (Europe). The workflow replaces the default rules with `firestore.rules`.
5. **Deploy key.** At console.cloud.google.com, with the same project selected: IAM & Admin > Service accounts > Create service account, named `github-deploy`, with the roles **Firebase Admin** and **Service Usage Consumer**. Then open it, Keys > Add key > Create new key > JSON; this downloads a key file.
6. **GitHub settings.** In this repository: Settings > Secrets and variables > Actions.
   - Secrets tab: new secret `FIREBASE_SERVICE_ACCOUNT`, with the whole content of the key file. Then delete the downloaded file.
   - Variables tab: new variable `FIREBASE_PROJECT_ID`, with the project id (shown in the Firebase project settings, e.g. `appeltaart-1a2b3`).
7. Run the workflow. The app is then at `https://<project-id>.web.app`; open it on the phone and use "Add to Home Screen".

The web config the app ships with (API key, app id) is public by design; access is controlled by `firestore.rules`. The service account key is not public: it stays in GitHub's secret store.

## Adding a family member

Anyone on the list can add someone: tap **Share**, type their Gmail address and tap **Invite**. When they open the app and sign in with that Google account, they join the list. Until then the address shows as invited, and the × withdraws the invitation. Capitals, dots and a `+suffix` in a Gmail address do not matter.

Anything the new member typed into the app before joining stays in a list of their own and is no longer shown. Removing someone is done in the Firebase console: Firestore Database > `lists` > the list > `members`, delete their uid.
