/**
 * Zero-Runtime REST / FastAPI / Express Route Extractor
 * v7.0.1 Enterprise AST Intelligence
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { existsSync } from "node:fs";
import type { Tree, Node } from "web-tree-sitter";
import { ParserRegistry } from "../parsers/registry.js";
import { CodeContextEngine } from "../core/engine.js";
import type { ReadResult } from "./readCore.js";

export interface ApiRouteItem {
  method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH" | "ALL" | "CUSTOM";
  path: string;
  handlerName: string;
  line: number;
  framework: "FastAPI" | "Express" | "NestJS" | "WP_REST" | "Generic";
  pathParams: string[];
}

export interface ApiRouteMatrixReport {
  filePath?: string;
  totalRoutesFound: number;
  routes: ApiRouteItem[];
  summary: string;
}

export interface ApiRouteMatrixOptions {
  filePath?: string;
  code?: string;
  content?: string;
  projectRoot?: string;
  registry?: ParserRegistry;
}

/**
 * Extracts route parameters like :id (Express) or {id} (FastAPI/OpenAPI)
 */
function extractPathParams(routePath: string): string[] {
  const params: string[] = [];
  // Express style :param
  const expressMatches = routePath.match(/:([a-zA-Z0-9_]+)/g);
  if (expressMatches) {
    for (const m of expressMatches) params.push(m.slice(1));
  }
  // OpenAPI / FastAPI style {param}
  const fastApiMatches = routePath.match(/{([a-zA-Z0-9_]+)}/g);
  if (fastApiMatches) {
    for (const m of fastApiMatches) params.push(m.slice(1, -1));
  }
  return params;
}

/**
 * Normalizes HTTP method string
 */
function normalizeMethod(raw: string): ApiRouteItem["method"] {
  const m = raw.toUpperCase();
  if (m === "GET") return "GET";
  if (m === "POST") return "POST";
  if (m === "PUT") return "PUT";
  if (m === "DELETE") return "DELETE";
  if (m === "PATCH") return "PATCH";
  if (m === "ALL" || m === "USE") return "ALL";
  return "CUSTOM";
}

/**
 * Extracts API routes from AST
 */
export async function extractApiRouteMatrix(params: ApiRouteMatrixOptions): Promise<ReadResult> {
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
    const routes: ApiRouteItem[] = [];

    function walkAST(n: Node) {
      // 1. Python FastAPI / Flask decorators: @app.get("/path"), @router.post("/path")
      if (n.type === "decorated_definition") {
        for (let i = 0; i < n.namedChildCount; i++) {
          const child = n.namedChild(i);
          if (child && child.type === "decorator") {
            const decText = child.text;
            const match = decText.match(/@(app|router|api|blueprint)\.(get|post|put|delete|patch)\((["'])(.*?)\3/i);
            if (match) {
              const method = normalizeMethod(match[2]);
              const routePath = match[4];
              const fnDef = n.childForFieldName("definition") || n.namedChild(n.namedChildCount - 1);
              const handlerName = fnDef?.childForFieldName("name")?.text || "anonymous_handler";

              routes.push({
                method,
                path: routePath,
                handlerName,
                line: child.startPosition.row + 1,
                framework: "FastAPI",
                pathParams: extractPathParams(routePath),
              });
            }
          }
        }
      }

      // 2. TypeScript / Express call_expression: app.get("/path", ...), router.post("/path", ...)
      if (n.type === "call_expression") {
        const fnExpr = n.childForFieldName("function");
        if (fnExpr && fnExpr.type === "member_expression") {
          const obj = fnExpr.childForFieldName("object")?.text || "";
          const prop = fnExpr.childForFieldName("property")?.text?.toLowerCase() || "";

          if (
            (obj === "app" || obj === "router" || obj.endsWith("Router") || obj.endsWith("App")) &&
            ["get", "post", "put", "delete", "patch", "all", "use"].includes(prop)
          ) {
            const args = n.childForFieldName("arguments");
            const firstArg = args?.namedChild(0);

            if (firstArg && (firstArg.type === "string" || firstArg.type === "string_literal" || firstArg.type === "template_string")) {
              const routePath = firstArg.text.replace(/^["'`]|["'`]$/g, "");
              const handlerNode = args?.namedChild(1);
              const handlerName = handlerNode?.text?.split("(")[0]?.trim() || "anonymous";

              routes.push({
                method: normalizeMethod(prop),
                path: routePath,
                handlerName,
                line: n.startPosition.row + 1,
                framework: "Express",
                pathParams: extractPathParams(routePath),
              });
            }
          }
        }
      }

      for (let i = 0; i < n.namedChildCount; i++) {
        const child = n.namedChild(i);
        if (child) walkAST(child);
      }
    }

    walkAST(tree.rootNode);

    const report: ApiRouteMatrixReport = {
      filePath: params.filePath,
      totalRoutesFound: routes.length,
      routes,
      summary: `Discovered ${routes.length} HTTP routes across AST without runtime execution.`,
    };

    return {
      success: true,
      content: JSON.stringify(report, null, 2),
    };
  } catch (error) {
    return {
      success: false,
      error: `extract_api_route_matrix failed: ${error instanceof Error ? error.message : String(error)}`,
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
