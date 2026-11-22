# ZER-25 Repository admission implementation evidence

Date: November 21, 2026 Pacific Time (November 22 UTC). Implementation candidate, not completion or release.

## Contract used

- [Accepted intent](../intent/credential-administration.md).
- [Delivery contract Task 1](../../specs/credential-admin/delivery-contract.md):
  inspect and safely edit Repository admission, HTTP and browser seams.
- [Operator experience](../../specs/credential-admin/operator-experience.md)
  sections 2, 4, 9 and 10; [credential spec](../../specs/credential-admin/spec.md)
  Admin UI and Ownership and permissions.
- [Glossary](../../CONTEXT.md): Repository, Project, Activity Event, Scope,
  Source Freshness and Attribution. Project mapping is distinct from Attribution.
- Team HANDOFF and STATUS contain no current Homer admin plan. DECISIONS at
  agent-context a4b7b7e permits the Homer parallel implementation exception.
  The consumed Context Pin remains unchanged. No FORGE plan or Verdict was found.

## Implemented

Authenticated Overview reads the actual catalog. Repository admission is explicit,
collection health is Unknown, and unavailable modules make no fixture-health claim.
The new field editor preserves the existing PUT and snapshot APIs, full-snapshot
CAS, authentication, origin checks and security response headers. Existing JSON
editor routes and its regression tests remain intact, with links to the new UI.

The form reviews added, changed and removed rows and affected Project references.
Conflicts and uncertain writes retain the in-memory non-secret draft, prohibit
mutation, and require current readback, three-way comparison, explicit adoption
of the current revision, and a fresh review. No write retry is automatic.

## Evidence

1. Worker HTTP Overview test failed with 404 instead of 401 before route
   implementation. Then the catalog test file passed 17 tests.
2. Protected field-form routes/assets test failed with 404 instead of 401 before
   implementation. Then the catalog test file passed 18 tests.
3. An HTTP concurrency/restart regression observes one 200 and one 409, reads the
   durable winner through authenticated snapshot HTTP after Durable Object restart,
   and rejects the stale precondition. This extends existing passing CAS behavior;
   it is additional regression coverage, not a claimed new red/green slice.
4. `npm run check` passes build, formatting, lint, types, tests and plain Worker
   smoke checks. No assertions or check configuration were weakened.

The first local build attempt resolved root AJV instead of the workspace's nested
AJV dependency because dependencies were symlinked. Restoring the corresponding
nested dependency link fixed the local environment; no dependency source changed.

## Local browser qualification attempt

`npm run smoke:admin` is a committed browser journey against a real local Wrangler
Worker. It covers field entry, added/changed/removed review, save/readback,
concurrent conflict, lost response after a real committed PUT, reconciliation,
forbidden access, keyboard entry and 320-pixel reflow. The lost-response case drops
only the transport response after forwarding the request to the real Worker.
It does not substitute a mocked HTML or snapshot response.

The local Worker started, but Chromium aborted before any journey assertion with
`process_singleton_posix.cc: socket() failed: Operation not permitted`.
A second attempt using a `/tmp` profile and `--no-sandbox --no-zygote` failed the
same way. Browser red/green, interaction success, mobile and keyboard results
are therefore **not demonstrated**. No VM substitute was used for the new form.
The existing legacy editor VM regression suite is not evidence for this new UI.

Run `npm run smoke:admin` in a browser-capable host for browser qualification.
Use `PLAYWRIGHT_MODULE` for a host-provided Playwright module and `CHROMIUM_PATH`
for its Chromium executable. The runner leaves no local synthetic catalog behind.

## Limits and remaining gates

Drafts survive failures within the current page, not reload/navigation. No new
persistent operation record is added; catalog revision/history supplies readback.
Source-verified identity lookup is unavailable, so IDs require verified manual
entry. Environment is explicitly catalog-wide, without an invented selector.
No actual collection, credential, archive or production health is claimed.

Real Access deployment policy, operator usability sessions, complete assistive
technology checks, software-factory Verdict/reproduce and merge approval remain
outstanding. No live credential operation, Access change or production deployment
was performed. Task completion in Linear still requires merge.

## CI qualification and review follow-up

The local Chromium limitation was resolved by running the same real-Worker journey
on GitHub Actions. At head `eb24771c1617e60ad9d970c3ce44459426cdacfd`, all seven
checks passed: build/test check, dependency audit, admin-browser, context-pin,
Markdown lint, links and secret scan.

[Browser evidence](https://github.com/Zero-State-LLC/Homer/actions/runs/44995460207/job/137125419926)
proves the committed mapping journey completed, including save/readback, conflict,
lost response after commit, linked validation errors, keyboard navigation,
320-pixel reflow and denied access. This is synthetic local-Worker evidence on a
CI runner, not live Access or staging qualification.

Separate Standards and Spec reviews identified linked-error feedback and shared
header ownership. Repairs add stable accessible field names and error links and
preserve the existing security headers. The extended browser journey passes.
These author-side reviews do not supply a software-factory Verdict.

[Draft PR #32](https://github.com/Zero-State-LLC/Homer/pull/32) contains this slice,
stacked on design PR #31. The next ready implementation slice is ZER-26.
