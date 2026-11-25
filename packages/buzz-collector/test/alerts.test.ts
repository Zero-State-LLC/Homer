import { describe, expect, it } from "vitest";
import {
  ALERTS_PER_HOUR,
  HELD_ALERTS_KEY,
  HOMER_ALERT_TEMPLATES as templates,
  alertMessage,
  applyAlerts,
  dueAlerts,
  emptyAlertState,
  markDelivered,
  markFailed,
  type AlertRequest,
  type AlertState,
} from "../src/index.js";

const T0 = Date.parse("2026-11-25T18:00:00Z");
const channel = "f7e1c741-5b3a-4d6c-b67d-2078c6042d2d";
const thermal = (machineId = "delphi", name = "Delphi"): AlertRequest => ({
  key: `fleet:${machineId}:thermal`,
  template: "fleet.machine_alert",
  params: { machineId, name, rule: "thermal" },
});
const apply = (state: AlertState, requests: AlertRequest[], now = T0) =>
  applyAlerts(state, "fleet:", requests, templates, now);
/** Posts everything due, as a working transport would. */
function deliverAll(state: AlertState, now: number): { state: AlertState; posted: string[] } {
  const posted: string[] = [];
  for (const delivery of dueAlerts(state, templates, now)) {
    state = markDelivered(state, delivery.key, delivery.content, now);
    posted.push(delivery.content);
  }
  return { state, posted };
}

describe("change-only Alerts", () => {
  it("posts a raised Alert once, and its clearing once", () => {
    const first = apply(emptyAlertState(), [thermal()]);
    expect(first.refused).toEqual([]);
    let round = deliverAll(first.state, T0);
    let state: AlertState;
    expect(round.posted).toEqual([
      "GPU temperature on Delphi\n\nAlert key: fleet:delphi:thermal\nRunbook: https://github.com/Zero-State-LLC/Homer/blob/main/specs/fleet-monitoring/spec.md#alerts-to-buzz",
    ]);
    // The same Alert again: nothing new to say.
    ({ state } = apply(round.state, [thermal()], T0 + 30_000));
    expect(dueAlerts(state, templates, T0 + 30_000)).toEqual([]);
    // No longer raised: one clearing message, and then the record is finished.
    ({ state } = apply(state, [], T0 + 60_000));
    round = deliverAll(state, T0 + 60_000);
    expect(round.posted).toHaveLength(1);
    expect(round.posted[0]).toMatch(/^GPU temperature on Delphi cleared\n/);
    expect(round.state.records).toEqual({});
  });

  it("says nothing for an Alert that cleared before its first post", () => {
    let { state } = apply(emptyAlertState(), [thermal()]);
    ({ state } = apply(state, [], T0 + 1_000));
    expect(dueAlerts(state, templates, T0 + 1_000)).toEqual([]);
    expect(state.records).toEqual({});
  });

  it("posts the latest message when an Alert changes before it is posted, in its first place", () => {
    const stale = (since: string): AlertRequest => ({
      key: "fleet:delphi:stale",
      template: "fleet.machine_stale",
      params: { machineId: "delphi", name: "Delphi", since },
    });
    let { state } = apply(emptyAlertState(), [stale("2026-11-25T17:55:00Z")]);
    ({ state } = apply(state, [stale("2026-11-25T17:57:00Z"), thermal()], T0 + 1_000));
    const due = dueAlerts(state, templates, T0 + 1_000);
    expect(due.map((d) => d.key)).toEqual(["fleet:delphi:stale", "fleet:delphi:thermal"]);
    expect(due[0]?.content).toMatch(/since 2026-11-25T17:57:00Z/);
  });

  it("keeps a changed message queued when an older one is recorded as posted", () => {
    let { state } = apply(emptyAlertState(), [thermal()]);
    const [first] = dueAlerts(state, templates, T0);
    ({ state } = apply(state, [thermal("delphi", "Delphi Spark")], T0 + 1_000));
    state = markDelivered(state, first!.key, first!.content, T0 + 2_000);
    const [next] = dueAlerts(state, templates, T0 + 2_000);
    expect(next?.content).toMatch(/^GPU temperature on Delphi Spark\n/);
  });

  it("clears only inside the monitor's own scope", () => {
    const other = applyAlerts(
      emptyAlertState(),
      "homer:",
      [{ key: "homer:test", template: "homer.alerts_held", params: { count: "1" } }],
      templates,
      T0,
    ).state;
    const { state } = apply(other, []);
    expect(Object.keys(state.records)).toEqual(["homer:test"]);
  });

  it("posts a one-shot Alert once per occurrence and never clears it", () => {
    const gap = (since: string): AlertRequest => ({
      key: `fleet:collector:collector_gap:${since}`,
      template: "fleet.held_diagnostic",
      params: { code: "collector_gap", since },
    });
    let { state } = apply(emptyAlertState(), [gap("2026-11-25T17:59:00Z")]);
    let round = deliverAll(state, T0);
    expect(round.posted[0]).toMatch(
      /^The Fleet Collector missed part of sparkDash's alert history at 2026-11-25T17:59:00Z\.\n/,
    );
    ({ state } = apply(round.state, [gap("2026-11-25T17:59:00Z")], T0 + 30_000));
    ({ state } = apply(state, [], T0 + 60_000));
    round = deliverAll(state, T0 + 60_000);
    expect(round.posted).toEqual([]);
    ({ state } = apply(round.state, [gap("2026-11-25T18:05:00Z")], T0 + 90_000));
    expect(deliverAll(state, T0 + 90_000).posted).toHaveLength(1);
  });

  it("keeps a one-shot Alert a week from its post, even when posting took longer", () => {
    const key = "fleet:collector:sparkdash_restarted:2026-11-25T17:59:00Z";
    const restart: AlertRequest = {
      key,
      template: "fleet.held_diagnostic",
      params: { code: "sparkdash_restarted", since: "2026-11-25T17:59:00Z" },
    };
    let { state } = apply(emptyAlertState(), [restart]);
    const day = 24 * 60 * 60_000;
    // Posting fails for eight days; it is never dropped.
    for (let now = T0; now < T0 + 8 * day; now += 600_000) state = markFailed(state, key, now);
    const posted = T0 + 8 * day;
    const [due] = dueAlerts(state, templates, posted);
    state = markDelivered(state, key, due!.content, posted);
    ({ state } = apply(state, [restart], posted + 30_000));
    expect(dueAlerts(state, templates, posted + 30_000)).toEqual([]);
    expect(Object.keys(state.records)).toEqual([key]);
  });
});

