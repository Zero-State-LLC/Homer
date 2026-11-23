import { describe, expect, test } from "vitest";
import {
  lineSplitter,
  runAcpTurn,
  type AcpTransport,
  type Timers,
  type TurnOptions,
} from "../src/index.js";

type Message = Record<string, unknown>;

/** A scripted agent on the other end of the transport. */
function fakeAgent(handle: (message: Message, reply: (body: Message) => void) => void) {
  let lineListener: (line: string) => void = () => undefined;
  let closeListener: () => void = () => undefined;
  const sent: Message[] = [];
  const reply = (body: Message) => queueMicrotask(() => lineListener(JSON.stringify(body)));
  const transport: AcpTransport = {
    send: (line) => {
      const message = JSON.parse(line) as Message;
      sent.push(message);
      handle(message, reply);
    },
    onLine: (listener) => {
      lineListener = listener;
    },
    onClose: (listener) => {
      closeListener = listener;
    },
  };
  return {
    transport,
    sent,
    raw: (line: string) => lineListener(line),
    close: () => closeListener(),
  };
}

function manualTimers() {
  const callbacks = new Map<number, () => void>();
  let next = 1;
  const timers: Timers = {
    setTimeout: (callback) => {
      callbacks.set(next, callback);
      return next++;
    },
    clearTimeout: (handle) => {
      callbacks.delete(handle as number);
    },
  };
  return {
    timers,
    fireAll: () => {
      for (const [id, callback] of [...callbacks]) {
        callbacks.delete(id);
        callback();
      }
    },
  };
}

const allowOnce = { outcome: { outcome: "selected", optionId: "a1" } } as const;

function options(extra: Partial<TurnOptions> = {}): TurnOptions {
  return {
    cwd: "/workspace",
    prompt: "Curate.",
    decide: () => allowOnce,
    timeoutMs: 1000,
    clientVersion: "1.2.3",
    ...extra,
  };
}

const chunk = (text: string) => ({
  jsonrpc: "2.0",
  method: "session/update",
  params: {
    sessionId: "s1",
    update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text } },
  },
});

/** Answers setup, then runs `during` when the prompt arrives. */
function standard(
  during: (prompt: Message, reply: (body: Message) => void) => void,
): (message: Message, reply: (body: Message) => void) => void {
  return (message, reply) => {
    if (message.method === "initialize") {
      reply({ jsonrpc: "2.0", id: message.id, result: { protocolVersion: 1, authMethods: [] } });
    } else if (message.method === "session/new") {
      reply({ jsonrpc: "2.0", id: message.id, result: { sessionId: "s1" } });
    } else if (message.method === "session/prompt") {
      during(message, reply);
    }
  };
}

