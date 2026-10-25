# Plan and progress

The milestones are defined in [`spec.md`](spec.md), section "Build order". One milestone per session; each ends with `npm run build`, `npm run lint` and `npm run test:e2e` passing.

| # | Milestone | Status |
| --- | --- | --- |
| 1 | Skeleton | Done. Deployed to https://appeltaart-fd1ff.web.app and installed on the maintainer's laptop and phone (2026-10-25). |
| 2 | Single-device list | Built and tested against the emulators (7 tests in `e2e/list.spec.ts`). Tried on the maintainer's laptop and phone (deploy of `dd981f7`, 2026-10-25). |
| 3 | Emulator and harness | Built: properties 1–5 green over 100 generated scenarios each (`e2e/sync.spec.ts`), and over 500 in a longer run. Found and fixed two sync bugs (open questions 7 and 9). |
| 4 | Sharing | Built and tested against the emulators: `e2e/sharing.spec.ts` (three phones, real UI, conflicting offline edits converge; inviting by Gmail address) and `e2e/rules.spec.ts`. Deployed with `837ad06`. |
| 5 | Shopping polish | Built: undo toast, "Not synced", wake lock, duplicates as one row (`e2e/polish.spec.ts`). Deployed with `7b360de`. |
| 6 | Categories | Built early, at the maintainer's request: eight fixed categories in shop order, chosen per product (`e2e/categories.spec.ts`). Deployed with `7b360de`. |
| 7 | Dictionary | Built: learned products (with categories), a seed list of 222 groceries, type-ahead suggestions, category filled in automatically (`e2e/dictionary.spec.ts`). Deployed with `dbb690f`. |
| 8 | Quantities | Built early: free text after a colon (`e2e/quantities.spec.ts`). Deployed with `7b360de`. |
| – | Multiple lists | Built at the maintainer's request (`e2e/lists.spec.ts`). Deployed with `b948255`. |

## Deployment

- Firebase project `appeltaart-fd1ff`; the app is at https://appeltaart-fd1ff.web.app.
- `.github/workflows/deploy.yml` deploys hosting and `firestore.rules` from a ref: on a `v*` tag, or by hand (Actions > Deploy > Run workflow). A session can start it with the GitHub tools (`run_workflow`, workflow `deploy.yml`, ref `main`) and read the result from the job log, which ends with the Hosting URL.
- The workflow reads the repository variable `FIREBASE_PROJECT_ID` and the secret `FIREBASE_SERVICE_ACCOUNT` (service account `github-deploy`, roles Firebase Admin and Service Usage Consumer). Sessions never see the key and need no other Firebase access.
- Deploy only what the maintainer asked to have deployed: a deploy changes the app on the family's phones.
- Last deploy: `b948255` (multiple lists, invitation only, and their rules), 2026-10-25.

## Decisions

