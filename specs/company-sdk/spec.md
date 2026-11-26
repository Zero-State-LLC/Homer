# Spec: Homer Company SDK (`packages/company-sdk`)

- **Status:** Accepted by Danny on 2026-11-26 (PT) with defaults 1, 2 and 4 and alternative 3 (see section 9). No deploy, Worker binding or production configuration is enabled by this file.
- **Author:** PROMETHEUS (Engineering Architect)
- **Date:** 2026-11-26 (PT)
- **Target Repository:** `Zero-State-LLC/Homer`
- **Target Implementer:** `deepseek/deepseek-v4.1-flash` (high reasoning) via OpenRouter, in one scoped PR after Danny signs off
- **Governing Docs Cited:**
  - `AGENTS.md` (agent contract, invariants, merge/deploy rules)
  - `CONTEXT.md` (ubiquitous language: Source System, Authority, Collector, Activity Event, Event Key, Event Ledger, Provenance, Actor, Identity Binding, Unattributed, Project, Milestone, Blocker, Projection, Knowledge Flag, Curator Run, Scope, Fleet Report, Context Pin)
  - `docs/intent/home-foundation.md` (accepted 2026-11-19)
  - `docs/intent/work-assignment-router.md` (accepted 2026-11-23)
  - `specs/knowledge-loop/spec.md` (accepted 2026-11-23)
  - `specs/adr/013-catalog-worker-boundary.md` (accepted 2026-11-24)
  - `agent-context.pin.json` (pinned to `Zero-State-LLC/agent-context@8cf82d516999543dffc692413046767becfe2e6a`, 2026-11-24)
  - Linear `ZER-35` (Backlog: `knowledge_gap` events and nightly curator)

## 1. Problem and Architecture Choice

Agents and internal tools need one typed, read-only way to query Homer for:

1. Cross-source Identity Bindings (GitHub, Linear, Buzz -> Actor, or `Unattributed`),
2. Project status (Milestones, Planned vs Actual Dates, Blockers, Release Gates, Source Freshness),
3. Fleet health (Machines, sparkDash status, firing alerts),
4. The active `agent-context` Context Pin,
5. Open Knowledge Flags linked to Langfuse run traces and `software-factory` Verdict outcomes for `curator-runner`, and
6. The versioned, read-only model/budget routing policy (Jev, OpenRouter, Qwen Studio limits).

### Simplest Architecture (First Principles)

- **No new Worker, no new database, no new queue, no new public HTTP route on `homer-event-ledger`.**
- All new read endpoints live on **`homer-catalog`** (`packages/catalog-worker`) behind the existing Cloudflare Access `read` audience (`ACCESS_READ_AUD`), declared in `catalogRoutes` per ADR 013 rule 4.
- **`homer-event-ledger`** remains strictly internal (Durable Object RPC binding only, no HTTP `fetch` handler).
- **One new workspace package: `packages/company-sdk` (`@zs-home/company-sdk`).** It provides:
  - A thin, typed, read-only HTTP client (`createCompanyClient`) talking only to `homer-catalog` `GET` endpoints over Access.
  - A transport-agnostic, read-only MCP tool surface (`COMPANY_SDK_MCP_TOOLS` + `dispatchMcpTool`) exposing `Scope: read` tools only, plus a stdio MCP server bin (`homer-company-mcp`) built on `@modelcontextprotocol/sdk` (decision 3).
  - A pure, deterministic, dev/user-agnostic routing policy evaluator (`resolveModelRoute`).
- **Unify `ZER-35` with `specs/knowledge-loop/spec.md` instead of inventing a duplicate event kind.** Use `knowledge.flagged` (never storing raw flag prose in Homer) plus an additive `home.activity-event/v4` contract extension for optional trace/verdict references (`traceRef`, `verdictEventKey`, `gapKind`) and a pure Projection `projectOpenKnowledgeFlags` in `@zs-home/projections` that joins `knowledge.flagged`, `factory.verdict_recorded`, `pull_request.merged`, and `curator.run_completed` for `curator-runner`.
- **NVIDIA-first check:** Not applicable. This package is a read-only TypeScript SDK, pure Projections, and Cloudflare Workers read routes; it runs no local GPU inference. Local serving remains governed by `curator-runner` and host adapters.

## 2. Hard Invariants and Boundaries

Every rule below is a product-true lock from `AGENTS.md`, `CONTEXT.md`, and ADR 013:

