import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { PRODUCT_VERSION } from "@zs-home/shared-contracts/workers";
import { COMPANY_SDK_MCP_TOOLS, dispatchMcpTool } from "./mcp.js";
import type { CompanyClient } from "./types.js";

/** Every company tool reads: it changes nothing, repeats the same answer and reaches Homer only. */
const TOOL_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

/** An MCP server, over any transport, that registers the read-only company tools. */
export function createCompanyMcpServer(client: CompanyClient): Server {
  const server = new Server(
    { name: "homer-company-sdk", version: PRODUCT_VERSION },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: COMPANY_SDK_MCP_TOOLS.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: {
        type: tool.inputSchema.type,
        properties: { ...tool.inputSchema.properties },
        ...(tool.inputSchema.required === undefined
          ? {}
          : { required: [...tool.inputSchema.required] }),
        additionalProperties: false,
      },
      annotations: { ...TOOL_ANNOTATIONS },
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const result = await dispatchMcpTool(client, request.params.name, request.params.arguments);
    if (result.ok) {
      return { content: [{ type: "text", text: JSON.stringify(result.value) }] };
    }
    return { isError: true, content: [{ type: "text", text: JSON.stringify(result.error) }] };
  });

  return server;
}
