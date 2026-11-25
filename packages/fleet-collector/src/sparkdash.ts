import { FLEET_RULE_ID } from "@zs-home/shared-contracts";

/**
 * Parsers for the three sparkDash responses the Collector reads (fleet
 * monitoring spec, "What the Collector reads from sparkDash"). Each keeps only
 * the fields the spec lists. `label`, `summary`, `unitName`, `ruleName`,
 * `peakSeverity` and every other family and label are dropped on read, so
 * nothing else can reach a report. A response that does not match is
 * `shape_changed`: never "no problems".
 */
export const SHAPE_CHANGED = "shape_changed";
export type ShapeChanged = typeof SHAPE_CHANGED;

export type UnitKind = "spark" | "mac" | "host";
export type Severity = "warning" | "critical";

export interface MetricsUnit {
  /** The `unit_name` label, untrusted until cleaned. */
  name: string | undefined;
  kind: UnitKind;
  up: boolean;
  /** The newest `sparkdash_collector_last_success_timestamp_seconds`, in ms. */
  lastSuccessMs: number | undefined;
}

/** One alert in `active`: firing now. */
export interface ActiveAlert {
  key: string;
  ruleId: string;
  unitId: string;
  severity: Severity;
  startsAt: number;
}

/** One transition in `recent`, sparkDash's in-memory history. */
export interface HistoryEntry {
  id: number;
  at: number;
  status: "firing" | "resolved";
  key: string;
  ruleId: string;
  unitId: string;
  severity: Severity;
  startsAt: number;
  endsAt: number | null;
}

export interface AlertsRead {
  enabled: boolean;
  active: ActiveAlert[];
  /** Oldest first, ids contiguous. */
  recent: HistoryEntry[];
}

const UNIT_ID = /^[a-zA-Z0-9._-]{1,64}$/;
const VERSION = /^[0-9A-Za-z][0-9A-Za-z.+-]{0,39}$/;
const KINDS = new Set(["spark", "mac", "host"]);
const SEVERITIES = new Set(["warning", "critical"]);
/** sparkDash keeps the newest 200 transitions. */
export const HISTORY_LIMIT = 200;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function json(body: string): unknown {
  try {
    return JSON.parse(body) as unknown;
  } catch {
    return undefined;
  }
}

/** Epoch milliseconds that make a valid date. */
function isMs(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) < 8.64e15;
}

/** `GET /api/health`: the release only. */
export function parseHealth(body: string): { version: string } | ShapeChanged {
  const value = json(body);
  if (!isRecord(value) || typeof value["version"] !== "string" || !VERSION.test(value["version"]))
    return SHAPE_CHANGED;
  return { version: value["version"] };
}

