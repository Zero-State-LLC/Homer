// Explicit local-only browser qualification. Requires Playwright and a Chromium executable.
import assert from "node:assert/strict";
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
  `import {handleRequest} from ${JSON.stringify(resolve("packages/catalog-worker/src/index.ts"))};
export {MappingCatalogObject} from ${JSON.stringify(resolve("packages/catalog-worker/src/index.ts"))};
import {createLocalJWKSet} from ${JSON.stringify(require.resolve("jose"))};
const key=createLocalJWKSet({keys:[${JSON.stringify(jwk)}]});
export default {fetch(request, env){
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
    },
    services: [{ binding: "CREDENTIAL_DIRECTORY", service: "homer-directory-fixture" }],
    durable_objects: {
      bindings: [{ name: "MAPPING_CATALOG", class_name: "MappingCatalogObject" }],
    },
    migrations: [{ tag: "v1", new_sqlite_classes: ["MappingCatalogObject"] }],
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
    assert.equal(committed.status(), 200);
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
} finally {
  await browser?.close();
  child.kill("SIGTERM");
  const force = setTimeout(() => child.kill("SIGKILL"), 3000);
  await exited;
  clearTimeout(force);
  rmSync(temp, { recursive: true, force: true });
}
