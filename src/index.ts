#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { logger } from "./logger.js";
import { createMcpServer } from "./server.js";

async function main(): Promise<void> {
  const { server } = await createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info("stdio MCP server ready");
}

main().catch((error: unknown) => {
  logger.error("server startup failed", error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
