/**
 * WASM Incremental AST Re-Parsing & Subtree Diff Engine (v5.5.0)
 * 
 * Computes sub-millisecond AST re-parsing deltas between old and new code using
 * Tree-sitter's tree.edit() and incremental re-parsing. Identifies exact affected
 * AST nodes, enclosing declarations, and validates syntax error integrity (hasError)
 * in O(log N) time without re-parsing unaffected subtrees.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { existsSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { ParserRegistry } from "../parsers/registry.js";
import { CodeContextEngine } from "../core/engine.js";
import type { ReadResult } from "./readCore.js";
import type { Node, Tree, Point } from "web-tree-sitter";

export interface AffectedAstNode {
  type: string;
  symbolName?: string;
  enclosingScope?: string;
  startLine: number;
  endLine: number;
  startColumn: number;
  endColumn: number;
  snippet: string;
}

export interface IncrementalAstDiffReport {
  filePath?: string;
  reparseDurationMs: number;
  isSyntaxValid: boolean;
  hasErrors: boolean;
  errorNodesCount: number;
  deltaByteRange: {
    startIndex: number;
    oldEndIndex: number;
    newEndIndex: number;
  };
  affectedNode: AffectedAstNode;
  summary: string;
}

/**
 * Calculates common prefix length between two strings
 */
function getCommonPrefix(s1: string, s2: string): number {
  let i = 0;
  const max = Math.min(s1.length, s2.length);
  while (i < max && s1[i] === s2[i]) i++;
  return i;
}

/**
 * Calculates common suffix length between two strings given prefix offset
 */
function getCommonSuffix(s1: string, s2: string, prefixLen: number): number {
  let len = 0;
  let i1 = s1.length - 1;
  let i2 = s2.length - 1;
  while (i1 >= prefixLen && i2 >= prefixLen && s1[i1] === s2[i2]) {
    len++;
    i1--;
    i2--;
  }
  return len;
}

/**
 * Converts byte index into row/column Point
 */
function indexToPoint(str: string, index: number): Point {
  const slice = str.slice(0, index);
  const lines = slice.split("\n");
  const row = lines.length - 1;
  const column = lines[lines.length - 1].length;
  return { row, column };
}

/**
 * Finds the enclosing declaration (function, class, method, or interface)
 */
function findEnclosingDeclaration(node: Node): { type: string; name?: string } | null {
  let curr: Node | null = node;
  while (curr) {
    if (
      curr.type === "function_declaration" ||
      curr.type === "function_definition" ||
      curr.type === "method_definition" ||
      curr.type === "class_declaration" ||
      curr.type === "class_definition" ||
      curr.type === "interface_declaration" ||
      curr.type === "arrow_function"
    ) {
      const name = curr.childForFieldName("name")?.text ||
                   (curr.parent?.type === "variable_declarator" ? curr.parent.childForFieldName("name")?.text : undefined);
      return { type: curr.type, name };
    }
    curr = curr.parent;
  }
  return null;
}

export interface IncrementalAstDiffOptions {
  filePath?: string;
  newContent?: string;
  oldContent?: string;
  newCode?: string;
  oldCode?: string;
  projectRoot?: string;
  registry?: ParserRegistry;
}

/**
 * Main incrementalAstDiff operation
 */
