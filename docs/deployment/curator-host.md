# Curator host setup: Windows with WSL2

Host decision: Daniel's dedicated curator machine runs Windows, with no GPU and
32 GB of memory. The curator runner and Docker run inside WSL2 (Ubuntu), so the
same [Docker host adapter](../../packages/curator-host-docker/) serves this machine
now and Galadriel later. Contract: the
[knowledge-loop spec](../../specs/knowledge-loop/spec.md), "Docker host adapter".

No secret value belongs in this repository, a pull request, Linear, Buzz, or chat.
Only the names below.

## 1. WSL2 and Ubuntu

1. In an administrator PowerShell, run `wsl --install -d Ubuntu`, then restart.
2. In Ubuntu, create `/etc/wsl.conf` with:

   ```ini
   [boot]
   systemd=true
   ```

3. In PowerShell, run `wsl --shutdown`, then open Ubuntu again.
   `systemctl list-unit-files --type=service` should now list services.

## 2. Docker

Install Docker Engine inside Ubuntu from
[Docker's Ubuntu instructions](https://docs.docker.com/engine/install/ubuntu/).
Docker Desktop with WSL integration also works; the adapter only needs the `docker`
command inside Ubuntu.

Add the runner's account to the `docker` group. That access is equal to root on
this Ubuntu, so keep the distribution for the curator only.

## 3. Folders on the Linux disk

Everything lives under the runner's home in Ubuntu, never under `/mnt/c`. The
adapter refuses Windows drives, because file permissions and symlinks are not
reported exactly there.

```sh
mkdir -p ~/curator/clone ~/curator/runs ~/curator/inputs
install -d -m 700 ~/curator/secrets
```

The runner's own clone of Homer goes in `~/curator/clone`. The agent never sees it.

## 4. Credentials, by name

Each credential is one file in `~/curator/secrets`, named exactly as the provider
catalog names it, mode `600`. Create only the ones the chosen profiles need.

| File | What it holds |
| --- | --- |
| `CLOUDFLARE_AI_TOKEN` | A token from the Workers AI page: **Use REST API**, then **Create a Workers AI API Token**. A custom token needs only Workers AI Read and Edit. |
| `ANTHROPIC_API_KEY` | For Claude Code |
| `OPENAI_API_KEY` | For Codex with OpenAI |

The Cloudflare account id is configuration, not a secret. It goes in the adapter's
configuration as `cloudflareAccountId`.

## 5. Images

The adapter runs only images pinned by digest. Pull a Node image for the egress
proxy and record its digest:

```sh
docker pull node:22-alpine
docker image inspect --format '{{index .RepoDigests 0}}' node:22-alpine
```

Harness images (Hermes, Claude Code, Codex) come with the qualification work. Each
carries the label `homer.curator.harness-version` and reads `CURATOR_PROVIDER`,
`CURATOR_MODEL`, `CURATOR_BASE_URL` and its provider's credential from the
environment.

## 6. Staying up for the 02:00 run

- Set the Windows power plan so the machine never sleeps while plugged in.
- Set Windows Update active hours to cover the nightly run.
- systemd services do not keep a WSL instance alive. Add a Task Scheduler task
  that runs at log on: `wsl.exe -d Ubuntu --exec sleep infinity`, hidden.
- After a restart, check that Ubuntu and Docker are running before you leave it.

A missed run is not lost work. The spec has Homer raise a missed-run alert, and
Run now is always available.

## 7. Check

- `docker network create --internal --subnet 172.31.250.0/24 curator-check` then
  `docker network rm curator-check`. If the subnet overlaps another network, set a
  different `subnet` in the adapter's configuration.
- The adapter's `describe()` should list the harness versions and the credential
  names, with no values.
- Each session starts with a probe that must fail to reach the internet directly.
  If it reaches out, the session does not start.
