#!/usr/bin/env node

/**
 * mcp-code-context — Semantic Code Context Server (v2.3.0 - Refactored)
 *
 * A Model Context Protocol (MCP) server that compresses any code repository
 * into LLM-ready semantic context and provides surgical code editing.
 *
 * Architecture: Modular handlers with centralized utilities
 * - Read handlers: get_semantic_repo_map, read_file_surgical, analyze_impact, etc.
 * - Write handlers: write_file_surgical, insert_symbol, rename_symbol, remove_symbol
 * - Util handlers: rollback_file, clean_backups
 *
 * Transport: stdio (JSON-RPC over stdin/stdout)
 * Compatible with: Claude Desktop, Cursor, Windsurf, Copilot, Amazon Q, and any MCP client.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

// Import handlers
import {
  handleGetSemanticRepoMap,
  handleReadFileSurgical,
  handleAnalyzeImpact,
  handleReadFileLines,
  handleSearchCodePattern,
} from "./handlers/readHandlers.js";

import {
  handleWriteFileSurgical,
  handleInsertSymbol,
  handleRenameSymbol,
  handleRemoveSymbol,
} from "./handlers/writeHandlers.js";

import {
  handleRollbackFile,
  handleCleanBackups,
} from "./handlers/utilHandlers.js";

import { SERVER_NAME, SERVER_VERSION } from "./utils/constants.js";

// ─── MCP Server Instance ────────────────────────────────────────────

const server = new Server(
  { name: SERVER_NAME, version: SERVER_VERSION },
  { capabilities: { tools: {} } },
);

// ─── Tool Definitions ───────────────────────────────────────────────

const TOOLS = [
  {
    name: "get_semantic_repo_map",
    description:
      "Generates a semantically compressed map of a code repository. " +
      "Walks the directory tree respecting .gitignore rules, reads source files, " +
      "and extracts only structural signatures (functions, classes, interfaces, types) " +
      "while stripping implementation bodies. Returns an XML or Markdown document " +
      "optimized for LLM consumption with minimal token usage. " +
      "Supports TypeScript, JavaScript, PHP (AST-based), Dart, and Python. " +
      "Use this to understand the architecture of a large codebase at a glance.",
    inputSchema: {
      type: "object" as const,
      properties: {
        directoryPath: {
          type: "string",
          description:
            "Absolute path to the repository root directory to analyze.",
        },
        format: {
          type: "string",
          enum: ["xml", "markdown"],
          description:
            "Output format for the repo map. 'xml' (default) provides structured data, " +
            "'markdown' provides human-readable output.",
        },
      },
      required: ["directoryPath"],
    },
  },
  {
    name: "read_file_surgical",
    description:
      "Reads the complete source code of a file, or surgically extracts only " +
      "a specific named symbol (function, class, interface, method, type alias). " +
      "When a symbol name is provided, only the full source code block for that " +
      "symbol is returned — saving tokens compared to reading the entire file. " +
      "Supports TypeScript, JavaScript, PHP, Dart, and Python files for symbol extraction.",
    inputSchema: {
      type: "object" as const,
      properties: {
        filePath: {
          type: "string",
          description: "Absolute path to the source file to read.",
        },
        symbolName: {
          type: "string",
          description:
            "Optional. Name of a specific function, class, interface, method, " +
            "or type alias to extract. If omitted, the entire file is returned.",
        },
        className: {
          type: "string",
          description:
            "Optional. Name of the class to scope the symbol search to. " +
            "Use this when multiple classes in the same file have methods with the same name " +
            "(e.g., multiple build() methods in Flutter). If omitted, returns the first match.",
        },
      },
      required: ["filePath"],
    },
  },
  {
    name: "analyze_impact",
    description:
      "Analyzes the impact of modifying a given file by discovering all other " +
      "files in the repository that import or depend on it. Scans for ES import/export, " +
      "CommonJS require(), Python import, PHP use/require_once/include, and Dart import statements. " +
      "Returns a structured report listing all dependent files and the specific " +
      "import statements that create the dependency. Essential for understanding " +
      "blast radius before refactoring.",
    inputSchema: {
      type: "object" as const,
      properties: {
        filePath: {
          type: "string",
          description:
            "Absolute path to the file being modified (the dependency target).",
        },
        rootDir: {
          type: "string",
          description:
            "Optional. Absolute path to the repository root. If omitted, " +
            "the server walks up from filePath to find the nearest directory " +
            "containing package.json, .git, or similar root markers.",
        },
      },
      required: ["filePath"],
    },
  },
  {
    name: "read_file_lines",
    description:
      "Reads specific line ranges from a file without loading the entire content. " +
      "Supports reading by exact line range (startLine/endLine) or around a pattern match. " +
      "More efficient than read_file_surgical when you only need a small fragment of code. " +
      "Perfect for debugging, viewing specific code blocks, or extracting context around errors.",
    inputSchema: {
      type: "object" as const,
      properties: {
        filePath: {
          type: "string",
          description: "Absolute path to the source file to read.",
        },
        startLine: {
          type: "number",
          description: "Starting line number (1-indexed). Required if using exact range mode.",
        },
        endLine: {
          type: "number",
          description: "Ending line number (1-indexed). Required if using exact range mode.",
        },
        aroundPattern: {
          type: "string",
          description:
            "Search pattern to find in the file. Returns lines around the first match. " +
            "Use this mode when you don't know the exact line numbers.",
        },
        contextLines: {
          type: "number",
          description:
            "Number of lines to include before and after the pattern match. " +
            "Defaults to 5. Only used with aroundPattern mode.",
        },
      },
      required: ["filePath"],
    },
  },
  {
    name: "search_code_pattern",
    description:
      "Searches for code patterns across multiple files in a repository. " +
      "Returns matches with file paths, line numbers, and optional context lines. " +
      "Respects .gitignore rules and allows filtering by file extensions. " +
      "More efficient than manual grep when you need structured results with context.",
    inputSchema: {
      type: "object" as const,
      properties: {
        rootDir: {
          type: "string",
          description: "Absolute path to the repository root directory to search.",
        },
        pattern: {
          type: "string",
          description:
            "Regular expression pattern to search for. Use proper regex escaping " +
            "(e.g., 'widget\\\\.height' to match 'widget.height').",
        },
        fileExtensions: {
          type: "array",
          items: { type: "string" },
          description:
            "Array of file extensions to search (e.g., ['.ts', '.dart', '.py']). " +
            "Defaults to common code extensions if omitted.",
        },
        excludeDirs: {
          type: "array",
          items: { type: "string" },
          description:
            "Array of directory names to exclude (e.g., ['node_modules', 'dist']). " +
            "Defaults to common build/dependency directories.",
        },
        showContext: {
          type: "boolean",
          description: "If true, includes surrounding lines for each match. Defaults to true.",
        },
        contextLines: {
          type: "number",
          description: "Number of context lines before/after each match. Defaults to 3.",
        },
        maxResults: {
          type: "number",
          description: "Maximum number of matches to return. Defaults to 50.",
        },
      },
      required: ["rootDir", "pattern"],
    },
  },
  {
    name: "write_file_surgical",
    description:
      "Surgically replaces the full source code of a named symbol (function, class, " +
      "method, interface, type alias) in a file. The AI provides ONLY the replacement " +
      "code for that specific symbol — the tool handles locating it via AST parsing " +
      "and splicing the replacement into the correct position. Supports TypeScript, " +
      "JavaScript, PHP, Dart, and Python. Returns a unified diff of the changes. " +
      "Supports dry-run mode to preview changes without modifying the file.",
    inputSchema: {
      type: "object" as const,
      properties: {
        filePath: {
          type: "string",
          description: "Absolute path to the source file to modify.",
        },
        symbolName: {
          type: "string",
          description:
            "Name of the function, class, method, interface, or type alias to replace.",
        },
        newContent: {
          type: "string",
          description:
            "The complete replacement source code for the symbol, including its " +
            "signature and body. Must be syntactically valid for the target language.",
        },
        className: {
          type: "string",
          description:
            "Optional. Name of the class to scope the symbol search to. " +
            "Use when multiple classes have methods with the same name.",
        },
        confirmationToken: {
          type: "string",
          description:
            "Required for Phase 2. The token provided from the Phase 1 Dry-Run preview.",
        },
        confirm: {
          type: "boolean",
          description:
            "Required for Phase 2. Set to true to confirm and apply the changes.",
        },
        createBackup: {
          type: "boolean",
          description:
            "If true, creates a .bak copy of the file before modifying it. " +
            "Defaults to false (opt-in).",
        },
      },
      required: ["filePath", "symbolName", "newContent"],
    },
  },
  {
    name: "insert_symbol",
    description:
      "Inserts new code at a precise location relative to an existing symbol in a file. " +
      "Can insert before or after a symbol, or inside a class/interface at the start or end. " +
      "If no anchor symbol is provided, inserts at the end of the file. " +
      "Supports TypeScript, JavaScript, PHP, Dart, and Python. " +
      "Automatically matches the surrounding indentation style.",
    inputSchema: {
      type: "object" as const,
      properties: {
        filePath: {
          type: "string",
          description: "Absolute path to the source file to modify.",
        },
        code: {
          type: "string",
          description: "The new code to insert. Must be syntactically valid.",
        },
        anchorSymbol: {
          type: "string",
          description:
            "Name of an existing symbol to position relative to. " +
            "If omitted, code is inserted at the end of the file.",
        },
        position: {
          type: "string",
          enum: ["before", "after", "inside_start", "inside_end"],
          description:
            "Where to insert relative to the anchor. 'before' and 'after' insert " +
            "outside the symbol. 'inside_start' and 'inside_end' insert as members " +
            "inside a class or interface. Defaults to 'after'.",
        },
        className: {
          type: "string",
          description:
            "Optional. Name of the class to scope the anchor symbol search to. " +
            "Use when multiple classes have methods with the same name.",
        },
        confirmationToken: {
          type: "string",
          description:
            "Required for Phase 2. The token provided from the Phase 1 Dry-Run preview.",
        },
        confirm: {
          type: "boolean",
          description:
            "Required for Phase 2. Set to true to confirm and apply the changes.",
        },
        createBackup: {
          type: "boolean",
          description: "If true, backup the file before modifying.",
        },
      },
      required: ["filePath", "code"],
    },
  },
  {
    name: "rename_symbol",
    description:
      "Renames a symbol across an entire repository. Renames the definition in the " +
      "source file AND updates all files that import or reference it. Uses AST-aware " +
      "whole-word replacement to avoid false matches. Supports TypeScript, JavaScript, " +
      "PHP, Dart, and Python. Returns a multi-file diff showing all changes. " +
      "Essential for safe refactoring.",
    inputSchema: {
      type: "object" as const,
      properties: {
        filePath: {
          type: "string",
          description:
            "Absolute path to the file where the symbol is defined.",
        },
        oldName: {
          type: "string",
          description: "The current name of the symbol.",
        },
        newName: {
          type: "string",
          description: "The new name for the symbol.",
        },
        rootDir: {
          type: "string",
          description:
            "Optional. Absolute path to the repository root. " +
            "If omitted, auto-detected from the file path.",
        },
        confirmationToken: {
          type: "string",
          description:
            "Required for Phase 2. The token provided from the Phase 1 Dry-Run preview.",
        },
        confirm: {
          type: "boolean",
          description:
            "Required for Phase 2. Set to true to confirm and apply the changes.",
        },
        createBackup: {
          type: "boolean",
          description: "If true, backup each modified file before changing it.",
        },
      },
      required: ["filePath", "oldName", "newName"],
    },
  },
  {
    name: "remove_symbol",
    description:
      "Removes a named symbol from a file. By default, checks for dependents first " +
      "and refuses to remove if other files import or reference the symbol. " +
      "Use force=true to skip the dependency check and remove anyway. " +
      "Supports TypeScript, JavaScript, PHP, Dart, and Python. " +
      "Returns a diff showing what was removed.",
    inputSchema: {
      type: "object" as const,
      properties: {
        filePath: {
          type: "string",
          description: "Absolute path to the source file.",
        },
        symbolName: {
          type: "string",
          description: "Name of the symbol to remove.",
        },
        className: {
          type: "string",
          description:
            "Optional. Name of the class to scope the symbol search to. " +
            "Use when multiple classes have methods with the same name.",
        },
        force: {
          type: "boolean",
          description:
            "If true, skip the dependency check and remove the symbol even if " +
            "other files reference it. Defaults to false.",
        },
        confirmationToken: {
          type: "string",
          description:
            "Required for Phase 2. The token provided from the Phase 1 Dry-Run preview.",
        },
        confirm: {
          type: "boolean",
          description:
            "Required for Phase 2. Set to true to confirm and apply the changes.",
        },
        createBackup: {
          type: "boolean",
          description: "If true, backup the file before modifying.",
        },
      },
      required: ["filePath", "symbolName"],
    },
  },
  {
    name: "rollback_file",
    description: "Reverts a file to a previous backup state after a surgical write operation. Keeps up to 5 automatic backups. Specify the number of steps to rollback (1 = most recent).",
    inputSchema: {
      type: "object" as const,
      properties: {
        filePath: {
          type: "string",
          description: "Absolute path to the source file to revert.",
        },
        steps: {
          type: "number",
          description: "Number of steps back to revert to (1-5). Defaults to 1 (most recent backup).",
        }
      },
      required: ["filePath"],
    },
  },
  {
    name: "clean_backups",
    description:
      "Removes all backup files for a project. Deletes the entire .mcp-backups directory " +
      "at the project root, freeing up disk space and cleaning the working directory. " +
      "Use this to clean up after completing a series of edits or when backups are no longer needed.",
    inputSchema: {
      type: "object" as const,
      properties: {
        projectRoot: {
          type: "string",
          description:
            "Absolute path to the project root directory. The .mcp-backups folder " +
            "at this location will be removed.",
        },
      },
      required: ["projectRoot"],
    },
  },
];

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS,
}));

// ─── Tool Dispatcher ────────────────────────────────────────────────

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      // Read tools
      case "get_semantic_repo_map":
        return await handleGetSemanticRepoMap(args as Record<string, unknown>);
      case "read_file_surgical":
        return await handleReadFileSurgical(args as Record<string, unknown>);
      case "analyze_impact":
        return await handleAnalyzeImpact(args as Record<string, unknown>);
      case "read_file_lines":
        return await handleReadFileLines(args as Record<string, unknown>);
      case "search_code_pattern":
        return await handleSearchCodePattern(args as Record<string, unknown>);

      // Write tools
      case "write_file_surgical":
        return await handleWriteFileSurgical(args as Record<string, unknown>);
      case "insert_symbol":
        return await handleInsertSymbol(args as Record<string, unknown>);
      case "rename_symbol":
        return await handleRenameSymbol(args as Record<string, unknown>);
      case "remove_symbol":
        return await handleRemoveSymbol(args as Record<string, unknown>);

      // Util tools
      case "rollback_file":
        return await handleRollbackFile(args as Record<string, unknown>);
      case "clean_backups":
        return await handleCleanBackups(args as Record<string, unknown>);

      default:
        return errorResponse(`Unknown tool: "${name}"`);
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return errorResponse(`Unhandled error in tool "${name}": ${message}`);
  }
});

// ─── Utility ────────────────────────────────────────────────────────

function errorResponse(message: string) {
  return {
    content: [{ type: "text" as const, text: `❌ ${message}` }],
    isError: true,
  };
}

// ─── Bootstrap ──────────────────────────────────────────────────────

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(
    `🚀 ${SERVER_NAME} v${SERVER_VERSION} running on stdio transport`,
  );
}

import { fileURLToPath, pathToFileURL } from "node:url";

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error("Fatal error starting MCP server:", error);
    process.exit(1);
  });
}
