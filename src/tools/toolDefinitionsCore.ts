/** Core MCP tool schemas (read + write) */

export const CORE_TOOLS = [

  {
    name: "get_semantic_repo_map",
    description: "Generate a compressed architectural overview of an entire repository",
    inputSchema: {
      type: "object" as const,
      properties: {
        directoryPath: { type: "string", description: "Absolute path to repository root" },
        projectRoot: { type: "string", description: "Project root for security boundary" },
        format: { type: "string", enum: ["xml", "markdown"], description: "Output format (default: xml)" },
      },
      required: ["directoryPath", "projectRoot"],
    },
  },
  {
    name: "read_file_surgical",
    description: "Read a file or extract a specific named symbol",
    inputSchema: {
      type: "object" as const,
      properties: {
        filePath: { type: "string", description: "Absolute path to file" },
        projectRoot: { type: "string", description: "Project root (REQUIRED)" },
        symbolName: { type: "string", description: "Symbol name to extract (optional)" },
        className: { type: "string", description: "Class name for scoping (optional)" },
      },
      required: ["filePath", "projectRoot"],
    },
  },
  {
    name: "analyze_impact",
    description: "Find all files that depend on a given file",
    inputSchema: {
      type: "object" as const,
      properties: {
        filePath: { type: "string", description: "Absolute path to file" },
        projectRoot: { type: "string", description: "Project root for security boundary" },
        rootDir: { type: "string", description: "Repository root (optional, defaults to projectRoot)" },
      },
      required: ["filePath", "projectRoot"],
    },
  },
  {
    name: "read_file_lines",
    description: "Read specific line ranges from a file",
    inputSchema: {
      type: "object" as const,
      properties: {
        filePath: { type: "string", description: "Absolute path to file" },
        projectRoot: { type: "string", description: "Project root for security boundary" },
        startLine: { type: "number", description: "Starting line number (1-indexed)" },
        endLine: { type: "number", description: "Ending line number (1-indexed)" },
        aroundPattern: { type: "string", description: "Search pattern to find and return surrounding lines" },
        contextLines: { type: "number", description: "Number of lines before/after pattern (default: 5)" },
      },
      required: ["filePath", "projectRoot"],
    },
  },
  {
    name: "search_code_pattern",
    description: "Search for code patterns across multiple files",
    inputSchema: {
      type: "object" as const,
      properties: {
        rootDir: { type: "string", description: "Repository root directory" },
        projectRoot: { type: "string", description: "Project root for security boundary" },
        pattern: { type: "string", description: "Regular expression pattern to search" },
        fileExtensions: { type: "array", items: { type: "string" }, description: "Extensions to search" },
        excludeDirs: { type: "array", items: { type: "string" }, description: "Directories to exclude" },
        maxResults: { type: "number", description: "Maximum matches to return (default: 10)" },
        startIndex: { type: "number", description: "Start index for pagination (default: 0)" },
        fuzzyMatch: { type: "boolean", description: "Enable fuzzy matching (default: false)" },
        fuzzyThreshold: { type: "number", description: "Fuzzy match threshold 0-1 (default: 0.4)" },
      },
      required: ["rootDir", "projectRoot", "pattern"],
    },
  },
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
    name: "write_file_surgical",
    description: "Replace a symbol with new code. Phase 1 (dry-run): returns diff + token. Phase 2: confirm with token to apply.",
    inputSchema: {
      type: "object" as const,
      properties: {
        filePath: { type: "string", description: "Absolute path to file" },
        projectRoot: { type: "string", description: "Project root (REQUIRED)" },
        symbolName: { type: "string", description: "Symbol to replace" },
        newContent: { type: "string", description: "New code (Phase 1 only ΓÇö omit in Phase 2, server uses stored content)" },
        className: { type: "string", description: "Class name (optional, for scoping)" },
        confirm: { type: "boolean", description: "Set true to apply a pending operation (Phase 2)" },
        confirmationToken: { type: "string", description: "Token from Phase 1 dry-run (Phase 2 only)" },
        diffFormat: { type: "string", enum: ["unified", "compact", "summary", "none"], description: "Diff verbosity in Phase 1 output (default: unified). Use none to skip diff and save tokens." },
      },
      required: ["filePath", "projectRoot", "symbolName"],
    },
  },
  {
    name: "insert_symbol",
    description: "Insert code at a specific location. Phase 1: returns diff + token. Phase 2: confirm with token to apply.",
    inputSchema: {
      type: "object" as const,
      properties: {
        filePath: { type: "string", description: "Absolute path to file" },
        projectRoot: { type: "string", description: "Project root (REQUIRED)" },
        code: { type: "string", description: "Code to insert (Phase 1 only ΓÇö omit in Phase 2, server uses stored content)" },
        anchorSymbol: { type: "string", description: "Symbol to position relative to" },
        position: { type: "string", enum: ["before", "after", "inside_start", "inside_end"], description: "Where to insert" },
        className: { type: "string", description: "Class name (optional)" },
        confirm: { type: "boolean", description: "Set true to apply a pending operation (Phase 2)" },
        confirmationToken: { type: "string", description: "Token from Phase 1 dry-run (Phase 2 only)" },
        diffFormat: { type: "string", enum: ["unified", "compact", "summary", "none"], description: "Diff verbosity in Phase 1 output (default: unified). Use none to skip diff and save tokens." },
      },
      required: ["filePath", "projectRoot"],
    },
  },
  {
    name: "remove_symbol",
    description: "Remove a symbol from file. Phase 1: returns diff + token. Phase 2: confirm with token to apply.",
    inputSchema: {
      type: "object" as const,
      properties: {
        filePath: { type: "string", description: "Absolute path to file" },
        projectRoot: { type: "string", description: "Project root (REQUIRED)" },
        symbolName: { type: "string", description: "Symbol to remove" },
        className: { type: "string", description: "Class name (optional)" },
        force: { type: "boolean", description: "Skip dependency check" },
        confirm: { type: "boolean", description: "Set true to apply a pending operation" },
        confirmationToken: { type: "string", description: "Token from Phase 1 dry-run" },
      },
      required: ["filePath", "projectRoot", "symbolName"],
    },
  },
  {
    name: "rename_symbol",
    description: "Rename a symbol across the entire repository. Phase 1: returns diff + token. Phase 2: confirm with token to apply.",
    inputSchema: {
      type: "object" as const,
      properties: {
        filePath: { type: "string", description: "File where symbol is defined" },
        projectRoot: { type: "string", description: "Project root (REQUIRED)" },
        oldName: { type: "string", description: "Current name" },
        newName: { type: "string", description: "New name" },
        rootDir: { type: "string", description: "Repository root (optional)" },
        confirm: { type: "boolean", description: "Set true to apply a pending operation" },
        confirmationToken: { type: "string", description: "Token from Phase 1 dry-run" },
      },
      required: ["filePath", "projectRoot", "oldName", "newName"],
    },
  },
  // ── AST Transform (v3.7.0) ──────────────────────────────────────────────
  {
    name: "ast_transform",
    description: "Apply a declarative AST transformation to a symbol. Supports: add_parameter, wrap_with_try_catch, add_decorator, change_return_type, extract_variable. Uses two-phase write (Phase 1: preview diff, Phase 2: confirm with token).",
    inputSchema: {
      type: "object" as const,
      properties: {
        filePath: { type: "string", description: "Absolute path to file" },
        projectRoot: { type: "string", description: "Project root (REQUIRED)" },
        symbolName: { type: "string", description: "Target symbol to transform" },
        className: { type: "string", description: "Class name (optional, for scoping)" },
        transform: {
          type: "object",
          description: "Transform specification",
          properties: {
            kind: {
              type: "string",
              enum: ["add_parameter", "wrap_with_try_catch", "add_decorator", "change_return_type", "extract_variable"],
              description: "Type of transformation",
            },
            parameter: { type: "string", description: "For add_parameter: parameter text (e.g. 'timeout: number = 5000')" },
            parameterIndex: { type: "number", description: "For add_parameter: insertion index (0-based, default: append)" },
            catchBody: { type: "string", description: "For wrap_with_try_catch: catch block body (default: 'throw error;')" },
            decorator: { type: "string", description: "For add_decorator: decorator text (e.g. '@deprecated')" },
            returnType: { type: "string", description: "For change_return_type: new return type" },
            expression: { type: "string", description: "For extract_variable: expression to extract" },
            variableName: { type: "string", description: "For extract_variable: name for extracted const" },
          },
          required: ["kind"],
        },
        confirm: { type: "boolean", description: "Set true to apply a pending operation (Phase 2)" },
        confirmationToken: { type: "string", description: "Token from Phase 1 dry-run (Phase 2 only)" },
        diffFormat: { type: "string", enum: ["unified", "compact", "summary", "none"], description: "Diff verbosity (default: unified)" },
      },
      required: ["filePath", "projectRoot", "symbolName", "transform"],
    },
  },
  // ── NEW TOOLS v3.7.0 ──────────────────────────────────────────────────────ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
  {
    name: "search_symbols",
    description: "Search symbols by name across the repo using AST (not text search). Finds classes, functions, methods by approximate name.",
    inputSchema: {
      type: "object" as const,
      properties: {
        rootDir: { type: "string", description: "Directory to search in" },
        projectRoot: { type: "string", description: "Project root for security boundary" },
        query: { type: "string", description: "Symbol name or partial name to search" },
        fuzzy: { type: "boolean", description: "Enable fuzzy name matching (default: false)" },
        types: { type: "array", items: { type: "string" }, description: "Filter by symbol types: class_declaration, function_declaration, method_definition, etc." },
        fileExtensions: { type: "array", items: { type: "string" }, description: "Extensions to search (default: all supported)" },
        excludeDirs: { type: "array", items: { type: "string" }, description: "Directories to exclude" },
        maxResults: { type: "number", description: "Maximum results (default: 20)" },
      },
      required: ["rootDir", "projectRoot", "query"],
    },
  },
  {
    name: "explain_symbol",
    description: "Get signature, location, and callers of a symbol in one call. More efficient than read_file_surgical + analyze_impact separately.",
    inputSchema: {
      type: "object" as const,
      properties: {
        filePath: { type: "string", description: "Absolute path to file" },
        projectRoot: { type: "string", description: "Project root (REQUIRED)" },
        symbolName: { type: "string", description: "Symbol to explain" },
        className: { type: "string", description: "Class name (optional, for scoping)" },
        rootDir: { type: "string", description: "Root dir for caller search (optional, defaults to projectRoot)" },
      },
      required: ["filePath", "projectRoot", "symbolName"],
    },
  },
  {
    name: "batch_read",
    description: "Read multiple symbols from multiple files in one call. Reduces N round-trips to 1.",
    inputSchema: {
      type: "object" as const,
      properties: {
        reads: {
          type: "array",
          description: "List of symbols to read",
          items: {
            type: "object",
            properties: {
              filePath: { type: "string", description: "Absolute path to file" },
              symbolName: { type: "string", description: "Symbol name to extract" },
              className: { type: "string", description: "Class name (optional)" },
            },
            required: ["filePath", "symbolName"],
          },
        },
        projectRoot: { type: "string", description: "Project root for security boundary" },
      },
      required: ["reads", "projectRoot"],
    },
  },
  {
    name: "get_rate_limit_status",
    description: "Get current rate limiter token balance and operation costs. Use before expensive operations to check available budget.",
    inputSchema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  // ΓöÇΓöÇ END NEW TOOLS ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
];
