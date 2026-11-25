# ADR 008: CI builds the workspace once per run

Status: accepted by Danny on 2026-11-24 (#62).
Intent: [CI feedback time](../../docs/intent/ci-feedback.md) (accepted).
Spec: [CI feedback time](../ci-feedback/spec.md), requirement R1 and packet 1.
Evidence: [CI baseline receipt](../../docs/receipts/ci-baseline-2026-11-24.md).

## Context

The root `package.json` gives `typecheck` and `test` a `pre` script that runs
`npm run build`, so `npm run typecheck` and `npm test` work on a clean tree. The
CI `check` job runs Build, Typecheck, Test, and then Build again. One run
therefore builds the workspace four times, and `npm run check` builds it three
times. Each build runs eight workspace builds in sequence and then the
`postbuild` runtime tests.

Measured on 27 green runs: a build takes 8 seconds (median), and the `check` job
takes 76. Three of the four builds, about 24 seconds, repeat one that already
passed.

## Decision

CI and `npm run check` run `npm run build` once, then call Typecheck and Test
with npm's `--ignore-scripts`:

```sh
npm run format:check
npm run build
npm run lint
npm run --ignore-scripts typecheck
npm test --ignore-scripts
npm run smoke:workers
```

`--ignore-scripts` skips the `pre` and `post` scripts of the named script and
still runs the script itself. The trailing Build step goes: the single build is
the build check, and it still runs the `postbuild` runtime tests. Format moves
first, because it reads no build output and fails in about 2 seconds.

The `pre` scripts stay. A developer or agent who runs `npm test` alone on a fresh
clone still gets a build first.

## Consequences

- About 24 seconds off a 76-second `check` run, to be confirmed by measurement
  (spec R7) before the change merges.
- Typecheck and Test trust the build that ran earlier in the same job. A future
  step placed between them that changes the tree must rebuild explicitly.
- `--ignore-scripts` also sets `npm_config_ignore_scripts=true` for child
  processes. Nothing under Typecheck or Test runs npm today [verified: no npm or
  npx spawn in tests, Vitest configs or `scripts/`]. A future test that shells
  out to an npm script would silently skip that script's hooks, so it would need
  to call the command directly.
- The step "Build workspace dependencies" becomes "Build", and the second Build
  step goes. Job names do not change.
- Open pull request #32 edits the line next to `check` in `package.json` and adds
  an `admin-browser` job that builds on its own; it rebases onto this.

## Alternatives considered

- **Delete the `pre` scripts.** Simplest diff. Rejected: `npm test` on a fresh
  clone would fail on missing `dist/` output, and every developer and agent would
  have to know the order.
- **TypeScript project references (`tsc -b`) with cached `.tsbuildinfo`.**
  Repeat builds become nearly free and the eight npm processes per build go
  away. Rejected for now: it touches eight `tsconfig.build.json` files and the
  emit settings, to save seconds once the build already runs once. Revisit if the
  single Build step passes 20 seconds.
- **A build cache tool such as Turborepo or Nx.** Rejected: a new dependency and
  configuration surface for a 76-second job.
- **Typecheck and Test as parallel jobs that share a build artifact.** Rejected:
  each job pays its own runner setup and `npm ci` (about 10 seconds) plus the
  artifact transfer, for little wall-clock gain and more moving parts.
