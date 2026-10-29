/** Core MCP tool schemas (read + write) */

export const CORE_TOOLS = [

  {
    name: "get_semantic_repo_map",
    description: "Generate a compressed architectural overview of an entire repository",
    inputSchema: {
      type: "object" as const,
      properties: {
        directoryPath: { type: "string", description: "Absolute path to repository root" },
        projectRoot: { type: "string", description: "Project root for security boundary (optional, defaults to directoryPath)" },
        format: { type: "string", enum: ["xml", "markdown", "html"], description: "Output format (default: xml, markdown, or html for interactive visual architecture dashboard)" },
      },
      required: ["directoryPath"],
    },
  },
  {
    name: "read_file_surgical",
    description: "Read a file or extract a specific named symbol",
    inputSchema: {
      type: "object" as const,
      properties: {
        filePath: { type: "string", description: "Absolute path to file" },
        projectRoot: { type: "string", description: "Project root for security boundary (optional, defaults to file project root)" },
        symbolName: { type: "string", description: "Symbol name to extract (optional)" },
        className: { type: "string", description: "Class name for scoping (optional)" },
      },
      required: ["filePath"],
    },
  },
  {
    name: "analyze_impact",
    description: "Find all files that depend on a given file",
    inputSchema: {
      type: "object" as const,
      properties: {
        filePath: { type: "string", description: "Absolute path to file" },
        projectRoot: { type: "string", description: "Project root for security boundary (optional, defaults to file project root)" },
        rootDir: { type: "string", description: "Repository root (optional, defaults to projectRoot)" },
      },
      required: ["filePath"],
    },
  },
  {
    name: "read_file_lines",
    description: "Read specific line ranges from a file",
    inputSchema: {
      type: "object" as const,
      properties: {
        filePath: { type: "string", description: "Absolute path to file" },
        projectRoot: { type: "string", description: "Project root for security boundary (optional, defaults to file project root)" },
        startLine: { type: "number", description: "Starting line number (1-indexed)" },
        endLine: { type: "number", description: "Ending line number (1-indexed)" },
        aroundPattern: { type: "string", description: "Search pattern to find and return surrounding lines" },
        contextLines: { type: "number", description: "Number of lines before/after pattern (default: 5)" },
      },
      required: ["filePath"],
    },
  },
  {
    name: "search_code_pattern",
    description: "Search for code patterns across multiple files",
    inputSchema: {
      type: "object" as const,
      properties: {
        rootDir: { type: "string", description: "Repository root directory" },
        projectRoot: { type: "string", description: "Project root for security boundary (optional, defaults to rootDir)" },
        pattern: { type: "string", description: "Regular expression pattern to search" },
        fileExtensions: { type: "array", items: { type: "string" }, description: "Extensions to search" },
        excludeDirs: { type: "array", items: { type: "string" }, description: "Directories to exclude" },
        maxResults: { type: "number", description: "Maximum matches to return (default: 10)" },
        startIndex: { type: "number", description: "Start index for pagination (default: 0)" },
        fuzzyMatch: { type: "boolean", description: "Enable fuzzy matching (default: false)" },
        fuzzyThreshold: { type: "number", description: "Fuzzy match threshold 0-1 (default: 0.4)" },
      },
      required: ["rootDir", "pattern"],
    },
  },
  {
    name: "parse_file",
    description: "Parse a file using Tree-sitter and extract symbols",
    inputSchema: {
      type: "object" as const,
      properties: {
        filePath: { type: "string", description: "Absolute path to file" },
        projectRoot: { type: "string", description: "Project root for security boundary (optional, defaults to file project root)" },
      },
      required: ["filePath"],
    },
  },
  {
    name: "write_file_surgical",
    description: "Replace a symbol with new code. Phase 1 (dry-run): returns diff + token. Phase 2: confirm with token to apply.",
    inputSchema: {
      type: "object" as const,
      properties: {
        filePath: { type: "string", description: "Absolute path to file" },
        projectRoot: { type: "string", description: "Project root for security boundary (optional, defaults to file project root)" },
        symbolName: { type: "string", description: "Symbol to replace" },
        newContent: { type: "string", description: "New code (Phase 1 only — omit in Phase 2, server uses stored content)" },
        className: { type: "string", description: "Class name (optional, for scoping)" },
        confirm: { type: "boolean", description: "Set true to apply a pending operation (Phase 2)" },
        confirmationToken: { type: "string", description: "Token from Phase 1 dry-run (Phase 2 only)" },
        diffFormat: { type: "string", enum: ["unified", "compact", "summary", "none"], description: "Diff verbosity in Phase 1 output (default: unified). Use none to skip diff and save tokens." },
      },
      required: ["filePath", "symbolName"],
    },
  },
  {
    name: "insert_symbol",
    description: "Insert code at a specific location. Phase 1: returns diff + token. Phase 2: confirm with token to apply.",
    inputSchema: {
      type: "object" as const,
      properties: {
        filePath: { type: "string", description: "Absolute path to file" },
        projectRoot: { type: "string", description: "Project root for security boundary (optional, defaults to file project root)" },
        code: { type: "string", description: "Code to insert (Phase 1 only — omit in Phase 2, server uses stored content)" },
        anchorSymbol: { type: "string", description: "Symbol to position relative to" },
        position: { type: "string", enum: ["before", "after", "inside_start", "inside_end"], description: "Where to insert" },
        className: { type: "string", description: "Class name (optional)" },
        confirm: { type: "boolean", description: "Set true to apply a pending operation (Phase 2)" },
        confirmationToken: { type: "string", description: "Token from Phase 1 dry-run (Phase 2 only)" },
        diffFormat: { type: "string", enum: ["unified", "compact", "summary", "none"], description: "Diff verbosity in Phase 1 output (default: unified). Use none to skip diff and save tokens." },
      },
      required: ["filePath", "code"],
    },
  },
  {
    name: "remove_symbol",
    description: "Remove a symbol from file. Phase 1: returns diff + token. Phase 2: confirm with token to apply.",
    inputSchema: {
      type: "object" as const,
      properties: {
        filePath: { type: "string", description: "Absolute path to file" },
        projectRoot: { type: "string", description: "Project root for security boundary (optional, defaults to file project root)" },
        symbolName: { type: "string", description: "Symbol to remove" },
        className: { type: "string", description: "Class name (optional)" },
        force: { type: "boolean", description: "Skip dependency check" },
        confirm: { type: "boolean", description: "Set true to apply a pending operation" },
        confirmationToken: { type: "string", description: "Token from Phase 1 dry-run" },
      },
      required: ["filePath", "symbolName"],
    },
  },
  {
    name: "rename_symbol",
    description: "Rename a symbol across the entire repository. Phase 1: returns diff + token. Phase 2: confirm with token to apply.",
    inputSchema: {
      type: "object" as const,
      properties: {
        filePath: { type: "string", description: "File where symbol is defined" },
        projectRoot: { type: "string", description: "Project root for security boundary (optional, defaults to file project root)" },
        oldName: { type: "string", description: "Current name" },
        newName: { type: "string", description: "New name" },
        rootDir: { type: "string", description: "Repository root (optional, defaults to projectRoot)" },
        confirm: { type: "boolean", description: "Set true to apply a pending operation" },
        confirmationToken: { type: "string", description: "Token from Phase 1 dry-run" },
      },
      required: ["filePath", "oldName", "newName"],
    },
  },
  // ── AST Transform (v3.9.0) ──────────────────────────────────────────────
  {
    name: "ast_transform",
    description: "Apply a declarative AST transformation to a symbol. Supports: add_parameter, wrap_with_try_catch, add_decorator, change_return_type, extract_variable. Uses two-phase write (Phase 1: preview diff, Phase 2: confirm with token).",
    inputSchema: {
      type: "object" as const,
      properties: {
        filePath: { type: "string", description: "Absolute path to file" },
        projectRoot: { type: "string", description: "Project root for security boundary (optional, defaults to file project root)" },
        symbolName: { type: "string", targetSymbol: true, description: "Target symbol to transform" },
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
      required: ["filePath", "symbolName", "transform"],
    },
  },
  // ── Core Inspection & Search Tools ──────────────────────────────────────────
  {
    name: "search_symbols",
    description: "Search symbols by name across the repo using AST (not text search). Finds classes, functions, methods by approximate name.",
    inputSchema: {
      type: "object" as const,
      properties: {
        rootDir: { type: "string", description: "Directory to search in" },
        projectRoot: { type: "string", description: "Project root for security boundary (optional, defaults to rootDir)" },
        query: { type: "string", description: "Symbol name or partial name to search" },
        fuzzy: { type: "boolean", description: "Enable fuzzy name matching (default: false)" },
        types: { type: "array", items: { type: "string" }, description: "Filter by symbol types: class_declaration, function_declaration, method_definition, etc." },
        fileExtensions: { type: "array", items: { type: "string" }, description: "Extensions to search (default: all supported)" },
        excludeDirs: { type: "array", items: { type: "string" }, description: "Directories to exclude" },
        maxResults: { type: "number", description: "Maximum results (default: 20)" },
      },
      required: ["rootDir", "query"],
    },
  },
  {
    name: "search_code_concept",
    description: "Search symbols and code by conceptual intent, domain semantics, and docstrings using offline in-memory vectors. Finds functions even when the exact name is unknown (e.g. searching 'VIP discount' finds 'applyLoyaltyRebate').",
    inputSchema: {
      type: "object" as const,
      properties: {
        query: { type: "string", description: "Conceptual query (e.g. 'VIP customer discount calculation', 'auth token refresh', 'database transaction rollback')" },
        rootDir: { type: "string", description: "Directory to search in (optional, defaults to projectRoot)" },
        projectRoot: { type: "string", description: "Project root for security boundary (optional, defaults to rootDir)" },
        threshold: { type: "number", description: "Minimum relevance similarity threshold 0.0 - 1.0 (default: 0.25)" },
        maxResults: { type: "number", description: "Maximum results to return (default: 15)" },
        fileExtensions: { type: "array", items: { type: "string" }, description: "Filter by file extensions (e.g. ['.ts', '.py'])" },
        excludeDirs: { type: "array", items: { type: "string" }, description: "Directories to exclude from search" },
      },
      required: ["query"],
    },
  },
  {
    name: "verify_import_integrity",
    description: "Verify that all external package dependencies, local relative files, and named symbols imported in a file exist. Prevents build-breaking import hallucinations and phantom dependencies before applying code changes.",
    inputSchema: {
      type: "object" as const,
      properties: {
        filePath: { type: "string", description: "Path to file being inspected or modified" },
        projectRoot: { type: "string", description: "Project root for security boundary (optional, defaults to file's root)" },
        content: { type: "string", description: "Optional proposed content to verify before saving to disk" },
      },
      required: ["filePath"],
    },
  },
  {
    name: "trace_taint_flow",
    description: "Trace data flow from untrusted user inputs (req.query, req.body, $_GET, etc.) to dangerous sinks (db.query, exec, eval, fs.readFile, innerHTML). Identifies SQL Injection, RCE, Path Traversal, and SSRF vulnerabilities before code is committed.",
    inputSchema: {
      type: "object" as const,
      properties: {
        filePath: { type: "string", description: "Path to file being analyzed" },
        projectRoot: { type: "string", description: "Project root for security boundary (optional, defaults to file's root)" },
        sourceParam: { type: "string", description: "Optional specific parameter name to track as tainted source" },
        dangerousSink: { type: "string", description: "Optional specific sink to target (e.g. 'exec', 'db.query', 'eval', 'readFile')" },
        content: { type: "string", description: "Optional proposed content to analyze before saving" },
      },
      required: ["filePath"],
    },
  },
  {
    name: "backfill_types",
    description: "Inspect AST property accesses (param.id, param.name.trim(), param.age > 18, param.save()), method calls, and return expressions to infer strict TypeScript interfaces or Python TypedDict / BaseModel definitions for untyped or legacy code.",
    inputSchema: {
      type: "object" as const,
      properties: {
        filePath: { type: "string", description: "Path to file to infer types for" },
        projectRoot: { type: "string", description: "Project root directory (optional, resolved automatically)" },
        symbolName: { type: "string", description: "Optional specific function or method name to infer types for" },
        targetLanguage: { 
          type: "string", 
          enum: ["typescript", "python"],
          description: "Target type system to generate ('typescript' or 'python', defaults based on file extension)" 
        },
        content: { type: "string", description: "Optional proposed content to analyze before saving to disk" },
      },
      required: ["filePath"],
    },
  },
  {
    name: "enforce_architecture_rules",
    description: "Enforce clean/hexagonal architectural boundary guardrails by checking AST imports against layer separation rules (e.g. domain entities cannot import infra/frameworks; UI cannot import raw database models; use cases cannot import controllers).",
    inputSchema: {
      type: "object" as const,
      properties: {
        filePath: { type: "string", description: "Path to file being checked (optional)" },
        projectRoot: { type: "string", description: "Project root directory (optional, resolved automatically)" },
        content: { type: "string", description: "Optional proposed content to verify before saving to disk" },
        rules: {
          type: "array",
          items: {
            type: "object",
            properties: {
              layer: { type: "string", description: "Name of the architectural layer (e.g. 'domain', 'ui', 'use_cases')" },
              pattern: { type: "string", description: "File path glob pattern belonging to this layer (e.g. 'src/domain/**')" },
              disallow: { 
                type: "array", 
                items: { type: "string" },
                description: "Array of disallowed import paths or package names (e.g. ['src/infra/**', '@prisma/client'])"
              },
              description: { type: "string", description: "Reason for this boundary rule" },
              suggestion: { type: "string", description: "Recommended decoupled alternative pattern" }
            },
            required: ["layer", "pattern", "disallow"]
          },
          description: "Optional custom architectural rules (defaults to reading .architecturerc.json or applying standard Clean Architecture rules)"
        }
      },
    },
  },
  {
    name: "compact_context_ledger",
    description: "Compress source files into lossless AST signature outlines (interfaces, types, classes, fields, and method signatures without implementation bodies). Saves 80% to 90% of tokens while preserving 100% of structural and type fidelity for AI LLMs.",
    inputSchema: {
      type: "object" as const,
      properties: {
        filePaths: { 
          oneOf: [
            { type: "array", items: { type: "string" } },
            { type: "string" }
          ],
          description: "One or more file paths to compact into AST outlines" 
        },
        projectRoot: { type: "string", description: "Project root directory (optional, resolved automatically)" },
        dropPrivate: { type: "boolean", description: "Whether to omit private members and helper functions (default: false)" },
        includeDocstrings: { type: "boolean", description: "Whether to preserve JSDoc / docstrings for intent understanding (default: true)" },
        content: { type: "string", description: "Optional proposed content for single file compaction" },
      },
      required: ["filePaths"],
    },
  },
  {
    name: "generate_ast_impact_report",
    description: "Generate an objective cryptographic PR blast radius report with SHA-256 digest, identifying changed symbols across git refs or working tree, impacted test suites via TIA, and verifying architectural boundary compliance.",
    inputSchema: {
      type: "object" as const,
      properties: {
        baseBranch: { type: "string", description: "Base git ref or branch to compare against (default: 'main')" },
        targetBranch: { type: "string", description: "Target git ref or 'WORKING_TREE' for uncommitted changes (default: 'HEAD')" },
        projectRoot: { type: "string", description: "Project root directory (optional, resolved automatically)" },
        includeTests: { type: "boolean", description: "Whether to run Test Impact Analysis on modified symbols (default: true)" },
        includeArchitecture: { type: "boolean", description: "Whether to verify architectural boundary rules (default: true)" },
      },
    },
  },
  {
    name: "query_code_ast",
    description: "Execute native Tree-sitter S-Expression (Scheme DSL) queries or pre-built architectural pattern templates directly against source code in memory via WebAssembly.",
    inputSchema: {
      type: "object" as const,
      properties: {
        filePath: { type: "string", description: "Absolute path to source file" },
        query: { type: "string", description: "Tree-sitter S-Expression pattern (e.g. '(catch_clause (statement_block) @empty_catch)')" },
        template: {
          type: "string",
          enum: ["empty-catch", "excessive-params", "nested-ternary", "eval-call", "todo-comment", "console-log", "print-call"],
          description: "Pre-built AST query pattern template",
        },
        code: { type: "string", description: "Optional raw code content to query directly in memory" },
        limit: { type: "number", description: "Maximum number of AST matches to return (default: 50)" },
        projectRoot: { type: "string", description: "Project root directory (optional)" },
      },
    },
  },
  {
    name: "incremental_ast_diff",
    description: "High-performance O(log N) AST incremental re-parsing and diffing using WebAssembly Tree-sitter. Pinpoints exact changed syntax subtrees and validates AST integrity before saving.",
    inputSchema: {
      type: "object" as const,
      properties: {
        filePath: { type: "string", description: "Absolute path to source file" },
        oldCode: { type: "string", description: "Previous source code buffer" },
        newCode: { type: "string", description: "New or edited source code buffer" },
        projectRoot: { type: "string", description: "Project root directory (optional)" },
      },
      required: ["newCode"],
    },
  },
  {
    name: "get_ast_complexity_matrix",
    description: "Computes McCabe Cyclomatic and Sonar Cognitive Complexity per function/method using Tree-sitter AST, identifying high-risk structural hotspots.",
    inputSchema: {
      type: "object" as const,
      properties: {
        filePath: { type: "string", description: "Absolute path to source file" },
        code: { type: "string", description: "Optional raw code content" },
        threshold: { type: "number", description: "Minimum cognitive complexity threshold to filter (e.g. 10)" },
        projectRoot: { type: "string", description: "Project root directory (optional)" },
      },
    },
  },
  {
    name: "generate_ast_mocks",
    description: "Generates zero-hallucination typed factory mocks, fixtures, or JSON samples directly from TypeScript interfaces/types or classes.",
    inputSchema: {
      type: "object" as const,
      properties: {
        symbolName: { type: "string", description: "Name of the interface, type alias, or class to mock" },
        filePath: { type: "string", description: "Absolute path to source file" },
        code: { type: "string", description: "Optional raw code content" },
        format: { type: "string", enum: ["factory", "fixture", "inline_json"], description: "Output mock format (default: 'factory')" },
        projectRoot: { type: "string", description: "Project root directory (optional)" },
      },
      required: ["symbolName"],
    },
  },
  {
    name: "detect_dead_ast_symbols",
    description: "Detects dead or unconsumed exports, unused internal functions, and unreachable statements after return/throw using AST reachability analysis.",
    inputSchema: {
      type: "object" as const,
      properties: {
        filePath: { type: "string", description: "Absolute path to source file" },
        code: { type: "string", description: "Optional raw code content" },
        projectRoot: { type: "string", description: "Project root directory (optional)" },
      },
    },
  },
  {
    name: "resolve_lexical_scope",
    description: "Resolves lexical scope chains (closures, blocks, functions) and detects variable shadowing or identifier collision before renaming.",
    inputSchema: {
      type: "object" as const,
      properties: {
        filePath: { type: "string", description: "Absolute path to source file" },
        code: { type: "string", description: "Optional raw code content" },
        proposedRename: {
          type: "object",
          properties: {
            targetSymbol: { type: "string" },
            newSymbolName: { type: "string" },
            atLine: { type: "number" },
          },
          required: ["targetSymbol", "newSymbolName", "atLine"],
          description: "Optional rename simulation to verify if newSymbolName collides with existing scope variables",
        },
        projectRoot: { type: "string", description: "Project root directory (optional)" },
      },
    },
  },
  {
    name: "sql_ast_validator",
    description: "Extracts and parses embedded SQL queries from TypeScript/Python/PHP code, validating syntax, checking for SQL injection risk, and cross-referencing virtual schemas.",
    inputSchema: {
      type: "object" as const,
      properties: {
        filePath: { type: "string", description: "Absolute path to source file" },
        code: { type: "string", description: "Optional raw code content" },
        projectRoot: { type: "string", description: "Project root directory (optional)" },
      },
    },
  },
  {
    name: "ast_codemod_transpile",
    description: "Applies lossless Concrete Syntax Tree (CST) structural codemods preserving exact comments and formatting (e.g. CommonJS require to ESM import, strip console).",
    inputSchema: {
      type: "object" as const,
      properties: {
        rule: { type: "string", enum: ["cjs-to-esm", "strip-console"], description: "Codemod transformation rule to apply" },
        filePath: { type: "string", description: "Absolute path to source file" },
        code: { type: "string", description: "Optional raw code content" },
        projectRoot: { type: "string", description: "Project root directory (optional)" },
      },
      required: ["rule"],
    },
  },
  {
    name: "explain_symbol",
    description: "Get signature, location, and callers of a symbol in one call. More efficient than read_file_surgical + analyze_impact separately.",
    inputSchema: {
      type: "object" as const,
      properties: {
        filePath: { type: "string", description: "Absolute path to file" },
        projectRoot: { type: "string", description: "Project root for security boundary (optional, defaults to file project root)" },
        symbolName: { type: "string", description: "Symbol to explain" },
        className: { type: "string", description: "Class name (optional, for scoping)" },
        rootDir: { type: "string", description: "Root dir for caller search (optional, defaults to projectRoot)" },
      },
      required: ["filePath", "symbolName"],
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
        projectRoot: { type: "string", description: "Project root for security boundary (optional, defaults to file project root)" },
      },
      required: ["reads"],
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
  // ── Ruby Intelligence Tools (v3.9.0) ─────────────────────────────────────
  {
    name: "get_gemfile_context",
    description: "Parse Gemfile and return known gem behaviors with implicit Rails conventions. Useful for understanding what capabilities are active in a Ruby project without running the app.",
    inputSchema: {
      type: "object" as const,
      properties: {
        projectRoot: { type: "string", description: "Project root (optional, defaults to current directory) — must contain a Gemfile" },
      },
      required: [],
    },
  },
  {
    name: "find_metaprogramming",
    description: "Scan Ruby files for dynamic method generation entry points (define_method, method_missing, class_eval, ActiveSupport::Concern, etc.). Surfaces WHERE to look for magic methods.",
    inputSchema: {
      type: "object" as const,
      properties: {
        projectRoot: { type: "string", description: "Project root (optional, defaults to current directory)" },
        filePath: { type: "string", description: "Scan a single file (optional — omit to scan full project)" },
        rootDir: { type: "string", description: "Scan a subdirectory (optional — e.g. app/models)" },
      },
      required: [],
    },
  },
  {
    name: "get_rails_routes",
    description: "Parse config/routes.rb and return a structured route map (method, path, controller, action). Supports resources, resource, explicit HTTP verbs, namespace/scope, and root.",
    inputSchema: {
      type: "object" as const,
      properties: {
        projectRoot: { type: "string", description: "Project root (optional, defaults to current directory) — must contain config/routes.rb" },
      },
      required: [],
    },
  },
  {
    name: "get_impacted_tests",
    description: "Test Impact Analysis (TIA): Map modified AST symbols to target test suites and detect minimal test runner commands.",
    inputSchema: {
      type: "object" as const,
      properties: {
        filePath: { type: "string", description: "Absolute path to the modified source file" },
        symbolName: { type: "string", description: "Name of the modified symbol (optional)" },
        projectRoot: { type: "string", description: "Project root boundary (optional)" },
      },
      required: ["filePath"],
    },
  },
  {
    name: "get_call_hierarchy",
    description: "AST-based 3-Hop Call Hierarchy: Trace callers and callees up to 3 hops with Mermaid graph TD visualization.",
    inputSchema: {
      type: "object" as const,
      properties: {
        filePath: { type: "string", description: "Absolute path to file" },
        symbolName: { type: "string", description: "Name of function or method to trace" },
        direction: { type: "string", enum: ["callers", "callees", "both"], description: "Traversal direction (default: both)" },
        maxHops: { type: "number", description: "Maximum hops to trace (default: 3, max: 5)" },
        projectRoot: { type: "string", description: "Project root boundary (optional)" },
      },
      required: ["filePath", "symbolName"],
    },
  },
  {
    name: "validate_wire_contract",
    description: "Cross-Language Wire Contract Validator: Verify frontend TypeScript interfaces against backend models/schemas for drift, type mismatches, and naming conventions.",
    inputSchema: {
      type: "object" as const,
      properties: {
        frontendFile: { type: "string", description: "Absolute path to frontend file containing TypeScript interface/type" },
        backendFile: { type: "string", description: "Absolute path to backend model/migration/entity file (optional)" },
        endpoint: { type: "string", description: "API endpoint route (e.g. /api/users) (optional)" },
        projectRoot: { type: "string", description: "Project root boundary (optional)" },
      },
      required: ["frontendFile"],
    },
  },
  {
    name: "predict_semantic_conflicts",
    description: "Semantic Merge Conflict Predictor: Analyze AST divergence across Git branches/worktrees before merge to identify breaking symbol changes and affected dependents.",
    inputSchema: {
      type: "object" as const,
      properties: {
        baseBranch: { type: "string", description: "Base Git ref or branch (default: HEAD~1)" },
        targetBranch: { type: "string", description: "Target Git ref or branch (default: HEAD)" },
        projectRoot: { type: "string", description: "Project root boundary (optional)" },
      },
      required: [],
    },
  },
  // ── END NEW TOOLS ────────────────────────────────────────────────────────
];
