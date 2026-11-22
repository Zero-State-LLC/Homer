import { DurableObject } from "cloudflare:workers";
export const MAX_RUNNER_BYTES = 64 * 1024;
export interface RunnerMachine {
  id: string;
  alias: string;
  kind: "pc" | "mac";
  os: "windows" | "linux" | "macos";
  architecture: "x64" | "arm64";
  runnerId: number | null;
  repository: string;
  labels: string[];
  desiredState: "enabled" | "maintenance";
}
export interface RunnerConfig {
  version: 1;
  revision: number;
  machines: RunnerMachine[];
}
function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("invalid_config");
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== keys.length || keys.some((k) => !Object.hasOwn(record, k)))
    throw new Error("invalid_config");
  return record;
}
export function parseRunnerConfig(value: unknown): RunnerConfig {
  const v = object(value, ["version", "revision", "machines"]);
  if (
    v.version !== 1 ||
    !Number.isSafeInteger(v.revision) ||
    (v.revision as number) < 0 ||
    !Array.isArray(v.machines) ||
    v.machines.length > 50
  )
    throw new Error("invalid_config");
  const ids = new Set<string>();
  const runnerIds = new Set<number>();
  const machines = v.machines.map((value) => {
    const m = object(value, [
      "id",
      "alias",
      "kind",
      "os",
      "architecture",
      "runnerId",
      "repository",
      "labels",
      "desiredState",
    ]);
    if (
      typeof m.id !== "string" ||
      !/^[a-z0-9][a-z0-9-]{0,63}$/.test(m.id) ||
      ids.has(m.id) ||
      typeof m.alias !== "string" ||
      m.alias.length < 1 ||
      m.alias.length > 80 ||
      m.alias.trim() !== m.alias ||
      [...m.alias].some(
        (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
      ) ||
      !(
        (m.kind === "pc" && (m.os === "windows" || m.os === "linux")) ||
        (m.kind === "mac" && m.os === "macos")
      ) ||
      !["x64", "arm64"].includes(m.architecture as string) ||
      !(m.runnerId === null || (Number.isSafeInteger(m.runnerId) && (m.runnerId as number) > 0)) ||
      typeof m.repository !== "string" ||
      !/^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9_.-]{1,100}$/.test(m.repository) ||
      !Array.isArray(m.labels) ||
      m.labels.length > 20 ||
      m.labels.some((l) => typeof l !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/.test(l)) ||
      new Set(m.labels.map((l) => (l as string).toLowerCase())).size !== m.labels.length ||
      !["enabled", "maintenance"].includes(m.desiredState as string)
    )
      throw new Error("invalid_config");
    ids.add(m.id);
    if (m.runnerId !== null) {
      if (runnerIds.has(m.runnerId as number)) throw new Error("invalid_config");
      runnerIds.add(m.runnerId as number);
    }
    return m as unknown as RunnerMachine;
  });
  return { version: 1, revision: v.revision as number, machines };
}
export class RunnerFleetObject extends DurableObject<unknown> {
  constructor(ctx: DurableObjectState, env: unknown) {
    super(ctx, env);
    ctx.storage.sql
      .exec(`CREATE TABLE IF NOT EXISTS runner_history (revision INTEGER PRIMARY KEY, previous_revision INTEGER NOT NULL, config TEXT NOT NULL, operator_digest TEXT NOT NULL, requested_at TEXT NOT NULL) STRICT;
 CREATE TRIGGER IF NOT EXISTS runner_no_update BEFORE UPDATE ON runner_history BEGIN SELECT RAISE(ABORT,'Runner history is immutable'); END;
 CREATE TRIGGER IF NOT EXISTS runner_no_delete BEFORE DELETE ON runner_history BEGIN SELECT RAISE(ABORT,'Runner history is immutable'); END;`);
  }
  read() {
    const row = this.ctx.storage.sql
      .exec<{
        revision: number;
        previous_revision: number;
        config: string;
        operator_digest: string;
        requested_at: string;
      }>("SELECT * FROM runner_history ORDER BY revision DESC LIMIT 1")
      .toArray()[0];
    return {
      config: row
        ? parseRunnerConfig(JSON.parse(row.config))
        : { version: 1 as const, revision: 0, machines: [] },
      observedState: "unknown",
      requestStatus: row ? "pending" : "none",
      audit: row
        ? {
            previousRevision: row.previous_revision,
            operatorDigest: row.operator_digest,
            requestedAt: row.requested_at,
          }
        : null,
    };
  }
  replace(expected: number, input: unknown, operatorDigest: string) {
    const config = parseRunnerConfig(input);
    const encoded = JSON.stringify(config);
    if (
      !Number.isSafeInteger(expected) ||
      expected < 0 ||
      config.revision !== expected + 1 ||
      !/^[a-f0-9]{64}$/.test(operatorDigest) ||
      new TextEncoder().encode(encoded).length > MAX_RUNNER_BYTES
    )
      throw new Error("invalid_config");
    return this.ctx.storage.transactionSync(() => {
      const previous = this.read().config;
      if (previous.revision !== expected) return "conflict";
      if (previous.machines.some((m) => !config.machines.some((n) => n.id === m.id)))
        return "deletion_forbidden";
      this.ctx.storage.sql.exec(
        "INSERT INTO runner_history VALUES (?,?,?,?,?)",
        config.revision,
        expected,
        encoded,
        operatorDigest,
        new Date().toISOString(),
      );
      return "saved";
    });
  }
}
