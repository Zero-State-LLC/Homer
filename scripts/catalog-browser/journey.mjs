// Explicit local-only browser qualification. Requires Playwright and a Chromium executable.
import assert from "node:assert/strict";
import { createController } from "../../packages/runner-controller/dist/index.js";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import { generateKeyPair, exportJWK, SignJWT } from "jose";
import { directoryFixture } from "./directory-fixture.mjs";
const require = createRequire(import.meta.url);
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const temp = mkdtempSync(join(tmpdir(), "homer-admin-browser-"));
const { privateKey, publicKey } = await generateKeyPair("RS256");
const jwk = { ...(await exportJWK(publicKey)), kid: "local-browser" };
const jwt = (aud, sub = "synthetic-browser") =>
  new SignJWT({
    type: "app",
    sub,
    iss: "https://synthetic.cloudflareaccess.com",
    aud,
  })
    .setProtectedHeader({ alg: "RS256", kid: "local-browser" })
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(privateKey);
writeFileSync(
  join(temp, "worker.ts"),
  // One local Worker serves both routers (ADR 013): the runner controller
  // routes go to homer-intake's, everything else to homer-catalog's. Both see
  // the same RUNNER_FLEET, as the deployed script_name binding gives them.
  `import {handleRequest} from ${JSON.stringify(resolve("packages/catalog-worker/src/index.ts"))};
import {handleRequest as handleIntakeRequest} from ${JSON.stringify(resolve("packages/intake-worker/src/index.ts"))};
export {MappingCatalogObject,RunnerFleetObject} from ${JSON.stringify(resolve("packages/catalog-worker/src/index.ts"))};
import {createLocalJWKSet} from ${JSON.stringify(require.resolve("jose"))};
export {EventLedgerObject} from ${JSON.stringify(resolve("packages/event-ledger/src/ledger-object.ts"))};
import {event} from ${JSON.stringify(resolve("packages/event-ledger/test/fixture.ts"))};
const key=createLocalJWKSet({keys:[${JSON.stringify(jwk)}]});
export default {async fetch(request, env){
 if(new URL(request.url).pathname==='/__fixture/calendar-seed'){
  const ledger=env.EVENT_LEDGER.get(env.EVENT_LEDGER.idFromName('event-ledger'));
  for(const e of [{...event('browser-human'),subject:'Synthetic reviewed implementation',occurredAt:'2026-11-21T01:00:00Z',actor:{sourceAccount:'synthetic-human',actorId:'actor:fixture',actorKind:'human'}},{...event('browser-unknown'),subject:'Synthetic unattributed merge',occurredAt:'2026-11-22T01:00:00Z'}]){const result=await ledger.appendActivityEvent(e);if(!['appended','duplicate'].includes(result.outcome))return Response.json(result,{status:500});}
  return Response.json({seeded:true});
 }
 if(new URL(request.url).pathname.startsWith('/v1/runner-controller/'))return handleIntakeRequest(request, env, key);
 const mode=request.headers.get('X-Synthetic-Directory');
 const original=env.CREDENTIAL_DIRECTORY;
 const configured={...env,CREDENTIAL_DIRECTORY:mode==='missing'?undefined:{fetch: req=>original.fetch(new Request(req,{headers:{'X-Synthetic-Directory':mode||'ready'}}))}};
 return handleRequest(request, configured, key)
}};`,
);
writeFileSync(
  join(temp, "wrangler.json"),
  JSON.stringify({
    name: "homer-admin-local-browser",
    main: "worker.ts",
    compatibility_date: "2026-11-18",
    compatibility_flags: ["nodejs_compat"],
    workers_dev: false,
    vars: {
      ACCESS_ISSUER: "https://synthetic.cloudflareaccess.com",
      ACCESS_READ_AUD: "synthetic-read",
      ACCESS_ADMIN_AUD: "synthetic-admin",
      CATALOG_NAME: "browser",
      RUNNER_CONTROLLER_AUD: "synthetic-controller",
      RUNNER_HEARTBEAT_BUDGET_SECONDS: "120",
    },
    services: [{ binding: "CREDENTIAL_DIRECTORY", service: "homer-directory-fixture" }],
    durable_objects: {
      bindings: [
        { name: "MAPPING_CATALOG", class_name: "MappingCatalogObject" },
        { name: "RUNNER_FLEET", class_name: "RunnerFleetObject" },
        { name: "EVENT_LEDGER", class_name: "EventLedgerObject" },
      ],
    },
    migrations: [
      {
        tag: "v1",
        new_sqlite_classes: ["MappingCatalogObject", "RunnerFleetObject", "EventLedgerObject"],
      },
    ],
  }),
);
writeFileSync(
  join(temp, "directory.ts"),
  `const snapshot=${JSON.stringify(directoryFixture)};
export default {fetch(request){
 const mode=request.headers.get('X-Synthetic-Directory');
 if(mode==='unavailable')return new Response('Fixture unavailable',{status:503});
 if(mode==='changed')return Response.json({...snapshot,metadataRevision:2,observedAt:'2026-11-21T00:00:00Z',credentials:snapshot.credentials.map(c=>({...c,activeVersion:'fixture_version_two'}))});
 return Response.json(mode==='empty'?{...snapshot,credentials:[]}:snapshot);
}};`,
);
writeFileSync(
  join(temp, "directory.json"),
  JSON.stringify({
    name: "homer-directory-fixture",
    main: "directory.ts",
    compatibility_date: "2026-11-18",
    workers_dev: false,
  }),
);
const socket = createServer();
socket.listen(0, "127.0.0.1");
await once(socket, "listening");
const port = socket.address().port;
await new Promise((r) => socket.close(r));
const child = spawn(
  process.execPath,
  [
    "node_modules/wrangler/bin/wrangler.js",
    "dev",
    "--local",
    "--config",
    join(temp, "wrangler.json"),
    "--config",
    join(temp, "directory.json"),
    "--ip",
    "127.0.0.1",
    "--port",
    String(port),
    "--inspector-port",
    "0",
    "--persist-to",
    join(temp, "state"),
  ],
  { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, WRANGLER_SEND_METRICS: "false" } },
);
let output = "";
child.stdout.on("data", (c) => (output += c));
child.stderr.on("data", (c) => (output += c));
const exited = once(child, "exit");
let browser;
try {
  const base = `http://127.0.0.1:${port}`;
  let ready = false;
  for (let i = 0; i < 150 && child.exitCode === null; i++) {
    try {
      await fetch(base);
      ready = true;
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  assert(ready, output);
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROMIUM_PATH,
    args: ["--no-sandbox", "--no-zygote"],
  });
  const context = await browser.newContext({
    extraHTTPHeaders: { "Cf-Access-Jwt-Assertion": await jwt("synthetic-admin") },
  });
  const page = await context.newPage();
  await page.goto(base + "/v1/admin/repositories");
  await page
    .getByRole("button", { name: "Add Repository mapping", exact: true })
    .click({ timeout: 3000 });
  await page.getByLabel("Repository ID", { exact: true }).fill("123");
  await page.getByLabel("Repository name", { exact: true }).fill("Zero-State-LLC/browser");
  await page.getByLabel("Project ID", { exact: true }).fill("project:homer");
  await page.getByLabel("Enabled", { exact: true }).check();
  const originalId = await page.getByLabel("Repository ID", { exact: true }).getAttribute("id");
  await page.getByRole("button", { name: "Add Repository mapping", exact: true }).click();
  const rows = page.locator(".mapping-row");
  await rows.nth(1).getByLabel("Repository ID", { exact: true }).fill("123");
  await rows.nth(1).getByLabel("Repository name", { exact: true }).fill("Zero-State-LLC/BROWSER");
  await page.getByRole("button", { name: "Review changes", exact: true }).click();
  assert.equal(await page.locator('[aria-invalid="true"]').count(), 4);
  assert.equal(await page.locator("#validation-errors a").count(), 4);
  assert.equal(
    await page.locator("#validation-summary").evaluate((node) => node === document.activeElement),
    true,
  );
  assert.equal(await page.locator("#preview").isHidden(), true);
  for (const link of await page.locator("#validation-errors a").all()) {
    const target = await link.getAttribute("href");
    await link.focus();
    await page.keyboard.press("Enter");
    assert.equal(
      await page.locator(target).evaluate((node) => node === document.activeElement),
      true,
    );
    const description = await page.locator(target).getAttribute("aria-describedby");
    assert.match(await page.locator("#" + description).innerText(), /duplicates another mapping/);
  }
  await rows.nth(1).getByRole("button", { name: "Remove mapping", exact: true }).click();
  assert.equal(
    await page.getByLabel("Repository ID", { exact: true }).getAttribute("id"),
    originalId,
  );
  assert.equal(await page.locator("#validation-summary").isHidden(), true);
  await page.getByLabel("Project ID", { exact: true }).fill("invalid project");
  await page.getByRole("button", { name: "Review changes", exact: true }).click();
  assert.equal(
    await page
      .getByLabel("Project ID", { exact: true })
      .evaluate((node) => node.validity.patternMismatch),
    true,
  );
  assert.equal(
    await page.getByLabel("Project ID", { exact: true }).getAttribute("aria-invalid"),
    "true",
  );
  await page.getByLabel("Project ID", { exact: true }).fill("project:homer");
  assert.equal(await page.locator('[aria-invalid="true"]').count(), 0);
  console.log(
    "PASS: duplicate fields and native invalid input have linked errors, keyboard focus and correction recovery",
  );
  await page.getByRole("button", { name: "Review changes", exact: true }).click();
  assert.match(await page.locator("#changes").innerText(), /Added/);
  await page.getByRole("button", { name: "Save reviewed changes", exact: true }).click();
  await page.waitForFunction(() =>
    document.getElementById("status").textContent.includes("Saved revision 1"),
  );
  const readback = await context.request.get(base + "/v1/admin/catalog/snapshot");
  assert.deepEqual(await readback.json(), {
    version: 1,
    revision: 1,
    repositories: [
      {
        repositoryId: 123,
        repository: "Zero-State-LLC/browser",
        enabled: true,
        projectId: "project:homer",
      },
    ],
  });
  console.log("PASS: browser field-based add, explicit review, save and real Worker readback");
  await page.getByLabel("Project ID", { exact: true }).fill("project:draft");
  await page.getByRole("button", { name: "Review changes", exact: true }).click();
  assert.match(await page.locator("#changes").innerText(), /Changed/);
  const competing = {
    version: 1,
    revision: 2,
    repositories: [
      {
        repositoryId: 123,
        repository: "Zero-State-LLC/browser",
        enabled: false,
        projectId: "project:other",
      },
    ],
  };
  const concurrent = await context.request.put(base + "/v1/admin/catalog", {
    headers: { "If-Match": '\"1\"' },
    data: competing,
  });
  assert.equal(concurrent.status(), 200);
  await page.getByRole("button", { name: "Save reviewed changes", exact: true }).click();
  await page.waitForFunction(() =>
    document.getElementById("status").textContent.includes("Another operator"),
  );
  assert.equal(await page.getByLabel("Project ID", { exact: true }).inputValue(), "project:draft");
  assert.equal(
    await page.getByRole("button", { name: "Review changes", exact: true }).isDisabled(),
    true,
  );
  await page
    .getByRole("button", { name: "Read current mappings for reconciliation", exact: true })
    .click();
  await page.locator("#reconciliation").waitFor({ state: "visible" });
  assert.match(await page.locator("#readback").innerText(), /project:other/);
  assert.match(await page.locator("#original").innerText(), /project:homer/);
  assert.match(await page.locator("#retained").innerText(), /project:draft/);
  await page
    .getByRole("button", { name: "Use current revision and review my draft", exact: true })
    .click();
  await page.getByRole("button", { name: "Review changes", exact: true }).click();
  await page.getByRole("button", { name: "Save reviewed changes", exact: true }).click();
  await page.waitForFunction(() =>
    document.getElementById("status").textContent.includes("Saved revision 3"),
  );
  console.log(
    "PASS: browser concurrent update preserves original/current/draft and requires readback plus review",
  );
  await page.getByLabel("Project ID", { exact: true }).fill("project:uncertain");
  await page.getByRole("button", { name: "Review changes", exact: true }).click();
  let writes = 0;
  await page.route("**/v1/admin/catalog", async (route) => {
    writes++;
    const committed = await route.fetch();
    assert.equal(
      committed.status(),
      200,
      JSON.stringify({ request: route.request().postDataJSON(), response: await committed.text() }),
    );
    await route.abort("connectionfailed");
  });
  await page.getByRole("button", { name: "Save reviewed changes", exact: true }).click();
  await page.waitForFunction(() =>
    document.getElementById("status").textContent.includes("could not be confirmed"),
  );
  assert.equal(writes, 1);
  assert.equal(
    await page.getByLabel("Project ID", { exact: true }).inputValue(),
    "project:uncertain",
  );
  assert.equal(
    await page.getByRole("button", { name: "Review changes", exact: true }).isDisabled(),
    true,
  );
  await page
    .getByRole("button", { name: "Read current mappings for reconciliation", exact: true })
    .click();
  await page.locator("#reconciliation").waitFor({ state: "visible" });
  assert.match(await page.locator("#readback").innerText(), /project:uncertain/);
  await page
    .getByRole("button", { name: "Use current revision and review my draft", exact: true })
    .click();
  await page.getByRole("button", { name: "Review changes", exact: true }).click();
  assert.match(await page.locator("#status").innerText(), /No mapping changes/);
  assert.equal(writes, 1);
  await page.unroute("**/v1/admin/catalog");
  await page.getByRole("button", { name: "Remove mapping", exact: true }).click();
  await page.getByRole("button", { name: "Review changes", exact: true }).click();
  assert.match(await page.locator("#changes").innerText(), /Removed/);
  await page.getByRole("button", { name: "Save reviewed changes", exact: true }).click();
  await page.waitForFunction(() =>
    document.getElementById("status").textContent.includes("Saved revision 5"),
  );
  assert.deepEqual(
    (await (await context.request.get(base + "/v1/admin/catalog/snapshot")).json()).repositories,
    [],
  );
  console.log(
    "PASS: lost response after real commit reconciles without duplicate write; removal review saves",
  );
  await page.setViewportSize({ width: 320, height: 700 });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  await page.getByRole("button", { name: "Add Repository mapping", exact: true }).focus();
  await page.keyboard.press("Enter");
  assert.equal(
    await page
      .getByLabel("Repository ID", { exact: true })
      .evaluate((node) => node === document.activeElement),
    true,
  );
  const denied = await browser.newContext({
    extraHTTPHeaders: { "Cf-Access-Jwt-Assertion": await jwt("synthetic-read") },
  });
  const deniedPage = await denied.newPage();
  assert.equal((await deniedPage.goto(base + "/v1/admin/repositories")).status(), 401);
  await denied.close();
  console.log("PASS: mobile reflow, keyboard entry and forbidden browser route");
  const reader = await browser.newContext({
    extraHTTPHeaders: { "Cf-Access-Jwt-Assertion": await jwt("synthetic-read") },
  });
  const directoryPage = await reader.newPage();
  const directoryErrors = [];
  directoryPage.on("pageerror", (error) => directoryErrors.push(error.message));
  await directoryPage.goto(base + "/v1/workspace/credentials");
  await directoryPage
    .getByRole("button", { name: "Inspect Developer diagnostic", exact: true })
    .waitFor();
  assert.doesNotMatch(
    await directoryPage.locator("body").innerText(),
    /Another developer private integration/,
  );
  assert.equal((await reader.request.get(base + "/v1/workspace/directory.css")).status(), 200);
  if (process.env.ADMIN_SCREENSHOT_DIR) {
    mkdirSync(process.env.ADMIN_SCREENSHOT_DIR, { recursive: true });
    await directoryPage.screenshot({
      path: join(process.env.ADMIN_SCREENSHOT_DIR, "credentials-desktop.png"),
      fullPage: true,
    });
  }
  assert.match(
    await directoryPage.locator("#inventory").innerText(),
    /Configured consumer count: 1/,
  );
  assert.match(
    await directoryPage.locator("#inventory").innerText(),
    /Configured consumer count: 0/,
  );
  assert.deepEqual(await directoryPage.locator("#ownerActorId option").allTextContents(), [
    "All authorized owners",
    "human:fixture",
    "human:other",
  ]);
  for (const [filter, value, expected, excluded] of [
    ["Project", "project:homer", "Developer diagnostic", "Shared archive"],
    ["Environment", "production", "Shared archive", "Developer diagnostic"],
    ["Owner", "human:other", "Shared archive", "Developer diagnostic"],
  ]) {
    await directoryPage.getByLabel(filter, { exact: true }).selectOption(value);
    await directoryPage.getByRole("button", { name: "Search", exact: true }).click();
    await directoryPage.getByRole("button", { name: "Inspect " + expected, exact: true }).waitFor();
    assert.doesNotMatch(
      await directoryPage.locator("#inventory").innerText(),
      new RegExp(excluded),
    );
    await directoryPage.reload();
    await directoryPage.getByRole("button", { name: "Inspect " + expected, exact: true }).waitFor();
    assert.equal(await directoryPage.getByLabel(filter, { exact: true }).inputValue(), value);
    await directoryPage.getByLabel(filter, { exact: true }).selectOption("");
    await directoryPage.getByRole("button", { name: "Search", exact: true }).click();
    await directoryPage
      .getByRole("button", { name: "Inspect Developer diagnostic", exact: true })
      .waitFor();
  }
  await directoryPage.getByLabel("Search authorized metadata").fill("private");
  await directoryPage.getByRole("button", { name: "Search", exact: true }).click();
  await directoryPage.waitForFunction(
    () => document.getElementById("status").textContent === "No matching authorized metadata.",
  );
  await directoryPage.getByLabel("Search authorized metadata").fill("diagnostic");
  await directoryPage.getByRole("button", { name: "Search", exact: true }).click();
  const inspect = directoryPage.getByRole("button", {
    name: "Inspect Developer diagnostic",
    exact: true,
  });
  await inspect.waitFor();
  await directoryPage.waitForFunction(
    () => document.getElementById("status").textContent === "Authorized inventory loaded.",
  );
  assert.match(
    await directoryPage.locator("#observed").innerText(),
    /Inventory Metadata revision 1/,
  );
  // The directory changes after inventory observation and before the fresh detail read.
  await directoryPage.setExtraHTTPHeaders({ "X-Synthetic-Directory": "changed" });
  await inspect.focus();
  await directoryPage.keyboard.press("Enter");
  await directoryPage
    .getByText("Synthetic diagnostic consumer (fixture_consumer)", { exact: true })
    .waitFor();
  assert.match(
    await directoryPage.locator("#detail-body").innerText(),
    /Consumer discovery scope: Unknown/,
  );
  assert.equal(
    await directoryPage
      .locator("#detail-title")
      .evaluate((node) => node === document.activeElement),
    true,
  );
  assert.match(
    await directoryPage.locator("#observed").innerText(),
    /Inventory Metadata revision 1/,
  );
  assert.match(
    await directoryPage.locator("#detail-body").innerText(),
    /Detail Metadata revision 2/,
  );
  assert.match(await directoryPage.locator("#detail-body").innerText(), /fixture_version_two/);
  const observedDates = await directoryPage.evaluate(() => {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return ["2026-11-20T00:00:00Z", "2026-11-21T00:00:00Z"].map((value) =>
      new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "long",
        timeZone: zone,
      }).format(new Date(value)),
    );
  });
  assert((await directoryPage.locator("#observed").innerText()).includes(observedDates[0]));
  assert((await directoryPage.locator("#detail-body").innerText()).includes(observedDates[1]));
  const bookmark = directoryPage.url();
  assert.equal(new URL(bookmark).searchParams.get("credential"), "fixture_owned");
  await directoryPage.reload();
  await directoryPage
    .getByText("Synthetic diagnostic consumer (fixture_consumer)", { exact: true })
    .waitFor();
  await directoryPage.getByRole("button", { name: "Close detail", exact: true }).click();
  assert.equal(await inspect.evaluate((node) => node === document.activeElement), true);
  assert.equal(new URL(directoryPage.url()).searchParams.has("credential"), false);
  assert.equal(new URL(directoryPage.url()).searchParams.get("q"), "diagnostic");
  await directoryPage.goBack();
  await directoryPage
    .getByText("Synthetic diagnostic consumer (fixture_consumer)", { exact: true })
    .waitFor();
  await directoryPage.goForward();
  await directoryPage.locator("#detail").waitFor({ state: "hidden" });
  await directoryPage.goto(bookmark);
  await directoryPage
    .getByText("Synthetic diagnostic consumer (fixture_consumer)", { exact: true })
    .waitFor();
  await directoryPage.goto(base + "/v1/workspace/credentials?credential=fixture_hidden");
  await directoryPage
    .getByText("Credential not found or outside your permitted scope.", { exact: true })
    .waitFor();
  assert.doesNotMatch(await directoryPage.locator("#detail-body").innerText(), /Another developer/);
  await directoryPage.getByRole("link", { name: "My setup", exact: true }).click();
  await directoryPage
    .getByRole("heading", { name: "Local instrumentation", exact: true })
    .waitFor();
  assert.match(
    await directoryPage.locator("#setup").innerText(),
    /not evidence of Linear assignment/,
  );
  assert.match(await directoryPage.locator("#setup").innerText(), /Unverified/);
  await directoryPage.setViewportSize({ width: 320, height: 700 });
  assert(await directoryPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  if (process.env.ADMIN_SCREENSHOT_DIR)
    await directoryPage.screenshot({
      path: join(process.env.ADMIN_SCREENSHOT_DIR, "my-setup-mobile.png"),
      fullPage: true,
    });
  assert.deepEqual(directoryErrors, []);
  await reader.close();
  for (const [mode, subject, expected] of [
    ["missing", "synthetic-browser", "Directory connection missing"],
    ["unavailable", "synthetic-browser", "Directory source unavailable"],
    ["ready", "unbound-browser", "Access denied"],
    ["empty", "synthetic-browser", "No Credentials in authorized inventory"],
  ]) {
    const fixtureContext = await browser.newContext({
      extraHTTPHeaders: {
        "Cf-Access-Jwt-Assertion": await jwt("synthetic-read", subject),
        "X-Synthetic-Directory": mode,
      },
    });
    const fixturePage = await fixtureContext.newPage();
    await fixturePage.goto(base + "/v1/workspace/credentials");
    await fixturePage.waitForFunction(
      (expected) => document.getElementById("status").textContent.includes(expected),
      expected,
    );
    assert.equal(await fixturePage.locator("#inventory article").count(), 0);
    await fixtureContext.close();
  }
  console.log(
    "PASS: scoped credential search, detail consumers, keyboard focus, developer setup, mobile reflow and distinct missing/denied/unavailable/empty states through fixture directory service",
  );
  // Isolated synthetic Event Ledger only. No production append endpoint is introduced.
  assert.equal((await fetch(base + "/__fixture/calendar-seed")).status, 200);
  const workContext = await browser.newContext({
    extraHTTPHeaders: { "Cf-Access-Jwt-Assertion": await jwt("synthetic-read") },
  });
  const work = await workContext.newPage();
  await work.goto(base + "/v1/workspace/calendar");
  assert.equal(await work.locator("article").count(), 2);
  assert.match(await work.locator("main").innerText(), /actor:fixture/);
  assert.match(await work.locator("main").innerText(), /Unattributed/);
  await work.getByLabel("Bucket", { exact: true }).selectOption("day");
  await work.getByLabel("Actor kind", { exact: true }).selectOption("human");
  await work.getByLabel("Day", { exact: true }).fill("2026-11-20");
  const applyFilters = work.getByRole("button", { name: "Apply filters", exact: true });
  await applyFilters.focus();
  assert.equal(await applyFilters.evaluate((node) => node === document.activeElement), true);
  await work.keyboard.press("Enter");
  await work.waitForURL(/day=2026-11-20/);
  assert.equal(await work.locator("article").count(), 1);
  assert.match(await work.locator("article").innerText(), /Synthetic reviewed implementation/);
  await work.getByText("Evidence and Provenance", { exact: true }).click();
  assert.equal(
    await work.getByRole("link", { name: "Source link", exact: true }).getAttribute("href"),
    "https://example.test/evidence",
  );
  await work.reload();
  assert.equal(await work.getByLabel("Day", { exact: true }).inputValue(), "2026-11-20");
  if (process.env.ADMIN_SCREENSHOT_DIR)
    await work.screenshot({
      path: join(process.env.ADMIN_SCREENSHOT_DIR, "calendar-desktop.png"),
      fullPage: true,
    });
  await work.setViewportSize({ width: 320, height: 740 });
  assert(await work.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  if (process.env.ADMIN_SCREENSHOT_DIR)
    await work.screenshot({
      path: join(process.env.ADMIN_SCREENSHOT_DIR, "calendar-mobile.png"),
      fullPage: true,
    });
  assert.equal((await work.request.get(base + "/v1/admin/runners/config")).status(), 401);
  await workContext.close();
  const fleetContext = await browser.newContext({
    extraHTTPHeaders: { "Cf-Access-Jwt-Assertion": await jwt("synthetic-admin") },
  });
  const fleet = await fleetContext.newPage();
  await fleet.goto(base + "/v1/admin/runners");
  await fleet.getByLabel("Machine ID", { exact: true }).fill("fixture-pc");
  await fleet.getByLabel("Alias", { exact: true }).fill("Fixture PC");
  await fleet.getByLabel("Repository scope", { exact: true }).fill("Zero-State-LLC/fixture");
  await fleet.getByLabel("Operating system", { exact: true }).selectOption("windows");
  await fleet.getByRole("button", { name: "Review request", exact: true }).click();
  assert.match(await fleet.locator("#review-text").innerText(), /Desired mode: enabled/);
  await fleet.getByRole("button", { name: "Save desired configuration", exact: true }).click();
  await fleet.getByRole("button", { name: "Edit Fixture PC", exact: true }).waitFor();
  await fleet.waitForFunction(() => !document.getElementById("fields").disabled);
  await fleet.getByRole("button", { name: "New machine", exact: true }).click();
  await fleet.getByLabel("Machine ID", { exact: true }).fill("fixture-mac");
  await fleet.getByLabel("Alias", { exact: true }).fill("Fixture Mac");
  await fleet.getByLabel("Machine kind", { exact: true }).selectOption("mac");
  await fleet.getByLabel("Architecture", { exact: true }).selectOption("arm64");
  await fleet.getByLabel("Repository scope", { exact: true }).fill("Zero-State-LLC/fixture");
  await fleet.getByRole("button", { name: "Review request", exact: true }).click();
  await fleet.getByRole("button", { name: "Save desired configuration", exact: true }).click();
  await fleet.getByRole("button", { name: "Edit Fixture Mac", exact: true }).waitFor();
  await fleet.reload();
  await fleet.getByRole("button", { name: "Edit Fixture PC", exact: true }).waitFor();
  const fleetData = await (await fleet.request.get(base + "/v1/admin/runners/config")).json();
  assert.equal(fleetData.config.revision, 2);
  assert.equal(fleetData.config.machines.length, 2);
  assert.equal(fleetData.observedState, "unknown");
  assert.equal(fleetData.requestStatus, "pending");
  // Edit a persisted machine, explicitly review enabled -> maintenance, then read back.
  await fleet.getByRole("button", { name: "Edit Fixture PC", exact: true }).click();
  assert.equal(await fleet.getByLabel("Machine ID", { exact: true }).inputValue(), "fixture-pc");
  assert.equal(await fleet.getByLabel("Desired mode", { exact: true }).inputValue(), "enabled");
  await fleet.getByLabel("Desired mode", { exact: true }).selectOption("maintenance");
  await fleet.getByRole("button", { name: "Review request", exact: true }).click();
  assert.match(await fleet.locator("#review-text").innerText(), /Desired mode: maintenance/);
  assert.equal(
    (await (await fleet.request.get(base + "/v1/admin/runners/config")).json()).config.revision,
    2,
  );
  await fleet.getByRole("button", { name: "Save desired configuration", exact: true }).click();
  await fleet.waitForFunction(() =>
    document.getElementById("status").textContent.includes("Readback confirmed"),
  );
  const maintained = (await (await fleet.request.get(base + "/v1/admin/runners/config")).json())
    .config;
  assert.equal(maintained.revision, 3);
  assert.deepEqual(
    maintained.machines,
    fleetData.config.machines.map((m) =>
      m.id === "fixture-pc" ? { ...m, desiredState: "maintenance" } : m,
    ),
  );
  assert.match(await fleet.locator("#fleet").innerText(), /Desired: maintenance/);

  // Another operator changes fields while this operator holds a stale reviewed draft.
  await fleet.getByRole("button", { name: "Edit Fixture PC", exact: true }).click();
  await fleet.getByLabel("Alias", { exact: true }).fill("Stale PC draft");
  await fleet.getByLabel("Desired mode", { exact: true }).selectOption("enabled");
  await fleet.getByRole("button", { name: "Review request", exact: true }).click();
  const latest = {
    ...maintained,
    revision: 4,
    machines: maintained.machines.map((m) =>
      m.id === "fixture-pc"
        ? {
            ...m,
            alias: "Current PC",
            repository: "Zero-State-LLC/current",
            labels: ["current-only"],
          }
        : m,
    ),
  };
  assert.equal(
    (
      await fleet.request.put(base + "/v1/admin/runners/config", {
        headers: { "If-Match": '"3"' },
        data: latest,
      })
    ).status(),
    200,
  );
  const runnerWrites = [];
  fleet.on("response", (response) => {
    if (
      response.url() === base + "/v1/admin/runners/config" &&
      response.request().method() === "PUT"
    )
      runnerWrites.push(response.status());
  });
  await fleet.getByRole("button", { name: "Save desired configuration", exact: true }).click();
  await fleet.waitForFunction(() =>
    document.getElementById("status").textContent.includes("Unsaved draft discarded"),
  );
  assert.deepEqual(runnerWrites, [409]);
  assert.match(await fleet.locator("#status").innerText(), /No request was retried/);
  assert.equal(await fleet.locator("#review").isHidden(), true);
  assert.equal(await fleet.getByLabel("Alias", { exact: true }).inputValue(), "Current PC");
  assert.equal(
    await fleet.getByLabel("Repository scope", { exact: true }).inputValue(),
    "Zero-State-LLC/current",
  );
  assert.equal(
    await fleet.getByLabel("Labels (comma separated)", { exact: true }).inputValue(),
    "current-only",
  );
  assert.equal(await fleet.getByLabel("Desired mode", { exact: true }).inputValue(), "maintenance");
  assert.deepEqual(
    (await (await fleet.request.get(base + "/v1/admin/runners/config")).json()).config,
    latest,
  );
  // A fresh manual intent must retain the other operator's latest configuration.
  await fleet.getByLabel("Desired mode", { exact: true }).selectOption("enabled");
  await fleet.getByRole("button", { name: "Review request", exact: true }).click();
  assert.match(await fleet.locator("#review-text").innerText(), /Current PC/);
  assert.match(await fleet.locator("#review-text").innerText(), /current-only/);
  await fleet.getByRole("button", { name: "Save desired configuration", exact: true }).click();
  await fleet.waitForFunction(() =>
    document.getElementById("status").textContent.includes("Readback confirmed"),
  );
  assert.deepEqual(runnerWrites, [409, 200]);
  assert.deepEqual(
    (await (await fleet.request.get(base + "/v1/admin/runners/config")).json()).config,
    {
      ...latest,
      revision: 5,
      machines: latest.machines.map((m) =>
        m.id === "fixture-pc" ? { ...m, desiredState: "enabled" } : m,
      ),
    },
  );
  console.log(
    "PASS: persisted runner edit and maintenance review; conflict readback discards stale draft, preserves concurrent configuration and never automatically retries",
  );
  if (process.env.ADMIN_SCREENSHOT_DIR)
    await fleet.screenshot({
      path: join(process.env.ADMIN_SCREENSHOT_DIR, "runners-desktop.png"),
      fullPage: true,
    });
  await fleet.setViewportSize({ width: 320, height: 740 });
  assert(await fleet.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  if (process.env.ADMIN_SCREENSHOT_DIR)
    await fleet.screenshot({
      path: join(process.env.ADMIN_SCREENSHOT_DIR, "runners-mobile.png"),
      fullPage: true,
    });
  // Machine-scoped controller calls exercise only the local fixture fleet.
  const serviceName = "fixture-controller.access";
  const principalDigest = createHash("sha256")
    .update("https://synthetic.cloudflareaccess.com\nservice:" + serviceName)
    .digest("hex");
  const bindingResponse = await fleet.request.put(
    base + "/v1/admin/runners/binding?machineId=fixture-pc",
    {
      headers: { "If-Match": '"0"' },
      data: {
        revision: 1,
        principalDigest,
        evidenceRef: "synthetic-reviewed-binding",
        enabled: true,
      },
    },
  );
  assert.equal(bindingResponse.status(), 200);
  const controllerToken = await new SignJWT({
    type: "app",
    sub: "",
    common_name: serviceName,
    iss: "https://synthetic.cloudflareaccess.com",
    aud: "synthetic-controller",
  })
    .setProtectedHeader({ alg: "RS256", kid: "local-browser" })
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(privateKey);
  const host = await browser.newContext({
    extraHTTPHeaders: { "Cf-Access-Jwt-Assertion": controllerToken },
  });
  const command = await (
    await host.request.get(base + "/v1/runner-controller/poll?machineId=fixture-pc")
  ).json();
  assert.equal(command.machineId, "fixture-pc");
  assert.equal(command.revision, 5);
  assert.equal(command.desiredState, "enabled");
  assert.equal(
    (await host.request.get(base + "/v1/runner-controller/poll?machineId=fixture-mac")).status(),
    403,
  );
  assert.equal(
    (await fleet.request.get(base + "/v1/runner-controller/poll?machineId=fixture-pc")).status(),
    401,
  );
  const report = {
    reportId: crypto.randomUUID(),
    operationId: command.operationId,
    revision: command.revision,
    observedAt: new Date().toISOString(),
    listener: "running",
    job: "idle",
    acceptingJobs: true,
  };
  const reported = await host.request.post(
    base + "/v1/runner-controller/report?machineId=fixture-pc",
    { data: report },
  );
  assert.equal(reported.status(), 200);
  const receipt = await reported.json();
  assert.deepEqual(
    await (
      await host.request.post(base + "/v1/runner-controller/report?machineId=fixture-pc", {
        data: report,
      })
    ).json(),
    receipt,
  );
  await fleet.reload();
  await fleet.waitForFunction(() =>
    document
      .getElementById("fleet")
      .textContent.includes("Host-reported evidence: fresh · Operation: complete"),
  );
  assert.match(await fleet.locator("#fleet").innerText(), /Received at:/);
  if (process.env.ADMIN_SCREENSHOT_DIR)
    await fleet.screenshot({
      path: join(process.env.ADMIN_SCREENSHOT_DIR, "runner-host-evidence.png"),
      fullPage: true,
    });
  // Expiry must update an already open tab, without a reload or newer report.
  await fleet.clock.install();
  await fleet.reload();
  await fleet.waitForFunction(() =>
    document.getElementById("fleet").textContent.includes("fresh · Operation: complete"),
  );
  await fleet.clock.fastForward(121000);
  assert.match(await fleet.locator("#fleet").innerText(), /stale · Operation: unknown/);
  let state = { accepted: null, outbox: null },
    firstReceipt,
    retryReceipt,
    sends = 0,
    observations = 0;
  const journal = {
    load: async () => structuredClone(state),
    save: async (value) => {
      state = structuredClone(value);
    },
  };
  const unexpected = async () => {
    throw new Error("unexpected host effect");
  };
  const options = {
    machineId: "fixture-pc",
    journal,
    adapter: {
      observe: async () => {
        observations++;
        return { listener: "running", job: "idle", acceptingJobs: true };
      },
      start: unexpected,
      stop: unexpected,
      closeAdmission: unexpected,
      openAdmission: unexpected,
    },
    transport: {
      poll: async () =>
        (await host.request.get(base + "/v1/runner-controller/poll?machineId=fixture-pc")).json(),
      report: async (value) => {
        const response = await host.request.post(
          base + "/v1/runner-controller/report?machineId=fixture-pc",
          { data: value },
        );
        assert.equal(response.status(), 200);
        const receipt = await response.json();
        if (++sends === 1) {
          firstReceipt = receipt;
          throw new Error("synthetic lost acknowledgement");
        }
        retryReceipt = receipt;
        return receipt;
      },
    },
  };
  assert.deepEqual(await createController(options).reconcile(), {
    ok: false,
    code: "transport_failed",
  });
  assert.ok(state.outbox);
  assert.equal((await createController(options).reconcile()).ok, true);
  assert.deepEqual(retryReceipt, firstReceipt);
  assert.equal(state.outbox, null);
  assert.equal(observations, 1);
  console.log(
    "PASS: open-page evidence expiry and real core/server lost-acknowledgement receipt compatibility",
  );
  const revoke = await fleet.request.put(base + "/v1/admin/runners/binding?machineId=fixture-pc", {
    headers: { "If-Match": '"1"' },
    data: { revision: 2, principalDigest, evidenceRef: "synthetic-revocation", enabled: false },
  });
  assert.equal(revoke.status(), 200);
  assert.equal(
    (
      await host.request.post(base + "/v1/runner-controller/report?machineId=fixture-pc", {
        data: report,
      })
    ).status(),
    403,
  );
  // Reviewed lifecycle controls operate against the same isolated Worker fixture.
  await fleet.clock.resume();
  await fleet.reload();
  const pc = fleet.locator('article.machine[data-machine-id="fixture-pc"]');
  await pc.getByRole("button", { name: "Enroll/Reconnect", exact: true }).click();
  await fleet.locator("#enrollment-digest").fill(principalDigest);
  await fleet.locator("#enrollment-evidence").fill("synthetic-local-enrollment");
  await fleet.locator("#lifecycle-confirm").click();
  await fleet.waitForFunction(() =>
    document
      .querySelector('[data-machine-id="fixture-pc"]')
      ?.textContent.includes("Connection: unknown"),
  );
  const bindingAfter = await (
    await fleet.request.get(base + "/v1/admin/runners/binding?machineId=fixture-pc")
  ).json();
  assert.equal(bindingAfter.revision, 3);
  assert.equal(bindingAfter.binding.enabled, true);
  const perform = async (action) => {
    await pc.getByRole("button", { name: action, exact: true }).click();
    await fleet.locator("#lifecycle-confirm").click();
    await fleet.waitForFunction(
      () =>
        document.getElementById("lifecycle-review").hidden &&
        !document.getElementById("reload").disabled,
    );
  };
  const lifecycleURL = base + "/v1/admin/runners/lifecycle?machineId=fixture-pc";
  await fleet.route("**/v1/admin/runners/lifecycle?machineId=fixture-pc", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    const committed = await route.fetch();
    assert.equal(
      committed.status(),
      200,
      JSON.stringify({ request: route.request().postDataJSON(), response: await committed.text() }),
    );
    await route.abort("failed");
  });
  await perform("Resume");
  await fleet.unroute("**/v1/admin/runners/lifecycle?machineId=fixture-pc");
  let operations = await (await fleet.request.get(lifecycleURL)).json();
  assert.equal(operations.history.filter((x) => x.action === "resume").length, 1);
  await fleet.route("**/v1/admin/runners/lifecycle?machineId=fixture-pc", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    const competing = await route.fetch();
    assert.equal(
      competing.status(),
      200,
      JSON.stringify({ request: route.request().postDataJSON(), response: await competing.text() }),
    );
    await route.continue();
  });
  await perform("Drain");
  await fleet.unroute("**/v1/admin/runners/lifecycle?machineId=fixture-pc");
  operations = await (await fleet.request.get(lifecycleURL)).json();
  assert.equal(operations.history.filter((x) => x.action === "drain").length, 1);
  const draining = await (
    await host.request.get(base + "/v1/runner-controller/poll?machineId=fixture-pc")
  ).json();
  assert.equal(draining.desiredState, "maintenance");
  const sendState = async (listener, job, acceptingJobs) => {
    const response = await host.request.post(
      base + "/v1/runner-controller/report?machineId=fixture-pc",
      {
        data: {
          reportId: crypto.randomUUID(),
          operationId: draining.operationId,
          revision: draining.revision,
          observedAt: new Date().toISOString(),
          listener,
          job,
          acceptingJobs,
        },
      },
    );
    assert.equal(response.status(), 200);
  };
  await sendState("running", "busy", false);
  await fleet.reload();
  await perform("Disconnect");
  await pc.getByRole("button", { name: "Finish disconnect", exact: true }).waitFor();
  assert.equal(
    await pc.getByRole("button", { name: "Finish disconnect", exact: true }).isEnabled(),
    false,
  );
  assert.equal(
    (await host.request.get(base + "/v1/runner-controller/poll?machineId=fixture-pc")).status(),
    200,
  );
  await sendState("stopped", "idle", false);
  await fleet.reload();
  await perform("Finish disconnect");
  assert.equal(
    (await host.request.get(base + "/v1/runner-controller/poll?machineId=fixture-pc")).status(),
    403,
  );
  const lifecycle = await (
    await fleet.request.get(base + "/v1/admin/runners/lifecycle?machineId=fixture-pc")
  ).json();
  assert.equal(lifecycle.connectionState, "revoked");
  assert.equal(lifecycle.history.at(-1).outcome, "revoked");
  assert.equal(lifecycle.history.filter((x) => x.action === "disconnect").length, 2);
  // A failed or mixed-revision lifecycle snapshot must block every mutation.
  const lifecyclePattern = "**/v1/admin/runners/lifecycle?machineId=fixture-pc";
  await fleet.route(lifecyclePattern, (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: '{"error":"synthetic_unavailable"}',
    }),
  );
  await fleet.reload();
  await fleet.waitForFunction(
    () =>
      document.getElementById("fields").disabled &&
      document.getElementById("fleet").textContent.includes("readback unavailable"),
  );
  assert.doesNotMatch(await pc.innerText(), /Operation: complete/);
  assert.equal(
    await pc.getByRole("button", { name: "Enroll/Reconnect", exact: true }).isEnabled(),
    false,
  );
  await fleet.unroute(lifecyclePattern);
  await fleet.getByRole("button", { name: "Read back configuration", exact: true }).click();
  await fleet.waitForFunction(() => !document.getElementById("fields").disabled);
  await fleet.route(lifecyclePattern, async (route) => {
    const before = await (await fleet.request.get(base + "/v1/admin/runners/config")).json();
    const updated = {
      ...before.config,
      revision: before.config.revision + 1,
      machines: before.config.machines.map((m) =>
        m.id === "fixture-pc" ? { ...m, repository: "Zero-State-LLC/concurrent-scope" } : m,
      ),
    };
    const concurrent = await fleet.request.put(base + "/v1/admin/runners/config", {
      headers: { "If-Match": '"' + before.config.revision + '"' },
      data: updated,
    });
    assert.equal(concurrent.status(), 200);
    await route.continue();
  });
  await fleet.reload();
  await fleet.waitForFunction(
    () =>
      document.getElementById("fields").disabled &&
      document.getElementById("fleet").textContent.includes("readback unavailable"),
  );
  assert.equal(
    await pc.getByRole("button", { name: "Enroll/Reconnect", exact: true }).isEnabled(),
    false,
  );
  await fleet.unroute(lifecyclePattern);
  await fleet.getByRole("button", { name: "Read back configuration", exact: true }).click();
  await fleet.waitForFunction(() => !document.getElementById("fields").disabled);
  assert.match(await pc.innerText(), /Zero-State-LLC\/concurrent-scope/);
  console.log(
    "PASS: lifecycle read failures and mixed configuration revisions disable mutations until fresh consistent readback",
  );
  if (process.env.ADMIN_SCREENSHOT_DIR)
    await fleet.screenshot({
      path: join(process.env.ADMIN_SCREENSHOT_DIR, "runner-lifecycle-mobile.png"),
      fullPage: true,
    });
  console.log(
    "PASS: reviewed reconnect, drain, busy disconnect pending and fresh stopped finalization preserve operation audit",
  );
  await host.close();
  console.log(
    "PASS: exact workload scope, durable duplicate host receipt, operator host-evidence view and immediate revocation",
  );
  // A monitored machine has no runner fields, no desired mode and no lifecycle controls.
  await fleet.getByRole("button", { name: "New machine", exact: true }).click();
  await fleet.getByLabel("Machine ID", { exact: true }).fill("fixture-spark");
  await fleet.getByLabel("Alias", { exact: true }).fill("Fixture Spark");
  await fleet.getByLabel("Machine kind", { exact: true }).selectOption("spark");
  assert.equal(await fleet.getByLabel("Operating system", { exact: true }).inputValue(), "linux");
  assert.equal(await fleet.getByLabel("Architecture", { exact: true }).inputValue(), "arm64");
  await fleet.getByLabel("Role", { exact: true }).selectOption("monitored");
  assert.equal(await fleet.getByLabel("Repository scope", { exact: true }).isDisabled(), true);
  assert.equal(await fleet.getByLabel("Desired mode", { exact: true }).isDisabled(), true);
  await fleet.getByRole("button", { name: "Review request", exact: true }).click();
  assert.match(await fleet.locator("#review-text").innerText(), /Monitored only/);
  await fleet.getByRole("button", { name: "Save desired configuration", exact: true }).click();
  await fleet.getByRole("button", { name: "Edit Fixture Spark", exact: true }).waitFor();
  const monitored = (await (await fleet.request.get(base + "/v1/admin/runners/config")).json())
    .config;
  assert.equal(monitored.version, 2);
  assert.deepEqual(monitored.machines.at(-1), {
    id: "fixture-spark",
    alias: "Fixture Spark",
    kind: "spark",
    os: "linux",
    architecture: "arm64",
  });
  const spark = fleet.locator('article[data-machine-id="fixture-spark"]');
  assert.match(await spark.innerText(), /Monitored only/);
  assert.equal(await spark.getByRole("button").count(), 1);
  assert.equal(
    (
      await fleet.request.get(base + "/v1/admin/runners/lifecycle?machineId=fixture-spark")
    ).status(),
    404,
  );
  // A runner machine cannot become monitored only.
  await fleet
    .locator('article[data-machine-id="fixture-pc"]')
    .getByRole("button", { name: /^Edit / })
    .click();
  await fleet.getByLabel("Role", { exact: true }).selectOption("monitored");
  await fleet.getByRole("button", { name: "Review request", exact: true }).click();
  assert.match(await fleet.locator("#status").innerText(), /keeps its runner settings/);
  assert.equal(await fleet.locator("#review").isHidden(), true);
  console.log(
    "PASS: a monitored DGX Spark saves without runner fields or lifecycle controls, and a runner cannot become monitored only",
  );
  await fleetContext.close();
  console.log(
    "PASS: real ledger calendar evidence, Pacific day filters and URLs; PC/Mac durable fleet review/readback, pending maintenance, denied reader access and mobile reflow",
  );
} finally {
  await browser?.close();
  child.kill("SIGTERM");
  const force = setTimeout(() => child.kill("SIGKILL"), 3000);
  await exited;
  clearTimeout(force);
  rmSync(temp, { recursive: true, force: true });
}
