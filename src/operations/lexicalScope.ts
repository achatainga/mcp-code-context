/**
 * Scope-Aware Semantic Scope Resolver & Shadowing Guard
 * v5.7.0 Enterprise AST Intelligence
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { existsSync } from "node:fs";
import type { Tree, Node } from "web-tree-sitter";
import { ParserRegistry } from "../parsers/registry.js";
import { CodeContextEngine } from "../core/engine.js";
import type { ReadResult } from "./readCore.js";

export interface ScopeVariable {
  name: string;
  kind: "var" | "let" | "const" | "parameter" | "function" | "class";
  line: number;
  column: number;
}

export interface ShadowingIncident {
  identifier: string;
  innerScopeLine: number;
  outerScopeLine: number;
  warning: string;
}

export interface LexicalScopeInfo {
  id: number;
  type: "global" | "module" | "function" | "block";
  startLine: number;
  endLine: number;
  parentId?: number;
  variables: ScopeVariable[];
}

export interface LexicalScopeReport {
  filePath?: string;
  totalScopes: number;
  shadowingIncidents: ShadowingIncident[];
  scopes: LexicalScopeInfo[];
  canSafelyRename?: boolean;
  renameCollisionWarning?: string;
  summary: string;
}

export interface LexicalScopeOptions {
  filePath?: string;
  code?: string;
  content?: string;
  proposedRename?: {
    targetSymbol: string;
    newSymbolName: string;
    atLine: number;
  };
  projectRoot?: string;
  registry?: ParserRegistry;
}

/**
 * Builds the lexical scope tree and tracks identifier declarations
 */
function buildScopeTree(rootNode: Node): { scopes: LexicalScopeInfo[]; incidents: ShadowingIncident[] } {
  const scopes: LexicalScopeInfo[] = [];
  const incidents: ShadowingIncident[] = [];
  let nextScopeId = 1;

  function traverseScope(n: Node, parentId?: number): number {
    const isGlobal = !parentId && (n.type === "program" || n.type === "module");
    const isFunction =
      n.type === "function_declaration" ||
      n.type === "function_definition" ||
      n.type === "method_definition" ||
      n.type === "arrow_function";
    const isBlock = n.type === "statement_block" || n.type === "block";

    let currentScopeId = parentId;

    if (isGlobal || isFunction || isBlock) {
      currentScopeId = nextScopeId++;
      const scopeType: LexicalScopeInfo["type"] = isGlobal ? "global" : isFunction ? "function" : "block";

      scopes.push({
        id: currentScopeId,
        type: scopeType,
        startLine: n.startPosition.row + 1,
        endLine: n.endPosition.row + 1,
        parentId,
        variables: [],
      });
    }

    // Capture parameter declarations
    if (isFunction) {
      const params = n.childForFieldName("parameters");
      if (params) {
        for (let i = 0; i < params.namedChildCount; i++) {
          const p = params.namedChild(i);
          if (p && (p.type === "required_parameter" || p.type === "identifier")) {
            const name = p.type === "identifier" ? p.text : p.childForFieldName("pattern")?.text || p.text;
            const targetScope = scopes.find(s => s.id === currentScopeId);
            if (targetScope && name) {
              targetScope.variables.push({
                name,
                kind: "parameter",
                line: p.startPosition.row + 1,
                column: p.startPosition.column,
              });
            }
          }
        }
      }
    }

    // Capture variable declarators
    if (n.type === "variable_declarator") {
      const name = n.childForFieldName("name")?.text;
      if (name && currentScopeId) {
        const targetScope = scopes.find(s => s.id === currentScopeId);
        if (targetScope) {
          targetScope.variables.push({
            name,
            kind: "const",
            line: n.startPosition.row + 1,
            column: n.startPosition.column,
          });
        }
      }
    }

    for (let i = 0; i < n.namedChildCount; i++) {
      const child = n.namedChild(i);
      if (child) traverseScope(child, currentScopeId);
    }

    return currentScopeId || 0;
  }

  traverseScope(rootNode);

  // Detect shadowing across parent scopes
  for (const scope of scopes) {
    if (!scope.parentId) continue;

    for (const v of scope.variables) {
      let ancestorId: number | undefined = scope.parentId;
      while (ancestorId) {
        const ancestor = scopes.find(s => s.id === ancestorId);
        if (ancestor) {
          const shadowed = ancestor.variables.find(av => av.name === v.name);
          if (shadowed) {
            incidents.push({
              identifier: v.name,
              innerScopeLine: v.line,
              outerScopeLine: shadowed.line,
              warning: `Variable '${v.name}' at line ${v.line} shadows outer declaration at line ${shadowed.line}`,
            });
          }
          ancestorId = ancestor.parentId;
        } else {
          break;
        }
      }
    }
  }

  return { scopes, incidents };
}

/**
 * Main lexical scope resolver
 */
export async function resolveLexicalScope(params: LexicalScopeOptions): Promise<ReadResult> {
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
    const { scopes, incidents } = buildScopeTree(tree.rootNode);

    let canSafelyRename = true;
    let renameCollisionWarning: string | undefined = undefined;

    if (params.proposedRename) {
      const { targetSymbol, newSymbolName, atLine } = params.proposedRename;
      // Find innermost scope enclosing atLine (smallest line span)
      const targetScope = scopes
        .filter(s => atLine >= s.startLine && atLine <= s.endLine)
        .sort((a, b) => (a.endLine - a.startLine) - (b.endLine - b.startLine))[0];

      if (targetScope) {
        // Check if newSymbolName already exists in this scope, its ancestors, or direct children
        const checkScopes = [targetScope];
        let curr = targetScope;
        while (curr.parentId) {
          const parent = scopes.find(s => s.id === curr.parentId);
          if (parent) {
            checkScopes.push(parent);
            curr = parent;
          } else {
            break;
          }
        }

        for (const s of scopes) {
          if (s.parentId === targetScope.id && !checkScopes.includes(s)) {
            checkScopes.push(s);
          }
        }

        for (const s of checkScopes) {
          if (s.variables.some(v => v.name === newSymbolName)) {
            canSafelyRename = false;
            renameCollisionWarning = `Cannot safely rename '${targetSymbol}' to '${newSymbolName}': identifier '${newSymbolName}' is already declared in scope (Lines ${s.startLine}-${s.endLine}).`;
            break;
          }
        }
      }
    }

    const report: LexicalScopeReport = {
      filePath: params.filePath,
      totalScopes: scopes.length,
      shadowingIncidents: incidents,
      scopes,
      canSafelyRename,
      renameCollisionWarning,
      summary: `Analyzed ${scopes.length} lexical scopes. Detected ${incidents.length} variable shadowing incidents.${renameCollisionWarning ? " ⚠️ Rename collision detected." : ""}`,
    };

    return {
      success: true,
      content: JSON.stringify(report, null, 2),
    };
  } catch (error) {
    return {
      success: false,
      error: `resolve_lexical_scope failed: ${error instanceof Error ? error.message : String(error)}`,
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
