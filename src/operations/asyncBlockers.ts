/**
 * Async Event-Loop Blocker Detector
 * v7.0.1 Enterprise AST Intelligence
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { existsSync } from "node:fs";
import type { Tree, Node } from "web-tree-sitter";
import { ParserRegistry } from "../parsers/registry.js";
import { CodeContextEngine } from "../core/engine.js";
import type { ReadResult } from "./readCore.js";

export interface BlockingCallIncident {
  enclosingAsyncFunction: string;
  blockingApi: string;
  line: number;
  column: number;
  snippet: string;
  severity: "CRITICAL" | "HIGH";
  suggestedAlternative: string;
}

export interface AsyncBlockersReport {
  filePath?: string;
  asyncFunctionsScanned: number;
  blockingCallsFound: number;
  incidents: BlockingCallIncident[];
  summary: string;
}

export interface AsyncBlockersOptions {
  filePath?: string;
  code?: string;
  content?: string;
  projectRoot?: string;
  registry?: ParserRegistry;
}

/** Known blocking APIs that stall the event loop in Node.js / Python */
const BLOCKING_APIS: Record<string, { severity: "CRITICAL" | "HIGH"; alternative: string }> = {
  // Python blocking calls
  "time.sleep": { severity: "CRITICAL", alternative: "Use 'await asyncio.sleep()' instead." },
  "requests.get": { severity: "CRITICAL", alternative: "Use 'await httpx.AsyncClient().get()' or 'aiohttp' instead." },
  "requests.post": { severity: "CRITICAL", alternative: "Use 'await httpx.AsyncClient().post()' or 'aiohttp' instead." },
  "subprocess.run": { severity: "HIGH", alternative: "Use 'await asyncio.create_subprocess_exec()' instead." },
  "subprocess.call": { severity: "HIGH", alternative: "Use 'await asyncio.create_subprocess_exec()' instead." },
  "subprocess.check_output": { severity: "HIGH", alternative: "Use 'await asyncio.create_subprocess_exec()' instead." },

  // Node.js / TS blocking calls
  "fs.readFileSync": { severity: "CRITICAL", alternative: "Use 'await fs.readFile()' (from 'node:fs/promises') instead." },
  "fs.writeFileSync": { severity: "CRITICAL", alternative: "Use 'await fs.writeFile()' (from 'node:fs/promises') instead." },
  "fs.existsSync": { severity: "HIGH", alternative: "Use 'try { await fs.access(); } catch {}' or non-blocking check." },
  "execSync": { severity: "CRITICAL", alternative: "Use 'util.promisify(exec)' or async spawn instead." },
  "child_process.execSync": { severity: "CRITICAL", alternative: "Use async 'exec' or 'spawn' with await instead." },
};

/**
 * Traverses an async function's AST subtree to locate calls to blocking APIs
 */
function findBlockingCalls(asyncFnNode: Node, fnName: string, lines: string[]): BlockingCallIncident[] {
  const incidents: BlockingCallIncident[] = [];

  function walk(n: Node) {
    if (n.type === "call_expression" || n.type === "call") {
      const fnExpr = n.childForFieldName("function");
      const callText = fnExpr?.text || "";

      for (const [api, meta] of Object.entries(BLOCKING_APIS)) {
        if (callText === api || callText.endsWith("." + api) || (api.includes(".") && callText.includes(api.split(".")[1]))) {
          if (callText === api || callText.endsWith(api)) {
            incidents.push({
              enclosingAsyncFunction: fnName,
              blockingApi: callText,
              line: n.startPosition.row + 1,
              column: n.startPosition.column,
              snippet: lines[n.startPosition.row]?.trim() || callText,
              severity: meta.severity,
              suggestedAlternative: meta.alternative,
            });
          }
        }
      }
    }

    // Do not recurse into nested async functions (they will be analyzed on their own)
    for (let i = 0; i < n.namedChildCount; i++) {
      const child = n.namedChild(i);
      if (child) {
        const isNestedAsync =
          child.text.startsWith("async ") ||
          (child.type === "arrow_function" && child.text.startsWith("async")) ||
          (child.type === "function_definition" && child.text.startsWith("async "));
        if (!isNestedAsync) {
          walk(child);
        }
      }
    }
  }

  walk(asyncFnNode);
  return incidents;
}

/**
 * Detects blocking synchronous calls inside async function scopes
 */
export async function detectAsyncEventloopBlockers(params: AsyncBlockersOptions): Promise<ReadResult> {
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

    const asyncFunctions: Array<{ node: Node; name: string }> = [];

    function locateAsyncFunctions(n: Node) {
      // TypeScript / JavaScript
      if (
        n.type === "function_declaration" ||
        n.type === "method_definition" ||
        n.type === "arrow_function"
      ) {
        if (n.text.startsWith("async ") || n.text.startsWith("async(") || (n.parent?.type === "variable_declarator" && n.parent.text.includes("async "))) {
          const name = n.childForFieldName("name")?.text ||
            (n.parent?.type === "variable_declarator" ? n.parent.childForFieldName("name")?.text : undefined) ||
            "anonymous_async";
          asyncFunctions.push({ node: n, name });
        }
      }
      // Python: async def foo(): ...
      else if (n.type === "function_definition" && n.text.startsWith("async def")) {
        const name = n.childForFieldName("name")?.text || "anonymous_async";
        asyncFunctions.push({ node: n, name });
      }

      for (let i = 0; i < n.namedChildCount; i++) {
        const child = n.namedChild(i);
        if (child) locateAsyncFunctions(child);
      }
    }

    locateAsyncFunctions(tree.rootNode);

    const incidents: BlockingCallIncident[] = [];
    for (const fn of asyncFunctions) {
      const found = findBlockingCalls(fn.node, fn.name, lines);
      incidents.push(...found);
    }

    const report: AsyncBlockersReport = {
      filePath: params.filePath,
      asyncFunctionsScanned: asyncFunctions.length,
      blockingCallsFound: incidents.length,
      incidents,
      summary: `Scanned ${asyncFunctions.length} async functions. Found ${incidents.length} event-loop blocking call incidents.`,
    };

    return {
      success: true,
      content: JSON.stringify(report, null, 2),
    };
  } catch (error) {
    return {
      success: false,
      error: `detect_async_eventloop_blockers failed: ${error instanceof Error ? error.message : String(error)}`,
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