1. **Read-only SDK surface (`Scope: read`).** `packages/company-sdk` exposes `GET` calls and read-only MCP tools only. No write, claim, admin, or ledger-append methods.
2. **No One Mind content or credentials.** Never expose One Mind notes, vault text, API keys, tokens, SSH addresses, Cloudflare account IDs, or Qwen Studio keys in any contract, route, policy, log, or test fixture.
3. **Event Ledger stays internal.** `packages/event-ledger` gains zero HTTP routes. `homer-catalog` reads the ledger only through the existing `EVENT_LEDGER` Durable Object binding (bounded prefix, never silent truncation).
4. **Workers security posture preserved.** `workers_dev: false` and `preview_urls: false` remain untouched in every `wrangler.jsonc`. Every new `homer-catalog` route requires valid `Cf-Access-Jwt-Assertion` verified against `ACCESS_READ_AUD` (or `ACCESS_ADMIN_AUD`) and rejects cross-origin requests. No Access bypass.
5. **No invented facts.**
   - Unknown source account -> `Unattributed` (never guess from display name).
   - Missing Milestone target date -> `null` (`Unknown Date`).
   - Missing or stale Fleet Report -> `none` / `stale` / `unknown` (never `up`).
   - Unmatched routing policy -> explicit `abstain` with a stable `ReasonCode` (never silent fallback).
6. **Authority boundaries preserved.** Linear owns Tasks, GitHub owns Repository Events, software-factory owns Work Packets and Verdicts, Control Room owns Work Sessions. Homer only observes and projects.
7. **Deterministic, synthetic-fixture + local `workerd` tests only.** No live network calls, no live Cloudflare resources, no deploys.

## 3. Exact Package and File Layout

One scoped PR touches only these paths:

```text
specs/integration-contracts/
  activity-event.v4.schema.json          # Additive v4: traceRef, verdictEventKey, gapKind on knowledge.flagged; traceRef on factory.verdict_recorded
  routing-policy.v1.schema.json          # New: versioned read-only model/budget routing policy contract
  identity-bindings.v1.schema.json       # New: versioned reviewed cross-source Identity Binding snapshot contract

packages/shared-contracts/
  src/types.ts                           # Add ActivityEventContract v4, RoutingPolicy, IdentityBindingSnapshot, KnowledgeFlagRef types
  src/validators.ts                      # Export validateRoutingPolicy, validateIdentityBindingSnapshot, v4 support
  src/workers.ts                         # Export Workers-safe compiled validators for v4, routing policy, identity bindings
  src/generated/context-pin.ts           # Generated at build time from root agent-context.pin.json (no runtime fs reads in Workers)
  src/index.ts                           # Re-export new types, validators, CONTEXT_PIN

packages/projections/
  src/knowledge-flags.ts                 # New pure Projection: projectOpenKnowledgeFlags(entries, options)
  src/index.ts                           # Export projectOpenKnowledgeFlags + types

packages/catalog-worker/
  src/routes.ts                          # Register 5 new read-audience routes in catalogRoutes
  src/index.ts                           # Dispatch the 5 new read routes after Access verification
  src/company-read.ts                    # Handlers for /v1/context-pin, /v1/identities/resolve, /v1/projects/:id/timeline, /v1/knowledge-flags, /v1/routing-policy
  src/bindings.d.ts                      # Optional read-only bindings if needed (no new DO migration required for v1)
  test/company-read.test.ts              # Local workerd tests via @cloudflare/vitest-plugin

packages/curator-runner/
  src/index.ts                           # Add typed OpenKnowledgeFlagInput adapter accepting projectOpenKnowledgeFlags output (including traceRef and verdictEventKey)

packages/company-sdk/                    # NEW workspace package: @zs-home/company-sdk
  package.json                           # name: "@zs-home/company-sdk", type: "module", deps: @zs-home/shared-contracts, @zs-home/projections
  tsconfig.build.json                    # Matches existing workspace packages
  src/types.ts                           # Public SDK request/response types + MCP tool schema types
  src/client.ts                          # createCompanyClient(options): typed read-only HTTP client for homer-catalog
  src/routing.ts                         # resolveModelRoute(policy, request): pure deterministic route/budget evaluator
  src/mcp.ts                             # COMPANY_SDK_MCP_TOOLS + dispatchMcpTool(client, toolName, args)
  src/mcp-server.ts                      # createCompanyMcpServer(client): MCP Server over any transport (decision 3)
  src/cli.ts                             # homer-company-mcp bin: the server over StdioServerTransport (decision 3)
  src/index.ts                           # Public exports (transport-agnostic; no MCP SDK import)
  test/client.test.ts                    # Unit tests with injected stub fetch (no live network)
  test/mcp.test.ts                       # MCP tool schema validation, read-only enforcement, error mapping
  test/routing.test.ts                   # Deterministic routing, budget caps, dev/user-agnostic guard, abstention
  test/mcp-server.test.ts                # MCP server tool registration, read-only annotations, stdio CLI seam
  test/integration.test.ts               # End-to-end against catalog-worker handleRequest (runs in the catalog-worker workerd project)

package.json                             # Add @zs-home/company-sdk to root build script
vitest.config.ts                         # Add packages/company-sdk/test/**/*.test.ts to node project
```

