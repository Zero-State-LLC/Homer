import { runInDurableObject } from "cloudflare:test";
import { openEventLedger } from "@zs-home/event-ledger";
import { event } from "../../event-ledger/test/fixture.js";
import { env as bindings } from "cloudflare:workers";
import { beforeAll, beforeEach, expect, it } from "vitest";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWTVerifyGetKey } from "jose";
import { handleRequest, type Env } from "../src/index.js";
let env: typeof bindings;
beforeEach(() => {
  const ledgerId = bindings.EVENT_LEDGER.newUniqueId();
  env = {
    ...bindings,
    EVENT_LEDGER: {
      get: (id, options) => bindings.EVENT_LEDGER.get(id, options),
      idFromName: () => ledgerId,
      newUniqueId: (options) => bindings.EVENT_LEDGER.newUniqueId(options),
      idFromString: (id) => bindings.EVENT_LEDGER.idFromString(id),
      getByName: () => bindings.EVENT_LEDGER.get(ledgerId),
      jurisdiction: (value) => bindings.EVENT_LEDGER.jurisdiction(value),
    },
  };
});
let key: JWTVerifyGetKey;
let jwt: string;
const config = {
  ACCESS_ISSUER: "https://synthetic.cloudflareaccess.com",
  ACCESS_READ_AUD: "synthetic-read",
  ACCESS_ADMIN_AUD: "synthetic-admin",
  CATALOG_NAME: "calendar-test",
};
beforeAll(async () => {
  const keys = await generateKeyPair("RS256");
  const jwk = await exportJWK(keys.publicKey);
  jwk.kid = "calendar";
  key = createLocalJWKSet({ keys: [jwk] });
  jwt = await new SignJWT({ type: "app", sub: "synthetic-reader" })
    .setProtectedHeader({ alg: "RS256", kid: "calendar" })
    .setIssuer(config.ACCESS_ISSUER)
    .setAudience(config.ACCESS_READ_AUD)
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(keys.privateKey);
});
const request = (path: string, authenticated = true, e: Env = { ...env, ...config }) =>
  handleRequest(
    new Request(`https://homer.example${path}`, {
      headers: authenticated ? { "Cf-Access-Jwt-Assertion": jwt } : {},
    }),
    e,
    key,
  );
