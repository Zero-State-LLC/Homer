# ZER-25 review repair

The accepted [intent](../intent/credential-administration.md), Task 1 in the
[delivery contract](../../specs/credential-admin/delivery-contract.md), and
[operator experience section 10](../../specs/credential-admin/operator-experience.md)
require accessible Repository admission review. CONTEXT.md supplies Repository,
Project, Task and Release Gate vocabulary. The parent delivery receipt identifies
the Context Pin and agent-context HANDOFF, STATUS and DECISIONS references; no new
team authority or live policy is inferred by this repair.

## Spec finding

Repository inputs now have stable per-row field IDs. Validation adds inline
messages with aria-invalid and aria-describedby, plus a focusable error summary
whose links identify and focus the offending fields. Duplicate IDs and
case-insensitive names identify both rows. Native required, numeric and pattern
validity remains active, including the escaped hyphens fixed at b2e012b.
Editing or removing a row clears obsolete validation feedback. Ordinary status
updates remain polite and do not move focus. Explicit labels and sibling error
messages keep accessible field names stable while aria-describedby exposes the
error separately. The browser journey retains exact accessible-name selectors.

The authenticated HTTP markup test failed first: 1 failure and 18 passes because
the summary region was missing. After implementation the same test file passed
all 19 tests. This proves the served markup contract, not browser interaction.

The real Worker browser journey now checks duplicate errors, summary focus,
keyboard navigation to each field, stable IDs after removing another row, native
pattern failure and correction recovery. No private VM seam was added.

## Standards finding

The editor and new admin pages now call a shared header helper rather than
rendering the legacy editor solely to obtain its headers. Content Security Policy,
cache policy, frame denial, referrer policy and MIME protections are unchanged.
Existing legacy editor and authorization regressions remain in the suite.

## Validation and limits

- npm run check passed: build/runtime checks, format, lint, TypeScript, 179 tests
  across 19 files, and the real Wrangler/workerd smoke checks.
- npm run smoke:admin was attempted with the host Playwright module and Chromium.
  The local Worker started, but Chromium failed before browser assertions with
  socket() failed: Operation not permitted in process_singleton_posix.cc.
- Browser validation, keyboard, mobile and assistive-technology results are not
  demonstrated in this environment. The journey must run on a capable host.
  CHROMIUM_PATH remains optional so Playwright can select its installed browser.
- No live resources, authentication policy, credentials or remote refs changed.
  Author checks are not a software-factory Verdict or release approval.
