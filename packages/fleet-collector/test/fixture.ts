import type { CollectorConfig, HttpRead, SparkdashRead } from "../src/index.js";

/** Synthetic sparkDash responses, shaped as v2.91.0 renders them (`server/prometheus.js`, `server/alerts/engine.js`). */
export const config: CollectorConfig = {
  sparkdashUrl: "http://127.0.0.1:3000",
  pinnedVersion: "2.91.0",
  intakeUrl: "https://intake.example.test/v1/fleet/report",
  frontDoorOrigin: "https://sparkdash.example.test",
  machines: [
    { machineId: "delphi", sparkdashUnit: "delphi" },
    { machineId: "mac-studio", sparkdashUnit: "studio" },
    { machineId: "pc-one", name: "PC", ssh: { host: "pc-one.tailnet.example", port: 22 } },
  ],
};

export interface Unit {
  unit: string;
  name: string;
  kind: string;
  up: boolean;
  collectors?: Record<string, number>;
}

function escape(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
}

export const units: Unit[] = [
  {
    unit: "delphi",
    name: "Delphi",
    kind: "spark",
    up: true,
    collectors: { gpu: 1795543200, cpu: 1795543199.5 },
  },
  { unit: "studio", name: "Mac Studio", kind: "mac", up: false },
  // A unit the configuration does not map: never reported.
  { unit: "lab-box", name: "Lab box", kind: "host", up: true, collectors: { gpu: 1795543200 } },
];

/** `/metrics`, with a family the Collector must drop. */
export function metricsText(list: Unit[] = units): string {
  const labels = (u: Unit, extra = "") =>
    `{unit="${escape(u.unit)}",unit_name="${escape(u.name)}",kind="${u.kind}",role="standalone"${extra}}`;
  const lines = [
    "# HELP sparkdash_up 1 when the unit answered its last liveness check.",
    "# TYPE sparkdash_up gauge",
    ...list.map((u) => `sparkdash_up${labels(u)} ${u.up ? 1 : 0}`),
    "# HELP sparkdash_collector_last_success_timestamp_seconds Unix time of the last poll.",
    "# TYPE sparkdash_collector_last_success_timestamp_seconds gauge",
    ...list.flatMap((u) =>
      Object.entries(u.collectors ?? {}).map(
        ([c, s]) =>
          `sparkdash_collector_last_success_timestamp_seconds${labels(u, `,collector="${c}"`)} ${s}`,
      ),
    ),
    "# HELP sparkdash_gpu_info Always 1.",
    "# TYPE sparkdash_gpu_info gauge",
    'sparkdash_gpu_info{unit="delphi",unit_name="Delphi",kind="spark",gpu="0",name="NVIDIA GB10",uuid="GPU-1234"} 1',
  ];
  return lines.join("\n") + "\n";
}

export interface Entry {
  id: number;
  status: "firing" | "resolved";
  unitId?: string;
  ruleId?: string;
  severity?: "warning" | "critical";
  startsAt?: number;
  at?: number;
}

export const T0 = Date.parse("2026-11-24T17:58:00Z");

/** A `recent` entry with every field sparkDash writes, untrusted text included. */
export function entry(e: Entry): Record<string, unknown> {
  const unitId = e.unitId ?? "delphi";
  const ruleId = e.ruleId ?? "thermal";
  const startsAt = e.startsAt ?? T0;
  return {
    id: e.id,
    at: e.at ?? startsAt + e.id * 1000,
    status: e.status,
    key: `${unitId}:${ruleId}`,
    ruleId,
    ruleName: "GPU <b>temperature</b>",
    unitId,
    unitName: "Delphi at 10.0.0.5",
    severity: e.severity ?? "warning",
    label: "GPU0 91C",
    summary: "ssh: connect to host 10.0.0.5 port 22: Connection refused",
    startsAt,
    endsAt: e.status === "resolved" ? (e.at ?? startsAt + e.id * 1000) : null,
  };
}

/** An `active` entry, as `_public` renders it. */
export function activeAlert(
  unitId = "delphi",
  ruleId = "thermal",
  startsAt = T0,
): Record<string, unknown> {
  return {
    key: `${unitId}:${ruleId}`,
    ruleId,
    ruleName: "GPU temperature",
    unitId,
    unitName: "Delphi at fe80::1",
    severity: "warning",
    peakSeverity: "critical",
    state: "firing",
    label: "<script>alert(1)</script>",
    summary: "kernel: NVRM: Xid 79 at 192.168.1.20",
    startsAt,
    firingAt: startsAt,
    endsAt: null,
    status: "firing",
  };
}

/** `/api/alerts`; `recent` given oldest first, rendered newest first as sparkDash does. */
export function alertsBody(
  recent: Record<string, unknown>[] = [],
  active: Record<string, unknown>[] = [],
  enabled = true,
): string {
  return JSON.stringify({ enabled, active, pending: [], recent: [...recent].reverse() });
}

export function ok(body: string): HttpRead {
  return { status: 200, body };
}

export function read(over: Partial<SparkdashRead> = {}): SparkdashRead {
  return {
    health: ok(JSON.stringify({ ok: true, bindHost: "127.0.0.1", version: "2.91.0" })),
    metrics: ok(metricsText()),
    alerts: ok(alertsBody()),
    ...over,
  };
}

/** History ids from..to, all firing on delphi, each its own occurrence. */
export function range(from: number, to: number): Record<string, unknown>[] {
  return Array.from({ length: to - from + 1 }, (_, i) =>
    entry({ id: from + i, status: "firing", startsAt: T0 + (from + i) * 60_000 }),
  );
}
