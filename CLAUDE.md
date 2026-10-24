# Appeltaart

- The plan is `docs/spec.md`; progress and decisions are in `docs/plan.md`. Build one milestone per session, in the order of the spec's "Build order" section, and update `docs/plan.md` at the end of each.
- Everything is committed to `main`.
- Before declaring a change done, run `npm run build`, `npm run lint` and `npm run test:e2e`, and report the results.
- Tests run against the Firebase emulators with the demo project `demo-appeltaart`, never against a live project.
- Where the build order allows, write the test for a feature before the feature.