describe("an ACP turn", () => {
  test("sets up, answers permissions with the policy, and keeps only the last message", async () => {
    const decisions: unknown[] = [];
    const agent = fakeAgent(
      standard((prompt, reply) => {
        reply(chunk("Let me look."));
        reply({
          jsonrpc: "2.0",
          id: "p1",
          method: "session/request_permission",
          params: { sessionId: "s1", toolCall: { kind: "edit" }, options: [] },
        });
        reply({
          jsonrpc: "2.0",
          method: "session/update",
          params: { sessionId: "s1", update: { sessionUpdate: "tool_call", toolCallId: "t1" } },
        });
        reply(chunk("Done.\n```json\n"));
        reply(chunk('{"flags":[]}\n```'));
        reply({ jsonrpc: "2.0", id: prompt.id, result: { stopReason: "end_turn" } });
      }),
    );
    const result = await runAcpTurn(
      agent.transport,
      options({
        decide: (request) => {
          decisions.push(request);
          return allowOnce;
        },
      }),
    );
    expect(result).toEqual({ outcome: "completed", report: 'Done.\n```json\n{"flags":[]}\n```' });
    expect(decisions).toEqual([{ sessionId: "s1", toolCall: { kind: "edit" }, options: [] }]);
    expect(agent.sent[0]).toMatchObject({
      method: "initialize",
      params: {
        protocolVersion: 1,
        clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
      },
    });
    expect(agent.sent[1]).toMatchObject({
      method: "session/new",
      params: { cwd: "/workspace", mcpServers: [] },
    });
    expect(agent.sent[2]).toMatchObject({
      method: "session/prompt",
      params: { sessionId: "s1", prompt: [{ type: "text", text: "Curate." }] },
    });
    expect(agent.sent[3]).toEqual({ jsonrpc: "2.0", id: "p1", result: allowOnce });
  });

  test("file and terminal requests are refused as unsupported", async () => {
    const agent = fakeAgent(
      standard((prompt, reply) => {
        reply({ jsonrpc: "2.0", id: 9, method: "fs/read_text_file", params: { path: "/etc/x" } });
        reply({ jsonrpc: "2.0", id: 10, method: "terminal/create", params: {} });
        reply({ jsonrpc: "2.0", id: prompt.id, result: { stopReason: "end_turn" } });
      }),
    );
    await runAcpTurn(agent.transport, options());
    const errors = agent.sent.filter((m) => m.error !== undefined);
    expect(errors).toEqual([
      { jsonrpc: "2.0", id: 9, error: { code: -32601, message: "Method not found" } },
      { jsonrpc: "2.0", id: 10, error: { code: -32601, message: "Method not found" } },
    ]);
  });

  test("a timeout cancels the turn and reports a timed-out session", async () => {
    const clock = manualTimers();
    let promptSeen: () => void = () => undefined;
    const prompted = new Promise<void>((resolve) => {
      promptSeen = resolve;
    });
    const agent = fakeAgent(
      standard((_prompt, reply) => {
        // Starts working and never answers the prompt.
        reply(chunk("Working"));
        promptSeen();
      }),
    );
    const turn = runAcpTurn(agent.transport, options({ timers: clock.timers }));
    await prompted;
    await new Promise((resolve) => setTimeout(resolve, 0));
    clock.fireAll(); // the session limit
    await new Promise((resolve) => setTimeout(resolve, 0));
    clock.fireAll(); // the grace period
    const result = await turn;
    expect(result).toEqual({ outcome: "timed_out", report: "Working" });
    expect(agent.sent.at(-1)).toEqual({
      jsonrpc: "2.0",
      method: "session/cancel",
      params: { sessionId: "s1" },
    });
  });

  test("a harness that hangs during setup times out without a prompt", async () => {
    const clock = manualTimers();
    const agent = fakeAgent(() => undefined);
    const turn = runAcpTurn(agent.transport, options({ timers: clock.timers }));
    clock.fireAll();
    expect(await turn).toEqual({ outcome: "timed_out", report: null });
    expect(agent.sent.map((m) => m.method)).toEqual(["initialize"]);
  });

  test("a broken stream, garbage, a version mismatch, a huge id or a refusal fails", async () => {
    const closing = fakeAgent((message) => {
      if (message.method === "initialize") queueMicrotask(() => closing.close());
    });
    expect(await runAcpTurn(closing.transport, options())).toEqual({
      outcome: "failed",
      report: null,
    });

    const garbage = fakeAgent((message) => {
      if (message.method === "initialize") queueMicrotask(() => garbage.raw("not json"));
    });
    expect((await runAcpTurn(garbage.transport, options())).outcome).toBe("failed");

    const wrongVersion = fakeAgent((message, reply) => {
      reply({ jsonrpc: "2.0", id: message.id, result: { protocolVersion: 2 } });
    });
    expect((await runAcpTurn(wrongVersion.transport, options())).outcome).toBe("failed");

    const longId = fakeAgent(
      standard((prompt, reply) => {
        reply({ jsonrpc: "2.0", id: "x".repeat(300), method: "fs/read_text_file", params: {} });
        reply({ jsonrpc: "2.0", id: prompt.id, result: { stopReason: "end_turn" } });
      }),
    );
    expect((await runAcpTurn(longId.transport, options())).outcome).toBe("failed");
    expect(longId.sent.some((m) => m.error !== undefined)).toBe(false);

    const refusal = fakeAgent(
      standard((prompt, reply) => {
        reply({ jsonrpc: "2.0", id: prompt.id, result: { stopReason: "refusal" } });
      }),
    );
    expect((await runAcpTurn(refusal.transport, options())).outcome).toBe("failed");
  });

  test("an oversized last message gives no report", async () => {
    const agent = fakeAgent(
      standard((prompt, reply) => {
        reply(chunk("x".repeat(40_000)));
        reply(chunk("y".repeat(40_000)));
        reply({ jsonrpc: "2.0", id: prompt.id, result: { stopReason: "end_turn" } });
      }),
    );
    expect(await runAcpTurn(agent.transport, options())).toEqual({
      outcome: "completed",
      report: null,
    });
  });
});

describe("line splitting", () => {
  test("lines are split across chunks, and CRLF and blank lines are tolerated", () => {
    const lines: string[] = [];
    const feed = lineSplitter(
      (line) => lines.push(line),
      () => lines.push("overflow"),
    );
    feed('{"a":');
    feed('1}\r\n\n{"b":2}\n{"c"');
    expect(lines).toEqual(['{"a":1}', '{"b":2}']);
    feed(":3}\n");
    expect(lines).toEqual(['{"a":1}', '{"b":2}', '{"c":3}']);
  });

  test("an endless line overflows", () => {
    let overflowed = false;
    const feed = lineSplitter(
      () => undefined,
      () => {
        overflowed = true;
      },
    );
    feed("x".repeat(5 * 1024 * 1024));
    expect(overflowed).toBe(true);
  });
});