- **2026-10-24 — Clear checked vs. a concurrent uncheck.** If one phone clears checked items while another unchecks one of them, the item stays deleted; undo brings it back. An uncheck writes only `checked`.
- **2026-10-24 — Everything is committed to `main`.**
- **2026-10-24 — Offline delete (open question 2).** Settled: the live-items query drops an offline-deleted item at once; no extra `deleted` field needed.
- **2026-10-24 — `createdAt` from the phone's clock.** A pending `serverTimestamp()` is estimated to whole seconds, which shuffled items added offline. See open question 6 in the spec.
- **2026-10-25 — Firestore rules before the first deploy.** `firestore.rules` holds milestone 2's rules: only the owner reads or writes `lists/{uid}` and its items, and nobody can create a list under another uid. The emulators enforce them, so every e2e test runs under them; `e2e/rules.spec.ts` checks the denials. The owner reaches items by uid rather than through the list document, because the app's item listener and writes reach the server before the list document does. Milestone 4 extends these rules to shared lists.
- **2026-10-25 — Deployment through GitHub Actions**, so a deploy needs no computer. The workflow fetches the web config from the project; the service account key is a GitHub secret.
- **2026-10-24 — One list per user, for now.** The list document is `lists/{uid}`, created on first sign-in with `members: { uid: true }`. Milestone 4 replaces this with a list found through its members map.
- **2026-10-25 — The items query has no `deletedAt` filter (open question 7).** Filtering in the query let a phone keep showing a deleted item forever when it changed that item just as another phone deleted it. The app now fetches tombstones too and drops them itself.
- **2026-10-25 — An add writes neither `checked` nor `deletedAt` (open question 9).** A re-sent add whose first confirmation was lost brought a deleted item back. Missing fields now mean unchecked and live.
- **2026-10-25 — Harness clients are separate browser contexts.** Three Firestore clients in one page shared the browser's six connections per host and stalled each other's writes, which looked like a sync bug. One context per client is also closer to three phones.
- **2026-10-25 — The harness takes the next step only once the phone shows the last one.** Otherwise a generated restart could land before a write was saved locally, a force-quit no app can survive.
- **2026-10-25 — Only the console changes `members` (open question 10).** The rules forbid every client, members included, from changing who is on a list. Tests add members with the emulator's admin credential, the way the maintainer uses the console.
- **2026-10-25 — A member sees the list with the most members (open question 11).** The solo list made at first sign-in loses to the household list as soon as the maintainer adds them.
- **2026-10-25 — No hard deletes from clients.** Items are only marked deleted; the purge script uses admin rights.
- **2026-10-25 — Members invite from the app (open question 12), ahead of milestone 5 at the maintainer's request.** Replaces "only the console changes `members`". Any member invites a Gmail address with the Share button; the invited person joins when they sign in. Tested in `e2e/sharing.spec.ts` and `e2e/rules.spec.ts`.
- **2026-10-25 — Compact screen, 44 px rows.** At the maintainer's request, fifteen items fit on a Pixel 9 without scrolling (`e2e/layout.spec.ts`, viewport 412 × 860).
- **2026-10-25 — Categories, quantities and polish before using milestone 5 for two weeks**, at the maintainer's request. Choices in the spec, open questions 13–16: categories fixed in code, products learned one document each, quantity as free text after a colon, no swipe-to-delete.

## What milestone 2 built

- `src/firebase.ts`: Firestore with `persistentLocalCache` and `persistentMultipleTabManager`, connected to the Firestore emulator when `VITE_USE_EMULATORS` is `true`. `window.emulatorSignIn` now resolves to the uid.
- `src/list.ts`: the item writes from the spec's operation table (add, check, uncheck, soft delete, batched clear checked) and `useItems`, one `onSnapshot` on `where('deletedAt', '==', null)` with `limit(500)`, sorted by `createdAt` on the phone. Writes are never awaited.
- `src/ShoppingList.tsx`: the input at the top (stays focused), live items, checked items dimmed below, a delete button per row, and "Clear checked".
- `npm run test:e2e` now starts the Firestore emulator as well. Each list test signs in as a fresh user, so tests do not share a list, and reads the server state straight from the emulator's REST API.

Left for milestone 5, as the build order says: swipe to delete, the undo toast, the pending-write indicator, wake lock, duplicate collapsing.

## What milestone 3 built

- `src/harness.ts`, loaded only in emulator builds: one Firestore client per page, with `open`, `apply` (add, rename, check, uncheck, delete, clear, using the functions in `src/list.ts`), `setOffline`, `waitForWrites`, `look` and `dispose`.
- `e2e/sync.spec.ts`: three phones, each a page in its own browser context. A restart is a page reload, i.e. a real force-quit. fast-check generates sequences of up to 25 steps over the operations above plus offline, online, restart and pause. After a sequence every phone goes online, and the test compares what each phone shows with the server, read through the emulator's REST API.
  - Properties 1–3 (and 4, when a restart happened) are checked after every generated sequence: every phone shows exactly the server's live items, every add reached the server, and the live items are exactly the added minus the deleted ones.
  - Property 4 also has its own test, property 3 a fixed test of delete against rename and check, online and offline, and property 5 its own generated test (two phones clear, possibly offline, and the result equals one clear).
  - Shrunk counterexamples go in the `regressions` table in that file; there are four: two were harness bugs, two were the app bug of open question 9.
- `SYNC_RUNS` sets the scenarios per generated property (default 100). With the default, the whole e2e suite takes about 3 minutes.
- `src/list.ts` gained `renameItem`, `watchItems` (shared by the app and the harness) and takes the list as an argument; `Item` has `normName`.

