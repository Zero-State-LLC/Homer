# From a Task to a Verdict

How to get a software-factory Verdict for a Homer pull request. Follow it on the
judge's machine, the one where software-factory runs (Danny's machine; ADVERSARY
or Boof runs the steps). The merge contract in `AGENTS.md` needs that Verdict for
any pull request that changes code, configuration or CI. ZER-63 lists the ones
owed after the fact.

The chain: a Linear Task, then an emitted Work Request, then the judge's packet,
then `factory judge run --reproduce`, then `factory judge gate`, then the Verdict
on the pull request. Homer emits the request and builds the packet. Only
software-factory judges, and Homer never advances a Work Packet past intake
([Work Request emission spec](../../specs/work-requests/spec.md), execution plan
step 4).

## Set up the machine once

1. **Homer.** Clone it and build it. The emitter reads its policy file and manual
   requests from `origin/main`, never from the working tree, so fetch before
   each run:

   ```sh
   git clone https://github.com/Zero-State-LLC/Homer ~/homer
   cd ~/homer && npm ci --no-audit --no-fund && npm run build
   ```

2. **software-factory.** Use the existing checkout, with `factory` on the
   `PATH`. Its egress guard reads the OpenRouter key and keeps the spend ledger
   (`FACTORY_LEDGER`), as software-factory's `docs/governance.md` says. This
   runbook does not move that key, and Homer never holds it.
3. **The request store.** It lives on this machine only, at
   `$HOMER_WORK_REQUEST_STORE`, by default `~/.local/state/homer/work-requests/`.
   Create it once. Never delete, edit or copy a record in it: a recorded request
   is the request, forever.

   ```sh
   mkdir -p -m 700 ~/.local/state/homer/work-requests
   ```

4. **Credentials, by 1Password reference only.** Create a vault named
   `Homer Work Requests`, and a 1Password service account that can read that
   vault and nothing else. These are the items and their references. A
   reference names a vault, item and field; it is not a secret.

   | Variable | 1Password reference | What it is |
   | --- | --- | --- |
   | `HOMER_LINEAR_API_KEY_REF` | `op://Homer Work Requests/Linear read-only/credential` | A Linear API key with read access only, for Linear Tasks |
   | `HOMER_CLOUDFLARE_API_TOKEN_REF` | `op://Homer Work Requests/Workers AI/credential` | A Workers AI token, for Jev's risk tier on a first emission |
   | `HOMER_CLOUDFLARE_ACCOUNT_ID_REF` | `op://Homer Work Requests/Workers AI/account id` | The Cloudflare account id for that token |

   GitHub uses this machine's `gh` login, which must be able to read Homer and
   comment on its pull requests. Put the references, the service account's
   token and the emitting Agent's name in an environment file that only you can
   read. The emitter reads each value with `op read` at run time and passes it
   to nothing else.

   ```sh
   mkdir -p -m 700 ~/.config/homer
   install -m 600 /dev/null ~/.config/homer/work-requests.env
   # Edit it to hold these lines. Quote each value: the references hold spaces.
   #   OP_SERVICE_ACCOUNT_TOKEN="<the service account's token, typed here once>"
   #   HOMER_LINEAR_API_KEY_REF="op://Homer Work Requests/Linear read-only/credential"
   #   HOMER_CLOUDFLARE_API_TOKEN_REF="op://Homer Work Requests/Workers AI/credential"
   #   HOMER_CLOUDFLARE_ACCOUNT_ID_REF="op://Homer Work Requests/Workers AI/account id"
   #   HOMER_WORK_REQUEST_REQUESTER="agent:adversary"
   ```

## For each pull request

The example is pull request 76, from Linear Task ZER-91, written by Claude Opus
5.5. Use the files' names as they are here, so each step finds the last one's.

1. **Check the Task first.** The judge checks every Done when item against the
   diff. An item the diff cannot show, such as "the pull request carries a
   Verdict", is marked not met, and the Verdict fails. Move such an item out of
   the Done when list before you emit. After the first emission the recorded
   request stands, even when the Task changes, so a later edit does nothing. For
   a request that was recorded wrong, use a manual request instead: a reviewed
   `docs/work-requests/<slug>.json` on `main`, emitted as `manual:<slug>`.
