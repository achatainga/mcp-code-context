/**
 * AST Circular Import Cycle Detector (Tarjan's SCC Algorithm)
 * v7.0.0 Enterprise AST Intelligence
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { existsSync } from "node:fs";
import type { Tree, Node } from "web-tree-sitter";
import { ParserRegistry } from "../parsers/registry.js";
import { CodeContextEngine } from "../core/engine.js";
import type { ReadResult } from "./readCore.js";

export interface DependencyCycle {
  cycleLength: number;
  cyclePath: string[];
  recommendation: string;
}

export interface CircularDependenciesReport {
  projectRoot: string;
  totalFilesAnalyzed: number;
  totalCyclesFound: number;
  cycles: DependencyCycle[];
  summary: string;
}

export interface CircularDependenciesOptions {
  filesMap?: Record<string, string>; // In-memory map of relativeFilePath -> fileContent
  filePaths?: string[];
  projectRoot?: string;
  registry?: ParserRegistry;
}

/**
 * Extracts imported relative module paths from AST
 */
function extractRelativeImports(rootNode: Node): string[] {
  const imports: string[] = [];

  function walk(n: Node) {
    // import ... from './x'
    if (n.type === "import_statement") {
      const srcNode = n.childForFieldName("source");
      if (srcNode) {
        const raw = srcNode.text.replace(/^["']|["']$/g, "");
        if (raw.startsWith(".")) imports.push(raw);
      }
    }

    // require('./x')
    if (n.type === "call_expression") {
      const fn = n.childForFieldName("function")?.text;
      if (fn === "require") {
        const arg = n.childForFieldName("arguments")?.namedChild(0)?.text;
        if (arg) {
          const raw = arg.replace(/^["']|["']$/g, "");
          if (raw.startsWith(".")) imports.push(raw);
        }
      }
    }

    for (let i = 0; i < n.namedChildCount; i++) {
      const child = n.namedChild(i);
      if (child) walk(child);
    }
  }

  walk(rootNode);
  return imports;
}

/**
 * Normalizes an imported path against its parent file
 */
function resolveImportPath(parentFile: string, importPath: string): string {
  const dir = path.dirname(parentFile);
  let resolved = path.join(dir, importPath).replace(/\\/g, "/");
  // Normalize extensions
  if (resolved.endsWith(".js")) resolved = resolved.slice(0, -3);
  if (resolved.endsWith(".ts")) resolved = resolved.slice(0, -3);
  return resolved;
}

/**
 * Tarjan's Strongly Connected Components algorithm for finding cycles
 */
function findCyclesTarjan(adjList: Map<string, string[]>): string[][] {
  let index = 0;
  const indices = new Map<string, number>();
  const lowlinks = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const sccs: string[][] = [];

  function strongConnect(u: string) {
    indices.set(u, index);
    lowlinks.set(u, index);
    index++;
    stack.push(u);
    onStack.add(u);

    const neighbors = adjList.get(u) || [];
    for (const v of neighbors) {
      if (!indices.has(v)) {
        strongConnect(v);
        lowlinks.set(u, Math.min(lowlinks.get(u)!, lowlinks.get(v)!));
      } else if (onStack.has(v)) {
        lowlinks.set(u, Math.min(lowlinks.get(u)!, indices.get(v)!));
      }
    }

    if (lowlinks.get(u) === indices.get(u)) {
      const scc: string[] = [];
      let w = "";
      do {
        w = stack.pop()!;
        onStack.delete(w);
        scc.push(w);
      } while (w !== u);

      // A component with > 1 node or a self-loop is a cycle
      if (scc.length > 1) {
        sccs.push(scc.reverse());
      } else if (scc.length === 1 && (adjList.get(scc[0]) || []).includes(scc[0])) {
        sccs.push([scc[0], scc[0]]);
      }
    }
  }

  for (const node of adjList.keys()) {
    if (!indices.has(node)) {
      strongConnect(node);
    }
  }

  return sccs;
}

/**
 * Detects circular import dependencies across codebase
 */
export async function detectCircularDependencies(params: CircularDependenciesOptions): Promise<ReadResult> {
  const projectRoot = params.projectRoot || ".";

  try {
    let registry = params.registry;
    if (!registry) {
      const engine = new CodeContextEngine();
      await engine.init();
      registry = new ParserRegistry(engine);
      await registry.init();
    }

    const parser = registry.getParser(".ts");
    if (!parser) {
      return {
        success: false,
        error: "No TypeScript parser available for dependency analysis",
      };
    }

    const filesToAnalyze = new Map<string, string>();

    if (params.filesMap) {
      for (const [f, c] of Object.entries(params.filesMap)) {
        let norm = f.replace(/\\/g, "/");
        if (norm.endsWith(".ts")) norm = norm.slice(0, -3);
        if (norm.endsWith(".js")) norm = norm.slice(0, -3);
        filesToAnalyze.set(norm, c);
      }
    } else if (params.filePaths) {
      for (const f of params.filePaths) {
        if (existsSync(f)) {
          const content = await fs.readFile(f, "utf-8");
          let norm = path.relative(projectRoot, f).replace(/\\/g, "/");
          if (norm.endsWith(".ts")) norm = norm.slice(0, -3);
          if (norm.endsWith(".js")) norm = norm.slice(0, -3);
          filesToAnalyze.set(norm, content);
        }
      }
    }

    const adjList = new Map<string, string[]>();

    for (const [fileKey, content] of filesToAnalyze.entries()) {
      let tree: Tree | null = null;
      try {
        tree = parser.parse(content);
        const rawImports = extractRelativeImports(tree.rootNode);
        const resolved = rawImports.map(imp => resolveImportPath(fileKey, imp));
        adjList.set(fileKey, resolved.filter(r => filesToAnalyze.has(r)));
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

    const sccs = findCyclesTarjan(adjList);
    const cycles: DependencyCycle[] = sccs.map(scc => {
      const cycleLoop = [...scc, scc[0]];
      return {
        cycleLength: scc.length,
        cyclePath: cycleLoop,
        recommendation: `Break circular dependency: Extract shared interfaces or types from '${scc[0]}' into a separate 'types.ts' module or inject dependency.`,
      };
    });

    const report: CircularDependenciesReport = {
      projectRoot,
      totalFilesAnalyzed: filesToAnalyze.size,
      totalCyclesFound: cycles.length,
      cycles,
      summary: `Analyzed ${filesToAnalyze.size} modules. Found ${cycles.length} circular dependency cycles.`,
    };

    return {
      success: true,
      content: JSON.stringify(report, null, 2),
    };
  } catch (error) {
    return {
      success: false,
      error: `detect_circular_dependencies failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
