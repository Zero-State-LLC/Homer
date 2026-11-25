import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ActivityEvent, FleetReport } from "@zs-home/shared-contracts";
import {
  FleetCollector,
  MAX_QUEUE,
  StateUnreadable,
  fileStore,
  initialStored,
  memoryStore,
  reportIdFor,
  type CheckResult,
  type IntakeClient,
  type LogLine,
  type SparkdashClient,
  type StoredState,
} from "../src/runtime/index.js";
import { runCli } from "../src/cli.js";
import type { SparkdashRead } from "../src/index.js";
import { alertsBody, config, entry, ok, range, read } from "./fixture.js";

const START = Date.parse("2026-11-24T18:00:00Z");

/** A stub sparkDash: whatever `reads` says next. */
function stubSparkdash(next: () => SparkdashRead): SparkdashClient {
  return {
    request: () => Promise.reject(new Error("not used")),
    readAll: () => Promise.resolve(next()),
  };
}

/** A stub intake that records every report and answers with `status()`. */
function stubIntake(status: () => number | "unreachable" = () => 201) {
  const posts: FleetReport[] = [];
  const intake: IntakeClient = {
    post: (report) => {
      posts.push(structuredClone(report));
      return Promise.resolve(status());
    },
  };
  return { intake, posts };
}

function harness(options: {
  reads: () => SparkdashRead;
  status?: () => number | "unreachable";
  check?: () => CheckResult;
  stored?: StoredState;
}) {
  let clock = START;
  const store = memoryStore(options.stored);
  const { intake, posts } = stubIntake(options.status);
  const logs: LogLine[] = [];
  const collector = new FleetCollector({
    config,
    store,
    sparkdash: stubSparkdash(options.reads),
    check: () => Promise.resolve(options.check?.() ?? "up"),
    intake,
    now: () => clock,
    log: (line) => logs.push(line),
  });
  return {
    collector,
    store,
    posts,
    logs,
    tick: (ms = 30_000) => (clock += ms),
  };
}

const keys = (events: ActivityEvent[]) => events.map((e) => e.eventKey);

