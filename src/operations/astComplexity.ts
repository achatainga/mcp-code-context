/**
 * AST Complexity Matrix (McCabe Cyclomatic & Sonar Cognitive Complexity)
 * v5.6.0 Enterprise AST Intelligence
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { existsSync } from "node:fs";
import type { Tree, Node } from "web-tree-sitter";
import { ParserRegistry } from "../parsers/registry.js";
import { CodeContextEngine } from "../core/engine.js";
import type { ReadResult } from "./readCore.js";

export interface FunctionComplexityMetric {
  name: string;
  kind: "function" | "method" | "arrow_function";
  startLine: number;
  endLine: number;
  cyclomaticComplexity: number;
  cognitiveComplexity: number;
  maxNestingDepth: number;
  riskLevel: "LOW" | "MODERATE" | "HIGH" | "CRITICAL";
  recommendation: string;
}

export interface AstComplexityReport {
  filePath?: string;
  totalFunctionsAnalyzed: number;
  averageCyclomatic: number;
  averageCognitive: number;
  highestCognitiveFunction?: string;
  metrics: FunctionComplexityMetric[];
  summary: string;
}

export interface AstComplexityOptions {
  filePath?: string;
  code?: string;
  content?: string;
  threshold?: number;
  projectRoot?: string;
  registry?: ParserRegistry;
}

/** Node types that introduce branching in Cyclomatic Complexity */
const CYCLOMATIC_BRANCH_TYPES = new Set([
  "if_statement",
  "ternary_expression",
  "conditional_expression",
  "for_statement",
  "for_in_statement",
  "for_of_statement",
  "while_statement",
  "do_statement",
  "switch_case",
  "case_clause",
  "catch_clause",
]);

/**
 * Calculates Cyclomatic Complexity of an AST subtree
 */
function calculateCyclomatic(node: Node): number {
  let complexity = 1;

  function traverse(n: Node) {
    if (CYCLOMATIC_BRANCH_TYPES.has(n.type)) {
      complexity++;
    } else if (n.type === "binary_expression") {
      const op = n.childForFieldName("operator")?.text;
      if (op === "&&" || op === "||" || op === "??") {
        complexity++;
      }
    }
    for (let i = 0; i < n.namedChildCount; i++) {
      const child = n.namedChild(i);
      if (
        child &&
        child.type !== "function_declaration" &&
        child.type !== "function_definition" &&
        child.type !== "method_definition" &&
        child.type !== "arrow_function"
      ) {
        traverse(child);
      }
    }
  }

  traverse(node);
  return complexity;
}

/**
 * Calculates Cognitive Complexity with nesting penalties
 */
function calculateCognitive(node: Node): { score: number; maxNesting: number } {
  let score = 0;
  let maxNesting = 0;

  function traverse(n: Node, nesting: number) {
    if (nesting > maxNesting) maxNesting = nesting;

    let isNestingConstruct = false;
    let increments = 0;

    switch (n.type) {
      case "if_statement":
      case "switch_statement":
      case "switch_case":
      case "for_statement":
      case "for_in_statement":
      case "for_of_statement":
      case "while_statement":
      case "do_statement":
      case "catch_clause":
        increments = 1 + nesting;
        isNestingConstruct = true;
        break;
      case "ternary_expression":
      case "conditional_expression":
        increments = 1 + nesting;
        break;
      case "binary_expression": {
        const op = n.childForFieldName("operator")?.text;
        if (op === "&&" || op === "||" || op === "??") {
          increments = 1;
        }
        break;
      }
    }

    score += increments;

    const nextNesting = isNestingConstruct ? nesting + 1 : nesting;

    for (let i = 0; i < n.namedChildCount; i++) {
      const child = n.namedChild(i);
      if (
        child &&
        child.type !== "function_declaration" &&
        child.type !== "function_definition" &&
        child.type !== "method_definition" &&
        child.type !== "arrow_function"
      ) {
        traverse(child, nextNesting);
      }
    }
  }

  traverse(node, 0);
  return { score, maxNesting };
}

/**
 * Finds all functions and methods within AST
 */
