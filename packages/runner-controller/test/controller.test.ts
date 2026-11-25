/* Test adapters intentionally implement async I/O contracts in memory. */
/* eslint-disable @typescript-eslint/require-await */
import { expect, test } from "vitest";
import { createHash } from "node:crypto";
import {
  createController,
  type Command,
  type Report,
  type JournalState,
  type Observation,
  type ControllerOptions,
} from "../src/index.js";

test("malformed commands cannot reach a local adapter", async () => {
  const controller = createController({
    machineId: "pc",
    transport: { poll: async () => ({ machineId: "pc", shell: "secret" }) },
    adapter: {},
    journal: { load: async () => ({ accepted: null, outbox: null }) },
  } as never);
  expect(await controller.reconcile()).toEqual({ ok: false, code: "invalid_command" });
});

test("busy drain closes admission and reports busy without stopping", async () => {
  const h = harness();
  const result = await h.controller.reconcile();
  expect(result.ok).toBe(true);
  expect(h.events).toEqual(["observe", "closeAdmission", "observe"]);
  expect(h.reports[0]).toMatchObject({ job: "busy", acceptingJobs: false, listener: "running" });
});

test("idle drain stops only after fresh closed admission observation", async () => {
  const h = harness();
  h.observation.job = "idle";
  expect((await h.controller.reconcile()).ok).toBe(true);
  expect(h.events).toEqual(["observe", "closeAdmission", "observe", "stop", "observe"]);
  expect(h.reports[0]).toMatchObject({ listener: "stopped", job: "idle", acceptingJobs: false });
});

function harness() {
  const events: string[] = [];
  const reports: Report[] = [];
  let state: JournalState = { accepted: null, outbox: null };
  const observation: Observation = { listener: "running", job: "busy", acceptingJobs: true };
  const next: Command = {
    machineId: "pc",
    revision: 1,
    operationId: "pc:1",
    desiredState: "maintenance",
  };
  const options: ControllerOptions = {
    machineId: "pc",
    transport: {
      poll: async () => structuredClone(next),
      report: async (report) => {
        reports.push(structuredClone(report));
        return {
          reportId: report.reportId,
          operationId: report.operationId,
          receivedAt: "2026-11-22T08:00:00.000Z",
          digest: createHash("sha256").update(JSON.stringify(report)).digest("hex"),
        };
      },
    },
    adapter: {
      observe: async () => {
        events.push("observe");
        return { ...observation };
      },
      closeAdmission: async () => {
        events.push("closeAdmission");
        observation.acceptingJobs = false;
      },
      stop: async () => {
        events.push("stop");
        if (observation.job !== "idle" || observation.acceptingJobs !== false)
          throw Error("unsafe stop");
        observation.listener = "stopped";
      },
      start: async () => {
        events.push("start");
        observation.listener = "running";
      },
      openAdmission: async () => {
        events.push("openAdmission");
        observation.acceptingJobs = true;
      },
    },
    journal: {
      load: async () => structuredClone(state),
      save: async (next) => {
        state = structuredClone(next);
      },
    },
  };
  return { events, reports, observation, next, options, controller: createController(options) };
}

test("enable opens admission only after observing a running listener", async () => {
  const h = harness();
  h.next.desiredState = "enabled";
  h.observation.listener = "stopped";
  h.observation.acceptingJobs = false;
  expect((await h.controller.reconcile()).ok).toBe(true);
  expect(h.events).toEqual(["observe", "start", "observe", "openAdmission", "observe"]);
  expect(h.reports[0]).toMatchObject({ listener: "running", acceptingJobs: true });
});

test("lost acknowledgement preserves exact report across restart before newer work", async () => {
  const h = harness();
  const send = h.options.transport.report.bind(h.options.transport);
  h.options.transport.report = async (report) => {
    await send(report);
    throw Error("credential secret");
  };
  expect(await h.controller.reconcile()).toEqual({ ok: false, code: "transport_failed" });
  h.next.revision = 2;
  h.next.operationId = "pc:2";
  h.next.desiredState = "enabled";
  h.events.length = 0;
  h.options.transport.report = send;
  expect((await createController(h.options).reconcile()).ok).toBe(true);
  expect(h.reports).toHaveLength(2);
  expect(h.reports[1]).toEqual(h.reports[0]);
  expect(h.events).toEqual([]);
  expect((await h.options.journal.load()).outbox).toBeNull();
});