## 4. Detailed Contracts and TypeScript Interfaces

### 4.1 Surface 1: Typed Read-Only SDK and MCP Surface (`packages/company-sdk`)

#### 4.1.1 Reviewed Cross-Source Identity Bindings (`home.identity-bindings/v1`)

Homer currently has Access-principal bindings in `CREDENTIAL_DIRECTORY`, but no reviewed cross-source mapping (`github` login, `linear` user ID, `buzz` pubkey -> `Actor`).

```ts
export type IdentitySource = "github" | "linear" | "buzz";

export interface SourceIdentityBinding {
  readonly source: IdentitySource;
  /** Raw source account, e.g. "github:scrimshawlife-ctrl", "linear:usr_123", "buzz:npub1..." */
  readonly sourceAccount: string;
  /** Canonical Actor ID matching ^actor:[a-z0-9-]+$ */
  readonly actorId: string;
  readonly actorKind: "human" | "agent" | "system";
  /** Required when actorKind === "agent"; forbidden when actorKind === "human" */
  readonly accountableHumanId?: string;
  /** Review provenance link (commit/PR/ADR URL), never a secret */
  readonly evidenceRef: string;
}

export interface IdentityBindingSnapshot {
  readonly contract: "home.identity-bindings/v1";
  readonly revision: number;
  readonly updatedAt: string; // UTC ISO-8601 Z
  readonly bindings: readonly SourceIdentityBinding[];
}

export type IdentityResolution =
  | {
      readonly status: "attributed";
      readonly source: IdentitySource;
      readonly sourceAccount: string;
      readonly actorId: string;
      readonly actorKind: "human" | "agent" | "system";
      readonly accountableHumanId?: string;
      readonly evidenceRef: string;
      readonly revision: number;
    }
  | {
      readonly status: "unattributed";
      readonly source: IdentitySource;
      readonly sourceAccount: string;
      readonly revision: number;
    };
```

**Invariants:**

- Duplicate `(source, sourceAccount)` entries in a snapshot are rejected by validation.
- Every `agent` binding must name an `accountableHumanId` that exists as a `human` actor in the same snapshot.
- Lookup is exact-match only. No fuzzy matching, no email/display-name inference. Unmatched input always returns `{ status: "unattributed", ... }`.

#### 4.1.2 Active `agent-context` Pin (`GET /v1/context-pin`)

Generated at build time into `packages/shared-contracts/src/generated/context-pin.ts` from root `agent-context.pin.json` (same pattern as `generated/build-info.ts`), so Workers never touch the filesystem.

```ts
export interface ContextPinSnapshot {
  readonly repository: string; // "Zero-State-LLC/agent-context"
  readonly commit: string;     // 40-hex SHA
  readonly pinnedAt: string;   // YYYY-MM-DD
  readonly files: Readonly<Record<string, string>>; // path -> 64-hex sha256
}
```

#### 4.1.3 Project Status, Milestones, Blockers (`GET /v1/projects/:projectId/timeline`)

Reuses `projectProjectTimeline` from `@zs-home/projections` directly over bounded `EVENT_LEDGER` replay (same `<= 2000` sequence bound as `/v1/calendar` in `packages/catalog-worker/src/calendar.ts`, returning HTTP `413` `timeline_history_too_large` rather than silently truncating).

```ts
export interface ProjectStatusResponse {
  readonly state: "ready" | "empty";
  readonly head: { readonly sequence: number; readonly entryDigest: string } | null;
  readonly asOf: string;
  readonly timeline: ProjectTimeline; // from @zs-home/projections (milestones, blockers, releaseGates, sourceFreshness, warnings)
}
```

#### 4.1.4 Fleet Health (`GET /v1/fleet`)

Already implemented on `homer-catalog` (`packages/catalog-worker/src/fleet-status.ts`). `company-sdk` returns `FleetStatusView` directly with zero duplication.

#### 4.1.5 Company SDK Client (`packages/company-sdk/src/client.ts`)

