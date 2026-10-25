# Plan and progress

The milestones are defined in [`spec.md`](spec.md), section "Build order". One milestone per session; each ends with `npm run build`, `npm run lint` and `npm run test:e2e` passing.

| # | Milestone | Status |
| --- | --- | --- |
| 1 | Skeleton | Built and tested in the browser. Deployment set up (`.github/workflows/deploy.yml`); waiting on the maintainer's Firebase project and GitHub settings (README, "Deploying"). |
| 2 | Single-device list | Built and tested against the emulators (7 tests in `e2e/list.spec.ts`). Not yet tried on a phone. |
| 3 | Emulator and harness | Built: properties 1–5 green over 100 generated scenarios each (`e2e/sync.spec.ts`), and over 500 in a longer run. Found and fixed two sync bugs (open questions 7 and 9). |
| 4 | Sharing | Next |
| 5 | Shopping polish | Not started |
| 6 | Categories | Not started; only after two weeks of using milestone 5 |
| 7 | Dictionary | Not started |
| 8 | Quantities | Not started |

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

## Notes for milestone 4

- The sync suite already runs under `firestore.rules`: each scenario signs in three new users, phone 0 creates `lists/{its uid}` with only itself in `members` and then adds the other two, and the phones start listening only after that. Milestone 4's rules must keep this sequence working, or the harness must follow the new sharing flow.
- The app still uses `lists/{uid}`; milestone 4 must find the shared list through `members` instead. A query on `members.<uid> == true` is fine: open question 7 is about a document leaving a query, and a list only leaves it if someone is removed from `members`.
- The tombstone purge script (spec, "Operation semantics") is not written yet. The items query's `limit(2000)` counts tombstones; at a few hundred deleted items a month, the limit is reached within a year without it.
