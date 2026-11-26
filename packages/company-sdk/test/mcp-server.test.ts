import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { projectFleetStatus } from "@zs-home/projections";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { runCli, type Connect } from "../src/cli.js";
import { COMPANY_SDK_MCP_TOOLS } from "../src/mcp.js";
import { createCompanyMcpServer } from "../src/mcp-server.js";
import type { CompanyClient, FleetHealthView } from "../src/types.js";

const fleet: FleetHealthView = {
  ...projectFleetStatus(null, [], { now: 0 }),
  sparkdashUrl: null,
  configRevision: 0,
};

function stubClient(): CompanyClient {
  const unused = () => Promise.reject(new Error("not called by this test"));
  return {
    resolveIdentity: unused,
    getProjectStatus: unused,
    getFleetHealth: () => Promise.resolve(fleet),
    getContextPin: unused,
    listKnowledgeFlags: unused,
    getRoutingPolicy: unused,
  };
}

async function connect() {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createCompanyMcpServer(stubClient());
  const client = new Client({ name: "synthetic-client", version: "0.0.0" });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { client, server };
}

it("lists the six read-only tools with read-only annotations", async () => {
  const { client, server } = await connect();
  const listed = await client.listTools();
  expect(listed.tools.map((tool) => tool.name)).toEqual(
    COMPANY_SDK_MCP_TOOLS.map((tool) => tool.name),
  );
  for (const tool of listed.tools) {
    expect(tool.annotations?.readOnlyHint).toBe(true);
    expect(tool.annotations?.destructiveHint).toBe(false);
  }
  await client.close();
  await server.close();
});

it("dispatches a tool call as JSON text, and marks an unknown tool as an error", async () => {
  const { client, server } = await connect();
  const result = await client.callTool({ name: "homer_get_fleet_health", arguments: {} });
  expect(result.isError).toBeFalsy();
  const [block] = result.content as readonly { readonly type: string; readonly text: string }[];
  expect(block).toMatchObject({ type: "text" });
  expect(JSON.parse(block?.text ?? "")).toMatchObject({ state: "none", machines: [] });
  const unknown = await client.callTool({ name: "homer_write_everything", arguments: {} });
  expect(unknown.isError).toBe(true);
  expect(JSON.stringify(unknown.content)).toContain("unknown_tool");
  await client.close();
  await server.close();
});

it("names the env vars and returns 2 without configuration", async () => {
  const lines: string[] = [];
  const code = await runCli({
    env: { HOMER_CATALOG_URL: "https://homer-catalog.example" },
    stderr: (line) => lines.push(line),
  });
  expect(code).toBe(2);
  const text = lines.join("\n");
  expect(text).toContain("HOMER_CATALOG_URL");
  expect(text).toContain("HOMER_ACCESS_CLIENT_ID");
  expect(text).toContain("HOMER_ACCESS_CLIENT_SECRET");
});

it("connects stdio with a client built from the environment", async () => {
  const transports: StdioServerTransport[] = [];
  const connect: Connect = (_server, transport) => {
    transports.push(transport);
    return Promise.resolve();
  };
  const code = await runCli(
    {
      env: {
        HOMER_CATALOG_URL: "https://homer-catalog.example",
        HOMER_ACCESS_CLIENT_ID: "synthetic-client-id",
        HOMER_ACCESS_CLIENT_SECRET: "synthetic-client-secret",
      },
      stderr: () => {},
    },
    connect,
  );
  expect(code).toBe(0);
  expect(transports).toHaveLength(1);
  expect(transports[0]).toBeInstanceOf(StdioServerTransport);
});

it("declares the homer-company-mcp bin", () => {
  const manifest = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  ) as unknown;
  expect(manifest).toMatchObject({ bin: { "homer-company-mcp": "./dist/cli.js" } });
});