```ts
export interface CompanyClientOptions {
  /** Base https:// origin of homer-catalog (no trailing slash). */
  readonly baseUrl: string;
  /** Caller-supplied Access headers (e.g. CF-Access-Client-Id/Secret or Cf-Access-Jwt-Assertion). Never logged. */
  readonly getAccessHeaders: () => Promise<Record<string, string>> | Record<string, string>;
  /** Injectable fetch for tests and Workers service bindings. */
  readonly fetch?: typeof globalThis.fetch;
  readonly timeoutMs?: number; // default 10_000
}

export interface CompanyClient {
  resolveIdentity(query: { source: IdentitySource; sourceAccount: string }): Promise<IdentityResolution>;
  getProjectStatus(query: { projectId: string; asOf?: string }): Promise<ProjectStatusResponse>;
  getFleetHealth(): Promise<FleetStatusView>;
  getContextPin(): Promise<ContextPinSnapshot>;
  listKnowledgeFlags(query?: {
    status?: "open" | "stuck" | "needs_human" | "resolved" | "all";
    projectId?: string;
    repository?: string;
  }): Promise<KnowledgeFlagQueueView>;
  getRoutingPolicy(): Promise<RoutingPolicy>;
}
```

**Error discipline:** HTTP errors return typed `CompanySdkError` (`status`, `code`, `endpoint`) without ever echoing auth headers, tokens, or raw HTML bodies.

#### 4.1.6 Read-Only MCP Surface (`packages/company-sdk/src/mcp.ts`)

Transport-agnostic tool definitions + dispatcher (callers running stdio or HTTP MCP can register `COMPANY_SDK_MCP_TOOLS` directly). Per decision 3, the package also ships `createCompanyMcpServer` and the `homer-company-mcp` stdio bin, which register exactly these tools with read-only annotations:

| MCP Tool Name | Scope | Underlying `CompanyClient` Call | Input Schema |
| --- | --- | --- | --- |
| `homer_resolve_identity` | `read` | `resolveIdentity` | `{ source: "github"\|"linear"\|"buzz", sourceAccount: string }` |
| `homer_get_project_status` | `read` | `getProjectStatus` | `{ projectId: "^project:[a-z0-9-]+$", asOf?: isoUtc }` |
| `homer_get_fleet_health` | `read` | `getFleetHealth` | `{}` |
| `homer_get_context_pin` | `read` | `getContextPin` | `{}` |
| `homer_list_knowledge_flags` | `read` | `listKnowledgeFlags` | `{ status?: "open"\|"stuck"\|"needs_human"\|"resolved"\|"all", projectId?: string, repository?: string }` |
| `homer_get_routing_policy` | `read` | `getRoutingPolicy` | `{ taskClass?: RoutingTaskClass, maxBudgetUsd?: number }` (returns policy + optional `resolveModelRoute` result) |

Unknown tool names or invalid input shapes fail closed with `{ ok: false, error: { code: "unknown_tool" | "invalid_arguments", message } }`.

---

### 4.2 Surface 2: Linking Run Traces (Langfuse) and `software-factory` Verdicts to `knowledge.flagged` / `ZER-35`

#### 4.2.1 Reconciling `ZER-35` with `specs/knowledge-loop/spec.md`

- `specs/knowledge-loop/spec.md` already established `knowledge.flagged` (no raw flag prose in Homer; resolution requires `curator.run_completed` citing the Event Key + `pull_request.merged`).
- `ZER-35` adds three concrete requirements:
  1. Classifying the gap (`missing`, `wrong`, `stale`),
  2. Linking a Langfuse run trace ID (`traceRef`), and
  3. Surfacing failed `software-factory` Verdicts (`factory.verdict_recorded` with `result: "fail"`) alongside open flags for `curator-runner`.
- **Design:** Add `home.activity-event/v4` (`specs/integration-contracts/activity-event.v4.schema.json`), strictly additive over `v3`:
  - `knowledge.flagged` continues to be admitted from `buzz`, `github`, `linear`, AND now also from `software-factory` (for automated Verdict-failure knowledge flags).
  - Optional structured metadata inside `data` for `knowledge.flagged` (all IDs/hashes/links only; no raw prose or One Mind text):

    ```ts
    export interface KnowledgeFlagData {
      /** ZER-35 gap classification. */
      readonly gapKind?: "missing" | "wrong" | "stale";
      /** Repo path, skill slug, or doc URL that is missing/wrong/stale. */
      readonly targetRef?: string;
      /** SHA-256 hex of normalized observation text for ZER-35 dedup without storing raw text. */
      readonly observationHash?: string;
      /** Optional Langfuse trace linkage (ID only, plus optional https URL; never trace payload). */
      readonly traceRef?: {
        readonly provider: "langfuse";
        readonly traceId: string; // ^[A-Za-z0-9._-]{1,128}$
        readonly url?: string;    // https://...
      };
      /** Optional Event Key of a software-factory factory.verdict_recorded event that triggered this flag. */
      readonly verdictEventKey?: string; // ^software-factory:factory\.verdict_recorded:[A-Za-z0-9._:/#@-]{1,200}$
    }
    ```

  - Optional `data.traceRef` (same `{ provider: "langfuse", traceId, url? }` shape) is also allowed on `factory.verdict_recorded` so any Verdict event can carry the Langfuse trace ID of the run or judge session.
  - **Event Key deduplication (ZER-35):**
    - Source-backed flags keep `<source>:knowledge.flagged:<sourceObjectId>`.
    - Verdict-linked flags use `software-factory:knowledge.flagged:<packetId>:<headSha>` (or `<observationHash>` when raised from a normalized observation).
    - Because `EventLedger` already deduplicates identical Event Keys as `Duplicate` and refuses differing payloads as `Conflict`, no separate dedup table is needed.
  - **Actor Attribution rule:** `knowledge.flagged` events with an unrecognized `actor.sourceAccount` and no `actorId` remain `Unattributed` unless an Identity Binding exists; `actorKind` without `actorId` is already refused by `activityEventSemanticErrors`. If a caller requires attributed-only intake for automated flags, `homer-intake` enforces that at intake time before appending.

