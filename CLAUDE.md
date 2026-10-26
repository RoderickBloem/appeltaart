# Appeltaart

- `docs/spec.md` describes the app as built, with numbered decisions at the end; `docs/plan.md` says where things stand, what is requested and what is open. Record a new design decision in the spec's "Decisions", and update `docs/plan.md` when a piece of work is done.
- Everything is committed to `main`.
- Before declaring a change done, run `npm run build`, `npm run lint` and `npm run test:e2e`, and report the results.
- Tests run against the Firebase emulators with the demo project `demo-appeltaart`, never against a live project.
- Write the test for a feature before the feature.
- The live Firebase project and how to deploy to it are in `docs/plan.md`, section "Deployment". Deploy only when the maintainer asks, and update "Last deploy" there afterwards.