function extractFunctions(root: Node): Array<{ node: Node; name: string; kind: FunctionComplexityMetric["kind"] }> {
  const list: Array<{ node: Node; name: string; kind: FunctionComplexityMetric["kind"] }> = [];

  function walk(n: Node) {
    if (
      n.type === "function_declaration" ||
      n.type === "function_definition" ||
      n.type === "method_definition"
    ) {
      const name = n.childForFieldName("name")?.text || "anonymous";
      const kind = n.type === "method_definition" ? "method" : "function";
      list.push({ node: n, name, kind });
    } else if (n.type === "arrow_function") {
      let name = "anonymous_arrow";
      if (n.parent?.type === "variable_declarator") {
        name = n.parent.childForFieldName("name")?.text || name;
      }
      list.push({ node: n, name, kind: "arrow_function" });
    }

    for (let i = 0; i < n.namedChildCount; i++) {
      const child = n.namedChild(i);
      if (child) walk(child);
    }
  }

  walk(root);
  return list;
}

/**
 * Computes the AST complexity matrix for a file
 */
export async function getAstComplexityMatrix(params: AstComplexityOptions): Promise<ReadResult> {
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
        error: `No Tree-sitter parser available for extension: ${ext}`,
      };
    }

    tree = parser.parse(content);
    const functions = extractFunctions(tree.rootNode);

    const threshold = params.threshold || 0;
    const metrics: FunctionComplexityMetric[] = [];

    let totalCyclomatic = 0;
    let totalCognitive = 0;

    for (const fn of functions) {
      const cyclomatic = calculateCyclomatic(fn.node);
      const { score: cognitive, maxNesting } = calculateCognitive(fn.node);

      totalCyclomatic += cyclomatic;
      totalCognitive += cognitive;

      let riskLevel: FunctionComplexityMetric["riskLevel"] = "LOW";
      let recommendation = "Function is concise and straightforward.";

      if (cognitive >= 25 || cyclomatic >= 20) {
        riskLevel = "CRITICAL";
        recommendation = "Decompose immediately. High probability of hidden bugs and testing resistance.";
      } else if (cognitive >= 15 || cyclomatic >= 10) {
        riskLevel = "HIGH";
        recommendation = "Extract nested control structures and early return guard clauses.";
      } else if (cognitive >= 8 || cyclomatic >= 6) {
        riskLevel = "MODERATE";
        recommendation = "Consider simplifying nested conditions or ternary operators.";
      }

      if (cognitive >= threshold) {
        metrics.push({
          name: fn.name,
          kind: fn.kind,
          startLine: fn.node.startPosition.row + 1,
          endLine: fn.node.endPosition.row + 1,
          cyclomaticComplexity: cyclomatic,
          cognitiveComplexity: cognitive,
          maxNestingDepth: maxNesting,
          riskLevel,
          recommendation,
        });
      }
    }

    // Sort by cognitive complexity descending
    metrics.sort((a, b) => b.cognitiveComplexity - a.cognitiveComplexity);

    const count = functions.length;
    const avgCyclomatic = count > 0 ? Number((totalCyclomatic / count).toFixed(2)) : 0;
    const avgCognitive = count > 0 ? Number((totalCognitive / count).toFixed(2)) : 0;

    const report: AstComplexityReport = {
      filePath: params.filePath,
      totalFunctionsAnalyzed: count,
      averageCyclomatic: avgCyclomatic,
      averageCognitive: avgCognitive,
      highestCognitiveFunction: metrics.length > 0 ? `${metrics[0].name} (Score: ${metrics[0].cognitiveComplexity})` : undefined,
      metrics,
      summary: `Analyzed ${count} functions. Avg Cyclomatic: ${avgCyclomatic}, Avg Cognitive: ${avgCognitive}. Identified ${metrics.filter(m => m.riskLevel === "HIGH" || m.riskLevel === "CRITICAL").length} high-risk functions.`,
    };

    return {
      success: true,
      content: JSON.stringify(report, null, 2),
    };
  } catch (error) {
    return {
      success: false,
      error: `get_ast_complexity_matrix failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  } finally {
    if (tree) {
      try {
        tree.delete();
      } catch {
        // ignore disposal errors
      }
    }
  }
}