#### 4.2.2 Pure Projection: `projectOpenKnowledgeFlags` (`packages/projections/src/knowledge-flags.ts`)

Deterministic Projection rebuilt from effective Event Ledger history (after `replayEffectiveHistory`):

```ts
export type KnowledgeFlagStatus = "open" | "stuck" | "needs_human" | "resolved";

export interface LinkedVerdictSummary {
  readonly eventKey: string;
  readonly packetId: string;
  readonly repository: string;
  readonly headSha: string;
  readonly pr: number;
  readonly result: "pass" | "fail";
  readonly mode: "online" | "offline";
  readonly judgeModel: string;
  readonly authorModel: string;
  readonly occurredAt: string;
  readonly traceRef?: { readonly provider: "langfuse"; readonly traceId: string; readonly url?: string };
}

export interface ProjectedKnowledgeFlag {
  readonly eventKey: string;
  readonly sourceSystem: "buzz" | "github" | "linear" | "software-factory";
  readonly sourceUrl: string;
  readonly occurredAt: string;
  readonly actor: ActivityEventActor;
  readonly projectId?: string;
  readonly repository?: string;
  readonly taskId?: string;
  readonly gapKind: "missing" | "wrong" | "stale" | "unspecified";
  readonly targetRef: string | null;
  readonly observationHash: string | null;
  readonly traceRef: { readonly provider: "langfuse"; readonly traceId: string; readonly url?: string } | null;
  readonly linkedVerdict: LinkedVerdictSummary | null;
  readonly status: KnowledgeFlagStatus;
  readonly curatorAttempts: number;
  readonly needsHumanReason: "unclear" | "conflict" | null;
  readonly resolvedByPrUrl: string | null;
}

export interface KnowledgeFlagQueueView {
  readonly state: "ready" | "empty";
  readonly head: { readonly sequence: number; readonly entryDigest: string } | null;
  readonly stuckThreshold: number; // default 3, per specs/knowledge-loop/spec.md
  readonly flags: readonly ProjectedKnowledgeFlag[];
  readonly warnings: readonly string[];
}
```

**Projection rules (exact match to `specs/knowledge-loop/spec.md`):**

- Collect all `knowledge.flagged` events in ledger order.
- Index `factory.verdict_recorded` events by `eventKey`. If `data.verdictEventKey` matches a recorded Verdict, attach `linkedVerdict` (and inherit `traceRef` from the Verdict if the flag itself omitted one). If `verdictEventKey` points to a missing event, emit a warning in `warnings` and keep `linkedVerdict: null`.
- Index `pull_request.merged` events by `provenance.sourceUrl` (PR URL).
- Scan `curator.run_completed` events:
  - For each key in `data.addressedFlags`: increment `curatorAttempts`; if the run's `evidence` contains a PR URL that has a matching `pull_request.merged` event, mark `status = "resolved"` and record `resolvedByPrUrl`.
  - For each entry in `data.needsHuman`: if not resolved, set `status = "needs_human"` and record `needsHumanReason`.
  - If still unresolved and `curatorAttempts >= stuckThreshold` (default `3`): set `status = "stuck"`.
- `packages/curator-runner/src/index.ts` gets a thin typed input shape `OpenKnowledgeFlagInput` matching `ProjectedKnowledgeFlag` so the nightly curator reads open/stuck flags with their `traceRef` and `linkedVerdict` without touching `EVENT_LEDGER` directly.

---

### 4.3 Surface 3: Versioned, Read-Only Model/Budget Routing Policy (`home.routing-policy/v1`)

Consistent with `docs/intent/work-assignment-router.md` (dev/user-agnostic, deterministic, fail-closed, zero secrets) and the standing routing rules (OpenRouter caps, Qwen Studio local endpoint metadata, Jev on Workers AI).

