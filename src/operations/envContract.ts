/**
 * Environment Variable AST Drift & Parity Verifier
 * v7.0.0 Enterprise AST Intelligence
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { existsSync } from "node:fs";
import type { Tree, Node } from "web-tree-sitter";
import { ParserRegistry } from "../parsers/registry.js";
import { CodeContextEngine } from "../core/engine.js";
import type { ReadResult } from "./readCore.js";

export interface EnvReference {
  name: string;
  line: number;
  column: number;
  snippet: string;
}

export interface EnvContractReport {
  filePath?: string;
  envExamplePath?: string;
  totalReferencedInCode: number;
  totalInExample: number;
  undocumentedInCode: string[];
  zombieInExample: string[];
  coveragePercent: number;
  references: EnvReference[];
  summary: string;
}

export interface EnvContractOptions {
  filePath?: string;
  code?: string;
  content?: string;
  envExampleContent?: string;
  projectRoot?: string;
  registry?: ParserRegistry;
}

/**
 * Parses .env.example into a Set of variable names
 */
function parseEnvExample(content: string): Set<string> {
  const vars = new Set<string>();
  const lines = content.split("\n");
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*=/);
    if (match && match[1]) {
      vars.add(match[1]);
    }
  }
  return vars;
}

/**
 * Extracts environment variable accesses from AST
 */
function extractEnvReferences(rootNode: Node, lines: string[]): EnvReference[] {
  const refs: EnvReference[] = [];

  function walk(n: Node) {
    // 1. Node.js / TS: process.env.XYZ or process.env['XYZ']
    if (n.type === "member_expression") {
      const obj = n.childForFieldName("object")?.text;
      const prop = n.childForFieldName("property")?.text;

      if (obj === "process.env" && prop) {
        const cleanProp = prop.replace(/^["']|["']$/g, "");
        refs.push({
          name: cleanProp,
          line: n.startPosition.row + 1,
          column: n.startPosition.column,
          snippet: lines[n.startPosition.row]?.trim() || n.text,
        });
      }
    }

    // 2. Python / PHP / generic function call: os.getenv("XYZ"), getenv("XYZ"), env("XYZ")
    if (n.type === "call_expression" || n.type === "call") {
      const fn = n.childForFieldName("function")?.text;
      if (fn === "os.getenv" || fn === "getenv" || fn === "env" || fn === "os.environ.get") {
        const args = n.childForFieldName("arguments") || n.namedChild(1);
        const firstArg = args?.namedChild(0)?.text;
        if (firstArg) {
          const varName = firstArg.replace(/^["']|["']$/g, "");
          refs.push({
            name: varName,
            line: n.startPosition.row + 1,
            column: n.startPosition.column,
            snippet: lines[n.startPosition.row]?.trim() || n.text,
          });
        }
      }
    }

    // 3. Python subscription: os.environ["XYZ"] or PHP: $_ENV["XYZ"]
    if (n.type === "subscript" || n.type === "subscript_expression") {
      const obj = (n.childForFieldName("value") || n.namedChild(0))?.text;
      const idx = (n.childForFieldName("subscript") || n.namedChild(1))?.text;
      if ((obj === "os.environ" || obj === "$_ENV" || obj === "$_SERVER") && idx) {
        const varName = idx.replace(/^["']|["']$/g, "");
        refs.push({
          name: varName,
          line: n.startPosition.row + 1,
          column: n.startPosition.column,
          snippet: lines[n.startPosition.row]?.trim() || n.text,
        });
      }
    }

    for (let i = 0; i < n.namedChildCount; i++) {
      const child = n.namedChild(i);
      if (child) walk(child);
    }
  }

  walk(rootNode);
  return refs;
}

/**
 * Verifies environment variable contract drift
 */
export async function verifyEnvContractDrift(params: EnvContractOptions): Promise<ReadResult> {
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

    const references = extractEnvReferences(tree.rootNode, lines);
    const referencedNames = new Set(references.map(r => r.name));

    // Resolve .env.example
    let exampleVars = new Set<string>();
    let envExamplePath: string | undefined = undefined;

    if (params.envExampleContent !== undefined) {
      exampleVars = parseEnvExample(params.envExampleContent);
    } else if (params.projectRoot) {
      const candidatePaths = [
        path.join(params.projectRoot, ".env.example"),
        path.join(params.projectRoot, ".env.template"),
        path.join(params.projectRoot, ".env"),
      ];
      for (const p of candidatePaths) {
        if (existsSync(p)) {
          envExamplePath = p;
          const exampleStr = await fs.readFile(p, "utf-8");
          exampleVars = parseEnvExample(exampleStr);
          break;
        }
      }
    }

    const undocumented: string[] = [];
    for (const refName of referencedNames) {
      if (!exampleVars.has(refName)) {
        undocumented.push(refName);
      }
    }

    const zombie: string[] = [];
    for (const exName of exampleVars) {
      if (!referencedNames.has(exName)) {
        zombie.push(exName);
      }
    }

    const totalReferenced = referencedNames.size;
    const documentedCount = totalReferenced - undocumented.length;
    const coveragePercent = totalReferenced > 0 ? Math.round((documentedCount / totalReferenced) * 100) : 100;

    const report: EnvContractReport = {
      filePath: params.filePath,
      envExamplePath,
      totalReferencedInCode: totalReferenced,
      totalInExample: exampleVars.size,
      undocumentedInCode: undocumented,
      zombieInExample: zombie,
      coveragePercent,
      references,
      summary: `Analyzed ${totalReferenced} env references in code vs ${exampleVars.size} in .env.example. Coverage: ${coveragePercent}%. Undocumented in example: ${undocumented.length}.`,
    };

    return {
      success: true,
      content: JSON.stringify(report, null, 2),
    };
  } catch (error) {
    return {
      success: false,
      error: `verify_env_contract_drift failed: ${error instanceof Error ? error.message : String(error)}`,
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
