#!/usr/bin/env node

/**
 * mcp-code-context v3.0.1 - Tree-sitter WASM Edition
 * 
 * Complete rewrite with:
 * - Tree-sitter WASM for 100% AST accuracy (TypeScript, Python, PHP, Dart)
 * - Zero native dependencies (no Visual Studio, node-gyp, or Python required)
 * - 100% portable across Windows/Mac/Linux
 * - Async-first architecture
 * - Mandatory security boundaries
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import { CodeContextEngine } from "./core/engine.js";
import { ParserRegistry } from "./parsers/registry.js";
import { SecurityValidator } from "./core/validator.js";
import { replaceSymbol, insertCode, removeSymbol, writeFile } from "./operations/write.js";

const SERVER_NAME = "mcp-code-context";
const SERVER_VERSION = "3.0.1";

// Global instances
let engine: CodeContextEngine;
let registry: ParserRegistry;

const server = new Server(
  { name: SERVER_NAME, version: SERVER_VERSION },
  { capabilities: { tools: {} } }
);

const TOOLS = [
  {
    name: "parse_file",
    description: "Parse a file using Tree-sitter and extract symbols",
    inputSchema: {
      type: "object" as const,
      properties: {
        filePath: { type: "string", description: "Absolute path to file" },
        projectRoot: { type: "string", description: "Project root (REQUIRED)" },
      },
      required: ["filePath", "projectRoot"],
    },
  },
  {
    name: "replace_symbol",
    description: "Replace a symbol (function/class/method) with new code",
    inputSchema: {
      type: "object" as const,
      properties: {
        filePath: { type: "string", description: "Absolute path to file" },
        projectRoot: { type: "string", description: "Project root (REQUIRED)" },
        symbolName: { type: "string", description: "Symbol to replace" },
        newContent: { type: "string", description: "New code" },
        className: { type: "string", description: "Class name (optional, for scoping)" },
      },
      required: ["filePath", "projectRoot", "symbolName", "newContent"],
    },
  },
  {
    name: "insert_code",
    description: "Insert code at a specific location",
    inputSchema: {
      type: "object" as const,
      properties: {
        filePath: { type: "string", description: "Absolute path to file" },
        projectRoot: { type: "string", description: "Project root (REQUIRED)" },
        code: { type: "string", description: "Code to insert" },
        anchorSymbol: { type: "string", description: "Symbol to position relative to" },
        position: { type: "string", enum: ["before", "after", "inside_start", "inside_end"], description: "Where to insert" },
        className: { type: "string", description: "Class name (optional)" },
      },
      required: ["filePath", "projectRoot", "code"],
    },
  },
  {
    name: "remove_symbol",
    description: "Remove a symbol from file",
    inputSchema: {
      type: "object" as const,
      properties: {
        filePath: { type: "string", description: "Absolute path to file" },
        projectRoot: { type: "string", description: "Project root (REQUIRED)" },
        symbolName: { type: "string", description: "Symbol to remove" },
        className: { type: "string", description: "Class name (optional)" },
      },
      required: ["filePath", "projectRoot", "symbolName"],
    },
  },
];

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS,
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case "parse_file":
        return await handleParseFile(args as Record<string, unknown>);
      case "replace_symbol":
        return await handleReplaceSymbol(args as Record<string, unknown>);
      case "insert_code":
        return await handleInsertCode(args as Record<string, unknown>);
      case "remove_symbol":
        return await handleRemoveSymbol(args as Record<string, unknown>);
      default:
        return errorResponse(`Unknown tool: "${name}"`);
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return errorResponse(`Error in tool "${name}": ${message}`);
  }
});

async function handleParseFile(args: Record<string, unknown>) {
  const filePath = args.filePath as string;
  const projectRoot = args.projectRoot as string;

  if (!filePath) return errorResponse("Missing required parameter: filePath");
  if (!projectRoot) return errorResponse("Missing required parameter: projectRoot");

  const validator = new SecurityValidator(projectRoot);
  const validation = await validator.validateFilePath(filePath);

  if (!validation.valid) {
    return errorResponse(validation.error!);
  }

  const fs = await import("node:fs/promises");
  const content = await fs.readFile(validation.resolvedPath!, "utf-8");

  const path = await import("node:path");
  const ext = path.extname(validation.resolvedPath!);
  const parser = registry.getParser(ext);

  if (!parser) {
    return errorResponse(`No parser available for extension: ${ext}`);
  }

  const tree = parser.parse(content);
  const symbols = parser.findSymbols(tree);

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify({ file: filePath, symbols }, null, 2),
      },
    ],
  };
}

async function handleReplaceSymbol(args: Record<string, unknown>) {
  const filePath = args.filePath as string;
  const projectRoot = args.projectRoot as string;
  const symbolName = args.symbolName as string;
  const newContent = args.newContent as string;
  const className = args.className as string | undefined;

  if (!filePath) return errorResponse("Missing: filePath");
  if (!projectRoot) return errorResponse("Missing: projectRoot");
  if (!symbolName) return errorResponse("Missing: symbolName");
  if (!newContent) return errorResponse("Missing: newContent");

  const path = await import("node:path");
  const ext = path.extname(filePath);
  const parser = registry.getParser(ext);
  if (!parser) return errorResponse(`No parser for: ${ext}`);

  const result = await replaceSymbol({ filePath, projectRoot, symbolName, newContent, className, parser });
  
  if (!result.success) {
    return errorResponse(result.error!);
  }

  // Write to file
  const validator = new SecurityValidator(projectRoot);
  const validation = await validator.validateFilePath(filePath);
  if (validation.valid) {
    await writeFile(validation.resolvedPath!, result.newContent!);
  }

  return {
    content: [{ type: "text" as const, text: `✅ Replaced "${symbolName}"\n\n${result.diff}` }],
  };
}

async function handleInsertCode(args: Record<string, unknown>) {
  const filePath = args.filePath as string;
  const projectRoot = args.projectRoot as string;
  const code = args.code as string;
  const anchorSymbol = args.anchorSymbol as string | undefined;
  const position = args.position as "before" | "after" | "inside_start" | "inside_end" | undefined;
  const className = args.className as string | undefined;

  if (!filePath) return errorResponse("Missing: filePath");
  if (!projectRoot) return errorResponse("Missing: projectRoot");
  if (!code) return errorResponse("Missing: code");

  const path = await import("node:path");
  const ext = path.extname(filePath);
  const parser = registry.getParser(ext);
  if (!parser) return errorResponse(`No parser for: ${ext}`);

  const result = await insertCode({ filePath, projectRoot, code, anchorSymbol, position, className, parser });
  
  if (!result.success) {
    return errorResponse(result.error!);
  }

  const validator = new SecurityValidator(projectRoot);
  const validation = await validator.validateFilePath(filePath);
  if (validation.valid) {
    await writeFile(validation.resolvedPath!, result.newContent!);
  }

  return {
    content: [{ type: "text" as const, text: `✅ Code inserted\n\n${result.diff}` }],
  };
}

async function handleRemoveSymbol(args: Record<string, unknown>) {
  const filePath = args.filePath as string;
  const projectRoot = args.projectRoot as string;
  const symbolName = args.symbolName as string;
  const className = args.className as string | undefined;

  if (!filePath) return errorResponse("Missing: filePath");
  if (!projectRoot) return errorResponse("Missing: projectRoot");
  if (!symbolName) return errorResponse("Missing: symbolName");

  const path = await import("node:path");
  const ext = path.extname(filePath);
  const parser = registry.getParser(ext);
  if (!parser) return errorResponse(`No parser for: ${ext}`);

  const result = await removeSymbol({ filePath, projectRoot, symbolName, className, parser });
  
  if (!result.success) {
    return errorResponse(result.error!);
  }

  const validator = new SecurityValidator(projectRoot);
  const validation = await validator.validateFilePath(filePath);
  if (validation.valid) {
    await writeFile(validation.resolvedPath!, result.newContent!);
  }

  return {
    content: [{ type: "text" as const, text: `✅ Removed "${symbolName}"\n\n${result.diff}` }],
  };
}

function errorResponse(message: string) {
  return {
    content: [{ type: "text" as const, text: `❌ ${message}` }],
    isError: true,
  };
}

async function main(): Promise<void> {
  console.error("🚀 Initializing mcp-code-context v3.0.0 (WASM)...");

  engine = new CodeContextEngine();
  await engine.init();

  registry = new ParserRegistry(engine);
  await registry.init();

  console.error("✅ Engine initialized with Tree-sitter WASM (portable)");

  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error(`🚀 ${SERVER_NAME} v${SERVER_VERSION} running on stdio`);
}

import { fileURLToPath, pathToFileURL } from "node:url";

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error("Fatal error starting MCP server:", error);
    process.exit(1);
  });
}
