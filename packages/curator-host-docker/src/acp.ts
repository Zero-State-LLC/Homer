/**
 * A minimal ACP client for one headless curator turn. Messages are newline-delimited
 * JSON-RPC 2.0 over the harness's standard input and output. Everything the harness sends is
 * untrusted: it is parsed defensively and never executed.
 */
import {
  MAX_REPORT_CHARS,
  type PermissionResponse,
  type SessionOutcome,
} from "@zs-home/curator-runner";

export const ACP_PROTOCOL_VERSION = 1;
/** Longest single message the client accepts before treating the stream as broken. */
export const MAX_LINE_CHARS = 4 * 1024 * 1024;
/** How long a cancelled turn gets to wind down before the container is stopped anyway. */
export const CANCEL_GRACE_MS = 15_000;

/** Line-oriented access to the harness's standard streams. */
export interface AcpTransport {
  send(line: string): void;
  onLine(listener: (line: string) => void): void;
  /** Called once if the stream breaks or the harness exits. */
  onClose(listener: () => void): void;
}

export interface TurnOptions {
  readonly cwd: string;
  readonly prompt: string;
  readonly decide: (request: unknown) => PermissionResponse;
  readonly timeoutMs: number;
  readonly clientVersion: string;
  /** Test seam; defaults to the real timers. */
  readonly timers?: Timers;
}

