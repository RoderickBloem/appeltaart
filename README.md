# Appeltaart

A shared shopping list for the family that keeps working without signal in the shop. How it works and why: [`docs/spec.md`](docs/spec.md). Where things stand and how it is deployed: [`docs/plan.md`](docs/plan.md). It runs at https://appeltaart-fd1ff.web.app; open it on a phone and use "Add to Home Screen".

## Using it

- **Adding**: type an item and press Enter; `tomatoes: 6` or `avocados: ripe` adds a quantity. From two letters on, suggestions appear; tap one to add it.
- **Shopping**: tap an item to check it, tap it again to uncheck; × deletes, **Clear checked** removes the checked ones, and both can be undone for a few seconds.
- **Categories**: items are sorted in shop order by category. Tap the colour bar at the start of a row to choose one; the app remembers it for that product, on every list.
- **Lists**: tap the list name at the top left to switch lists, create one, tick who sees it, or delete it. "Shopping" is everyone's.
- **People**: tap **Share**, type someone's Gmail address and tap **Invite**; when they sign in with that Google account, they are in. Someone without an invitation sees nothing but their name. Removing someone is done in the Firebase console: Firestore Database > `lists` > the document with everyone in `members` > `members`, delete their uid.

## Development

Requires Node 22 and Java 21 (for the Firebase emulators).

```sh
npm install
npm run emulators   # terminal 1: Auth and Firestore emulators, UI at http://127.0.0.1:4000
npm run dev         # terminal 2: app at http://localhost:5173
```

`npm run dev` reads `.env.development`, which points at the emulators with the demo project `demo-appeltaart`; no Firebase account is needed. Sign-in through the emulator shows a fake account chooser. The emulators start with no data, and the app shows a list only to members of a shared document; create one in the emulator UI (`lists/<your uid>` with `members: { <your uid>: true }`) or let a test do it.

| Command | What it does |
| --- | --- |
| `npm run build` | Type-check and build to `dist/`, including the service worker |
| `npm run lint` | Lint with oxlint |
| `npm run test:e2e` | Start the emulators, build, and run the Playwright tests in `e2e/` (about four minutes) |
| `npm run icons` | Re-render the PNG icons from `public/icon.svg` |

`e2e/sync.spec.ts` checks the sync properties on three simulated phones over generated scenarios, 100 per property; set `SYNC_RUNS` for more or fewer. `e2e/popup.spec.ts` signs in through the real button and the emulator's popup, which loads a script from `apis.google.com`, so that test needs access to that host.

## Code

| File | What is in it |
| --- | --- |
| `src/firebase.ts` | Firebase setup: Auth, Firestore with the persistent cache, the emulators in development |
| `src/household.ts` | The shared document: people, names, invitations, joining |
| `src/lists.ts` | The lists the user sees; creating, deleting, who sees them |
| `src/items.ts` | Items: adding, checking, deleting, clearing, the listener |
| `src/products.ts` | What the app learns about products |
| `src/categories.ts`, `src/seed.ts`, `src/dictionary.ts` | Categories, the seed dictionary, suggestions |
| `src/App.tsx`, `src/SignIn.tsx`, `src/ShoppingList.tsx` | The screens |
| `src/ItemList.tsx`, `src/ListsPanel.tsx`, `src/SharePanel.tsx`, `src/UndoToast.tsx` | Parts of the list screen |
| `src/harness.ts` | The sync test harness, built only for the emulators |
| `firestore.rules` | Who may read and write what |
| `e2e/` | The tests; `e2e/helpers.ts` holds the shared steps |

## Setting up the Firebase project (done; for reference)

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
7. Run the workflow. The app is then at `https://<project-id>.web.app`.
8. **The shared document.** The app no longer creates one; the live one was made by the first sign-in before that rule. A new project needs it made by hand: Firestore Database > Start collection `lists`, document id = your uid (Authentication > Users), field `members` (map) with your uid set to `true`.

The web config the app ships with (API key, app id) is public by design; access is controlled by `firestore.rules`. The service account key is not public: it stays in GitHub's secret store.
