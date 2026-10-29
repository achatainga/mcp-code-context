/**
 * Lossless CST Structural Codemod Engine
 * v6.0.0 Enterprise AST Intelligence
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { existsSync } from "node:fs";
import type { Tree, Node } from "web-tree-sitter";
import { ParserRegistry } from "../parsers/registry.js";
import { CodeContextEngine } from "../core/engine.js";
import type { ReadResult } from "./readCore.js";

export type CodemodRule = "cjs-to-esm" | "strip-console" | "named-to-arrow";

export interface CodemodChange {
  rule: string;
  startLine: number;
  endLine: number;
  originalSnippet: string;
  transformedSnippet: string;
}

export interface CstCodemodReport {
  filePath?: string;
  ruleApplied: string;
  changesApplied: number;
  changes: CodemodChange[];
  transformedCode: string;
  summary: string;
}

export interface CstCodemodOptions {
  filePath?: string;
  code?: string;
  content?: string;
  rule: CodemodRule;
  projectRoot?: string;
  registry?: ParserRegistry;
}

/**
 * Transforms CommonJS require statements into ESM import statements
 */
function applyCjsToEsm(root: Node, source: string): { transformed: string; changes: CodemodChange[] } {
  const changes: CodemodChange[] = [];
  const replacements: Array<{ start: number; end: number; text: string }> = [];

  function walk(n: Node) {
    // const x = require('x');
    if (
      n.type === "lexical_declaration" ||
      n.type === "variable_declaration"
    ) {
      for (let i = 0; i < n.namedChildCount; i++) {
        const decl = n.namedChild(i);
        if (decl && decl.type === "variable_declarator") {
          const init = decl.childForFieldName("value");
          if (
            init &&
            init.type === "call_expression" &&
            init.childForFieldName("function")?.text === "require"
          ) {
            const varName = decl.childForFieldName("name")?.text;
            const args = init.childForFieldName("arguments");
            const modPath = args?.namedChild(0)?.text;

            if (varName && modPath) {
              const esm = `import ${varName} from ${modPath};`;
              replacements.push({
                start: n.startIndex,
                end: n.endIndex,
                text: esm,
              });
              changes.push({
                rule: "cjs-to-esm",
                startLine: n.startPosition.row + 1,
                endLine: n.endPosition.row + 1,
                originalSnippet: n.text,
                transformedSnippet: esm,
              });
            }
          }
        }
      }
    }

    // module.exports = x;
    if (n.type === "expression_statement") {
      const expr = n.namedChild(0);
      if (expr && expr.type === "assignment_expression") {
        const left = expr.childForFieldName("left")?.text;
        const right = expr.childForFieldName("right")?.text;
        if (left === "module.exports" && right) {
          const esm = `export default ${right};`;
          replacements.push({
            start: n.startIndex,
            end: n.endIndex,
            text: esm,
          });
          changes.push({
            rule: "cjs-to-esm",
            startLine: n.startPosition.row + 1,
            endLine: n.endPosition.row + 1,
            originalSnippet: n.text,
            transformedSnippet: esm,
          });
        }
      }
    }

    for (let i = 0; i < n.namedChildCount; i++) {
      const child = n.namedChild(i);
      if (child) walk(child);
    }
  }

  walk(root);

  // Apply replacements from end to start to maintain indices
  replacements.sort((a, b) => b.start - a.start);
  let transformed = source;
  for (const r of replacements) {
    transformed = transformed.slice(0, r.start) + r.text + transformed.slice(r.end);
  }

  return { transformed, changes };
}

/**
 * Strips console.log calls
 */
function applyStripConsole(root: Node, source: string): { transformed: string; changes: CodemodChange[] } {
  const changes: CodemodChange[] = [];
  const replacements: Array<{ start: number; end: number; text: string }> = [];

  function walk(n: Node) {
    if (n.type === "expression_statement") {
      const expr = n.namedChild(0);
      if (
        expr &&
        expr.type === "call_expression" &&
        expr.childForFieldName("function")?.text?.startsWith("console.")
      ) {
        replacements.push({
          start: n.startIndex,
          end: n.endIndex,
          text: "",
        });
        changes.push({
          rule: "strip-console",
          startLine: n.startPosition.row + 1,
          endLine: n.endPosition.row + 1,
          originalSnippet: n.text,
          transformedSnippet: "/* removed */",
        });
      }
    }

    for (let i = 0; i < n.namedChildCount; i++) {
      const child = n.namedChild(i);
      if (child) walk(child);
    }
  }

  walk(root);

  replacements.sort((a, b) => b.start - a.start);
  let transformed = source;
  for (const r of replacements) {
    transformed = transformed.slice(0, r.start) + r.text + transformed.slice(r.end);
  }

  return { transformed, changes };
}

/**
 * Main CST Codemod Transpile Operation
 */
export async function astCodemodTranspile(params: CstCodemodOptions): Promise<ReadResult> {
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

    let result = { transformed: content, changes: [] as CodemodChange[] };

    if (params.rule === "cjs-to-esm") {
      result = applyCjsToEsm(tree.rootNode, content);
    } else if (params.rule === "strip-console") {
      result = applyStripConsole(tree.rootNode, content);
    } else {
      return {
        success: false,
        error: `Unsupported codemod rule: '${params.rule}'. Supported: 'cjs-to-esm', 'strip-console'.`,
      };
    }

    const report: CstCodemodReport = {
      filePath: params.filePath,
      ruleApplied: params.rule,
      changesApplied: result.changes.length,
      changes: result.changes,
      transformedCode: result.transformed,
      summary: `Successfully applied codemod '${params.rule}'. Performed ${result.changes.length} lossless CST transformations.`,
    };

    return {
      success: true,
      content: JSON.stringify(report, null, 2),
    };
  } catch (error) {
    return {
      success: false,
      error: `ast_codemod_transpile failed: ${error instanceof Error ? error.message : String(error)}`,
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
