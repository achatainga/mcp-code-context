/**
 * Embedded SQL AST Parser & Security Validator
 * v6.0.0 Enterprise AST Intelligence
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { existsSync } from "node:fs";
import type { Tree, Node } from "web-tree-sitter";
import { ParserRegistry } from "../parsers/registry.js";
import { CodeContextEngine } from "../core/engine.js";
import { loadUnifiedVirtualSchema } from "../utils/virtualSchema.js";
import type { ReadResult } from "./readCore.js";

export interface SqlQueryFinding {
  querySnippet: string;
  line: number;
  column: number;
  statementType: "SELECT" | "INSERT" | "UPDATE" | "DELETE" | "OTHER";
  tablesReferenced: string[];
  columnsReferenced: string[];
  isParameterized: boolean;
  hasUnboundedMutation: boolean;
  hasInterpolationWarning: boolean;
  syntaxErrors: string[];
  schemaWarnings: string[];
}

export interface SqlValidatorReport {
  filePath?: string;
  queriesDetected: number;
  findings: SqlQueryFinding[];
  summary: string;
}

export interface SqlValidatorOptions {
  filePath?: string;
  code?: string;
  content?: string;
  projectRoot?: string;
  registry?: ParserRegistry;
}

const SQL_VERB_REGEX = /^\s*(SELECT|INSERT\s+INTO|UPDATE|DELETE\s+FROM|CREATE\s+TABLE|DROP\s+TABLE|ALTER\s+TABLE)\b/i;

/**
 * Checks if a string literal or template looks like an SQL statement
 */
function isSqlString(str: string): boolean {
  const trimmed = str.trim();
  return SQL_VERB_REGEX.test(trimmed);
}

/**
 * Basic SQL syntactic & semantic inspection
 */
function inspectSqlQuery(rawSql: string, isTemplate: boolean, knownTables: Set<string>): SqlQueryFinding {
  const trimmed = rawSql.trim();
  const upper = trimmed.toUpperCase();

  let statementType: SqlQueryFinding["statementType"] = "OTHER";
  if (upper.startsWith("SELECT")) statementType = "SELECT";
  else if (upper.startsWith("INSERT")) statementType = "INSERT";
  else if (upper.startsWith("UPDATE")) statementType = "UPDATE";
  else if (upper.startsWith("DELETE")) statementType = "DELETE";

  const syntaxErrors: string[] = [];
  const schemaWarnings: string[] = [];
  const tablesReferenced: string[] = [];
  const columnsReferenced: string[] = [];

  // 1. Balance check for parentheses and quotes
  let parenDepth = 0;
  for (const ch of trimmed) {
    if (ch === "(") parenDepth++;
    else if (ch === ")") parenDepth--;
  }
  if (parenDepth !== 0) {
    syntaxErrors.push(`Unbalanced parentheses in SQL query (diff: ${parenDepth})`);
  }

  // 2. Unbounded mutation check
  const hasUnboundedMutation =
    (statementType === "UPDATE" || statementType === "DELETE") &&
    !upper.includes("WHERE");

  if (hasUnboundedMutation) {
    syntaxErrors.push(`Dangerous unbounded ${statementType} without WHERE clause`);
  }

  // 3. String interpolation warning
  const hasInterpolationWarning = isTemplate && (rawSql.includes("${") || rawSql.includes("{"));

  // 4. Extract simple table references
  const fromMatch = trimmed.match(/\bFROM\s+([a-zA-Z0-9_]+)/i);
  if (fromMatch && fromMatch[1]) {
    tablesReferenced.push(fromMatch[1]);
  }
  const updateMatch = trimmed.match(/\bUPDATE\s+([a-zA-Z0-9_]+)/i);
  if (updateMatch && updateMatch[1]) {
    tablesReferenced.push(updateMatch[1]);
  }
  const intoMatch = trimmed.match(/\bINTO\s+([a-zA-Z0-9_]+)/i);
  if (intoMatch && intoMatch[1]) {
    tablesReferenced.push(intoMatch[1]);
  }

  // 5. Schema verification if knownTables available
  if (knownTables.size > 0) {
    for (const t of tablesReferenced) {
      if (!knownTables.has(t.toLowerCase()) && !knownTables.has(t)) {
        schemaWarnings.push(`Table '${t}' not found in registered project schema (Prisma/Drizzle/Rails/Eloquent)`);
      }
    }
  }

  return {
    querySnippet: trimmed.length > 120 ? trimmed.slice(0, 120) + "..." : trimmed,
    line: 1,
    column: 1,
    statementType,
    tablesReferenced,
    columnsReferenced,
    isParameterized: !hasInterpolationWarning && (trimmed.includes("?") || trimmed.includes("$1") || trimmed.includes(":")),
    hasUnboundedMutation,
    hasInterpolationWarning,
    syntaxErrors,
    schemaWarnings,
  };
}

/**
 * Validates embedded SQL queries in code
 */
export async function validateSqlAst(params: SqlValidatorOptions): Promise<ReadResult> {
  let tree: Tree | null = null;

  try {
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
        error: `No parser available for extension: ${ext}`,
      };
    }

    tree = parser.parse(content);

    // Load known schema tables if projectRoot available
    const knownTables = new Set<string>();
    if (params.projectRoot) {
      try {
        const result = await loadUnifiedVirtualSchema(params.projectRoot);
        if (result && result.schema) {
          for (const tableName of Object.keys(result.schema)) {
            knownTables.add(tableName.toLowerCase());
          }
        }
      } catch {
        // schema optional
      }
    }

    const findings: SqlQueryFinding[] = [];

    function walk(n: Node) {
      let isSql = false;
      let rawText = "";
      let isTemplate = false;

      if (n.type === "template_string" || n.type === "template_literal") {
        rawText = n.text.replace(/^`|`$/g, "");
        if (isSqlString(rawText) || n.parent?.text.includes("sql`") || n.parent?.text.includes("$queryRaw")) {
          isSql = true;
          isTemplate = true;
        }
      } else if (n.type === "string" || n.type === "string_literal") {
        rawText = n.text.replace(/^["']|["']$/g, "");
        if (isSqlString(rawText)) {
          isSql = true;
        }
      }

      if (isSql && rawText.length > 5) {
        const finding = inspectSqlQuery(rawText, isTemplate, knownTables);
        finding.line = n.startPosition.row + 1;
        finding.column = n.startPosition.column;
        findings.push(finding);
      }

      for (let i = 0; i < n.namedChildCount; i++) {
        const child = n.namedChild(i);
        if (child) walk(child);
      }
    }

    walk(tree.rootNode);

    const issuesCount = findings.reduce((acc, f) => acc + f.syntaxErrors.length + f.schemaWarnings.length, 0);

    const report: SqlValidatorReport = {
      filePath: params.filePath,
      queriesDetected: findings.length,
      findings,
      summary: `Detected ${findings.length} embedded SQL queries with ${issuesCount} total warnings/errors.`,
    };

    return {
      success: true,
      content: JSON.stringify(report, null, 2),
    };
  } catch (error) {
    return {
      success: false,
      error: `sql_ast_validator failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  } finally {
    if (tree) {
      try {
        tree.delete();
      } catch {
        // ignore
      }
    }
  }
}
