# Plan and progress

What the app does and why it is built as it is: [`spec.md`](spec.md). This file says where things stand.

## Status

Every milestone of the spec's build order is built, tested against the emulators, and deployed, together with invitations, multiple lists and invitation-only access, which the maintainer asked for along the way. The maintainer and family use it on their phones.

| Feature | Tests |
| --- | --- |
| Installable app, Google sign-in, works offline | `e2e/skeleton.spec.ts`, `e2e/popup.spec.ts` |
| Add, check, delete, clear; survives a force-quit offline | `e2e/list.spec.ts` |
| Sync properties over generated scenarios | `e2e/sync.spec.ts` |
| Sharing, invitations, three phones converging | `e2e/sharing.spec.ts`, `e2e/rules.spec.ts` |
| Undo, "Not synced", wake lock, duplicates as one row | `e2e/polish.spec.ts` |
| Categories, learned per product | `e2e/categories.spec.ts` |
| Seed dictionary and suggestions | `e2e/dictionary.spec.ts` |
| Quantities | `e2e/quantities.spec.ts` |
| Multiple lists | `e2e/lists.spec.ts` |
| Fifteen items on a Pixel 9 | `e2e/layout.spec.ts` |

## Deployment

- Firebase project `appeltaart-fd1ff`; the app is at https://appeltaart-fd1ff.web.app.
- `.github/workflows/deploy.yml` deploys hosting and `firestore.rules` from a ref: on a `v*` tag, or by hand (Actions > Deploy > Run workflow). A session can start it with the GitHub tools (`run_workflow`, workflow `deploy.yml`, ref `main`) and read the result from the job log, which ends with the Hosting URL.
- The workflow reads the repository variable `FIREBASE_PROJECT_ID` and the secret `FIREBASE_SERVICE_ACCOUNT` (service account `github-deploy`, roles Firebase Admin and Service Usage Consumer). Sessions never see the key and need no other Firebase access.
- Deploy only what the maintainer asked to have deployed: a deploy changes the app on the family's phones. Rules and app go out together, so a rules change must keep the deployed data working; no session can migrate live data.
- Last deploy: `5ff43a0` (deleting lists, names of people not yet seen, names recorded on joining), 2026-10-25.

## Working on it

- Everything is committed to `main`.
- Before a change is done: `npm run build`, `npm run lint`, `npm run test:e2e`. For changes to sync or to several phones, also repeat the affected tests (`--repeat-each 10`), which catches timing problems a single run does not.
- The live shared document was made before the app stopped creating them; tests make theirs with admin rights (`createHousehold` and `addMember` in `e2e/helpers.ts`).
- A test must not act faster than a person: wait for the screen to show a change before the next step, as people do. Several "bugs" found during development were tests reloading or typing before the previous step reached the screen.

## Feature requests

- **A seed list from the maintainer's supermarket.** The maintainer will provide product names and categories, and the order in which the shop's categories come; they replace or extend `src/seed.ts` and the order in `src/categories.ts`.

Possible later, if missed in use: editing categories in the app (names, colours, order); renaming a list; tapping a quantity to edit it; swipe-to-delete; removing a person from the app (now only in the console, and what the removed person's app then does is untested).

## Still open

- **Purging deleted items.** Items and lists are only marked deleted, so undo works. The items query loads at most 2000 items, deleted ones included; at a few hundred deletions a month, that is reached within a year. Needed: a script that removes items deleted more than 30 days ago, with admin rights, for example as a monthly GitHub Action.