describe("what may enter a message", () => {
  const free = [
    "Delphi <script>",
    "@everyone",
    "https://evil.example",
    "line\nbreak",
    "x".repeat(70),
    "",
    "Delphi; rm -rf",
  ];

  it("refuses free text in every parameter, and nothing is queued", () => {
    for (const text of free) {
      const requests: AlertRequest[] = [
        { ...thermal(), params: { machineId: "delphi", name: text, rule: "thermal" } },
        { ...thermal(), params: { machineId: text, name: "Delphi", rule: "thermal" } },
        { ...thermal(), params: { machineId: "delphi", name: "Delphi", rule: text } },
        {
          key: "fleet:collector:stale",
          template: "fleet.collector_stale",
          params: { since: text },
        },
        {
          key: "fleet:collector:metrics_off",
          template: "fleet.sparkdash_state",
          params: { state: text },
        },
      ];
      for (const request of requests) {
        const { state, refused } = apply(emptyAlertState(), [request]);
        expect(refused, JSON.stringify(request)).toEqual([
          { key: request.key, reason: "invalid_params" },
        ]);
        expect(state.records).toEqual({});
      }
    }
  });

  it("refuses bad keys, other scopes, repeated keys, unknown templates and extra parameters", () => {
    const { refused, state } = apply(emptyAlertState(), [
      { ...thermal(), key: "fleet:delphi:thermal\nx" },
      { ...thermal(), key: "curator:x" },
      thermal(),
      thermal(),
      { ...thermal(), key: "fleet:x", template: "free.text" },
      { ...thermal(), key: "fleet:y", params: { ...thermal().params, extra: "1" } },
      { ...thermal(), key: "fleet:z", params: { machineId: "delphi", name: "Delphi" } },
    ]);
    expect(refused.map((r) => r.reason)).toEqual([
      "invalid_key",
      "outside_scope",
      "duplicate_key",
      "unknown_template",
      "invalid_params",
      "invalid_params",
    ]);
    expect(Object.keys(state.records)).toEqual(["fleet:delphi:thermal"]);
  });

  it("keeps an Alert as it is when a request under its key is refused", () => {
    let { state } = apply(emptyAlertState(), [thermal()]);
    ({ state } = deliverAll(state, T0));
    const before = structuredClone(state.records);
    const bad = { ...thermal(), params: { machineId: "delphi", name: "<b>", rule: "thermal" } };
    const result = apply(state, [bad], T0 + 1_000);
    expect(result.refused).toEqual([{ key: "fleet:delphi:thermal", reason: "invalid_params" }]);
    expect(result.state.records).toEqual(before);
    expect(dueAlerts(result.state, templates, T0 + 1_000)).toEqual([]);
  });

  it("renders every template from its parameters alone", () => {
    const sample: Record<string, Record<string, string>> = {
      "fleet.machine_alert": { machineId: "delphi", name: "Delphi", rule: "new-rule" },
      "fleet.collector_stale": { since: "2026-11-25T17:58:00Z" },
      "fleet.machine_stale": { machineId: "delphi", name: "Delphi", since: "2026-11-25T17:58:00Z" },
      "fleet.sparkdash_state": { state: "shape_changed" },
      "fleet.version_changed": { pinned: "2.91.0", seen: "2.92.0" },
      "fleet.collector_diagnostic": { code: "queue_full" },
      "fleet.held_diagnostic": { code: "sparkdash_restarted", since: "2026-11-25T17:58:00Z" },
      "homer.alerts_held": { count: "12" },
    };
    expect(Object.keys(sample).sort()).toEqual(Object.keys(templates).sort());
    const words = Object.entries(sample).map(([id, params]) => {
      const t = templates[id]!;
      return [t.raised(params), t.cleared?.(params) ?? null];
    });
    expect(words).toEqual([
      ["sparkDash rule new-rule on Delphi", "sparkDash rule new-rule on Delphi cleared"],
      [
        "Fleet monitoring has not reported since 2026-11-25T17:58:00Z",
        "Fleet monitoring is reporting again",
      ],
      ["No fresh reading from Delphi since 2026-11-25T17:58:00Z", "Delphi is fresh again"],
      [
        "sparkDash's responses no longer match the pinned release, so the Fleet Collector stopped mapping them.",
        "sparkDash's responses match the pinned release again.",
      ],
      [
        "sparkDash runs 2.92.0, not the pinned 2.91.0. The Fleet Collector maps its responses only while they match the pinned shape.",
        "sparkDash runs the pinned 2.91.0 again.",
      ],
      [
        "The Fleet Collector's queue of undelivered events is full, so it stopped turning sparkDash's history into events.",
        "The Fleet Collector's queue has room again.",
      ],
      ["sparkDash restarted, and its alert history started again at 2026-11-25T17:58:00Z.", null],
      [
        "Homer is holding 12 alert changes under its cap of 30 an hour. It posts each one's state as the cap frees.",
        null,
      ],
    ]);
  });
});

