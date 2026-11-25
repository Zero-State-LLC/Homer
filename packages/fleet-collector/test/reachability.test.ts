import { createServer, type Server } from "node:net";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { applyCheck, checkSshBanner, initialReachability } from "../src/runtime/index.js";

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise((r) => s.close(r))));
});

/** A TCP server on loopback that sends `banner` (or nothing) and records what it received. */
async function listen(banner: string | null): Promise<{ port: number; received: () => number }> {
  let bytes = 0;
  const server = createServer((socket) => {
    socket.on("data", (chunk) => (bytes += chunk.length));
    socket.on("error", () => undefined);
    if (banner !== null) socket.write(banner);
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { port: (server.address() as AddressInfo).port, received: () => bytes };
}

describe("the Reachability Check", () => {
  it("is up for an SSH banner, and sends nothing", async () => {
    const ssh = await listen("SSH-2.0-OpenSSH_9.6\r\n");
    expect(await checkSshBanner("127.0.0.1", ssh.port)).toBe("up");
    await new Promise((r) => setTimeout(r, 50));
    expect(ssh.received()).toBe(0);
  });

  it("fails for an HTTP banner, a refused connection, or no banner within the timeout", async () => {
    const http = await listen("HTTP/1.1 400 Bad Request\r\n");
    expect(await checkSshBanner("127.0.0.1", http.port)).toBe("failure");
    const closed = await listen(null);
    const port = closed.port;
    await new Promise((r) => servers.pop()?.close(r));
    expect(await checkSshBanner("127.0.0.1", port)).toBe("failure");
    const silent = await listen(null);
    expect(await checkSshBanner("127.0.0.1", silent.port, 200)).toBe("failure");
  });

  it("reads at most 255 bytes of a line with no end", async () => {
    const long = await listen("SSH-2.0-" + "x".repeat(1000));
    expect(await checkSshBanner("127.0.0.1", long.port)).toBe("up");
    const junk = await listen("x".repeat(1000));
    expect(await checkSshBanner("127.0.0.1", junk.port)).toBe("failure");
  });

  it("fires after two failures in a row, and clears on the first success afterwards", () => {
    const t = (s: number) => Date.parse("2026-11-24T18:00:00Z") + s * 1000;
    const one = applyCheck(initialReachability(), "failure", t(0));
    expect(one.transition).toBeUndefined();
    expect(one.next.state).toBe("unknown");
    const two = applyCheck(one.next, "failure", t(60));
    expect(two.transition).toEqual({ kind: "machine.alert_fired", startsAt: t(0) });
    expect(two.next.state).toBe("down");
    const three = applyCheck(two.next, "failure", t(120));
    expect(three.transition).toBeUndefined();
    const back = applyCheck(three.next, "up", t(180));
    expect(back.transition).toEqual({ kind: "machine.alert_cleared", startsAt: t(0) });
    expect(back.next).toEqual({
      state: "up",
      failures: 0,
      failingSince: null,
      lastSuccessAt: t(180),
    });
    // One failure between successes is not down.
    const blip = applyCheck(applyCheck(back.next, "failure", t(240)).next, "up", t(300));
    expect(blip.transition).toBeUndefined();
  });
});
