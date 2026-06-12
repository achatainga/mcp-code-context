#!/usr/bin/env node

/**
 * mcp-code-context v3.7.0 - Tree-sitter WASM Edition (thin bootstrap)
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { CodeContextEngine } from "./core/engine.js";
import { ParserRegistry } from "./parsers/registry.js";
import { globalSessionManager } from "./core/sessionManager.js";
import { TOOLS } from "./tools/toolDefinitions.js";
import { setServerInstances } from "./tools/context.js";
import { registerPipeline } from "./tools/pipeline.js";

const SERVER_NAME = "mcp-code-context";
const SERVER_VERSION = "3.7.0";

const server = new Server(
  { name: SERVER_NAME, version: SERVER_VERSION },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

registerPipeline(server);

async function main() {
  const engine = new CodeContextEngine();
  await engine.init();
  const registry = new ParserRegistry(engine);
  await registry.init();
  setServerInstances(engine, registry);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`[${SERVER_NAME}] v${SERVER_VERSION} running on stdio`);
}

const shutdownHandler = () => {
  globalSessionManager.shutdownAll().catch((err) => {
    console.error('[shutdown] Session cleanup error:', err);
  });
};

process.on("SIGINT", shutdownHandler);
process.on("SIGTERM", shutdownHandler);
process.on("exit", shutdownHandler);

main().catch((error) => {
  console.error("Server error:", error);
  process.exit(1);
});
