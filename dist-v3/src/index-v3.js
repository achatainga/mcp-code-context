#!/usr/bin/env node
/**
 * mcp-code-context v3.0.0 - Tree-sitter Edition
 *
 * Complete rewrite with:
 * - Tree-sitter WASM for 100% accuracy
 * - Async-first architecture
 * - Mandatory security boundaries
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema, } from "@modelcontextprotocol/sdk/types.js";
import { CodeContextEngine } from "./core/engine.js";
import { ParserRegistry } from "./parsers/registry.js";
import { SecurityValidator } from "./core/validator.js";
const SERVER_NAME = "mcp-code-context";
const SERVER_VERSION = "3.0.0";
// Global instances
let engine;
let registry;
const server = new Server({ name: SERVER_NAME, version: SERVER_VERSION }, { capabilities: { tools: {} } });
const TOOLS = [
    {
        name: "parse_file",
        description: "Parse a file using Tree-sitter and extract symbols",
        inputSchema: {
            type: "object",
            properties: {
                filePath: { type: "string", description: "Absolute path to file" },
                projectRoot: { type: "string", description: "Project root (REQUIRED)" },
            },
            required: ["filePath", "projectRoot"],
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
                return await handleParseFile(args);
            default:
                return errorResponse(`Unknown tool: "${name}"`);
        }
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return errorResponse(`Error in tool "${name}": ${message}`);
    }
});
async function handleParseFile(args) {
    const filePath = args.filePath;
    const projectRoot = args.projectRoot;
    if (!filePath)
        return errorResponse("Missing required parameter: filePath");
    if (!projectRoot)
        return errorResponse("Missing required parameter: projectRoot");
    const validator = new SecurityValidator(projectRoot);
    const validation = await validator.validateFilePath(filePath);
    if (!validation.valid) {
        return errorResponse(validation.error);
    }
    const fs = await import("node:fs/promises");
    const content = await fs.readFile(validation.resolvedPath, "utf-8");
    const path = await import("node:path");
    const ext = path.extname(validation.resolvedPath);
    const parser = registry.getParser(ext);
    if (!parser) {
        return errorResponse(`No parser available for extension: ${ext}`);
    }
    const tree = parser.parse(content);
    const symbols = parser.findSymbols(tree);
    return {
        content: [
            {
                type: "text",
                text: JSON.stringify({ file: filePath, symbols }, null, 2),
            },
        ],
    };
}
function errorResponse(message) {
    return {
        content: [{ type: "text", text: `❌ ${message}` }],
        isError: true,
    };
}
async function main() {
    console.error("🚀 Initializing mcp-code-context v3.0.0...");
    engine = new CodeContextEngine();
    await engine.init();
    registry = new ParserRegistry(engine);
    await registry.init();
    console.error("✅ Engine initialized with Tree-sitter");
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error(`🚀 ${SERVER_NAME} v${SERVER_VERSION} running on stdio`);
}
import { pathToFileURL } from "node:url";
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
    main().catch((error) => {
        console.error("Fatal error starting MCP server:", error);
        process.exit(1);
    });
}
//# sourceMappingURL=index-v3.js.map