test("older commands remain rejected after restart", async () => {
  const h = harness();
  h.next.revision = 2;
  h.next.operationId = "pc:2";
  await h.controller.reconcile();
  h.events.length = 0;
  h.next.revision = 1;
  h.next.operationId = "pc:1";
  expect(await createController(h.options).reconcile()).toEqual({
    ok: false,
    code: "stale_command",
  });
  expect(h.events).toEqual([]);
});

test("concurrent cycles serialize transport and host effects", async () => {
  const h = harness();
  let release!: () => void;
  let entered!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let polls = 0;
  h.options.transport.poll = async () => {
    polls++;
    entered();
    await gate;
    return { ...h.next };
  };
  const first = h.controller.reconcile();
  await started;
  const second = h.controller.reconcile();
  await Promise.resolve();
  expect(polls).toBe(1);
  release();
  await Promise.all([first, second]);
  expect(polls).toBe(2);
});

test("corrupt restored journal refuses all host effects", async () => {
  const h = harness();
  h.options.journal.load = async () => ({
    accepted: { ...h.next, machineId: "other" },
    outbox: null,
  });
  expect(await h.controller.reconcile()).toEqual({ ok: false, code: "journal_failed" });
  expect(h.events).toEqual([]);
});

test("malformed adapter observations refuse mutations and free-form host data", async () => {
  const h = harness();
  h.options.adapter.observe = async () =>
    ({ listener: "running", job: "idle", acceptingJobs: false, token: "secret" }) as Observation;
  expect(await h.controller.reconcile()).toEqual({ ok: false, code: "adapter_failed" });
  expect(h.events).toEqual([]);
  expect(h.reports).toEqual([]);
});

test.each(["unknown", "busy"] as const)("%s job never stops", async (job) => {
  const h = harness();
  h.observation.job = job;
  expect((await h.controller.reconcile()).ok).toBe(true);
  expect(h.events).not.toContain("stop");
});
test("failed closure refuses stop and sanitizes exceptions", async () => {
  const h = harness();
  h.observation.job = "idle";
  h.options.adapter.closeAdmission = async () => {
    throw Error("token=my-secret path=/home/private");
  };
  expect(await h.controller.reconcile()).toEqual({ ok: false, code: "adapter_failed" });
  expect(h.events).toEqual(["observe"]);
  expect(h.reports).toEqual([]);
});
test("unsuccessful closure observation refuses stop", async () => {
  const h = harness();
  h.observation.job = "idle";
  h.options.adapter.closeAdmission = async () => {};
  await h.controller.reconcile();
  expect(h.events).not.toContain("stop");
});
test("interrupted mutation observes before retry across restart", async () => {
  const h = harness();
  h.observation.job = "idle";
  h.options.adapter.stop = async () => {
    h.events.push("stop");
    h.observation.listener = "stopped";
    throw Error("secret");
  };
  expect(await h.controller.reconcile()).toEqual({ ok: false, code: "adapter_failed" });
  h.events.length = 0;
  expect((await createController(h.options).reconcile()).ok).toBe(true);
  expect(h.events).toEqual(["observe"]);
  expect(h.reports[0]).toMatchObject({ listener: "stopped" });
});
test("cross-machine command is rejected before effects", async () => {
  const h = harness();
  h.next.machineId = "mac";
  h.next.operationId = "mac:1";
  expect(await h.controller.reconcile()).toEqual({ ok: false, code: "wrong_machine" });
  expect(h.events).toEqual([]);
});
test("failed start observation never opens admission", async () => {
  const h = harness();
  h.next.desiredState = "enabled";
  h.observation.listener = "unknown";
  h.options.adapter.start = async () => {};
  expect((await h.controller.reconcile()).ok).toBe(true);
  expect(h.events).not.toContain("openAdmission");
  expect(h.reports[0]).toMatchObject({ listener: "unknown" });
});
test("receipt mismatch preserves durable outbox and blocks new work", async () => {
  const h = harness();
  h.options.transport.report = async () => ({ reportId: "wrong" });
  expect(await h.controller.reconcile()).toEqual({ ok: false, code: "receipt_mismatch" });
  expect((await h.options.journal.load()).outbox).not.toBeNull();
  h.events.length = 0;
  await h.controller.reconcile();
  expect(h.events).toEqual([]);
});

