# ZER-26 scoped Credential Directory implementation

November 21, 2026 PT.

Implements [accepted intent](../intent/credential-administration.md),
[spec read-only directory boundary](../../specs/credential-admin/spec.md#read-only-directory-boundary-for-zer-26),
[delivery Task 2](../../specs/credential-admin/delivery-contract.md#2-inspect-scoped-credentials-and-developer-setup)
and operator experience sections 3, 7 and 10. Uses `CONTEXT.md` Actor, Identity
Binding, Accountable Human, Project, Scope and new Credential Directory terms.

Read local agent-context HANDOFF and STATUS; neither supplies current credential
policy. Its November 21 DECISIONS entry allows isolated implementers merging into
the integration branch, without waiving main release gates. Context Pin unchanged.
No default bindings or grants have been invented from team context.

## Implementation choices

The new [directory contract](../../specs/credential-admin/directory-contract.md)
is a trusted optional service binding, separate from catalog writes and secret
storage. Strict v1 metadata accepts shared-service, developer-owned and local-only
classes only. It validates Human and accountable Agent Identity Bindings, enforces
exact grants and returns no principal/policy lists or backend locators. There are
no mutation, enrollment or value endpoints. Production binding remains absent.

Read audience routes provide inventory, search, scoped details and My setup.
Missing source, unavailable source, denied access and an authorized empty result
stay distinct. My setup reports authorized scopes rather than inferred assignment;
connections remain missing/unverified and instrumentation/Work Session evidence
unknown. Expired healthy/degraded evidence projects as stale. Read UI assets do
not depend on catalog-admin access; existing catalog routes and CAS stay intact.

## Public seam qualification

The confirmed HTTP seam ran vertical red/green cycles:

1. Missing directory initially returned 404; read-only routing now returns 503
   `credential_directory_not_configured` with no-store.
2. Scoped inventory initially returned 503; validated service reads now enforce
   exact grants before list/search/detail and preserve inaccessible/absent 404.
3. My setup initially lacked Actor/scope/evidence states; it now returns the
   authenticated binding and truthful missing evidence.
4. Read audience workspace routes initially returned 404; authenticated HTML,
   script and CSS now load without catalog-admin assets.
5. Expired evidence initially retained healthy; it now returns stale.

Eleven HTTP tests pass, including Agent accountability, catalog-admin denial,
local-only isolation, unsupported mutations, invalid/future dates, malformed or
oversize sources, redirect rejection, source timeout and sanitized errors.
`npm run check` passed: build, format, lint, typecheck, 190 tests across 20 files,
and plain Wrangler/workerd smoke. Context Pin and its negative checks also pass. Ten built-runtime tests also pass. The existing
ledger failure-path tests emit expected exceptions while their assertions pass.

The browser journey was extended to a separate synthetic directory Worker service
and actual authenticated routes. It checks search, consumer detail, keyboard focus,
My setup, 320px reflow and missing/denied/unavailable/empty states, with optional
fixture-only PNG output. Local launch failed before navigation because Wrangler
could not enumerate network interfaces (`uv_interface_addresses`, EPERM). This is
not a browser pass. Actual GitHub Actions browser qualification remains required
on the published candidate. No assertions were skipped or weakened.

No live Access policy, directory enrollment, provider/backend calls, credentials,
consumer configuration or production deployment changed. Task closure, independent
Verdict/reproduce and main merge remain separate gates. Later mutation Tasks still
need their explicit provider/backend contracts and enrolled staging inputs.

## Spec review repairs

November 21, 2026 PT. Closes the three read-surface gaps against operator
experience sections 3, 5 and 6 and the directory contract's HTTP boundary:

- Fresh detail displays its own metadata revision and observation time, separately
  from the inventory's observation.
- Opaque Credential selection, search and exact filters live in the workspace
  URL. Reload, bookmarks and browser history restore selection; closing detail
  preserves search and filters and restores focus. The existing authorized detail
  API still decides visibility for every selection.
- Project, environment and owner selectors come from the authenticated My setup
  authorized scope subset. Inventory cards show configured consumer counts with
  discovery limitations. No API response fields or authorization rules changed.

The actual Worker browser journey now changes the synthetic source after inventory
load and checks distinct observation dates/revisions plus fresh detail facts. It
also checks all three exact filters, filter reload, zero/nonzero consumer counts,
selection reload/bookmark/back/forward/close and a denied detail bookmark. Fixture
controls remain isolated from runtime source. No VM browser substitute was added.

`npm run check` passed with 190 tests across 20 files, 10 built-runtime checks,
build, format, lint, typecheck and plain Wrangler/workerd smoke. Context Pin and
negative checks, browser journey syntax and diff whitespace checks passed.
The expanded browser journey could not navigate locally: Wrangler again failed
with `uv_interface_addresses` EPERM after locating installed Playwright. Its new
behavior assertions have not yet been qualified; CI must run them on this candidate.
No UI red/green claim is made from this infrastructure failure. There is no new
HTTP contract requiring an additional HTTP red/green cycle.