describe("the hourly cap", () => {
  const many = (n: number) =>
    Array.from({ length: n }, (_, i) => thermal(`m${String(i).padStart(2, "0")}`, `M${i}`));

  it("posts at most 30 an hour, the last slot a summary of what is held", () => {
    let { state } = apply(emptyAlertState(), many(35));
    let round = deliverAll(state, T0);
    expect(round.posted).toHaveLength(ALERTS_PER_HOUR);
    expect(round.posted.at(-1)).toMatch(/^Homer is holding 6 alert changes under its cap/);
    expect(round.posted.at(-1)).toContain(`Alert key: ${HELD_ALERTS_KEY}`);
    // Nothing more inside the hour, and no second summary.
    expect(dueAlerts(round.state, templates, T0 + 59 * 60_000)).toEqual([]);
    round = deliverAll(round.state, T0 + 60 * 60_000 + 1);
    expect(round.posted).toHaveLength(6);
    expect(round.posted.every((p) => p.startsWith("GPU temperature on M"))).toBe(true);
    // A held Alert that cleared meanwhile is never posted.
    ({ state } = apply(emptyAlertState(), many(31)));
    round = deliverAll(state, T0);
    ({ state } = apply(round.state, many(29), T0 + 1_000));
    expect(deliverAll(state, T0 + 60 * 60_000 + 1).posted).toEqual([]);
  });
});

describe("retries", () => {
  it("backs off a failed summary, keeping its slot", () => {
    let { state } = apply(
      emptyAlertState(),
      Array.from({ length: 31 }, (_, i) => thermal(`m${i}`, `M${i}`)),
    );
    const due = dueAlerts(state, templates, T0);
    expect(due).toHaveLength(ALERTS_PER_HOUR);
    for (const d of due.slice(0, -1)) state = markDelivered(state, d.key, d.content, T0);
    state = markFailed(state, HELD_ALERTS_KEY, T0);
    expect(dueAlerts(state, templates, T0)).toEqual([]);
    expect(dueAlerts(state, templates, T0 + 29_999)).toEqual([]);
    const [summary] = dueAlerts(state, templates, T0 + 30_000);
    expect(summary?.key).toBe(HELD_ALERTS_KEY);
    expect(summary?.content).toMatch(/^Homer is holding 2 alert changes/);
    state = markDelivered(state, summary!.key, summary!.content, T0 + 30_000);
    expect(state.summaryRetry).toBeNull();
  });

  it("waits 30 s, 60 s, 120 s, 300 s, then 600 s between failed posts, and never drops a message", () => {
    let { state } = apply(emptyAlertState(), [thermal()]);
    let now = T0;
    for (const wait of [30_000, 60_000, 120_000, 300_000, 600_000, 600_000]) {
      expect(dueAlerts(state, templates, now)).toHaveLength(1);
      state = markFailed(state, "fleet:delphi:thermal", now);
      expect(dueAlerts(state, templates, now + wait - 1)).toEqual([]);
      now += wait;
    }
    expect(deliverAll(state, now).posted).toHaveLength(1);
  });
});

describe("the Buzz message", () => {
  it("is a kind 9 message to the homer channel, unsigned", () => {
    expect(alertMessage({ key: "fleet:x", content: "text" }, channel, 1_764_093_600)).toEqual({
      kind: 9,
      created_at: 1_764_093_600,
      tags: [["h", channel]],
      content: "text",
    });
    expect(() => alertMessage({ key: "fleet:x", content: "text" }, "general", 1)).toThrow(
      "invalid_channel",
    );
    expect(() => alertMessage({ key: "fleet:x", content: "text" }, channel, 1.5)).toThrow(
      "invalid_time",
    );
  });
});
