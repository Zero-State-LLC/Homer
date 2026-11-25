import { MACHINE_ID, MACHINE_NAME, hasIpAddress } from "@zs-home/shared-contracts";

/**
 * The Fleet Collector's configuration, `fleet-collector.json` on its host
 * (fleet monitoring spec, "Collector configuration and state"). It holds no
 * credential. Addresses in it stay on the host: no report carries one.
 */
export interface CollectorConfig {
  /** sparkDash's origin, loopback only. */
  sparkdashUrl: string;
  /** The sparkDash release the Collector was checked against. */
  pinnedVersion: string;
  /** homer-intake's Fleet Report route, `https://`. */
  intakeUrl: string;
  /** The front door's `https://` origin for the sparkDash page: `provenance.sourceUrl`. */
  frontDoorOrigin: string;
  machines: ConfiguredMachine[];
}

/** A Machine sparkDash reads, by its sparkDash unit id. */
export interface SparkdashMachine {
  machineId: string;
  sparkdashUnit: string;
}
/** A Machine only the Reachability Check reads. */
export interface SshMachine {
  machineId: string;
  name?: string;
  ssh: { host: string; port: number };
}
export type ConfiguredMachine = SparkdashMachine | SshMachine;

export type ConfigResult = { ok: true; value: CollectorConfig } | { ok: false; errors: string[] };

const UNIT_ID = /^[a-zA-Z0-9._-]{1,64}$/;
const VERSION = /^[0-9A-Za-z][0-9A-Za-z.+-]{0,39}$/;
const HOST = /^[A-Za-z0-9.:[\]-]{1,253}$/;
const LOOPBACK = new Set(["127.0.0.1", "[::1]"]);
const MAX_MACHINES = 64;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function url(value: unknown): URL | undefined {
  if (typeof value !== "string") return undefined;
  try {
    return new URL(value);
  } catch {
    return undefined;
  }
}

function only(value: Record<string, unknown>, keys: string[], where: string, errors: string[]) {
  for (const key of Object.keys(value)) {
    if (!keys.includes(key)) errors.push(`${where}.${key} is not a configuration field`);
  }
}

/** A bare origin: no user, password, path other than `/`, query or fragment. */
function bareOrigin(u: URL): boolean {
  return !u.username && !u.password && u.pathname === "/" && !u.search && !u.hash;
}

/** Checks the configuration as it is read. Errors name fields, never values. */
export function parseCollectorConfig(input: unknown): ConfigResult {
  const errors: string[] = [];
  if (!isRecord(input)) return { ok: false, errors: ["the configuration must be a JSON object"] };
  only(
    input,
    ["sparkdashUrl", "pinnedVersion", "intakeUrl", "frontDoorOrigin", "machines"],
    "config",
    errors,
  );

  const sparkdash = url(input["sparkdashUrl"]);
  if (
    !sparkdash ||
    sparkdash.protocol !== "http:" ||
    !LOOPBACK.has(sparkdash.hostname) ||
    !bareOrigin(sparkdash)
  ) {
    errors.push("sparkdashUrl must be http://127.0.0.1 or http://[::1], with an optional port");
  }
  if (typeof input["pinnedVersion"] !== "string" || !VERSION.test(input["pinnedVersion"])) {
    errors.push("pinnedVersion must be a sparkDash release, such as 2.91.0");
  }
  const intake = url(input["intakeUrl"]);
  if (!intake || intake.protocol !== "https:" || intake.username || intake.password) {
    errors.push("intakeUrl must be an https:// URL with no credentials");
  }
  const frontDoor = url(input["frontDoorOrigin"]);
  if (
    !frontDoor ||
    frontDoor.protocol !== "https:" ||
    !bareOrigin(frontDoor) ||
    hasIpAddress(frontDoor.hostname)
  ) {
    errors.push("frontDoorOrigin must be an https:// origin on a host name, not an address");
  }

  const machines: ConfiguredMachine[] = [];
  const list = input["machines"];
  if (!Array.isArray(list) || list.length === 0 || list.length > MAX_MACHINES) {
    errors.push(`machines must list 1 to ${MAX_MACHINES} machines`);
  } else {
    const ids = new Set<string>();
    const units = new Set<string>();
    list.forEach((entry: unknown, index) => {
      const where = `machines[${index}]`;
      if (!isRecord(entry)) {
        errors.push(`${where} must be an object`);
        return;
      }
      const machineId = entry["machineId"];
      if (typeof machineId !== "string" || !MACHINE_ID.test(machineId)) {
        errors.push(`${where}.machineId must follow the runner fleet configuration's id rule`);
        return;
      }
      if (ids.has(machineId)) errors.push(`${where}.machineId is listed twice`);
      ids.add(machineId);
      const unit = entry["sparkdashUnit"];
      const ssh = entry["ssh"];
      if ((unit === undefined) === (ssh === undefined)) {
        errors.push(`${where} must have exactly one of sparkdashUnit and ssh`);
        return;
      }
      if (unit !== undefined) {
        only(entry, ["machineId", "sparkdashUnit"], where, errors);
        if (typeof unit !== "string" || !UNIT_ID.test(unit)) {
          errors.push(`${where}.sparkdashUnit must be a sparkDash unit id`);
          return;
        }
        if (units.has(unit)) errors.push(`${where}.sparkdashUnit is mapped twice`);
        units.add(unit);
        machines.push({ machineId, sparkdashUnit: unit });
        return;
      }
      only(entry, ["machineId", "name", "ssh"], where, errors);
      const name = entry["name"];
      if (name !== undefined && (typeof name !== "string" || !MACHINE_NAME.test(name))) {
        errors.push(`${where}.name must be at most 40 letters, digits, spaces, '.', '_' or '-'`);
      }
      if (!isRecord(ssh) || typeof ssh["host"] !== "string" || !HOST.test(ssh["host"])) {
        errors.push(`${where}.ssh.host must be a host name or address`);
        return;
      }
      only(ssh, ["host", "port"], `${where}.ssh`, errors);
      const port = ssh["port"] ?? 22;
      if (!Number.isInteger(port) || (port as number) < 1 || (port as number) > 65535) {
        errors.push(`${where}.ssh.port must be 1 to 65535`);
        return;
      }
      machines.push({
        machineId,
        ...(typeof name === "string" ? { name } : {}),
        ssh: { host: ssh["host"], port: port as number },
      });
    });
  }
  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      sparkdashUrl: input["sparkdashUrl"] as string,
      pinnedVersion: input["pinnedVersion"] as string,
      intakeUrl: input["intakeUrl"] as string,
      frontDoorOrigin: (frontDoor as URL).origin,
      machines,
    },
  };
}
