#!/usr/bin/env node

/**
 * mcp-code-context v4.0.0 Enterprise - Tree-sitter WASM Edition
 * Dual Transport Architecture: Stdio + Streamable HTTP / SSE
 */

import http from "node:http";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { CodeContextEngine } from "./core/engine.js";
import { ParserRegistry } from "./parsers/registry.js";
import { globalSessionManager } from "./core/sessionManager.js";
import { globalAuditLogger } from "./utils/auditLogger.js";
import { TOOLS } from "./tools/toolDefinitions.js";
import { setServerInstances } from "./tools/context.js";
import { registerPipeline } from "./tools/pipeline.js";

const SERVER_NAME = "mcp-code-context";
const SERVER_VERSION = "4.0.0";

const server = new Server(
  { name: SERVER_NAME, version: SERVER_VERSION },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

registerPipeline(server);

let httpServer: http.Server | null = null;
const sseTransports = new Map<string, SSEServerTransport>();

async function main() {
  const engine = new CodeContextEngine();
  await engine.init();
  const registry = new ParserRegistry(engine);
  await registry.init();
  setServerInstances(engine, registry);

  const isHttp = process.argv.includes("--http") || process.env.MCP_TRANSPORT === "http";

  if (isHttp) {
    const portArg = process.argv.find((a) => a.startsWith("--port="));
    const port = parseInt(process.env.PORT || (portArg ? portArg.split("=")[1] : "3000"), 10);
    const host = process.env.HOST || "127.0.0.1";

    httpServer = http.createServer(async (req, res) => {
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

      if (req.method === "OPTIONS") {
        res.writeHead(200);
        res.end();
        return;
      }

      const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

      if (url.pathname === "/" || url.pathname === "/health") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            status: "ok",
            server: SERVER_NAME,
            version: SERVER_VERSION,
            transports: ["stdio", "sse", "streamable-http"],
            toolsCount: TOOLS.length,
          })
        );
        return;
      }

      if (url.pathname === "/sse") {
        const transport = new SSEServerTransport("/message", res);
        sseTransports.set(transport.sessionId, transport);
        await server.connect(transport);
        return;
      }

      if (url.pathname === "/message" && req.method === "POST") {
        const sessionId = url.searchParams.get("sessionId");
        const transport = sessionId
          ? sseTransports.get(sessionId)
          : Array.from(sseTransports.values())[0];

        if (!transport) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "No active SSE transport session found" }));
          return;
        }

        await transport.handlePostMessage(req, res);
        return;
      }

      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Endpoint not found" }));
    });

    httpServer.listen(port, host, () => {
      console.error(`[${SERVER_NAME}] v${SERVER_VERSION} listening on http://${host}:${port} (Streamable HTTP / SSE)`);
    });
  } else {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error(`[${SERVER_NAME}] v${SERVER_VERSION} running on stdio`);
  }
}

const shutdownHandler = () => {
  if (httpServer) {
    try {
      httpServer.close();
    } catch {
      // ignore
    }
  }

  globalSessionManager
    .shutdownAll()
    .then(() => globalAuditLogger.stop())
    .then(() => {
      console.error("[shutdown] Cleanup complete. Exiting.");
      process.exit(0);
    })
    .catch((err) => {
      console.error("[shutdown] Session cleanup error:", err);
      process.exit(1);
    });
};

process.on("SIGINT", shutdownHandler);
process.on("SIGTERM", shutdownHandler);
process.on("exit", shutdownHandler);

main().catch((error) => {
  console.error("Server error:", error);
  process.exit(1);
});
