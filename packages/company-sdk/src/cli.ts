#!/usr/bin/env node
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createCompanyClient } from "./client.js";
import { createCompanyMcpServer } from "./mcp-server.js";

/** The environment and the stderr sink the CLI reads, so a test can drive both. */
export interface CliIo {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly stderr: (line: string) => void;
}

/** Connects a built server to a transport; the seam a test replaces. */
export type Connect = (server: Server, transport: StdioServerTransport) => Promise<void>;

const USAGE =
  "homer-company-mcp: set HOMER_CATALOG_URL (an https origin), HOMER_ACCESS_CLIENT_ID and " +
  "HOMER_ACCESS_CLIENT_SECRET (an Access service token).";

async function connectStdio(server: Server, transport: StdioServerTransport): Promise<void> {
  await server.connect(transport);
}

/** Builds the read-only client and server, then hands them to `connect`. Returns the exit code. */
export async function runCli(io: CliIo, connect: Connect = connectStdio): Promise<number> {
  const baseUrl = io.env["HOMER_CATALOG_URL"];
  const clientId = io.env["HOMER_ACCESS_CLIENT_ID"];
  const clientSecret = io.env["HOMER_ACCESS_CLIENT_SECRET"];
  if (!baseUrl || !clientId || !clientSecret) {
    io.stderr(USAGE);
    return 2;
  }
  const client = createCompanyClient({
    baseUrl,
    getAccessHeaders: () => ({
      "CF-Access-Client-Id": clientId,
      "CF-Access-Client-Secret": clientSecret,
    }),
  });
  await connect(createCompanyMcpServer(client), new StdioServerTransport());
  return 0;
}

function isMain(): boolean {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isMain()) {
  process.exitCode = await runCli({ env: process.env, stderr: (line) => console.error(line) });
}
