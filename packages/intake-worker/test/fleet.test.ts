import { env } from "cloudflare:workers";
import { beforeAll, expect, it } from "vitest";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWTVerifyGetKey } from "jose";
import { openEventLedger } from "@zs-home/event-ledger";
import {
  handleRequest as handleCatalogRequest,
  type Env as CatalogEnv,
} from "@zs-home/catalog-worker";
import { verifyAccessIdentity } from "@zs-home/catalog-worker/access";
import { handleRequest as handleIntakeRequest, type IntakeEnv } from "../src/index.js";

// Fleet intake spans both Workers (ADR 013): an admin binds the Fleet
// Collector in the catalog, and the Collector posts its reports to intake.
type FleetTestEnv = CatalogEnv & IntakeEnv;
const ISSUER = "https://synthetic.cloudflareaccess.com";
const T0 = Date.parse("2026-11-24T17:58:00Z");
let key: JWTVerifyGetKey;
let admin: string;
let collector: string;
let otherCollector: string;
let controller: string;
let person: string;
let collectorDigest: string;

beforeAll(async () => {
  const keys = await generateKeyPair("RS256");
  key = createLocalJWKSet({ keys: [{ ...(await exportJWK(keys.publicKey)), kid: "test" }] });
  const token = (aud: string, claims: Record<string, unknown>) =>
    new SignJWT({ type: "app", ...claims })
      .setIssuer(ISSUER)
      .setAudience(aud)
      .setIssuedAt()
      .setExpirationTime("5m")
      .setProtectedHeader({ alg: "RS256", kid: "test" })
      .sign(keys.privateKey);
  const workload = (commonName: string) => ({ sub: "", common_name: commonName });
  admin = await token("admin", { sub: "operator" });
  collector = await token("fleet", workload("collector.access"));
  otherCollector = await token("fleet", workload("other.access"));
  controller = await token("controller", workload("collector.access"));
  person = await token("fleet", { sub: "operator" });
  const config = {
    ACCESS_ISSUER: ISSUER,
    ACCESS_READ_AUD: "read",
    ACCESS_ADMIN_AUD: "admin",
    CATALOG_NAME: "x",
  };
  collectorDigest = (
    await verifyAccessIdentity(
      await token("admin", workload("collector.access")),
      config,
      true,
      key,
    )
  ).principal;
});

function testEnv(): FleetTestEnv {
  // Each test has its own ledger; production keeps its established singleton name.
  const ledgerId = env.EVENT_LEDGER.newUniqueId();
  return {
    ...env,
    ACCESS_ISSUER: ISSUER,
    ACCESS_READ_AUD: "read",
    ACCESS_ADMIN_AUD: "admin",
    RUNNER_CONTROLLER_AUD: "controller",
    FLEET_COLLECTOR_AUD: "fleet",
    CATALOG_NAME: crypto.randomUUID(),
    EVENT_LEDGER: {
      get: (id, options) => env.EVENT_LEDGER.get(id, options),
      idFromName: () => ledgerId,
      newUniqueId: (options) => env.EVENT_LEDGER.newUniqueId(options),
      idFromString: (id) => env.EVENT_LEDGER.idFromString(id),
      getByName: () => env.EVENT_LEDGER.get(ledgerId),
      jurisdiction: (value) => env.EVENT_LEDGER.jurisdiction(value),
    },
  };
}

function request(
  path: string,
  jwt: string | null,
  method = "GET",
  body?: unknown,
  headers: Record<string, string> = {},
) {
  return new Request(`https://homer.example${path}`, {
    method,
    headers: {
      ...(jwt ? { "Cf-Access-Jwt-Assertion": jwt } : {}),
      "Content-Type": "application/json",
      ...headers,
    },
    ...(body === undefined ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) }),
  });
}

const bindingPath = "/v1/admin/fleet/collector";
function binding(revision = 1, over: Record<string, unknown> = {}) {
  return {
    revision,
    principalDigest: collectorDigest,
    machineIds: ["delphi", "mac-studio", "pc-one"],
    evidenceRef: "review:synthetic-fleet-enrollment",
    enabled: true,
    ...over,
  };
}
async function bind(e: FleetTestEnv, over: Record<string, unknown> = {}, expected = 0) {
  return handleCatalogRequest(
    request(bindingPath, admin, "PUT", binding(expected + 1, over), {
      "If-Match": `"${expected}"`,
    }),
    e,
    key,
  );
}

function event(machineId = "delphi", startsAt = T0) {
  return {
    contract: "home.activity-event/v3",
    eventKey: `sparkdash:machine.alert_fired:${machineId}:thermal:${startsAt}`,
    kind: "machine.alert_fired",
    occurredAt: new Date(startsAt + 1000).toISOString(),
    actor: { sourceAccount: "sparkdash:alerts" },
    subject: "GPU temperature on Delphi",
    provenance: {
      sourceSystem: "sparkdash",
      sourceObjectId: `${machineId}:thermal@${startsAt}`,
      sourceUrl: "https://sparkdash.example.test/",
      collector: "fleet-collector",
      collectorVersion: "0.0.0+0000000",
      collectedAt: "2026-11-24T18:00:00.000Z",
    },
    data: {
      machineId,
      rule: "thermal",
      severity: "warning",
      startsAt: new Date(startsAt).toISOString(),
      sparkdashVersion: "2.91.0",
    },
  };
}