```ts
export type RoutingProviderId =
  | "openrouter"
  | "qwen-studio"
  | "cloudflare-workers-ai"
  | "anthropic"
  | "openai"
  | "xai"
  | "local";

export type RoutingTaskClass =
  | "coding"
  | "repo_audit"
  | "spec_design"
  | "risk_classification"
  | "curator_run"
  | "general_local";

export interface ProviderBudgetLimits {
  readonly provider: RoutingProviderId;
  /** Public or internal non-secret endpoint label; never credentials or account IDs. */
  readonly endpointHost: string | null;
  /** Maximum USD auto-approved per single call; 0 means local/free or no auto-spend. */
  readonly maxUsdPerCall: number;
  /** Maximum USD per Pacific Time day; null means uncapped local/included quota. */
  readonly maxUsdPerPtDay: number | null;
  /** Minimum remaining account credit USD before abstaining; null if not credit-billed. */
  readonly minCreditFloorUsd: number | null;
  /** Reference to where the caller obtains the key locally (name only, never value or path to secret contents). */
  readonly credentialEnvName: string | null;
}

export interface ModelRouteRule {
  readonly routeId: string;
  readonly taskClass: RoutingTaskClass;
  readonly priority: number; // lower wins; unique per taskClass for deterministic ordering
  readonly provider: RoutingProviderId;
  readonly model: string;
  readonly reasoningEffort?: "low" | "medium" | "high";
  readonly maxContextTokens: number;
  readonly maxUsdPerCall: number;
  readonly requiresHumanApprovalOverUsd: number | null;
}

export interface RoutingPolicy {
  readonly contract: "home.routing-policy/v1";
  readonly revision: number;
  readonly effectiveAt: string; // UTC ISO-8601 Z
  readonly timeZone: "America/Los_Angeles";
  readonly providers: readonly ProviderBudgetLimits[];
  readonly routes: readonly ModelRouteRule[];
}
```

#### Pure Evaluator (`packages/company-sdk/src/routing.ts`)

```ts
export type RoutingReasonCode =
  | "no_route_for_task_class"
  | "exceeds_per_call_budget"
  | "exceeds_daily_budget"
  | "below_credit_floor"
  | "exceeds_context_window"
  | "provider_unavailable";

export interface ModelRouteRequest {
  readonly taskClass: RoutingTaskClass;
  readonly estimatedCostUsd: number;
  readonly estimatedContextTokens?: number;
  readonly ptDaySpendUsd?: number;
  readonly providerCreditBalanceUsd?: Readonly<Partial<Record<RoutingProviderId, number>>>;
  readonly unavailableProviders?: readonly RoutingProviderId[];
}

export type ModelRouteDecision =
  | {
      readonly outcome: "selected";
      readonly policyRevision: number;
      readonly route: ModelRouteRule;
      readonly requiresHumanApproval: boolean;
      readonly excluded: readonly { readonly routeId: string; readonly reason: RoutingReasonCode }[];
    }
  | {
      readonly outcome: "abstain";
      readonly policyRevision: number;
      readonly reason: RoutingReasonCode;
      readonly excluded: readonly { readonly routeId: string; readonly reason: RoutingReasonCode }[];
    };

export function resolveModelRoute(
  policy: RoutingPolicy,
  request: ModelRouteRequest,
): ModelRouteDecision;
```

**Determinism and safety rules:**

- `ModelRouteRequest` accepts NO developer ID, user ID, email, display name, or login session.
- Routes for `request.taskClass` are sorted strictly by `(priority ASC, routeId ASC)`.
- A candidate is excluded with one stable `RoutingReasonCode` if:
  - its provider is in `unavailableProviders`,
  - `estimatedContextTokens > route.maxContextTokens`,
  - `estimatedCostUsd > min(route.maxUsdPerCall, provider.maxUsdPerCall)`,
  - `provider.maxUsdPerPtDay !== null && (ptDaySpendUsd ?? 0) + estimatedCostUsd > provider.maxUsdPerPtDay`, or
  - `provider.minCreditFloorUsd !== null && creditBalance !== undefined && creditBalance < provider.minCreditFloorUsd`.
- If no candidate remains, return `{ outcome: "abstain", ... }` (fail closed).
- Default seed fixture (for tests and reviewed config):
  - `coding`: `openrouter` / `deepseek/deepseek-v4.1-flash` (`high`, `$0.50`/call, `$5.00`/PT day, `$5.00` credit floor).
  - `spec_design`: `openrouter` / `anthropic/claude-opus-5.5` (same OpenRouter provider caps).
  - `risk_classification`: `cloudflare-workers-ai` / `typesafe/jev` (`$0` call budget, Workers AI quota).
  - `general_local`: `qwen-studio` / `qwen-flat` (`endpointHost: "qwen-studio.example"` in synthetic fixtures; the reviewed snapshot names the real host, 262,144 context, `$0` call budget, `credentialEnvName: "QWEN_STUDIO_API_KEY"` - never the key or local file path).