## What milestone 4 built

- `firestore.rules`: members read and write a list's items; nobody can create a list except at `lists/{own uid}` with only themselves as member; no client can change `members` or delete an item outright.
- `src/list.ts`: `useMyList` listens to the lists the user is a member of (`where('members.<uid>', '==', true)`) and picks one (open question 11); it creates the user's own list only when the server says there is none. `ShoppingList` shows nothing until the list is known, which from the cache is immediate.
- `e2e/sharing.spec.ts`: a member added in the console switches to the shared list, also after a reload; and the exit test: three phones share a list, go offline, make conflicting edits (check against delete, two checks and a clear, adds on two phones, a force-quit), come back one at a time, and show the same list.
- `e2e/rules.spec.ts` covers the rules above through the emulator's REST API, including the membership lookup query.
- The sync harness now shares each scenario's list the same way: phone 0 creates its own list, the test adds the other two with admin rights.
- README: "Adding a family member", the console steps.

## What categories, quantities and polish built

- `src/categories.ts`: the eight categories, colours and shop order.
- `src/list.ts`: `enterItem` (parses "name: amount", updates a product already on the list, adds a new one in its learned category), `rememberProduct`, `setCategory`, `useProductCategories`, `restoreItems`; `useItems` also reports pending writes.
- `src/ShoppingList.tsx`: rows grouped by `normName` and sorted by category, a colour bar that opens the category picker, quantity chips, the undo toast, "Not synced", and the wake lock.
- `firestore.rules`: `products` has the same rules as `items`.
- Tests: `e2e/categories.spec.ts`, `e2e/quantities.spec.ts`, `e2e/polish.spec.ts`.

## What milestone 7 built

- `src/seed.ts`: the seed dictionary; `src/dictionary.ts`: `categoryFor` (learned, else seed) and `suggest` (ranking in the spec, open question 17); `src/normalise.ts` holds `normalise`, shared by both.
- `src/list.ts`: `useProducts` replaces `useProductCategories` and also returns names and use counts; `enterItem` takes a category lookup.
- `src/ShoppingList.tsx`: the suggestion row under the input.
- Tests in `e2e/dictionary.spec.ts`. Tests that assumed items stay in the order typed now expect shop order, since common groceries get a category from the seed list.

## Next

- Use it for a while, as the spec intends after milestone 5, and see what is missing.
- Every milestone in the build order is built. Candidates for later: editing categories in the app (names, colours, shop order); seed names in another language; swipe-to-delete; editing a quantity by tapping its chip.
- Removing a member in the console is untested: their listeners will be refused by the rules, and the app has no handling for that.

## What multiple lists built (2026-10-25)

At the maintainer's request; design in the spec, open question 18.

- The list name at the top left opens a menu: pick a list, create one, and tick who sees the current one (everyone, at first; you cannot untick yourself). The main list, "Shopping", is everyone's.
- The phone remembers the last list it showed.
- Categories and learned products are shared by all lists.
- Nobody gets in without an invitation (open question 19); someone not invited sees only their name and Sign out.
- No data moved: the existing document `lists/{uid}` of the maintainer holds the people, invitations and products, its `items` are the main list, and further lists live under it at `lists/{uid}/lists/{id}`.
- `firestore.rules`: lists are seen and changed only by the people they are visible to; nobody creates the shared document from the app.
- Tests: `e2e/lists.spec.ts`; the other tests now create each test user's list with admin rights (`createHousehold` in `e2e/helpers.ts`), as the real one already exists.
- Found on the way: when someone joined, the app recording their name made it briefly fall back to another list document, and after a reload a phone could not confirm that it had no invitation; both fixed.

## Feature requests

From the maintainer, not yet scheduled:

- **A seed list from the maintainer's supermarket** (2026-10-25). The maintainer will provide product names and categories; they replace or extend `src/seed.ts`, possibly in another language, and may change the category order in `src/categories.ts` to match that shop.

## Still open

- The tombstone purge script (spec, "Operation semantics") is not written yet. The items query's `limit(2000)` counts tombstones; at a few hundred deleted items a month, the limit is reached within a year without it.
