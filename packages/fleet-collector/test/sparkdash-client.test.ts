import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RefusedRequest, checkRequest, sparkdashClient } from "../src/runtime/index.js";
import { initialState, parseCollectorConfig, poll } from "../src/index.js";
import { alertsBody, config, entry, metricsText } from "./fixture.js";

let server: Server;
let origin: string;
const seen: string[] = [];

beforeAll(async () => {
  // A stub sparkDash on loopback, answering as v2.91.0 does.
  server = createServer((req, res) => {
    seen.push(`${req.method} ${req.url}`);
    if (req.url === "/api/health") return res.end(JSON.stringify({ ok: true, version: "2.91.0" }));
    if (req.url === "/metrics") return res.end(metricsText());
    if (req.url === "/api/alerts") return res.end(alertsBody([entry({ id: 1, status: "firing" })]));
    res.statusCode = 404;
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

describe("the sparkDash client", () => {
  it("reads the three paths with GET, and the core maps what it read", async () => {
    const read = await sparkdashClient(origin).readAll();
    expect(seen.slice(-3)).toEqual(["GET /api/health", "GET /metrics", "GET /api/alerts"]);
    const result = poll({
      config,
      state: initialState(),
      read,
      now: Date.parse("2026-11-24T18:00:00Z"),
      queueRoom: 10,
    });
    expect(result.snapshot.sparkdash.state).toBe("ok");
    expect(result.events).toHaveLength(1);
  });

  it("reads the same origin whether or not it ends in a slash", async () => {
    const read = await sparkdashClient(`${origin}/`).readAll();
    expect(read.health).toMatchObject({ status: 200 });
    const parsed = parseCollectorConfig({ ...config, sparkdashUrl: `${origin}/` });
    expect(parsed.ok && parsed.value.sparkdashUrl).toBe(origin);
  });

  it("refuses a POST, a path outside the three, or a non-loopback host, before sending", async () => {
    let sent = 0;
    const client = sparkdashClient(origin, {
      fetch: () => {
        sent++;
        return Promise.resolve(new Response("{}"));
      },
    });
    const refusals: [string, string, string][] = [
      ["POST", `${origin}/api/alerts`, "method"],
      ["PUT", `${origin}/api/alerts/config`, "method"],
      ["DELETE", `${origin}/metrics`, "method"],
      ["GET", `${origin}/api/sparks`, "path"],
      ["GET", `${origin}/api/alerts/config`, "path"],
      ["GET", `${origin}/api/shutdown`, "path"],
      ["GET", `${origin}/metrics?token=x`, "path"],
      ["GET", "http://192.168.1.20:3000/metrics", "host"],
      ["GET", "http://localhost:3000/metrics", "host"],
      ["GET", origin.replace("http:", "https:") + "/metrics", "host"],
      ["GET", "http://127.0.0.1:1/metrics", "host"],
      ["GET", "not a url", "host"],
    ];
    for (const [method, url, reason] of refusals) {
      await expect(client.request(method, url), `${method} ${url}`).rejects.toThrow(RefusedRequest);
      expect(() => checkRequest(method, url, origin)).toThrow(`refused before sending: ${reason}`);
    }
    expect(sent).toBe(0);
    expect(() => sparkdashClient("http://delphi.local:3000")).toThrow(RefusedRequest);
  });

  it("follows no redirect, and reads no answer past its size limit", async () => {
    const redirecting = sparkdashClient(origin, {
      fetch: (_url, init) =>
        init?.redirect === "error"
          ? Promise.reject(new TypeError("redirect"))
          : Promise.resolve(new Response("{}")),
    });
    expect(await redirecting.request("GET", `${origin}/metrics`)).toBe("unreachable");
    const small = sparkdashClient(origin, { maxBytes: 10 });
    expect(await small.request("GET", `${origin}/metrics`)).toEqual({ status: -1, body: "" });
  });
});
