import * as fs from "node:fs/promises";
import * as path from "node:path";
import { walkDir } from "../utils/fileWalker.js";
import { SUPPORTED_EXTENSIONS, EXCLUDE_DIRS } from "../utils/constants.js";
import type { BaseParser } from "../parsers/base.js";
import type { Tree } from "web-tree-sitter";

export interface CallHierarchyNode {
  name: string;
  file: string;
  hop: number;
  direction: "caller" | "callee" | "root";
  parent?: string;
}

export interface CallHierarchyResult {
  root: {
    symbol: string;
    file: string;
  };
  nodes: CallHierarchyNode[];
  mermaid: string;
  totalNodes: number;
  maxHopsReached: number;
}

export async function getCallHierarchy(params: {
  filePath: string;
  symbolName: string;
  direction?: "callers" | "callees" | "both";
  maxHops?: number;
  projectRoot: string;
  parser?: BaseParser;
  tree?: Tree;
}): Promise<CallHierarchyResult> {
  const direction = params.direction || "both";
  const maxHops = Math.min(Math.max(1, params.maxHops || 3), 5);
  const relRootFile = path.relative(params.projectRoot, params.filePath).replace(/\\/g, "/");

  const nodes: CallHierarchyNode[] = [
    {
      name: params.symbolName,
      file: relRootFile,
      hop: 0,
      direction: "root",
    },
  ];

  const mermaidEdges: string[] = [];
  const visitedSymbols = new Set<string>([`${relRootFile}:${params.symbolName}`]);

  // 1. CALLEES (What does this symbol call?)
  if (direction === "callees" || direction === "both") {
    let currentHopSymbols = [{ name: params.symbolName, file: params.filePath, relFile: relRootFile }];

    for (let hop = 1; hop <= maxHops; hop++) {
      const nextHopSymbols: typeof currentHopSymbols = [];

      for (const cur of currentHopSymbols) {
        try {
          const content = await fs.readFile(cur.file, "utf-8");
          // Locate symbol and extract its body using brace matching
          let body = content;
          const symIdx = content.indexOf(cur.name);
          if (symIdx !== -1) {
            const braceIdx = content.indexOf("{", symIdx);
            if (braceIdx !== -1 && braceIdx - symIdx < 200) {
              let depth = 1;
              let i = braceIdx + 1;
              while (i < content.length && depth > 0) {
                if (content[i] === "{") depth++;
                else if (content[i] === "}") depth--;
                i++;
              }
              body = content.substring(braceIdx + 1, i - 1);
            }
          }

          // Find calls: foo( or obj.foo(
          const callRegex = /(?:([a-zA-Z0-9_]+)\.)?([a-zA-Z0-9_]{3,})\s*\(/g;
          let callMatch: RegExpExecArray | null;
          const discoveredInHop = new Set<string>();

          while ((callMatch = callRegex.exec(body)) !== null) {
            const calleeName = callMatch[2];
            if (["if", "for", "while", "switch", "catch", "import", "require", "console", "return", "throw", "typeof"].includes(calleeName)) {
              continue;
            }

            const key = `${cur.relFile}:${calleeName}`;
            if (!visitedSymbols.has(key) && !discoveredInHop.has(calleeName)) {
              discoveredInHop.add(calleeName);
              visitedSymbols.add(key);

              nodes.push({
                name: calleeName,
                file: cur.relFile,
                hop,
                direction: "callee",
                parent: cur.name,
              });

              mermaidEdges.push(`  "${cur.name}" --> "${calleeName}"`);

              if (hop < maxHops) {
                nextHopSymbols.push({ name: calleeName, file: cur.file, relFile: cur.relFile });
              }
            }
          }
        } catch {
          // ignore read failure
        }
      }

      currentHopSymbols = nextHopSymbols;
      if (currentHopSymbols.length === 0) break;
    }
  }

  // 2. CALLERS (Who calls this symbol?)
  if (direction === "callers" || direction === "both") {
    let currentTargets = [{ name: params.symbolName, relFile: relRootFile }];

    for (let hop = 1; hop <= maxHops; hop++) {
      const nextTargets: typeof currentTargets = [];

      for (const target of currentTargets) {
        await walkDir(params.projectRoot, {
          extensions: SUPPORTED_EXTENSIONS,
          excludeDirs: EXCLUDE_DIRS,
          onFile: async (callerPath: string) => {
            try {
              const content = await fs.readFile(callerPath, "utf-8");
              if (!content.includes(target.name)) return;

              const relCaller = path.relative(params.projectRoot, callerPath).replace(/\\/g, "/");
              if (relCaller === target.relFile && hop === 1 && !content.includes(`this.${target.name}`)) {
                // Skip self-reference declaration in target file unless explicitly invoking this.target
              }

              // Locate enclosing function/method that calls target.name
              const lines = content.split("\n");
              let currentEnclosingFunction = path.basename(callerPath, path.extname(callerPath));

              for (const line of lines) {
                const funcDefMatch = line.match(/(?:function|def|async|class)\s+([a-zA-Z0-9_]+)|([a-zA-Z0-9_]+)\s*\([^)]*\)\s*\{/);
                if (funcDefMatch) {
                  currentEnclosingFunction = funcDefMatch[1] || funcDefMatch[2];
                }

                if (line.includes(target.name) && currentEnclosingFunction !== target.name) {
                  const key = `${relCaller}:${currentEnclosingFunction}`;
                  if (!visitedSymbols.has(key)) {
                    visitedSymbols.add(key);

                    nodes.push({
                      name: currentEnclosingFunction,
                      file: relCaller,
                      hop,
                      direction: "caller",
                      parent: target.name,
                    });

                    mermaidEdges.push(`  "${currentEnclosingFunction}" --> "${target.name}"`);

                    if (hop < maxHops) {
                      nextTargets.push({ name: currentEnclosingFunction, relFile: relCaller });
                    }
                  }
                  break;
                }
              }
            } catch {
              // ignore
            }
          },
        });
      }

      currentTargets = nextTargets;
      if (currentTargets.length === 0) break;
    }
  }

  // Generate Mermaid diagram
  const mermaidGraph = [
    "graph TD",
    ...Array.from(new Set(mermaidEdges)),
  ].join("\n");

  return {
    root: {
      symbol: params.symbolName,
      file: relRootFile,
    },
    nodes,
    mermaid: mermaidGraph,
    totalNodes: nodes.length,
    maxHopsReached: Math.max(...nodes.map(n => n.hop)),
  };
}
