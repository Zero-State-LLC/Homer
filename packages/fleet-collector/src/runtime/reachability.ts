import { connect } from "node:net";

/**
 * The Reachability Check (fleet monitoring spec): open a TCP connection to the
 * machine's SSH port, read its banner, close. Nothing is ever sent: no key, no
 * login, no command. Up only when the first line starts with `SSH-2.0-`.
 */
export type CheckResult = "up" | "failure";
export type SshCheck = (host: string, port: number) => Promise<CheckResult>;

const TIMEOUT_MS = 5_000;
const MAX_BYTES = 255;

export function checkSshBanner(
  host: string,
  port: number,
  timeoutMs = TIMEOUT_MS,
): Promise<CheckResult> {
  return new Promise((resolve) => {
    let settled = false;
    let received = Buffer.alloc(0);
    const socket = connect({ host, port });
    const finish = (result: CheckResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      resolve(result);
    };
    // A timeout for the connection, then a fresh one for the banner.
    let timer = setTimeout(() => finish("failure"), timeoutMs);
    socket.once("connect", () => {
      clearTimeout(timer);
      timer = setTimeout(() => finish("failure"), timeoutMs);
    });
    socket.on("data", (chunk: Buffer) => {
      received = Buffer.concat([received, chunk]).subarray(0, MAX_BYTES);
      const newline = received.indexOf(0x0a);
      if (newline === -1 && received.length < MAX_BYTES) return;
      const line = received.subarray(0, newline === -1 ? received.length : newline);
      finish(line.toString("latin1").startsWith("SSH-2.0-") ? "up" : "failure");
    });
    socket.once("error", () => finish("failure"));
    socket.once("end", () => finish("failure"));
    socket.once("close", () => finish("failure"));
  });
}

/** What the Collector keeps for one machine's Checks. */
export interface ReachabilityState {
  state: "up" | "down" | "unknown";
  /** Failures in a row. */
  failures: number;
  /** When the current run of failures began, in ms: the alert's `startsAt`. */
  failingSince: number | null;
  /** The last successful Check, in ms. */
  lastSuccessAt: number | null;
}

export function initialReachability(): ReachabilityState {
  return { state: "unknown", failures: 0, failingSince: null, lastSuccessAt: null };
}

export interface ReachabilityTransition {
  kind: "machine.alert_fired" | "machine.alert_cleared";
  /** When the condition began, in ms. */
  startsAt: number;
}

/**
 * One Check's result applied: two failures in a row make a machine `down` and
 * fire the alert; the first success afterwards clears it.
 */
export function applyCheck(
  previous: ReachabilityState,
  result: CheckResult,
  at: number,
): { next: ReachabilityState; transition?: ReachabilityTransition } {
  if (result === "up") {
    const next: ReachabilityState = {
      state: "up",
      failures: 0,
      failingSince: null,
      lastSuccessAt: at,
    };
    if (previous.state === "down" && previous.failingSince !== null) {
      return {
        next,
        transition: { kind: "machine.alert_cleared", startsAt: previous.failingSince },
      };
    }
    return { next };
  }
  const failingSince = previous.failingSince ?? at;
  const failures = previous.failures + 1;
  if (failures >= 2 && previous.state !== "down") {
    return {
      next: { ...previous, state: "down", failures, failingSince },
      transition: { kind: "machine.alert_fired", startsAt: failingSince },
    };
  }
  return { next: { ...previous, failures, failingSince } };
}
