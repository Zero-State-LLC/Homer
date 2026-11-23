# Curator runner

The host-agnostic core of the knowledge-loop curator. It decides whether a Curator
Profile can run on a host, answers the agent's permission requests, checks the
agent's changes and writes the run receipt. Contract:
[knowledge-loop spec](../../specs/knowledge-loop/spec.md).

```ts
import { runCurator } from "@zs-home/curator-runner";

const receipt = await runCurator(
  { host: adapter, inputs: inputSource, validator, publisher },
  { runId: "nightly", date: "2026-11-23", profile },
);
```

## Adapters

Everything that depends on the machine sits behind `HostAdapter`. A new machine
needs a new adapter and nothing else:

| Method | Duty |
| --- | --- |
| `describe()` | OS, architecture, container runtime and egress limits, GPU, loopback model endpoints, installed harness versions and credential names (never values) |
| `exportTree()` | Homer's files at `main`, in a fresh folder with no Git metadata; returns the container paths of that folder and of the inputs |
| `runSession(spec)` | The harness over ACP, in a container that sees only the folder, the inputs and the provider; answers every permission request with `spec.decide`; returns the outcome and the agent's final reply, only after the agent has stopped |
| `listChanges()` | Every changed path with its status, file type, mode and line count |
| `readFile()` | The new contents of an accepted file |
| `cleanup()` | Removes the folder and the container |

Three more dependencies are trusted and never read the agent's folder:

- `InputSource` gathers the open flags and their evidence, and marks a flag
  incomplete when any of its evidence was unreachable.
- `ContentValidator` runs `markdownlint-cli2` and the pinned `check-agents-md.sh`
  on the accepted contents, with configuration from the runner's own clone.
- `Publisher` commits in its own clone with hooks disabled and opens the pull
  request.

## Providers

The model provider is part of the profile. Cloudflare Workers AI is reached
through its OpenAI-compatible endpoint, so any harness that takes an OpenAI-style
base URL can use it. The host keeps a Workers AI-only token as
`CLOUDFLARE_AI_TOKEN`; the account id is part of the base URL, not a secret.

| Provider | Egress | Credential |
| --- | --- | --- |
| `anthropic` | `api.anthropic.com` | `ANTHROPIC_API_KEY` |
| `openai` | `api.openai.com` | `OPENAI_API_KEY` |
| `cloudflare` | `api.cloudflare.com` | `CLOUDFLARE_AI_TOKEN` |
| `local` | none (loopback) | none |
| `xai` | `api.x.ai` | `XAI_API_KEY` |

## Rules the core enforces

- A profile runs only when `unmetNeeds()` is empty for that host.
- Permission requests are allowed once, never always: reads and searches inside
  the folder or inputs, and edits inside the folder. Everything else is refused.
- Changes must be Markdown files under `CONTEXT.md`, `AGENTS.md`, `docs/agents/`
  or `docs/map.md`, with plain ASCII names and no hidden files, no deletions, no
  mode changes and at most 300 changed lines, and must pass both content
  validators. One refusal rejects the whole run.
- The agent's flag report is untrusted. `readFlagReport()` counts a flag as
  addressed only when the report says so once, the run changed something and the
  flag's evidence was complete. The pull request cites only addressed flags; the
  receipt lists the rest as needing a human.
- Adapter errors become failure codes. Their messages never reach the receipt.