## 5. Worker and Binding Touchpoints

| Worker | Touchpoint | Auth / Access | New DO Migration? |
| --- | --- | --- | --- |
| `homer-catalog` (`packages/catalog-worker`) | Add 5 `GET`-only routes in `routes.ts` and `index.ts`: `/v1/context-pin`, `/v1/identities/resolve`, `/v1/projects/:projectId/timeline`, `/v1/knowledge-flags`, `/v1/routing-policy` | Existing `ACCESS_READ_AUD` (or `ACCESS_ADMIN_AUD`), same-origin check, `GET` only (`405` otherwise) | **No.** v1 reads `CONTEXT_PIN` (build-time constant), `EVENT_LEDGER` (existing DO binding), and reviewed JSON snapshots supplied via Worker bindings (`IDENTITY_BINDINGS_JSON`, `ROUTING_POLICY_JSON`) or static reviewed module with strict schema validation (fail-closed `503` if invalid or unconfigured). |
| `homer-event-ledger` (`packages/event-ledger`) | None (accepts `v4` automatically once `@zs-home/shared-contracts/workers` compiled validator includes `v4`) | Internal DO RPC only; zero HTTP routes | **No.** |
| `homer-intake` (`packages/intake-worker`) | None in this PR (already binds `EVENT_LEDGER`; future workload intake for `software-factory` verdicts/flags is a separate scoped PR once Danny approves its Access audience) | Unchanged | **No.** |

**Secret / Account ID hygiene:**

- `wrangler.jsonc` keeps `workers_dev: false`, `preview_urls: false`, and NO `account_id`.
- `routing-policy.v1.schema.json` and `identity-bindings.v1.schema.json` reject any field containing bearer tokens, API key patterns, IP addresses, or 32-hex Cloudflare account IDs in URLs.

## 6. Acceptance Tests (Synthetic Fixtures + Local `workerd`)

All tests run under `npm run check` (`vitest run` + `smoke:workers`), with zero live network calls:

1. **Contract tests (`packages/shared-contracts/test/`):**
   - `activity-event.v4.schema.json` accepts valid `knowledge.flagged` (from `buzz`, `github`, `linear`, `software-factory`) with `gapKind`, `targetRef`, `observationHash`, `traceRef`, `verdictEventKey`, and rejects malformed `traceId`, non-https `traceRef.url`, or non-`factory.verdict_recorded` `verdictEventKey`.
   - Workers standalone validator (`@zs-home/shared-contracts/workers`) matches Node validator on all v1/v2/v3/v4 fixtures (no `new Function` / `eval`).
   - `routing-policy.v1.schema.json` and `identity-bindings.v1.schema.json` reject duplicate keys, agent bindings without a human `accountableHumanId`, negative budgets, or extra unknown properties.
2. **Projection tests (`packages/projections/test/knowledge-flags.test.ts`):**
   - Joins `knowledge.flagged` + `factory.verdict_recorded` (inherits `traceRef` when flag omits it; warns on dangling `verdictEventKey`).
   - Lifecycle transitions: `open` -> `needs_human` (`unclear`/`conflict`) -> `stuck` (3 unmerged `curator.run_completed` attempts) -> `resolved` (only when cited PR has `pull_request.merged`).
   - Determinism: identical replay order yields byte-identical output.
3. **Catalog Worker `workerd` tests (`packages/catalog-worker/test/company-read.test.ts`):**
   - All 5 new routes reject missing/invalid Access JWT (`401`), wrong HTTP method (`405`), and cross-origin `Origin` (`403`).
   - `GET /v1/identities/resolve` returns `attributed` for bound GitHub/Linear/Buzz accounts and `unattributed` for unknown accounts (never 500, never guesses).
   - `GET /v1/projects/:projectId/timeline` replays bounded ledger history and returns `413` if sequence exceeds 2000; preserves `Unknown Date` (`null`).
   - `GET /v1/knowledge-flags` filters by `status`, `projectId`, `repository` and links synthetic Verdict + Langfuse `traceRef`.
   - `GET /v1/context-pin` returns exact `agent-context.pin.json` commit and file hashes.
   - `GET /v1/routing-policy` fails closed (`503`) if policy config is missing or invalid; returns valid `home.routing-policy/v1` when configured.