it("requires read authentication for the calendar and distinguishes empty verified history", async () => {
  for (const path of ["/v1/calendar", "/v1/workspace/calendar", "/v1/workspace/calendar.css"])
    expect((await request(path, false)).status).toBe(401);
  const response = await request("/v1/calendar");
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    state: "empty",
    head: null,
    observedEvents: 0,
    buckets: [],
    filters: { timeZone: "America/Los_Angeles", bucket: "day" },
  });
});
it("rejects invalid or ambiguous calendar filters", async () => {
  for (const query of [
    "timeZone=Moon/Base",
    "bucket=year",
    "actorId=alice",
    "projectId=bad",
    "actorKind=bot",
    "day=2026-02-30",
    "bucket=day&bucket=month",
    "limit=10",
  ]) {
    const response = await request(`/v1/calendar?${query}`);
    expect(response.status, query).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_calendar_filters" });
  }
});
it("projects corrected verified history with Pacific day, Project and Actor filters", async () => {
  const ledger = openEventLedger(env.EVENT_LEDGER);
  const original = {
    ...event("calendar-corrected"),
    occurredAt: "2026-11-19T01:00:00Z",
    actor: { sourceAccount: "agent-account", actorId: "actor:codex", actorKind: "agent" as const },
  };
  expect((await ledger.appendActivityEvent(original)).outcome).toBe("appended");
  expect(
    (
      await ledger.appendCorrection({
        contract: "home.correction/v1",
        correctionId: "calendar-fix",
        targetEventKey: original.eventKey,
        action: "supersede",
        reason: "Source corrected subject",
        replacement: { ...original, subject: "Corrected work" },
        provenance: original.provenance,
      })
    ).outcome,
  ).toBe("appended");
  expect(
    (
      await ledger.appendActivityEvent({
        ...event("calendar-other-day"),
        occurredAt: "2026-11-20T12:00:00Z",
      })
    ).outcome,
  ).toBe("appended");
  const result = await (
    await request(
      "/v1/calendar?day=2026-11-18&projectId=project:fixture&actorKind=agent&actorId=actor:codex",
    )
  ).json();
  expect(result).toMatchObject({
    observedEvents: 1,
    head: { sequence: 3 },
    buckets: [
      {
        key: "2026-11-18",
        events: [
          {
            subject: "Corrected work",
            occurredAt: "2026-11-19T01:00:00Z",
            actor: { actorId: "actor:codex", actorKind: "agent" },
          },
        ],
      },
    ],
  });
  expect(await (await request("/v1/calendar?day=2026-11-21")).json()).toMatchObject({
    state: "empty",
    observedEvents: 0,
    buckets: [],
  });
  expect(await (await request("/v1/calendar?actorKind=unattributed")).json()).toMatchObject({
    observedEvents: 1,
    buckets: [{ events: [{ actor: { sourceAccount: "synthetic-account" } }] }],
  });
});
it("reports unavailable and oversized Event Ledgers without a fabricated empty success", async () => {
  const unavailable = { ...env, ...config };
  Reflect.deleteProperty(unavailable, "EVENT_LEDGER");
  expect((await request("/v1/calendar", true, unavailable)).status).toBe(503);
  const oversized = {
    ...env,
    ...config,
    EVENT_LEDGER: {
      idFromName: () => "synthetic",
      get: () => ({
        head: () => Promise.resolve({ sequence: 2001, entryDigest: "a".repeat(64) }),
        readHistory: () => Promise.reject(new Error("must not read oversized ledger")),
      }),
    },
  } as unknown as Env;
  const response = await request("/v1/calendar", true, oversized);
  expect(response.status).toBe(413);
  expect(await response.json()).toEqual({ error: "calendar_history_too_large" });
});
it("refuses corrupt Event Ledger history", async () => {
  await openEventLedger(env.EVENT_LEDGER).appendActivityEvent(event("corrupt-calendar"));
  const stub = env.EVENT_LEDGER.get(env.EVENT_LEDGER.idFromName("event-ledger"));
  await runInDurableObject(stub, (_object, state) => {
    state.storage.sql.exec("DROP TRIGGER entries_no_update");
    state.storage.sql.exec(
      "UPDATE entries SET entry_digest = ? WHERE sequence = 1",
      "a".repeat(64),
    );
  });
  const response = await request("/v1/calendar");
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ error: "calendar_unavailable" });
});
it("renders source text safely with HTTP(S) evidence, URL filters, and honest coverage", async () => {
  expect(
    (
      await openEventLedger(env.EVENT_LEDGER).appendActivityEvent({
        ...event("unsafe-link"),
        evidence: [{ label: "Unsafe evidence", url: "javascript:alert(1)" }],
      })
    ).outcome,
  ).toBe("refused");
  const unsafe = {
    ...event("calendar-html"),
    subject: '<script>alert("source")</script>',
    evidence: [{ label: "Verified source", url: "https://example.test/proof" }],
  };
  expect((await openEventLedger(env.EVENT_LEDGER).appendActivityEvent(unsafe)).outcome).toBe(
    "appended",
  );
  const response = await request("/v1/workspace/calendar?actorKind=unattributed");
  expect(response.headers.get("Content-Type")).toContain("text/html");
  const html = await response.text();
  expect(html).toContain("&lt;script&gt;");
  expect(html).not.toContain("<script>alert");
  expect(html).not.toContain('href="javascript:');
  expect(html).toContain('href="https://example.test/proof"');
  expect(html).toContain("Unattributed");
  expect(html).toContain("observed Activity Events");
  expect(html).toContain('name="timeZone"');
  expect(html).toContain('method="get"');
  expect(html).toContain("Source Freshness: Unknown");
  expect(response.headers.get("Content-Security-Policy")).toContain("form-action 'self'");
  const unavailable = { ...env, ...config };
  Reflect.deleteProperty(unavailable, "EVENT_LEDGER");
  const failed = await request("/v1/workspace/calendar", true, unavailable);
  expect(failed.status).toBe(503);
  expect(await failed.text()).toContain("Calendar unavailable");
});
it("pins reads to the original verified prefix while later events arrive", async () => {
  const ledger = openEventLedger(env.EVENT_LEDGER);
  await ledger.appendActivityEvent(event("prefix-one"));
  const first = await ledger.head();
  await ledger.appendActivityEvent(event("prefix-two"));
  let calls = 0;
  const e = {
    ...env,
    ...config,
    EVENT_LEDGER: {
      idFromName: () => "synthetic",
      get: () => ({
        head: () => (++calls === 1 ? Promise.resolve(first) : ledger.head()),
        readHistory: (options: { throughSequence: number }) => ledger.readHistory(options),
      }),
    },
  } as unknown as Env;
  expect(await (await request("/v1/calendar", true, e)).json()).toMatchObject({
    head: { sequence: 1 },
    observedEvents: 1,
    buckets: [{ events: [{ eventKey: "github:commit.pushed:synthetic/prefix-one" }] }],
  });
});
it("applies retractions and projects week and month without changing UTC instants", async () => {
  const ledger = openEventLedger(env.EVENT_LEDGER);
  const e = event("retracted");
  await ledger.appendActivityEvent(e);
  await ledger.appendCorrection({
    contract: "home.correction/v1",
    correctionId: "retract-calendar",
    targetEventKey: e.eventKey,
    action: "retract",
    reason: "Source retracted event",
    provenance: e.provenance,
  });
  await ledger.appendActivityEvent(event("remaining"));
  expect(await (await request("/v1/calendar?bucket=week&timeZone=UTC")).json()).toMatchObject({
    observedEvents: 1,
    buckets: [{ key: "2026-11-16", events: [{ occurredAt: "2026-11-18T23:01:02.123456789Z" }] }],
  });
  expect(await (await request("/v1/calendar?bucket=month")).json()).toMatchObject({
    observedEvents: 1,
    buckets: [{ key: "2026-11" }],
  });
});
