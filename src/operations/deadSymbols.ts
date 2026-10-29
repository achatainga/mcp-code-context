/**
 * AST Reachability & Zombie Export Eliminator
 * v5.7.0 Enterprise AST Intelligence
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { existsSync } from "node:fs";
import type { Tree, Node } from "web-tree-sitter";
import { ParserRegistry } from "../parsers/registry.js";
import { CodeContextEngine } from "../core/engine.js";
import type { ReadResult } from "./readCore.js";

export interface DeadSymbolItem {
  name: string;
  kind: "function" | "class" | "interface" | "variable" | "export";
  line: number;
  column: number;
  reason: "UNUSED_EXPORT" | "UNUSED_INTERNAL" | "UNREACHABLE_AFTER_RETURN";
  snippet: string;
}

export interface DeadSymbolsReport {
  filePath?: string;
  totalSymbolsScanned: number;
  deadSymbolsCount: number;
  deadSymbols: DeadSymbolItem[];
  summary: string;
}

export interface DeadSymbolsOptions {
  filePath?: string;
  code?: string;
  content?: string;
  projectRoot?: string;
  registry?: ParserRegistry;
}

/**
 * Checks for unreachable code following return or throw statements
 */
function findUnreachableStatements(node: Node, lines: string[]): DeadSymbolItem[] {
  const unreachable: DeadSymbolItem[] = [];

  function walk(n: Node) {
    if (n.type === "statement_block" || n.type === "block") {
      let terminated = false;
      let terminatingStatement: Node | null = null;

      for (let i = 0; i < n.namedChildCount; i++) {
        const child = n.namedChild(i);
        if (!child) continue;

        if (terminated) {
          unreachable.push({
            name: child.text.slice(0, 30),
            kind: "variable",
            line: child.startPosition.row + 1,
            column: child.startPosition.column,
            reason: "UNREACHABLE_AFTER_RETURN",
            snippet: lines[child.startPosition.row] || child.text,
          });
        }

        if (
          child.type === "return_statement" ||
          child.type === "throw_statement"
        ) {
          terminated = true;
          terminatingStatement = child;
        }
      }
    }

    for (let i = 0; i < n.namedChildCount; i++) {
      const child = n.namedChild(i);
      if (child) walk(child);
    }
  }

  walk(node);
  return unreachable;
}

/**
 * Extracts declared symbols and counts their identifier references
 */
export async function detectDeadAstSymbols(params: DeadSymbolsOptions): Promise<ReadResult> {
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

    const declaredSymbols: Array<{
      name: string;
      kind: DeadSymbolItem["kind"];
      isExported: boolean;
      node: Node;
    }> = [];

    const identifierUsages = new Map<string, number>();

    function walkAST(n: Node) {
      // Check declarations
      const isExported = n.parent?.type === "export_statement" || n.text.startsWith("export ");

      if (
        n.type === "function_declaration" ||
        n.type === "function_definition"
      ) {
        const name = n.childForFieldName("name")?.text;
        if (name) {
          declaredSymbols.push({ name, kind: "function", isExported, node: n });
        }
      } else if (
        n.type === "class_declaration" ||
        n.type === "class_definition"
      ) {
        const name = n.childForFieldName("name")?.text;
        if (name) {
          declaredSymbols.push({ name, kind: "class", isExported, node: n });
        }
      } else if (n.type === "interface_declaration") {
        const name = n.childForFieldName("name")?.text;
        if (name) {
          declaredSymbols.push({ name, kind: "interface", isExported, node: n });
        }
      } else if (n.type === "variable_declarator") {
        const name = n.childForFieldName("name")?.text;
        if (name) {
          declaredSymbols.push({ name, kind: "variable", isExported, node: n });
        }
      }

      // Count identifier references
      if (
        (n.type === "identifier" || n.type === "type_identifier") &&
        n.parent?.type !== "function_declaration" &&
        n.parent?.type !== "class_declaration" &&
        n.parent?.type !== "interface_declaration" &&
        n.parent?.type !== "variable_declarator"
      ) {
        identifierUsages.set(n.text, (identifierUsages.get(n.text) || 0) + 1);
      }

      for (let i = 0; i < n.namedChildCount; i++) {
        const child = n.namedChild(i);
        if (child) walkAST(child);
      }
    }

    walkAST(tree.rootNode);

    const deadSymbols: DeadSymbolItem[] = [];

    // 1. Identify declared symbols with zero references
    for (const sym of declaredSymbols) {
      const usages = identifierUsages.get(sym.name) || 0;
      if (usages === 0) {
        deadSymbols.push({
          name: sym.name,
          kind: sym.kind,
          line: sym.node.startPosition.row + 1,
          column: sym.node.startPosition.column,
          reason: sym.isExported ? "UNUSED_EXPORT" : "UNUSED_INTERNAL",
          snippet: lines[sym.node.startPosition.row] || sym.name,
        });
      }
    }

    // 2. Identify unreachable statements
    const unreachable = findUnreachableStatements(tree.rootNode, lines);
    deadSymbols.push(...unreachable);

    const report: DeadSymbolsReport = {
      filePath: params.filePath,
      totalSymbolsScanned: declaredSymbols.length,
      deadSymbolsCount: deadSymbols.length,
      deadSymbols,
      summary: `Scanned ${declaredSymbols.length} declared symbols. Found ${deadSymbols.length} dead/unreachable AST items.`,
    };

    return {
      success: true,
      content: JSON.stringify(report, null, 2),
    };
  } catch (error) {
    return {
      success: false,
      error: `detect_dead_ast_symbols failed: ${error instanceof Error ? error.message : String(error)}`,
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