4. **Company SDK unit & integration tests (`packages/company-sdk/test/`):**
   - `client.test.ts`: every method hits the exact `homer-catalog` path, sends caller's Access headers, never leaks headers in `CompanySdkError`, enforces timeout.
   - `mcp.test.ts`: all 6 MCP tools validate inputs, dispatch to `CompanyClient`, reject unknown tools and invalid params, and expose zero write/mutate tools.
   - `routing.test.ts`: deterministic priority tie-break, per-call cap, PT daily cap, credit floor, context window limit, provider outage fallback, fail-closed `abstain`, and an explicit **agnostic guard test** proving no user/dev identity field exists or affects selection.
   - `integration.test.ts`: `createCompanyClient` wired directly into `catalog-worker` `handleRequest` (with synthetic Access JWT key seam and synthetic `EVENT_LEDGER` / `RUNNER_FLEET` DOs) exercises all 6 read surfaces end to end.

## 7. Explicit Non-Goals (Out of Scope for This PR)

- No write, claim, or admin endpoints on `company-sdk` or MCP (`Work Session` claims, catalog edits, profile switches stay out).
- No new `homer-intake` HTTP endpoint for pushing `factory.verdict_recorded` or `knowledge.flagged` (separate PR once workload Access audience is approved).
- No live Langfuse API client or trace fetching inside Homer Workers (`curator-runner` fetches external evidence on the local host per `specs/knowledge-loop/spec.md`).
- No One Mind read/write integration, no memory mirroring, no credential/secret storage or retrieval.
- No live spend ledger or OpenRouter balance polling inside Homer Workers (callers supply current spend/balance to `resolveModelRoute`).
- No new Durable Object classes or SQLite migrations in `homer-catalog` or `homer-event-ledger`.
- No Cloudflare deploy, no `wrangler deploy`, no staging/prod resource creation, and no merge without Danny's explicit yes and software-factory Verdict.

## 8. Workflows

Per repository policy (`AGENTS.md` and standing Workflows lock):

### Existing Grok Bot Skills

| Skill | Owner | Role in this work |
| --- | --- | --- |
| `anti-slop-code` | Implementer (`deepseek/deepseek-v4.1-flash`) / Reviewer | Keep contracts, client, and tests minimal and idiomatic; no dead abstractions. |
| `production-systems` | PROMETHEUS / Implementer | Fail-closed validation, bounded ledger reads, no secret leakage, explicit timeouts. |
| `google-developer-style` | PROMETHEUS / Implementer | Clear, literal docs and spec prose matching `CONTEXT.md` terms. |
| `zero-state-context` (from `agent-context` pin) | Boof / PROMETHEUS | Grounding against pinned `HANDOFF.md`, `STATUS.md`, `DECISIONS.md`. |

### GitHub Actions Workflows (Reused; None Added)

| Workflow | Path | Purpose |
| --- | --- | --- |
| CI | `.github/workflows/ci.yml` | Runs `npm run check` (`versions:check`, `format:check`, `build`, `lint`, `typecheck`, `vitest run`, `smoke:workers`). |
| Docs | `.github/workflows/docs.yml` | Markdown lint, link checks, and `scripts/check-context-pin.sh`. |
| Secret scan | `.github/workflows/secret-scan.yml` | Gitleaks scan on every PR. |

## 9. Decisions (Accepted 2026-11-26)

Danny accepted defaults 1, 2 and 4, and chose the alternative for decision 3: bundle `@modelcontextprotocol/sdk` with a stdio CLI bin in this pull request. The table records the options as proposed.

Each default holds unless Danny changes it on sign-off:

| # | Decision | Proposed Default | Alternative |
| --- | --- | --- | --- |
| 1 | **Identity Bindings & Routing Policy storage in v1** | Reviewed JSON snapshots bound to `homer-catalog` (validated fail-closed on read; zero new DO migrations so rollbacks stay unpinned). | New Durable Object(s) with compare-and-swap admin UI (defer to a follow-up PR). |
| 2 | **`ZER-35` event unification** | Extend `knowledge.flagged` in `home.activity-event/v4` with optional `data.gapKind`, `data.targetRef`, `data.observationHash`, `data.traceRef`, `data.verdictEventKey` (no raw flag prose in Homer). | Add a separate `knowledge_gap` kind (not recommended: duplicates `specs/knowledge-loop/spec.md`). |
| 3 | **MCP transport dependency** | Zero new runtime dependencies: export transport-agnostic `COMPANY_SDK_MCP_TOOLS` + `dispatchMcpTool` in `packages/company-sdk`. | Add `@modelcontextprotocol/sdk` as a runtime dependency and ship a stdio CLI bin in the same PR. |
| 4 | **PR scope & budget** | Single scoped PR implemented by `deepseek/deepseek-v4.1-flash` via OpenRouter under existing budget rules (`$0.50`/call, `$5.00`/PT day cap), then verified by an independent judge model via `software-factory`. | Split into two PRs (1: contracts + projections; 2: catalog-worker routes + `company-sdk`). |
