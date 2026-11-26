# @zs-home/company-sdk

Read-only access to the company read surfaces on `homer-catalog`: Identity Bindings, Project
Timelines, Fleet health, the Context Pin, Knowledge Flags and the routing policy. The same surfaces
are offered as six read-only MCP tools.

## Read-only guarantee

Every call is a `GET` on `homer-catalog` behind Cloudflare Access. The SDK carries no write, claim
or admin call, and no method changes Homer. An unknown source account stays `Unattributed`, and a
missing or invalid reviewed snapshot fails closed.

## Client

```ts
import { createCompanyClient } from "@zs-home/company-sdk";

const client = createCompanyClient({
  baseUrl: "https://homer-catalog.example",
  getAccessHeaders: () => ({
    "CF-Access-Client-Id": serviceTokenId,
    "CF-Access-Client-Secret": serviceTokenSecret,
  }),
});

const identity = await client.resolveIdentity({
  source: "github",
  sourceAccount: "github:example-dev",
});
```

`baseUrl` must be a bare `https://` origin, with no path, query, credentials or trailing slash.
Every failure is a `CompanySdkError` with a `status`, a `code` and the `endpoint` it came from;
headers, tokens and response bodies are never echoed. A redirect is never followed, and fails with
code `unexpected_redirect`.

## MCP tools

Each tool is `scope: read` and calls one `CompanyClient` method.

| Tool | Scope | Call |
| --- | --- | --- |
| `homer_resolve_identity` | `read` | `resolveIdentity` |
| `homer_get_project_status` | `read` | `getProjectStatus` |
| `homer_get_fleet_health` | `read` | `getFleetHealth` |
| `homer_get_context_pin` | `read` | `getContextPin` |
| `homer_list_knowledge_flags` | `read` | `listKnowledgeFlags` |
| `homer_get_routing_policy` | `read` | `getRoutingPolicy` |

## CLI

`homer-company-mcp` speaks MCP over stdio, so an MCP client starts it as a command.

```sh
export HOMER_CATALOG_URL=https://homer-catalog.example
export HOMER_ACCESS_CLIENT_ID=...
export HOMER_ACCESS_CLIENT_SECRET=...
homer-company-mcp
```

`HOMER_CATALOG_URL` is the `https://` origin of `homer-catalog`. `HOMER_ACCESS_CLIENT_ID` and
`HOMER_ACCESS_CLIENT_SECRET` are a Cloudflare Access service token, sent as `CF-Access-Client-Id`
and `CF-Access-Client-Secret` and never logged. Logs go to stderr; stdout carries MCP messages
only.