describe("the Collector runtime", () => {
  it("delivers 150 transitions as two reports, 100 then 50, none lost", async () => {
    const h = harness({ reads: () => read({ alerts: ok(alertsBody(range(1, 150))) }) });
    await h.collector.pollOnce();
    expect(h.posts.map((p) => p.events.length)).toEqual([100, 50]);
    expect(h.posts[0]?.diagnostics.map((d) => d.code)).toEqual(["events_backlog"]);
    expect(h.posts[1]?.diagnostics).toEqual([]);
    const delivered = h.posts.flatMap((p) => p.events);
    expect(new Set(keys(delivered)).size).toBe(150);
    expect((await h.store.load()).queue).toEqual([]);
  });

  it("delivers events queued before a stop once it starts again, and the cursor did not skip them", async () => {
    let up = false;
    const first = harness({
      reads: () => read({ alerts: ok(alertsBody(range(1, 3))) }),
      status: () => (up ? 201 : "unreachable"),
    });
    await first.collector.pollOnce();
    const saved = first.store.saved[0];
    expect(saved?.queue).toHaveLength(3);
    expect(saved?.collector.cursor?.id).toBe(3);
    // A new process, from what was on disk after queueing.
    up = true;
    const second = harness({
      reads: () => read({ alerts: ok(alertsBody(range(1, 3))) }),
      stored: saved!,
    });
    await second.collector.pollOnce();
    expect(second.posts).toHaveLength(1);
    expect(keys(second.posts[0]!.events)).toEqual(keys(saved!.queue));
  });

  it("stops the cursor and reports queue_full when the queue holds 10,000 events", async () => {
    const h0 = harness({
      reads: () => read({ alerts: ok(alertsBody(range(1, 1))) }),
      status: () => "unreachable",
    });
    await h0.collector.pollOnce();
    const one = (await h0.store.load()).queue[0]!;
    const full: StoredState = {
      ...(await h0.store.load()),
      queue: Array.from({ length: MAX_QUEUE }, () => one),
      // Due for delivery now, so the report shows the full queue.
      delivery: { failures: 0, nextAttemptAt: 0 },
    };
    const h = harness({
      reads: () => read({ alerts: ok(alertsBody(range(1, 5))) }),
      stored: full,
      status: () => 503,
    });
    await h.collector.pollOnce();
    const after = await h.store.load();
    expect(after.queue).toHaveLength(MAX_QUEUE);
    expect(after.collector.cursor?.id).toBe(1);
    expect(h.posts[0]?.diagnostics.map((d) => d.code)).toContain("queue_full");
  });

  it("carries a held gap with its first since through a failed post, and drops it after a 2xx", async () => {
    let history = range(1, 90);
    let status: number | "unreachable" = 201;
    const h = harness({
      reads: () => read({ alerts: ok(alertsBody(history)) }),
      status: () => status,
    });
    await h.collector.pollOnce();
    history = range(101, 300);
    status = 503;
    h.tick();
    await h.collector.pollOnce();
    const gap = h.posts.at(-1)!.diagnostics.find((d) => d.code === "collector_gap");
    expect(gap?.since).toBe("2026-11-24T18:00:30.000Z");
    history = range(102, 301);
    status = 201;
    h.tick(120_000);
    const before = h.posts.length;
    await h.collector.pollOnce();
    // The first report delivered carries the gap with its first since; the next ones do not.
    expect(h.posts[before]!.diagnostics.filter((d) => d.code === "collector_gap")).toEqual([gap]);
    expect(h.posts[before + 1]!.diagnostics.map((d) => d.code)).not.toContain("collector_gap");
    h.tick();
    await h.collector.pollOnce();
    expect(h.posts.at(-1)!.diagnostics.map((d) => d.code)).not.toContain("collector_gap");
  });

  it("stops carrying sparkdash_restarted once a report that carried it gets a 2xx", async () => {
    let history = range(51, 250);
    const h = harness({ reads: () => read({ alerts: ok(alertsBody(history)) }) });
    await h.collector.pollOnce();
    history = range(1, 4);
    h.tick();
    await h.collector.pollOnce();
    expect(h.posts.at(-1)!.diagnostics.map((d) => d.code)).toContain("sparkdash_restarted");
    h.tick();
    await h.collector.pollOnce();
    expect(h.posts.at(-1)!.diagnostics.map((d) => d.code)).not.toContain("sparkdash_restarted");
  });

  it("delivers the queue in order once the intake answers after 10 minutes, sending only the latest snapshot", async () => {
    let history = range(1, 10);
    let status: number | "unreachable" = "unreachable";
    const h = harness({
      reads: () => read({ alerts: ok(alertsBody(history)) }),
      status: () => status,
    });
    for (let i = 0; i < 20; i++) {
      history = range(1, 10 + i);
      await h.collector.pollOnce();
      h.tick();
    }
    const failedPosts = h.posts.length;
    expect(failedPosts).toBeLessThan(20);
    status = 201;
    h.tick(300_000);
    await h.collector.pollOnce();
    const delivered = h.posts.slice(failedPosts);
    expect(delivered).toHaveLength(1);
    const events = delivered[0]!.events;
    expect(events).toHaveLength(29);
    expect(new Set(keys(events)).size).toBe(29);
    // In order, oldest first.
    const starts = events.map((e) => Date.parse(e.data?.["startsAt"] as string));
    expect(starts).toEqual([...starts].sort((a, b) => a - b));
    // The latest snapshot only.
    expect(delivered[0]!.collectedAt).toBe(new Date(START + 20 * 30_000 + 300_000).toISOString());
  });

  it("keeps a report's id on an identical retry, and gives changed content another", () => {
    const report = { contract: "home.fleet-report/v1", reportId: "x" } as unknown as FleetReport;
    const id = reportIdFor(report);
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(reportIdFor({ ...report, reportId: "y" })).toBe(id);
    expect(reportIdFor({ ...report, collectedAt: "2026-11-24T18:00:30Z" })).not.toBe(id);
  });

  it("fires a reachability alert after two failed Checks, and clears it on the next pass", async () => {
    const results: CheckResult[] = ["failure", "failure", "up"];
    const h = harness({ reads: () => read(), check: () => results.shift() ?? "up" });
    for (let i = 0; i < 3; i++) {
      await h.collector.checkOnce();
      h.tick(60_000);
    }
    const queue = (await h.store.load()).queue;
    expect(queue.map((e) => e.kind)).toEqual(["machine.alert_fired", "machine.alert_cleared"]);
    expect(queue[0]).toMatchObject({
      eventKey: `homer:machine.alert_fired:pc-one:reachability:${START}`,
      subject: "SSH unreachable on PC",
      actor: { sourceAccount: "homer:fleet-collector" },
      data: { rule: "reachability", severity: "critical" },
    });
  });

  it("never writes a credential, an address or a response body to its log", async () => {
    const h = harness({
      reads: () => read({ alerts: ok(alertsBody([entry({ id: 1, status: "firing" })])) }),
    });
    await h.collector.pollOnce();
    const text = JSON.stringify(h.logs);
    for (const leak of ["10.0.0.5", "pc-one.tailnet", "Connection refused", "summary"])
      expect(text).not.toContain(leak);
  });
});