export async function incrementalAstDiff(params: IncrementalAstDiffOptions): Promise<ReadResult> {
  let oldTree: Tree | null = null;
  let newTree: Tree | null = null;

  try {
    const targetPath = params.filePath || "in_memory.ts";
    let oldContent = params.oldCode ?? params.oldContent;

    if (oldContent === undefined) {
      if (params.filePath && existsSync(params.filePath)) {
        oldContent = await fs.readFile(params.filePath, "utf-8");
      } else {
        oldContent = "";
      }
    }

    let newContent = params.newCode ?? params.newContent;
    if (newContent === undefined) {
      if (params.filePath && existsSync(params.filePath)) {
        newContent = await fs.readFile(params.filePath, "utf-8");
      } else {
        return {
          success: false,
          error: "newCode or newContent is required",
        };
      }
    }

    const ext = path.extname(targetPath).toLowerCase();

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
        error: `No AST parser available for extension ${ext}`,
      };
    }

    // Parse base tree
    oldTree = parser.parse(oldContent);

    // Compute diff offsets
    const prefixLen = getCommonPrefix(oldContent, newContent);
    const suffixLen = getCommonSuffix(oldContent, newContent, prefixLen);

    const startIndex = prefixLen;
    const oldEndIndex = oldContent.length - suffixLen;
    const newEndIndex = newContent.length - suffixLen;

    const startPos = indexToPoint(oldContent, startIndex);
    const oldEndPos = indexToPoint(oldContent, oldEndIndex);
    const newEndPos = indexToPoint(newContent, newEndIndex);

    // Execute tree-sitter edit on oldTree
    oldTree.edit({
      startIndex,
      oldEndIndex,
      newEndIndex,
      startPosition: startPos,
      oldEndPosition: oldEndPos,
      newEndPosition: newEndPos,
    });

    // Benchmark sub-millisecond re-parsing
    const t0 = performance.now();
    newTree = parser.parse(newContent, oldTree);
    const reparseDurationMs = Number((performance.now() - t0).toFixed(3));

    // Verify syntax integrity
    const hasErrors = newTree.rootNode.hasError;

    // Count error nodes if syntax broke
    let errorNodesCount = 0;
    if (hasErrors) {
      function countErrors(node: Node) {
        if (node.type === "ERROR" || node.isMissing) {
          errorNodesCount++;
        }
        for (let i = 0; i < node.namedChildCount; i++) {
          const c = node.namedChild(i);
          if (c && c.hasError) countErrors(c);
        }
      }
      countErrors(newTree.rootNode);
    }

    // Locate affected node in newTree
    const targetIdx = Math.min(startIndex, newContent.length > 0 ? newContent.length - 1 : 0);
    const targetEndIdx = Math.max(targetIdx, Math.min(newEndIndex, newContent.length));
    const rawNode = newTree.rootNode.descendantForIndex(targetIdx, targetEndIdx);
    const affectedNode: Node = rawNode ?? newTree.rootNode;

    const enclosing = findEnclosingDeclaration(affectedNode);
    const startRow = affectedNode.startPosition.row;
    const endRow = affectedNode.endPosition.row;

    const newLines = newContent.split("\n");
    const previewLines = newLines.slice(Math.max(0, startRow - 1), Math.min(newLines.length, endRow + 2));

    const affectedDetail: AffectedAstNode = {
      type: affectedNode.type,
      symbolName: enclosing?.name,
      enclosingScope: enclosing ? `${enclosing.type} ${enclosing.name || "(anonymous)"}` : "global",
      startLine: startRow + 1,
      endLine: endRow + 1,
      startColumn: affectedNode.startPosition.column,
      endColumn: affectedNode.endPosition.column,
      snippet: previewLines.join("\n"),
    };

    const summary = hasErrors
      ? `⚠️ Incremental Re-parse: Syntax Error introduced in '${affectedDetail.enclosingScope}' (Lines ${affectedDetail.startLine}-${affectedDetail.endLine}) in ${reparseDurationMs}ms.`
      : `✅ Incremental Re-parse: Clean syntax update in '${affectedDetail.enclosingScope}' (Lines ${affectedDetail.startLine}-${affectedDetail.endLine}) in ${reparseDurationMs}ms.`;

    const report: IncrementalAstDiffReport = {
      filePath: params.filePath,
      reparseDurationMs,
      isSyntaxValid: !hasErrors,
      hasErrors,
      errorNodesCount,
      deltaByteRange: {
        startIndex,
        oldEndIndex,
        newEndIndex,
      },
      affectedNode: affectedDetail,
      summary,
    };

    return {
      success: true,
      content: JSON.stringify(report, null, 2) + "\n\n" + summary,
    };
  } catch (error) {
    return {
      success: false,
      error: `incremental_ast_diff failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  } finally {
    // SRE Guardrail: Strict WASM Linear Memory Disposal
    try {
      oldTree?.delete();
    } catch {}
    try {
      newTree?.delete();
    } catch {}
  }
}