2. **Emit the Work Request.** Exit 0 means emitted, or a Duplicate that printed
   the recorded request. Exit 1 is a refusal, with its reason code. Exit 2 is
   usage or configuration, such as a missing credential.

   ```sh
   cd ~/homer && git fetch origin
   set -a && . ~/.config/homer/work-requests.env && set +a
   npm --silent run work-request -- linear:ZER-91 > /tmp/pr-76.request.json
   ```

3. **Build the judge's packet.** It is `toWorkPacket`'s packet at intake, plus
   the model that wrote the change, so the judge can refuse one of its own
   vendor family. The model comes from the pull request's commits: a
   `Co-Authored-By: Claude Opus 5.5` line is `anthropic/claude-opus-5.5`. The
   packet is written as ASCII, as software-factory reads it.

   ```sh
   npm --silent run work-packet -- /tmp/pr-76.request.json \
     --author-model anthropic/claude-opus-5.5 > /tmp/pr-76.packet.json
   ```

4. **Judge it, with the reproduce check.** The default judge is `z-ai/glm-5.3`
   through software-factory's egress guard, within the packet's `budget_usd`.
   Exit 0 is a pass, 1 a fail, 2 an error with no Verdict, 3 a refusal.

   ```sh
   factory judge run --repo Zero-State-LLC/Homer --pr 76 \
     --packet /tmp/pr-76.packet.json --reproduce --out /tmp/pr-76.verdict.json
   ```

5. **Gate it.** The gate looks up the pull request's head and checks, and prints
   `merge_allowed` with any problems. For a merged pull request, the head is the
   one that merged.

   ```sh
   factory judge gate --verdict /tmp/pr-76.verdict.json > /tmp/pr-76.gate.json
   ```

6. **Post the Verdict on the pull request**, pass or fail. A failing Verdict is
   evidence too.

   ```sh
   npm --silent run verdict-comment -- /tmp/pr-76.verdict.json /tmp/pr-76.gate.json \
     > /tmp/pr-76.comment.md
   gh pr comment 76 --repo Zero-State-LLC/Homer --body-file /tmp/pr-76.comment.md
   ```

7. **Record it.** In ZER-63, mark the pull request's row with the result and a
   link to the comment. A failing Verdict gets its own Linear Task to fix it
   forward in a new pull request. History is not rewritten.

## Why a Verdict fails or is refused

- **A Done when item the diff cannot show.** See step 1.
- **A diff over 200 KB.** The judge sees only the first 200 KB and fails the
  Verdict as truncated. A merged pull request that large cannot pass; record it
  in ZER-63 and ask Danny.
- **The reproduce check.** It clones `refs/pull/<n>/head` into a fresh folder and
  runs the policy's test command, `bash -c 'npm ci --no-audit --no-fund && npm run check'`.
  It runs without a shell and drops every environment variable whose name holds
  KEY, TOKEN, SECRET, PASSWORD or CREDENTIAL. It needs Node 22.13 or later and
  network access for npm.
- **A moved head.** A push after judging makes the Verdict stale. Judge again.
- **The same vendor family.** A judge from the author's vendor family is refused,
  and so is a floating alias such as `~anthropic/latest`.

## Where things live

| What | Where |
| --- | --- |
| Recorded Work Requests and their risk-tier decisions | `$HOMER_WORK_REQUEST_STORE` on the judge's machine |
| Packets, Verdict files and gate answers | `/tmp` on the judge's machine, for one run only |
| The Verdict itself | A comment on the pull request, with its full JSON |
| Spend | software-factory's ledger, hashes only |

## The first end-to-end run

The first time this runbook is followed for a real Homer pull request, write a
receipt, `docs/receipts/verdict-run-YYYY-MM-DD-pr-<n>.md`. It names the Task,
the pull request and head, each command above with its exit code, the Verdict
and gate results, the comment's link and the cost. It holds no credential,
reference value or request body beyond what the comment already shows.