function report(over: Record<string, unknown> = {}) {
  return {
    contract: "home.fleet-report/v1",
    reportId: "6f0b8a1e-2c3d-4e5f-8a9b-0c1d2e3f4a5b",
    collector: { name: "fleet-collector", version: "0.0.0+0000000" },
    collectedAt: "2026-11-24T18:00:00.000Z",
    sparkdash: { state: "ok", version: "2.91.0", pinnedVersion: "2.91.0" },
    machines: [
      {
        machineId: "delphi",
        name: "Delphi",
        kind: "spark",
        source: "sparkdash",
        state: "up",
        lastSeenAt: "2026-11-24T18:00:00.000Z",
        firing: [],
      },
      {
        machineId: "pc-one",
        name: "PC",
        kind: "ssh",
        source: "reachability",
        state: "down",
        lastSeenAt: null,
        firing: [],
      },
    ],
    diagnostics: [],
    events: [event()],
    ...over,
  };
}
const post = (e: FleetTestEnv, body: unknown, jwt: string | null = collector) =>
  handleIntakeRequest(request("/v1/fleet/report", jwt, "POST", body), e, key);
const store = (e: FleetTestEnv) => e.RUNNER_FLEET.get(e.RUNNER_FLEET.idFromName(e.CATALOG_NAME));
const history = (e: FleetTestEnv) => openEventLedger(e.EVENT_LEDGER!).readHistory();

it("accepts a valid report: events in the ledger, the snapshot stored, a receipt back", async () => {
  const e = testEnv();
  expect((await bind(e)).status).toBe(200);
  const response = await post(e, report());
  expect(response.status).toBe(200);
  const receipt = await response.json<Record<string, unknown>>();
  expect(receipt).toMatchObject({ reportId: "6f0b8a1e-2c3d-4e5f-8a9b-0c1d2e3f4a5b", events: 1 });
  expect(
    (await history(e)).map((h) =>
      h.entryType === "activity_event" ? h.payload.eventKey : h.entryType,
    ),
  ).toEqual([event().eventKey]);
  expect(await store(e).fleetSnapshot()).toMatchObject({
    reportId: "6f0b8a1e-2c3d-4e5f-8a9b-0c1d2e3f4a5b",
    collectedAt: "2026-11-24T18:00:00.000Z",
    machines: [
      { machineId: "delphi", state: "up" },
      { machineId: "pc-one", state: "down" },
    ],
  });
  // An identical retry: the original receipt, the events Duplicates, the snapshot unchanged.
  const retry = await post(e, report());
  expect(retry.status).toBe(200);
  expect(await retry.json()).toEqual(receipt);
  expect(await history(e)).toHaveLength(1);
  // Changed content under the same reportId is a conflict.
  const changed = await post(e, report({ collectedAt: "2026-11-24T18:00:30.000Z" }));
  expect(changed.status).toBe(409);
  expect(await changed.json()).toEqual({ error: "report_conflict" });
});

it("refuses a report that does not validate, and records nothing", async () => {
  const e = testEnv();
  await bind(e);
  for (const bad of [
    report({ events: [{ ...event(), subject: "thermal: GPU0 91C at 10.0.0.5" }] }),
    report({ machines: [{ ...report().machines[0], name: "10.0.0.5" }] }),
    report({ contract: "home.fleet-report/v2" }),
    // A machine alert is never attributed to an Actor: no Identity Binding applies.
    report({
      events: [
        {
          ...event(),
          actor: { sourceAccount: "sparkdash:alerts", actorId: "actor:danny", actorKind: "human" },
        },
      ],
    }),
    "not json",
  ]) {
    const response = await post(e, bad);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_report" });
  }
  expect(await history(e)).toEqual([]);
  expect(await store(e).fleetSnapshot()).toBeNull();
});

it("refuses a report that names a machine outside the Collector's binding, and records nothing", async () => {
  const e = testEnv();
  await bind(e);
  const outside = await post(e, report({ events: [event("lab-box")] }));
  expect(outside.status).toBe(403);
  expect(await outside.json()).toEqual({ error: "machine_not_bound" });
  const machines = report().machines;
  const listed = await post(
    e,
    report({ events: [], machines: [...machines, { ...machines[1], machineId: "lab-box" }] }),
  );
  expect(listed.status).toBe(403);
  expect(await history(e)).toEqual([]);
  expect(await store(e).fleetSnapshot()).toBeNull();
});

it("refuses a runner controller credential, a person, another workload, and no token", async () => {
  const e = testEnv();
  await bind(e);
  for (const jwt of [controller, person, null]) {
    expect((await post(e, report(), jwt)).status).toBe(401);
  }
  const unbound = await post(e, report(), otherCollector);
  expect(unbound.status).toBe(403);
  expect(await unbound.json()).toEqual({ error: "forbidden" });
  await bind(e, { enabled: false }, 1);
  expect((await post(e, report())).status).toBe(403);
  expect(await history(e)).toEqual([]);
});

