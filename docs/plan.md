# Plan and progress

The milestones are defined in [`spec.md`](spec.md), section "Build order". One milestone per session; each ends with `npm run build`, `npm run lint` and `npm run test:e2e` passing.

| # | Milestone | Status |
| --- | --- | --- |
| 1 | Skeleton | Built and tested in the browser. Waiting on the maintainer: Firebase project, `.env.production`, deploy, install on a phone. |
| 2 | Single-device list | Next |
| 3 | Emulator and harness | Not started |
| 4 | Sharing | Not started |
| 5 | Shopping polish | Not started |
| 6 | Categories | Not started; only after two weeks of using milestone 5 |
| 7 | Dictionary | Not started |
| 8 | Quantities | Not started |

## Decisions

- **2026-10-24 — Clear checked vs. a concurrent uncheck.** If one phone clears checked items while another unchecks one of them, the item stays deleted; undo brings it back. An uncheck writes only `checked`.
- **2026-10-24 — Everything is committed to `main`.**

## Notes for milestone 2

- Initialise Firestore with `persistentLocalCache` and `persistentMultipleTabManager`, and connect it to the Firestore emulator (port 8080, already in `firebase.json`) when `VITE_USE_EMULATORS` is `true`.
- Write the test first: add items offline, reload the page with the network still off, and check the items are still there; then go online and check they reach the emulator.
- Milestone 2 is single-device, so creating the list document can be minimal: one list per user, created on first sign-in. The members map and security rules come in milestone 4.
- Open questions 2–4 at the end of `spec.md` affect the item writes; question 2 (offline delete and the live-items query) can be checked as soon as the delete test exists.
