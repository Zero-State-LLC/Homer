/**
 * Fleet monitoring's fixed text and checks (specs/fleet-monitoring/spec.md): the
 * rule catalogue, the Event Key and subject of a machine alert, and the address
 * check. Workers-safe: no filesystem, no Node built-ins.
 */

/** A Machine's id: the id rule of the runner fleet configuration. */
export const MACHINE_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** A Machine's display name. The Collector replaces anything else with the machineId. */
export const MACHINE_NAME = /^[A-Za-z0-9 ._-]{1,40}$/;

/** A sparkDash rule id, or Homer's own `reachability`. */
export const FLEET_RULE_ID = /^[a-z0-9-]{1,40}$/;

/** The largest Fleet Report body, in bytes. */
export const MAX_FLEET_REPORT_BYTES = 256 * 1024;

export const MACHINE_ALERT_KINDS = ["machine.alert_fired", "machine.alert_cleared"] as const;
export type MachineAlertKind = (typeof MACHINE_ALERT_KINDS)[number];

/**
 * Homer's names for sparkDash's rule ids, and for its own `reachability`. A
 * subject's rule name comes from here, never from sparkDash's text.
 */
export const FLEET_RULE_NAMES: Readonly<Record<string, string>> = Object.freeze({
  offline: "Unit offline",
  throttle: "GPU throttling",
  disk: "Storage",
  llm: "LLM unavailable",
  tailnet: "Tailnet unavailable",
  thermal: "GPU temperature",
  memory: "Unified memory low",
  "low-power": "GPU stuck in low power",
  xid: "NVIDIA Xid error",
  oom: "Out-of-memory kill",
  "roce-link": "RoCE link down",
  "roce-loss": "RoCE packet loss",
  "link-speed": "Slow network link",
  concurrency: "Several models loaded",
  reachability: "SSH unreachable",
});

/**
 * The name of a rule: the catalogue's, `sparkDash rule <id>` for an unknown id
 * that matches the rule id pattern, or undefined for anything else, which the
 * Collector reports as `shape_changed`.
 */
export function fleetRuleName(rule: string): string | undefined {
  if (!FLEET_RULE_ID.test(rule)) return undefined;
  return Object.hasOwn(FLEET_RULE_NAMES, rule) ? FLEET_RULE_NAMES[rule] : `sparkDash rule ${rule}`;
}

export function isMachineAlertKind(kind: unknown): kind is MachineAlertKind {
  return kind === "machine.alert_fired" || kind === "machine.alert_cleared";
}

/** `startsAt` in whole milliseconds since the epoch, or undefined when it does not parse. */
function epochMs(startsAt: string): number | undefined {
  const ms = Date.parse(startsAt);
  return Number.isSafeInteger(ms) && ms >= 0 ? ms : undefined;
}

/** `<source>:<kind>:<machineId>:<rule>:<startsAt in ms>`: one occurrence, one pair of keys. */
export function machineAlertEventKey(
  source: "sparkdash" | "homer",
  kind: MachineAlertKind,
  machineId: string,
  rule: string,
  startsAt: string,
): string | undefined {
  const ms = epochMs(startsAt);
  return ms === undefined ? undefined : `${source}:${kind}:${machineId}:${rule}:${ms}`;
}

/** Provenance's `sourceObjectId`: `<machineId>:<rule>@<startsAt in ms>`. */
export function machineAlertObjectId(
  machineId: string,
  rule: string,
  startsAt: string,
): string | undefined {
  const ms = epochMs(startsAt);
  return ms === undefined ? undefined : `${machineId}:${rule}@${ms}`;
}

/** `<rule name> on <machine name>`, or `<rule name> cleared on <machine name>`. */
export function machineAlertSubject(
  kind: MachineAlertKind,
  rule: string,
  machineName: string,
): string | undefined {
  const name = fleetRuleName(rule);
  if (name === undefined || !MACHINE_NAME.test(machineName)) return undefined;
  return kind === "machine.alert_fired"
    ? `${name} on ${machineName}`
    : `${name} cleared on ${machineName}`;
}

// Four dot-separated groups of one to three digits. Anything shaped like an
// IPv4 address is refused, a four-part version number included.
const IPV4 = /[0-9]{1,3}(?:\.[0-9]{1,3}){3}/;
// Runs of the characters an IPv6 address is written with.
const IPV6_RUN = /[0-9A-Fa-f:.]{2,}/g;

function hasIpv6(text: string): boolean {
  for (const run of text.match(IPV6_RUN) ?? []) {
    if (run.split(":").length < 3) continue;
    const trimmed = run.replace(/^\.+|\.+$/g, "");
    // The URL parser is the authority on IPv6 text, in Node and in Workers.
    for (const candidate of [trimmed, trimmed.replace(/^:(?!:)/, "").replace(/([^:]):$/, "$1")]) {
      try {
        new URL(`http://[${candidate}]/`);
        return true;
      } catch {
        // Not an address.
      }
    }
  }
  return false;
}

/** Whether a string carries an IPv4 or IPv6 address. */
export function hasIpAddress(text: string): boolean {
  return IPV4.test(text) || hasIpv6(text);
}

/**
 * The JSON Pointer of the first string in `value` that carries an IP address,
 * or undefined. Addresses stay on the Collector's host: no Fleet Report or
 * Activity Event carries one.
 */
export function ipAddressIn(value: unknown, path = ""): string | undefined {
  if (typeof value === "string") return hasIpAddress(value) ? path || "/" : undefined;
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      const found = ipAddressIn(item, `${path}/${index}`);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  if (value !== null && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      const found = ipAddressIn(item, `${path}/${key.replace(/~/g, "~0").replace(/\//g, "~1")}`);
      if (found !== undefined) return found;
    }
  }
  return undefined;
}
