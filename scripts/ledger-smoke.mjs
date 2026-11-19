import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
const server = createServer();
server.listen(0, "127.0.0.1");
await once(server, "listening");
const port = server.address().port;
await new Promise((resolve) => server.close(resolve));
const storage = mkdtempSync(join(tmpdir(), "home-smoke-"));
const child = spawn(
  process.execPath,
  [
    "node_modules/wrangler/bin/wrangler.js",
    "dev",
    "--local",
    "--config",
    "scripts/ledger-smoke/wrangler.jsonc",
    "--ip",
    "127.0.0.1",
    "--port",
    String(port),
    "--inspector-port",
    "0",
    "--persist-to",
    storage,
  ],
  { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, WRANGLER_SEND_METRICS: "false" } },
);
let output = "";
child.stdout.on("data", (c) => (output += c));
child.stderr.on("data", (c) => (output += c));
const exit = once(child, "exit");
try {
  const deadline = Date.now() + 55000;
  let response;
  while (Date.now() < deadline && child.exitCode === null) {
    try {
      response = await fetch(`http://127.0.0.1:${port}`, { signal: AbortSignal.timeout(2000) });
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  assert(response, `Local Worker did not start: ${output}`);
  assert.equal(response.status, 200, await response.clone().text());
  assert.deepEqual(await response.json(), {
    first: "appended",
    retry: "duplicate",
    invalid: "refused",
    entries: 1,
    integrity: true,
  });
  console.log(
    "PASS: plain Wrangler/workerd append, Duplicate, Refused and verified history; no runtime code generation",
  );
} finally {
  child.kill("SIGTERM");
  const force = setTimeout(() => child.kill("SIGKILL"), 3000);
  await exit;
  clearTimeout(force);
  rmSync(storage, { recursive: true, force: true });
}