describe("the state file", () => {
  it("saves atomically, readable by its owner only, and loads what it saved", async () => {
    const dir = await mkdtemp(join(tmpdir(), "fleet-collector-"));
    const store = fileStore(join(dir, "state", "state.json"));
    expect(await store.load()).toEqual(initialStored());
    const state = { ...initialStored(), delivery: { failures: 2, nextAttemptAt: 5 } };
    await store.save(state);
    expect(await store.load()).toEqual(state);
    expect((await stat(join(dir, "state", "state.json"))).mode & 0o777).toBe(0o600);
  });

  it("refuses a file it cannot read, rather than starting afresh", async () => {
    const dir = await mkdtemp(join(tmpdir(), "fleet-collector-"));
    const path = join(dir, "state.json");
    await writeFile(path, "{ not json");
    await expect(fileStore(path).load()).rejects.toThrow(StateUnreadable);
    await writeFile(path, JSON.stringify({ version: 2 }));
    await expect(fileStore(path).load()).rejects.toThrow(StateUnreadable);
    expect(await readFile(path, "utf8")).toBe(JSON.stringify({ version: 2 }));
  });
});

describe("the command line", () => {
  async function files() {
    const dir = await mkdtemp(join(tmpdir(), "fleet-collector-"));
    const configPath = join(dir, "fleet-collector.json");
    await writeFile(configPath, JSON.stringify(config));
    return { configPath, statePath: join(dir, "state.json") };
  }

  it("exits non-zero naming a missing credential, never a value", async () => {
    const { configPath, statePath } = await files();
    const errors: string[] = [];
    const code = await runCli(["--config", configPath, "--state", statePath], {
      env: { FLEET_COLLECTOR_CLIENT_ID: "synthetic-client-id.access" },
      stdout: () => undefined,
      stderr: (line) => errors.push(line),
      start: () => Promise.reject(new Error("must not start")),
    });
    expect(code).toBe(1);
    expect(errors.join("\n")).toContain("FLEET_COLLECTOR_CLIENT_SECRET is not configured");
    expect(errors.join("\n")).not.toContain("synthetic-client-id");
  });

  it("reads a credential by 1Password reference, and starts", async () => {
    const { configPath, statePath } = await files();
    let started = false;
    const code = await runCli(["--config", configPath, "--state", statePath, "--once"], {
      env: {
        FLEET_COLLECTOR_CLIENT_ID_REF: "op://Fleet/collector/client-id",
        FLEET_COLLECTOR_CLIENT_SECRET_REF: "op://Fleet/collector/client-secret",
      },
      opRead: (reference) => Promise.resolve(`value-of-${reference.split("/").pop()}\n`),
      stdout: () => undefined,
      stderr: () => undefined,
      start: (_collector, once) => {
        started = once;
        return Promise.resolve();
      },
    });
    expect(code).toBe(0);
    expect(started).toBe(true);
  });

  it("refuses a configuration that does not check, naming fields only", async () => {
    const { configPath, statePath } = await files();
    await writeFile(configPath, JSON.stringify({ ...config, sparkdashUrl: "http://0.0.0.0:3000" }));
    const errors: string[] = [];
    const code = await runCli(["--config", configPath, "--state", statePath], {
      env: {},
      stdout: () => undefined,
      stderr: (line) => errors.push(line),
    });
    expect(code).toBe(2);
    expect(errors.join("\n")).toContain("sparkdashUrl must be");
    expect(errors.join("\n")).not.toContain("0.0.0.0");
  });
});