/** One sample line's name, labels and value, or undefined when it does not parse. */
function sample(
  line: string,
): { name: string; labels: Map<string, string>; value: string } | undefined {
  const match = /^([a-zA-Z_:][a-zA-Z0-9_:]*)(\{|\s)/.exec(line);
  if (!match) return undefined;
  const name = match[1] as string;
  let i = name.length;
  const labels = new Map<string, string>();
  if (line[i] === "{") {
    i++;
    for (;;) {
      if (line[i] === "}") {
        i++;
        break;
      }
      const key = /^([a-zA-Z_][a-zA-Z0-9_]*)="/.exec(line.slice(i));
      if (!key) return undefined;
      i += key[0].length;
      let text = "";
      for (;;) {
        const c = line[i];
        if (c === undefined) return undefined;
        if (c === '"') break;
        if (c === "\\") {
          const next = line[i + 1];
          if (next === "\\") text += "\\";
          else if (next === '"') text += '"';
          else if (next === "n") text += "\n";
          else return undefined;
          i += 2;
          continue;
        }
        text += c;
        i++;
      }
      i++;
      if (labels.has(key[1] as string)) return undefined;
      labels.set(key[1] as string, text);
      if (line[i] === ",") i++;
      else if (line[i] !== "}") return undefined;
    }
  }
  const rest = line.slice(i).trim().split(/\s+/);
  if (rest.length < 1 || rest.length > 2 || rest[0] === "") return undefined;
  return { name, labels, value: rest[0] as string };
}

/**
 * `GET /metrics`: `sparkdash_up` and
 * `sparkdash_collector_last_success_timestamp_seconds`, with their `unit`,
 * `unit_name`, `kind` and `collector` labels. Every other family and label is
 * dropped. sparkDash always describes `sparkdash_up`, even for an empty fleet,
 * so a body without it does not match.
 */
export function parseMetrics(text: string): Map<string, MetricsUnit> | ShapeChanged {
  const units = new Map<string, MetricsUnit>();
  const success = new Map<string, number>();
  let described = false;
  for (const raw of text.split("\n")) {
    const line = raw.trimEnd();
    if (line === "") continue;
    if (line.startsWith("#")) {
      if (line === "# TYPE sparkdash_up gauge") described = true;
      continue;
    }
    if (
      !line.startsWith("sparkdash_up") &&
      !line.startsWith("sparkdash_collector_last_success_timestamp_seconds")
    )
      continue;
    const s = sample(line);
    if (!s) return SHAPE_CHANGED;
    if (s.name === "sparkdash_up") {
      const unit = s.labels.get("unit");
      const kind = s.labels.get("kind") ?? "";
      if (!unit || !UNIT_ID.test(unit) || !KINDS.has(kind) || units.has(unit)) return SHAPE_CHANGED;
      if (s.value !== "0" && s.value !== "1") return SHAPE_CHANGED;
      units.set(unit, {
        name: s.labels.get("unit_name"),
        kind: kind as UnitKind,
        up: s.value === "1",
        lastSuccessMs: undefined,
      });
    } else if (s.name === "sparkdash_collector_last_success_timestamp_seconds") {
      const unit = s.labels.get("unit");
      const seconds = Number(s.value);
      if (!unit || !UNIT_ID.test(unit) || !s.labels.get("collector")) return SHAPE_CHANGED;
      if (!Number.isFinite(seconds) || seconds < 0) return SHAPE_CHANGED;
      const ms = Math.round(seconds * 1000);
      success.set(unit, Math.max(success.get(unit) ?? 0, ms));
    }
  }
  if (!described) return SHAPE_CHANGED;
  for (const [unit, ms] of success) {
    const entry = units.get(unit);
    if (entry) entry.lastSuccessMs = ms;
  }
  return units;
}

function alertFields(value: unknown): ActiveAlert | undefined {
  if (!isRecord(value)) return undefined;
  const { key, ruleId, unitId, severity, startsAt } = value;
  if (
    typeof ruleId !== "string" ||
    !FLEET_RULE_ID.test(ruleId) ||
    // Homer's own rule; sparkDash has none of that name.
    ruleId === "reachability" ||
    typeof unitId !== "string" ||
    !UNIT_ID.test(unitId) ||
    typeof key !== "string" ||
    key !== `${unitId}:${ruleId}` ||
    typeof severity !== "string" ||
    !SEVERITIES.has(severity) ||
    !isMs(startsAt)
  )
    return undefined;
  return { key, ruleId, unitId, severity: severity as Severity, startsAt };
}

/**
 * `GET /api/alerts`: `enabled`, and from `active` and `recent` only `id`,
 * `key`, `ruleId`, `unitId`, `severity`, `status`, `startsAt`, `endsAt` and
 * `at`. sparkDash lists `recent` newest first, numbered by a sequence id that
 * goes up by one with each transition; this returns it oldest first and
 * refuses a history whose ids are not contiguous.
 */
export function parseAlerts(body: string): AlertsRead | ShapeChanged {
  const value = json(body);
  if (
    !isRecord(value) ||
    typeof value["enabled"] !== "boolean" ||
    !Array.isArray(value["active"]) ||
    !Array.isArray(value["recent"]) ||
    value["recent"].length > HISTORY_LIMIT
  )
    return SHAPE_CHANGED;
  const active: ActiveAlert[] = [];
  for (const item of value["active"] as unknown[]) {
    const fields = alertFields(item);
    if (!fields || !isRecord(item) || item["status"] !== "firing") return SHAPE_CHANGED;
    active.push(fields);
  }
  const recent: HistoryEntry[] = [];
  for (const item of value["recent"] as unknown[]) {
    const fields = alertFields(item);
    if (!fields || !isRecord(item)) return SHAPE_CHANGED;
    const { id, at, status, endsAt } = item;
    if (!Number.isSafeInteger(id) || (id as number) < 1 || !isMs(at)) return SHAPE_CHANGED;
    if (status !== "firing" && status !== "resolved") return SHAPE_CHANGED;
    if (status === "firing" ? endsAt !== null : !isMs(endsAt)) return SHAPE_CHANGED;
    recent.push({
      id: id as number,
      at,
      status: status as HistoryEntry["status"],
      key: fields.key,
      ruleId: fields.ruleId,
      unitId: fields.unitId,
      severity: fields.severity,
      startsAt: fields.startsAt,
      endsAt: status === "firing" ? null : (endsAt as number),
    });
  }
  recent.reverse();
  for (let i = 1; i < recent.length; i++) {
    if ((recent[i] as HistoryEntry).id !== (recent[i - 1] as HistoryEntry).id + 1)
      return SHAPE_CHANGED;
  }
  return { enabled: value["enabled"] as boolean, active, recent };
}
