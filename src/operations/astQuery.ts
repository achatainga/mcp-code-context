/**
 * Tree-sitter Native S-Expression Query DSL Engine (v5.5.0)
 * 
 * Executes native Scheme / S-Expression AST queries against source code using
 * web-tree-sitter compiled to WebAssembly. Enables complex syntactic pattern matching
 * (e.g. empty catch blocks, excessive parameters, nested ternaries, unhandled promises)
 * with zero regex fragility and sub-millisecond execution.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { existsSync } from "node:fs";
import { ParserRegistry } from "../parsers/registry.js";
import { CodeContextEngine } from "../core/engine.js";
import type { ReadResult } from "./readCore.js";
import type { Tree } from "web-tree-sitter";

export interface AstQueryCapture {
  captureName: string;
  nodeType: string;
  text: string;
  startLine: number;
  endLine: number;
  startColumn: number;
  endColumn: number;
  snippet: string;
}

export type AstQueryTemplate = "empty-catch" | "excessive-params" | "nested-ternary" | "eval-call" | "todo-comment" | "console-log" | "print-call" | string;

export interface AstQueryReport {
  filePath?: string;
  language: string;
  queryPattern: string;
  matchesCount: number;
  captures: AstQueryCapture[];
}

/**
 * Built-in query templates for common AST anti-patterns
 */
export const PREDEFINED_QUERY_TEMPLATES: Record<string, Record<string, string>> = {
  typescript: {
    "empty-catch": `(catch_clause (statement_block) @empty_catch)`,
    "excessive-params": `(function_declaration parameters: (formal_parameters (required_parameter) (required_parameter) (required_parameter) (required_parameter) (required_parameter)+ @excess_param) @fn)`,
    "nested-ternary": `(ternary_expression consequence: (ternary_expression) @nested_ternary)`,
    "eval-call": `(call_expression function: (identifier) @fn (#eq? @fn "eval")) @eval_call`,
    "todo-comment": `((comment) @todo (#match? @todo "(?i)TODO|FIXME|BUG"))`,
    "console-log": `(call_expression function: (member_expression object: (identifier) @obj property: (property_identifier) @prop) (#eq? @obj "console") (#match? @prop "log|warn|error")) @console_call`,
  },
  python: {
    "empty-except": `(except_clause (block (pass_statement) @empty_except))`,
    "excessive-params": `(function_definition parameters: (parameters (identifier) (identifier) (identifier) (identifier) (identifier)+ @excess_param) @fn)`,
    "eval-call": `(call function: (identifier) @fn (#eq? @fn "eval")) @eval_call`,
    "todo-comment": `((comment) @todo (#match? @todo "(?i)TODO|FIXME|BUG"))`,
    "print-call": `(call function: (identifier) @fn (#eq? @fn "print")) @print_call`,
  }
};

/**
 * Resolves query pattern from preset name or custom S-Expression
 */
function resolveQueryPattern(query: string, langName: string): string {
  const langKey = langName.includes("python") ? "python" : "typescript";
  const templates = PREDEFINED_QUERY_TEMPLATES[langKey];
  if (templates && templates[query.toLowerCase()]) {
    return templates[query.toLowerCase()];
  }
  return query;
}

export interface AstQueryOptions {
  filePath?: string;
  query?: string;
  template?: AstQueryTemplate;
  code?: string;
  content?: string;
  limit?: number;
  maxMatches?: number;
  projectRoot?: string;
  registry?: ParserRegistry;
}

/**
 * Executes a Tree-sitter S-Expression query against a file
 */
export async function queryCodeAst(params: AstQueryOptions): Promise<ReadResult> {
  let tree: Tree | null = null;
  let q: any = null;

  try {
    const rawPattern = params.query || params.template;
    if (!rawPattern) {
      return {
        success: false,
        error: "Either 'query' (S-Expression) or 'template' must be provided",
      };
    }

    const targetPath = params.filePath || "in_memory.ts";
    let content = params.code ?? params.content;

    if (content === undefined) {
      if (params.filePath && existsSync(params.filePath)) {
        content = await fs.readFile(params.filePath, "utf-8");
      } else {
        return {
          success: false,
          error: `File does not exist: ${params.filePath || "none"}`,
        };
      }
    }

    const ext = path.extname(targetPath).toLowerCase();
    const langKey = ext === ".py" ? "python" : "typescript";
    const queryPattern = resolveQueryPattern(rawPattern, langKey);

    // Initialize Parser Registry
    let registry = params.registry;
    if (!registry) {
      const engine = new CodeContextEngine();
      await engine.init();
      registry = new ParserRegistry(engine);
      await registry.init();
    }

    const parser = registry.getParser(ext === ".py" ? ".py" : ".ts");
    if (!parser) {
      return {
        success: false,
        error: `No Tree-sitter AST parser available for extension: ${ext}`,
      };
    }

    const language = (parser as any).getLanguage?.() || (parser as any).language;
    if (!language) {
      return {
        success: false,
        error: `Failed to retrieve Language instance from parser for ${ext}`,
      };
    }

    tree = parser.parse(content);

    try {
      q = language.query(queryPattern);
    } catch (queryErr) {
      return {
        success: false,
        error: `Invalid Tree-sitter S-Expression query syntax: ${queryErr instanceof Error ? queryErr.message : String(queryErr)}`,
      };
    }

    const rawCaptures = q.captures(tree.rootNode);
    const maxMatches = params.limit ?? params.maxMatches ?? 50;
    const captures: AstQueryCapture[] = [];

    const lines = content.split("\n");

    for (let i = 0; i < rawCaptures.length; i++) {
      if (captures.length >= maxMatches) break;
      const cap = rawCaptures[i];
      const node = cap.node;

      // Filter: empty-catch should only capture blocks with 0 named children
      if (cap.name === "empty_catch" && node.namedChildCount > 0) {
        continue;
      }

      const startRow = node.startPosition.row;
      const endRow = node.endPosition.row;

      // Extract a 3-line preview snippet around the node
      const snippetLines = lines.slice(Math.max(0, startRow - 1), Math.min(lines.length, endRow + 2));
      const snippet = snippetLines.join("\n");

      captures.push({
        captureName: cap.name,
        nodeType: node.type,
        text: node.text.length > 200 ? node.text.slice(0, 200) + "..." : node.text,
        startLine: startRow + 1,
        endLine: endRow + 1,
        startColumn: node.startPosition.column,
        endColumn: node.endPosition.column,
        snippet,
      });
    }

    const report: AstQueryReport = {
      filePath: params.filePath,
      language: langKey,
      queryPattern,
      matchesCount: captures.length,
      captures,
    };

    const footer = captures.length === 0
      ? `\n\n🔍 Query returned 0 matches for pattern: "${queryPattern}".`
      : `\n\n🎯 Query matched ${captures.length} AST nodes.`;

    return {
      success: true,
      content: JSON.stringify(report, null, 2) + footer,
    };
  } catch (error) {
    return {
      success: false,
      error: `query_code_ast failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  } finally {
    // SRE Guardrail: Strict WASM Linear Memory Disposal
    try {
      q?.delete();
    } catch {}
    try {
      tree?.delete();
    } catch {}
  }
}
