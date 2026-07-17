/**
 * Rails Routes Parser - v3.9.0
 * Parses config/routes.rb to map HTTP routes to controller actions.
 * v1: handles resources, resource, explicit get/post/patch/put/delete/root.
 * v1 limitation: only:/except:/shallow:/nested resources — emits warnings, does not generate false routes.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";

export interface RouteEntry {
  method: string;
  path: string;
  controller: string;
  action: string;
}

export interface RoutesResult {
  routes: RouteEntry[];
  warnings: string[];
}

// Cache: routesPath → { result, mtime }
const routesCache = new Map<string, { result: RoutesResult; mtime: number }>();

/** Standard 7 REST actions for `resources` */
const RESOURCES_ACTIONS: RouteEntry[] = [
  { method: "GET",    path: "",          action: "index",   controller: "" },
  { method: "GET",    path: "/new",      action: "new",     controller: "" },
  { method: "POST",   path: "",          action: "create",  controller: "" },
  { method: "GET",    path: "/:id",      action: "show",    controller: "" },
  { method: "GET",    path: "/:id/edit", action: "edit",    controller: "" },
  { method: "PATCH",  path: "/:id",      action: "update",  controller: "" },
  { method: "DELETE", path: "/:id",      action: "destroy", controller: "" },
];

/** Standard 6 singular REST actions for `resource` */
const RESOURCE_ACTIONS: RouteEntry[] = [
  { method: "GET",    path: "/new",  action: "new",     controller: "" },
  { method: "POST",   path: "",      action: "create",  controller: "" },
  { method: "GET",    path: "",      action: "show",    controller: "" },
  { method: "GET",    path: "/edit", action: "edit",    controller: "" },
  { method: "PATCH",  path: "",      action: "update",  controller: "" },
  { method: "DELETE", path: "",      action: "destroy", controller: "" },
];

export async function parseRailsRoutes(projectRoot: string): Promise<RoutesResult | null> {
  const routesPath = path.join(projectRoot, "config", "routes.rb");

  let mtime: number;
  try {
    mtime = (await fs.stat(routesPath)).mtimeMs;
  } catch {
    return null; // No routes.rb — not a Rails app
  }

  const cached = routesCache.get(routesPath);
  if (cached?.mtime === mtime) return cached.result;

  const content = await fs.readFile(routesPath, "utf-8");
  const result = parseRoutesContent(content);
  routesCache.set(routesPath, { result, mtime });
  return result;
}

export function parseRoutesContent(content: string): RoutesResult {
  const routes: RouteEntry[] = [];
  const warnings: string[] = [];

  // Stack for namespace/scope prefix accumulation
  const prefixStack: string[] = [];

  const lines = content.split("\n");

  for (const rawLine of lines) {
    const line = rawLine.trim();

    // Skip comments and blank lines
    if (line.startsWith("#") || line === "") continue;

    // Namespace/scope push
    const nsMatch = line.match(/^(?:namespace|scope)\s+[:'"]([^'"]+)['"]/);
    if (nsMatch) {
      prefixStack.push(nsMatch[1].replace(/^:/, ""));
      continue;
    }

    // Closing end — pop prefix stack
    if (line === "end" && prefixStack.length > 0) {
      prefixStack.pop();
      continue;
    }

    const prefix = prefixStack.length > 0 ? "/" + prefixStack.join("/") : "";

    // Detect unsupported options — warn instead of generating wrong output
    const hasOnlyExcept = /\bonly:\s*\[/.test(line) || /\bexcept:\s*\[/.test(line);
    const hasShallow = /\bshallow:\s*true\b/.test(line);
    const hasNested = line.includes("do") && (line.startsWith("resources") || line.startsWith("resource"));

    // resources :name
    const resourcesMatch = line.match(/^resources\s+:(\w+)/);
    if (resourcesMatch) {
      const name = resourcesMatch[1];
      const controller = nameToController(name, prefixStack);
      const basePath = `${prefix}/${name}`;

      if (hasOnlyExcept) {
        warnings.push(`resources :${name} uses only:/except: — route list may be incomplete. Full support planned for v2.`);
      }
      if (hasShallow) {
        warnings.push(`resources :${name} uses shallow: — nested shallow routes not fully parsed.`);
      }
      if (hasNested) {
        warnings.push(`resources :${name} has nested resources (do block) — only top-level routes parsed.`);
      }

      for (const action of RESOURCES_ACTIONS) {
        routes.push({
          method: action.method,
          path: basePath + action.path,
          controller,
          action: action.action,
        });
      }
      continue;
    }

    // resource :name (singular)
    const resourceMatch = line.match(/^resource\s+:(\w+)/);
    if (resourceMatch) {
      const name = resourceMatch[1];
      const controller = nameToController(name + "s", prefixStack); // pluralize for controller
      const basePath = `${prefix}/${name}`;

      if (hasOnlyExcept) {
        warnings.push(`resource :${name} uses only:/except: — route list may be incomplete.`);
      }

      for (const action of RESOURCE_ACTIONS) {
        routes.push({
          method: action.method,
          path: basePath + action.path,
          controller,
          action: action.action,
        });
      }
      continue;
    }

    // Explicit HTTP verb routes: get '/path', to: 'controller#action'
    const verbMatch = line.match(/^(get|post|patch|put|delete|head|options)\s+['"]([^'"]+)['"]\s*,\s*to:\s*['"]([^#'"]+)#([^'"]+)['"]/i);
    if (verbMatch) {
      routes.push({
        method: verbMatch[1].toUpperCase(),
        path: prefix + verbMatch[2],
        controller: verbMatch[3].trim(),
        action: verbMatch[4].trim(),
      });
      continue;
    }

    // root to: 'controller#action'
    const rootMatch = line.match(/^root\s+(?:to:\s*)?['"]([^#'"]+)#([^'"]+)['"]/);
    if (rootMatch) {
      routes.push({
        method: "GET",
        path: prefix + "/",
        controller: rootMatch[1].trim(),
        action: rootMatch[2].trim(),
      });
      continue;
    }
  }

  return { routes, warnings };
}

/** Convert resource name + namespace stack to controller name */
function nameToController(name: string, prefixStack: string[]): string {
  const ns = prefixStack.length > 0 ? prefixStack.join("/") + "/" : "";
  return `${ns}${name}`;
}