export interface Timers {
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

const realTimers: Timers = {
  setTimeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export interface TurnResult {
  readonly outcome: SessionOutcome;
  /** The agent's last message, untrusted, or null if there was none or it was too long. */
  readonly report: string | null;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

class ProtocolError extends Error {}

/** Splits a stream of chunks into lines, refusing any line past the limit. */
export function lineSplitter(onLine: (line: string) => void, onOverflow: () => void) {
  let buffer = "";
  return (chunk: string): void => {
    buffer += chunk;
    let index = buffer.indexOf("\n");
    while (index !== -1) {
      const line = buffer.slice(0, index).replace(/\r$/, "");
      buffer = buffer.slice(index + 1);
      if (line.length > 0) onLine(line);
      index = buffer.indexOf("\n");
    }
    if (buffer.length > MAX_LINE_CHARS) {
      buffer = "";
      onOverflow();
    }
  };
}

/**
 * Tracks the agent's latest message. A message ends when anything else happens, such as a tool
 * call, so the report is the last thing the agent said, not everything it said.
 */
class MessageTracker {
  private current = "";
  private ended = true;
  private overflow = false;

  update(update: Record<string, unknown>): void {
    if (update.sessionUpdate !== "agent_message_chunk") {
      if (update.sessionUpdate !== "agent_thought_chunk") this.ended = true;
      return;
    }
    if (this.ended) {
      this.current = "";
      this.overflow = false;
      this.ended = false;
    }
    const content = update.content;
    if (!record(content) || content.type !== "text" || typeof content.text !== "string") return;
    if (this.overflow) return;
    if (this.current.length + content.text.length > MAX_REPORT_CHARS) {
      this.overflow = true;
      this.current = "";
      return;
    }
    this.current += content.text;
  }

  report(): string | null {
    return this.overflow || this.current === "" ? null : this.current;
  }
}

type Pending = { resolve: (value: unknown) => void; reject: (error: Error) => void };

class AcpConnection {
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private closed = false;
  readonly messages = new MessageTracker();
  private sessionId: string | null = null;

  private readonly transport: AcpTransport;
  private readonly decide: (request: unknown) => PermissionResponse;

  constructor(transport: AcpTransport, decide: (request: unknown) => PermissionResponse) {
    this.transport = transport;
    this.decide = decide;
    transport.onLine((line) => this.receive(line));
    transport.onClose(() => this.fail(new ProtocolError("closed")));
  }

  setSession(sessionId: string): void {
    this.sessionId = sessionId;
  }

  request(method: string, params: unknown): Promise<unknown> {
    if (this.closed) return Promise.reject(new ProtocolError("closed"));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.transport.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
    });
  }

  notify(method: string, params: unknown): void {
    if (!this.closed) this.transport.send(JSON.stringify({ jsonrpc: "2.0", method, params }));
  }

  fail(error: Error): void {
    if (this.closed) return;
    this.closed = true;
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }

  private respond(id: unknown, body: { result: unknown } | { error: unknown }): void {
    if (!this.closed) this.transport.send(JSON.stringify({ jsonrpc: "2.0", id, ...body }));
  }

  private receive(line: string): void {
    let message: unknown;
    try {
      message = JSON.parse(line) as unknown;
    } catch {
      this.fail(new ProtocolError("invalid message"));
      return;
    }
    if (!record(message) || message.jsonrpc !== "2.0") {
      this.fail(new ProtocolError("invalid message"));
      return;
    }
    const { id, method } = message;
    if (typeof method === "string") {
      if (id === undefined) {
        this.notification(method, message.params);
      } else if (typeof id === "string" || typeof id === "number") {
        this.agentRequest(id, method, message.params);
      }
      return;
    }
    if (typeof id !== "number") return;
    const pending = this.pending.get(id);
    if (pending === undefined) return;
    this.pending.delete(id);
    if ("error" in message) pending.reject(new ProtocolError("agent returned an error"));
    else pending.resolve(message.result);
  }

  private notification(method: string, params: unknown): void {
    if (method !== "session/update" || !record(params) || !record(params.update)) return;
    if (this.sessionId !== null && params.sessionId !== this.sessionId) return;
    this.messages.update(params.update);
  }

  private agentRequest(id: string | number, method: string, params: unknown): void {
    if (method === "session/request_permission") {
      this.respond(id, { result: this.decide(params) });
      return;
    }
    // No file-system or terminal capability is advertised, so nothing else is answered.
    this.respond(id, { error: { code: -32601, message: "Method not found" } });
  }
}

/**
 * Runs one prompt turn: initialize, session/new, session/prompt. On timeout it sends
 * session/cancel and waits a short grace period. The caller stops the container afterwards.
 */
export async function runAcpTurn(
  transport: AcpTransport,
  options: TurnOptions,
): Promise<TurnResult> {
  const timers = options.timers ?? realTimers;
  const connection = new AcpConnection(transport, options.decide);
  let timedOut = false;
  let prompting = false;
  let onTimeout: () => void = () => undefined;
  const deadline = new Promise<"timeout">((resolve) => {
    onTimeout = () => resolve("timeout");
  });
  const timer = timers.setTimeout(() => {
    timedOut = true;
    onTimeout();
    // Before the prompt there is no turn to cancel, so stop waiting at once.
    if (!prompting) connection.fail(new ProtocolError("timeout"));
  }, options.timeoutMs);

  const turn = (async (): Promise<SessionOutcome> => {
    const init = await connection.request("initialize", {
      protocolVersion: ACP_PROTOCOL_VERSION,
      clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
      clientInfo: { name: "homer-curator", version: options.clientVersion },
    });
    if (!record(init) || init.protocolVersion !== ACP_PROTOCOL_VERSION) return "failed";
    const session = await connection.request("session/new", { cwd: options.cwd, mcpServers: [] });
    if (!record(session) || typeof session.sessionId !== "string") return "failed";
    connection.setSession(session.sessionId);
    prompting = true;
    const prompt = connection.request("session/prompt", {
      sessionId: session.sessionId,
      prompt: [{ type: "text", text: options.prompt }],
    });
    const first = await Promise.race([prompt, deadline]);
    if (first === "timeout") {
      connection.notify("session/cancel", { sessionId: session.sessionId });
      let grace: unknown;
      await Promise.race([
        prompt.catch(() => undefined),
        new Promise<void>((resolve) => {
          grace = timers.setTimeout(resolve, CANCEL_GRACE_MS);
        }),
      ]);
      timers.clearTimeout(grace);
      return "timed_out";
    }
    if (!record(first)) return "failed";
    switch (first.stopReason) {
      case "end_turn":
      case "max_tokens":
      case "max_turn_requests":
        return "completed";
      default:
        return "failed";
    }
  })();

  let outcome: SessionOutcome;
  try {
    outcome = await turn;
  } catch {
    outcome = timedOut ? "timed_out" : "failed";
  } finally {
    timers.clearTimeout(timer);
    connection.fail(new ProtocolError("finished"));
  }
  return { outcome, report: connection.messages.report() };
}