test("rejected outbox explicitly blocks further work until operator reconciliation", async () => {
  const h = harness();
  const { ReportRejected } = await import("../src/index.js");
  h.options.transport.report = async () => {
    throw new ReportRejected();
  };
  expect(await h.controller.reconcile()).toEqual({ ok: false, code: "report_rejected" });
  const pending = (await h.options.journal.load()).outbox;
  h.next.revision = 2;
  h.next.operationId = "pc:2";
  h.events.length = 0;
  expect(await h.controller.reconcile()).toEqual({ ok: false, code: "report_rejected" });
  expect((await h.options.journal.load()).outbox).toEqual(pending);
  expect(h.events).toEqual([]);
});

test.each([
  { revision: 0 },
  { revision: 1.5 },
  { revision: Number.MAX_SAFE_INTEGER + 1 },
  { operationId: "pc:2" },
  { desiredState: "reboot" },
  { shell: "secret" },
  { machineId: "a".repeat(81) },
])("invalid bounded command %j cannot reach local effects", async (changes) => {
  const h = harness();
  h.options.transport.poll = async () => ({ ...h.next, ...changes });
  expect(await h.controller.reconcile()).toEqual({ ok: false, code: "invalid_command" });
  expect(h.events).toEqual([]);
});
test("same revision cannot change intent", async () => {
  const h = harness();
  await h.controller.reconcile();
  h.next.desiredState = "enabled";
  h.events.length = 0;
  expect(await h.controller.reconcile()).toEqual({ ok: false, code: "stale_command" });
  expect(h.events).toEqual([]);
});
test("durability failure before accepted intent prevents host mutations", async () => {
  const h = harness();
  h.options.journal.save = async () => {
    throw Error("private journal path");
  };
  expect(await h.controller.reconcile()).toEqual({ ok: false, code: "journal_failed" });
  expect(h.events).toEqual([]);
});
test.each(["reportId", "operationId", "digest", "receivedAt"])(
  "receipt must match %s before clearing outbox",
  async (field) => {
    const h = harness();
    const send = h.options.transport.report.bind(h.options.transport);
    h.options.transport.report = async (report) => ({
      ...((await send(report)) as object),
      [field]: "mismatch",
    });
    expect(await h.controller.reconcile()).toEqual({ ok: false, code: "receipt_mismatch" });
    expect((await h.options.journal.load()).outbox).not.toBeNull();
  },
);
test("corrupt outbox refuses retransmission and effects", async () => {
  const h = harness();
  h.options.journal.load = async () => ({
    accepted: h.next,
    outbox: { reportId: "secret" } as Report,
  });
  expect(await h.controller.reconcile()).toEqual({ ok: false, code: "journal_failed" });
  expect(h.reports).toEqual([]);
  expect(h.events).toEqual([]);
});

test.each(["a".repeat(65), "PC", "pc_name", "-pc"])(
  "machine IDs match fleet bounds: %s",
  async (machineId) => {
    const h = harness();
    h.options.machineId = machineId;
    h.options.transport.poll = async () => ({
      ...h.next,
      machineId,
      operationId: `${machineId}:1`,
    });
    expect(await createController(h.options).reconcile()).toEqual({
      ok: false,
      code: "invalid_command",
    });
    expect(h.events).toEqual([]);
  },
);
