# Curator Docker host adapter

Runs the knowledge-loop curator's harness in Docker on Linux, including inside WSL2
on Windows. It implements `HostAdapter` from
[curator-runner](../curator-runner/). Contract: the
[knowledge-loop spec](../../specs/knowledge-loop/spec.md), "Docker host adapter".
Host setup: [curator host runbook](../../docs/deployment/curator-host.md).

```ts
import { runCurator } from "@zs-home/curator-runner";
import { DockerHostAdapter } from "@zs-home/curator-host-docker";

const host = new DockerHostAdapter({
  hostId: "curator-1",
  runnerClone: "/home/curator/curator/clone",
  workRoot: "/home/curator/curator/runs",
  secretsDir: "/home/curator/curator/secrets",
  proxyImage: "node@sha256:<digest>",
  harnesses: { hermes: { image: "homer/hermes@sha256:<digest>", command: ["hermes", "acp"] } },
  cloudflareAccountId: "<account id>",
});
const receipt = await runCurator({ host, inputs, validator, publisher }, request);
```

## What a run does

1. `exportTree()` fetches `origin/main` in the runner's clone and extracts it twice
   with `git archive`: a folder the agent edits and a reference copy it never sees.
   Neither has Git metadata.
2. `runSession()` starts an internal Docker network, an allowlist proxy, and a probe
   that must fail to connect out directly. Then it runs the harness:
   - as the runner's user, with a read-only root file system, no capabilities, no
     privilege escalation, and memory, CPU and process limits;
   - with the folder at `/workspace` and the inputs read-only at `/inputs`;
   - with no DNS, and `HTTPS_PROXY` pointing at the proxy, which allows `CONNECT`
     only to the provider's hosts on port 443;
   - with the credential passed through the environment by name, never on the
     command line.

   It speaks ACP over the container's standard streams, answers permission requests
   with the core's policy, and returns only after the container is gone. A harness
   that stops reading its input, or sends an oversized message or request id, ends
   the session.
3. `listChanges()` compares the two copies on the host, without Git, and reports
   symlinks, modes and line counts for the core's checks. It marks any change that
   holds the run's credential, plain, split or base64-encoded, so the core refuses
   it.
4. `readFile()` refuses a symlink anywhere on the path, anything that is not UTF-8
   text, and anything holding the run's credential.
5. `cleanup()` removes the containers, the network and the folders, and fails if
   any are left.

## Harness images

Each image is pinned by digest, carries the label `homer.curator.harness-version`,
and runs its ACP command as any user with `HOME=/tmp`. It reads its settings from
the environment:

| Variable | Value |
| --- | --- |
| `CURATOR_PROVIDER` | `anthropic`, `openai`, `cloudflare` or `xai` |
| `CURATOR_MODEL` | The profile's model id |
| `CURATOR_BASE_URL` | The OpenAI-compatible endpoint, when the provider has one |
| The provider's credential | For example `CLOUDFLARE_AI_TOKEN` |

The `local` provider is not supported by this adapter yet.