it("reserves a report id before any event is appended, so overlapping reports cannot both land", async () => {
  const e = testEnv();
  await bind(e);
  const s = store(e);
  const digest = (n: string) => n.repeat(64);
  const id = "6f0b8a1e-2c3d-4e5f-8a9b-0c1d2e3f4a80";
  expect(await s.fleetReportAdmission(collectorDigest, id, digest("a"), ["delphi"])).toBe(
    "admitted",
  );
  // Changed content under the same id, while the first is still appending: refused before its events.
  expect(await s.fleetReportAdmission(collectorDigest, id, digest("b"), ["delphi"])).toBe(
    "report_conflict",
  );
  // The same content, retried after a failure: it may resume.
  expect(await s.fleetReportAdmission(collectorDigest, id, digest("a"), ["delphi"])).toBe(
    "admitted",
  );
  // Reports admitted but not yet committed count toward the limit.
  for (let i = 1; i < 6; i++) {
    expect(
      await s.fleetReportAdmission(collectorDigest, `${id.slice(0, -1)}${i}`, digest("c"), [
        "delphi",
      ]),
    ).toBe("admitted");
  }
  expect(
    await s.fleetReportAdmission(collectorDigest, `${id.slice(0, -2)}99`, digest("d"), ["delphi"]),
  ).toBe("rate_limited");
});

it("keeps the newer snapshot when an older report arrives after it", async () => {
  const e = testEnv();
  await bind(e);
  expect(
    (
      await post(
        e,
        report({
          reportId: "6f0b8a1e-2c3d-4e5f-8a9b-0c1d2e3f4a51",
          collectedAt: "2026-11-24T18:01:00.000Z",
          events: [],
        }),
      )
    ).status,
  ).toBe(200);
  expect(
    (
      await post(
        e,
        report({
          reportId: "6f0b8a1e-2c3d-4e5f-8a9b-0c1d2e3f4a52",
          collectedAt: "2026-11-24T18:00:00.000Z",
          events: [],
        }),
      )
    ).status,
  ).toBe(200);
  expect(await store(e).fleetSnapshot()).toMatchObject({ collectedAt: "2026-11-24T18:01:00.000Z" });
});

it("takes at most 6 new reports a minute", async () => {
  const e = testEnv();
  await bind(e);
  for (let i = 0; i < 6; i++) {
    const id = `6f0b8a1e-2c3d-4e5f-8a9b-0c1d2e3f4a6${i}`;
    expect((await post(e, report({ reportId: id, events: [] }))).status, id).toBe(200);
  }
  const seventh = await post(
    e,
    report({ reportId: "6f0b8a1e-2c3d-4e5f-8a9b-0c1d2e3f4a70", events: [] }),
  );
  expect(seventh.status).toBe(429);
  // A retry of one already received is still answered.
  expect(
    (await post(e, report({ reportId: "6f0b8a1e-2c3d-4e5f-8a9b-0c1d2e3f4a60", events: [] })))
      .status,
  ).toBe(200);
});

it("needs its own audience, different from the runner controller's, and a body of at most 256 KiB", async () => {
  const e = testEnv();
  await bind(e);
  expect((await post({ ...e, FLEET_COLLECTOR_AUD: "" }, report())).status).toBe(503);
  expect(
    (await post({ ...e, FLEET_COLLECTOR_AUD: "controller" }, report(), controller)).status,
  ).toBe(503);
  const huge = JSON.stringify({ ...report(), padding: "x".repeat(300 * 1024) });
  expect((await post(e, huge)).status).toBe(413);
  expect(
    (await handleIntakeRequest(request("/v1/fleet/report", collector, "GET"), e, key)).status,
  ).toBe(405);
});

it("binds the Collector with a revision precondition and an audit record", async () => {
  const e = testEnv();
  const missing = await handleCatalogRequest(request(bindingPath, admin, "PUT", binding()), e, key);
  expect(missing.status).toBe(428);
  expect((await bind(e)).status).toBe(200);
  expect((await bind(e)).status).toBe(409);
  expect((await bind(e, { machineIds: ["Delphi!"] }, 1)).status).toBe(400);
  expect((await bind(e, { machineIds: ["delphi"] }, 1)).status).toBe(200);
  const read = await handleCatalogRequest(request(bindingPath, admin), e, key);
  expect(read.headers.get("ETag")).toBe('"2"');
  const body = await read.json<{
    binding: { machineIds: string[] };
    history: { operatorDigest: string }[];
  }>();
  expect(body.binding.machineIds).toEqual(["delphi"]);
  expect(body.history).toHaveLength(2);
  expect(body.history.every((h) => /^[a-f0-9]{64}$/.test(h.operatorDigest))).toBe(true);
  // Neither a workload with the fleet audience nor any non-admin binds it.
  expect((await handleCatalogRequest(request(bindingPath, collector), e, key)).status).toBe(401);
});
