/**
 * AST Exception & Error Swallowing Guard
 * v7.0.1 Enterprise AST Intelligence
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { existsSync } from "node:fs";
import type { Tree, Node } from "web-tree-sitter";
import { ParserRegistry } from "../parsers/registry.js";
import { CodeContextEngine } from "../core/engine.js";
import type { ReadResult } from "./readCore.js";

export interface CatchClauseFinding {
  line: number;
  column: number;
  caughtType?: string;
  variableName?: string;
  findingType: "EMPTY_CATCH" | "GENERIC_SWALLOW" | "MISSING_TELEMETRY" | "SUPPRESSED_CRITICAL";
  severity: "CRITICAL" | "HIGH" | "MEDIUM";
  snippet: string;
  recommendation: string;
}

export interface ErrorAuditReport {
  filePath?: string;
  totalCatchBlocks: number;
  cleanCatchBlocks: number;
  riskyCatchBlocks: number;
  resilienceScore: number;
  findings: CatchClauseFinding[];
  summary: string;
}

export interface ErrorAuditOptions {
  filePath?: string;
  code?: string;
  content?: string;
  projectRoot?: string;
  registry?: ParserRegistry;
}

/**
 * Checks if a block contains any logging or rethrow statements
 */
function inspectCatchBody(bodyNode: Node): { hasLogging: boolean; hasRethrow: boolean; isEmpty: boolean } {
  let hasLogging = false;
  let hasRethrow = false;

  // Check if empty or contains only comments
  const stripped = bodyNode.text.replace(/(\/\*[\s\S]*?\*\/|\/\/.*|\{|\}|\s)/g, "");
  if (bodyNode.namedChildCount === 0 || stripped === "" || stripped === "pass") {
    return { hasLogging: false, hasRethrow: false, isEmpty: true };
  }

  function walk(n: Node) {
    if (
      n.type === "throw_statement" ||
      n.type === "raise_statement"
    ) {
      hasRethrow = true;
    }

    if (n.type === "call_expression" || n.type === "call") {
      const fn = n.childForFieldName("function")?.text || "";
      if (
        fn.includes("log") ||
        fn.includes("error") ||
        fn.includes("warn") ||
        fn.includes("telemetry") ||
        fn.includes("audit")
      ) {
        hasLogging = true;
      }
    }

    for (let i = 0; i < n.namedChildCount; i++) {
      const child = n.namedChild(i);
      if (child) walk(child);
    }
  }

  walk(bodyNode);
  return { hasLogging, hasRethrow, isEmpty: false };
}

/**
 * Audits error handling patterns across AST
 */
export async function auditErrorHandlingContracts(params: ErrorAuditOptions): Promise<ReadResult> {
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
    const lines = content.split("\n");

    const findings: CatchClauseFinding[] = [];
    let totalCatches = 0;

    function walkAST(n: Node) {
      // TypeScript / JS / PHP: catch_clause
      if (n.type === "catch_clause") {
        totalCatches++;
        const param = n.childForFieldName("parameter")?.text;
        const body = n.childForFieldName("body") || n.namedChild(n.namedChildCount - 1);

        if (body) {
          const { hasLogging, hasRethrow, isEmpty } = inspectCatchBody(body);

          if (isEmpty) {
            findings.push({
              line: n.startPosition.row + 1,
              column: n.startPosition.column,
              caughtType: param,
              findingType: "EMPTY_CATCH",
              severity: "CRITICAL",
              snippet: lines[n.startPosition.row]?.trim() || n.text,
              recommendation: "Never leave catch blocks empty. Add structured logging or rethrow.",
            });
          } else if (!hasRethrow && !hasLogging) {
            findings.push({
              line: n.startPosition.row + 1,
              column: n.startPosition.column,
              caughtType: param,
              findingType: "GENERIC_SWALLOW",
              severity: "HIGH",
              snippet: lines[n.startPosition.row]?.trim() || n.text,
              recommendation: "Swallowing caught exception without logging or rethrowing damages system observability.",
            });
          }
        }
      }

      // Python: except_clause
      if (n.type === "except_clause") {
        totalCatches++;
        const exceptText = n.text;
        const parentTry = n.parent;
        const body = parentTry?.childForFieldName("body") || n.nextNamedSibling;

        if (n.text.includes("BaseException") || n.text.includes("KeyboardInterrupt") || n.text.includes("SystemExit")) {
          findings.push({
            line: n.startPosition.row + 1,
            column: n.startPosition.column,
            caughtType: exceptText,
            findingType: "SUPPRESSED_CRITICAL",
            severity: "CRITICAL",
            snippet: lines[n.startPosition.row]?.trim() || n.text,
            recommendation: "Do not intercept KeyboardInterrupt or SystemExit; it prevents graceful process termination.",
          });
        }

        // Check the block following except
        const nextSibling = n.nextNamedSibling;
        if (nextSibling && (nextSibling.type === "block" || nextSibling.type === "statement_block")) {
          const { hasLogging, hasRethrow, isEmpty } = inspectCatchBody(nextSibling);
          if (isEmpty) {
            findings.push({
              line: n.startPosition.row + 1,
              column: n.startPosition.column,
              caughtType: exceptText,
              findingType: "EMPTY_CATCH",
              severity: "CRITICAL",
              snippet: lines[n.startPosition.row]?.trim() || n.text,
              recommendation: "Empty 'except: pass' silently hides catastrophic runtime failures.",
            });
          } else if (!hasRethrow && !hasLogging) {
            findings.push({
              line: n.startPosition.row + 1,
              column: n.startPosition.column,
              caughtType: exceptText,
              findingType: "GENERIC_SWALLOW",
              severity: "HIGH",
              snippet: lines[n.startPosition.row]?.trim() || n.text,
              recommendation: "Add logger.exception() or re-raise with 'raise'.",
            });
          }
        }
      }

      for (let i = 0; i < n.namedChildCount; i++) {
        const child = n.namedChild(i);
        if (child) walkAST(child);
      }
    }

    walkAST(tree.rootNode);

    const riskyCount = findings.length;
    const cleanCount = Math.max(0, totalCatches - riskyCount);
    const resilienceScore = totalCatches > 0 ? Math.round((cleanCount / totalCatches) * 100) : 100;

    const report: ErrorAuditReport = {
      filePath: params.filePath,
      totalCatchBlocks: totalCatches,
      cleanCatchBlocks: cleanCount,
      riskyCatchBlocks: riskyCount,
      resilienceScore,
      findings,
      summary: `Audited ${totalCatches} catch/except clauses. Clean: ${cleanCount}, Risky: ${riskyCount}. Error Resilience Score: ${resilienceScore}/100.`,
    };

    return {
      success: true,
      content: JSON.stringify(report, null, 2),
    };
  } catch (error) {
    return {
      success: false,
      error: `audit_error_handling_contracts failed: ${error instanceof Error ? error.message : String(error)}`,
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
