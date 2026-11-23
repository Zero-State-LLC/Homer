# Curator host setup: Windows with WSL2

Hosting decision (Daniel, 2026-11-23): runners are local, and Cloudflare handles
everything else. The dedicated curator machine runs Windows, with no GPU and
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
```

The runner's own clone of Homer goes in `~/curator/clone`. The agent never sees it.

## 4. Credentials from 1Password

The runner reads the model credentials and the Cloudflare account id from 1Password
at run time, with the 1Password CLI. Nothing is copied to disk, and neither value
belongs in this repository, a pull request, Linear, Buzz, or chat.

1. In 1Password, keep the curator's items in a vault of their own, for example
   `Homer Curator`, so the runner can read nothing else. Put the Cloudflare account
   id and the Workers AI token there.
2. Create a 1Password service account with read access to that vault only.
3. Install the 1Password CLI in Ubuntu from
   [1Password's CLI instructions](https://www.1password.dev/cli/get-started).
4. Put the service account token in the runner's environment as
   `OP_SERVICE_ACCOUNT_TOKEN`, in an environment file only the runner can read
   (mode `600`). The adapter passes it to the 1Password CLI only, never to Docker
   or a container.
5. In the adapter's configuration on the host, point each credential at its secret
   reference. References name a vault, item and field; they are not secrets.

| Setting | Refers to |
| --- | --- |
| `onePassword.CLOUDFLARE_AI_TOKEN` | A token from the Workers AI page: **Use REST API**, then **Create a Workers AI API Token**. A custom token needs only Workers AI Read and Edit. |
| `cloudflareAccountId` | The account id, as an `op://` reference |
| `onePassword.ANTHROPIC_API_KEY` | For Claude Code, if used |
| `onePassword.OPENAI_API_KEY` | For Codex with OpenAI, if used |

The runner also treats the account id as sensitive: a change that copies it, or the
token, into a file is refused.

A fallback without 1Password: one file per credential in `~/curator/secrets`, named
as above, mode `600`, with `secretsDir` set in the configuration.

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
