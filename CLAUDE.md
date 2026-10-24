# Appeltaart

- The plan is `docs/spec.md`. Build one milestone per session, in the order of its "Build order" section.
- Everything is committed to `main`.
- Before declaring a change done, run `npm run build`, `npm run lint` and `npm run test:e2e`, and report the results.
- Tests run against the Firebase emulators with the demo project `demo-appeltaart`, never against a live project.
- Where the build order allows, write the test for a feature before the feature.
