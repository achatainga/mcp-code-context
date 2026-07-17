/**
 * Rails Routes Parser - v3.9.1
 * Parses config/routes.rb to map HTTP routes to controller actions.
 * Uses indentation-based namespace tracking (immune to do/end counting errors).
 * Supports: resources, resource, explicit HTTP verbs, namespace/scope, root.
 * v1 limitations: only:/except:/shallow:/nested resources — emits warnings, no false routes.
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
const RESOURCES_ACTIONS: Array<{ method: string; path: string; action: string }> = [
  { method: "GET",    path: "",          action: "index"   },
  { method: "GET",    path: "/new",      action: "new"     },
  { method: "POST",   path: "",          action: "create"  },
  { method: "GET",    path: "/:id",      action: "show"    },
  { method: "GET",    path: "/:id/edit", action: "edit"    },
  { method: "PATCH",  path: "/:id",      action: "update"  },
  { method: "DELETE", path: "/:id",      action: "destroy" },
];

/** Standard 6 singular REST actions for `resource` */
const RESOURCE_ACTIONS: Array<{ method: string; path: string; action: string }> = [
  { method: "GET",    path: "/new",  action: "new"     },
  { method: "POST",   path: "",      action: "create"  },
  { method: "GET",    path: "",      action: "show"    },
  { method: "GET",    path: "/edit", action: "edit"    },
  { method: "PATCH",  path: "",      action: "update"  },
  { method: "DELETE", path: "",      action: "destroy" },
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

  // Indentation-based namespace stack: each entry = { indent, prefix, nsPrefix }
  // indent: the column indent of the `namespace` line itself
  // prefix: url segment (e.g. "admin")
  // nsPrefix: controller namespace (e.g. "admin")
  interface NsEntry { indent: number; prefix: string; nsPrefix: string }
  const nsStack: NsEntry[] = [];

  // Helper: get current url prefix and controller namespace from stack
  const getPrefix = () => nsStack.length > 0 ? "/" + nsStack.map(e => e.prefix).join("/") : "";
  const getNsPrefix = () => nsStack.length > 0 ? nsStack.map(e => e.nsPrefix).join("/") + "/" : "";

  // Helper: measure leading spaces
  const indentOf = (raw: string) => raw.match(/^(\s*)/)?.[1].length ?? 0;

  const lines = content.split("\n");

  for (const rawLine of lines) {
    const indent = indentOf(rawLine);
    const line = rawLine.trim();

    // Skip blank lines and comments
    if (line === "" || line.startsWith("#")) continue;

    // Pop namespace stack entries whose indent is >= current indent
    // (meaning we've dedented past them — their `end` was processed)
    while (nsStack.length > 0 && indent <= nsStack[nsStack.length - 1].indent) {
      nsStack.pop();
    }

    // namespace :admin do  /  namespace 'admin' do  /  scope :admin do
    // Handles both symbol (:admin) and string ('admin'/"admin") syntax
    const nsSymbolMatch = line.match(/^(?:namespace|scope)\s+:(\w+)/);
    const nsStringMatch = line.match(/^(?:namespace|scope)\s+['"]([^'"]+)['"]/);
    const nsMatch = nsSymbolMatch ?? nsStringMatch;
    if (nsMatch) {
      const seg = nsMatch[1];
      // scope doesn't add controller namespace, namespace does
      const isNamespace = line.startsWith("namespace");
      nsStack.push({ indent, prefix: seg, nsPrefix: isNamespace ? seg : "" });
      continue;
    }

    const urlPrefix = getPrefix();
    const ctrlPrefix = getNsPrefix();

    // Detect option flags
    const hasOnlyExcept = /\bonly:\s*\[/.test(line) || /\bexcept:\s*\[/.test(line);
    const hasShallow = /\bshallow:\s*true\b/.test(line);
    // Nested resources: line ends with `do` (opens a block we won't parse deeply)
    const hasNestedDo = /\bdo\s*$/.test(line) && (line.startsWith("resources") || line.startsWith("resource"));

    // resources :name  /  resources :name, only: [...]  /  resources :name do
    const resourcesMatch = line.match(/^resources\s+:(\w+)/);
    if (resourcesMatch) {
      const name = resourcesMatch[1];
      const controller = `${ctrlPrefix}${name}`;
      const basePath = `${urlPrefix}/${name}`;

      if (hasOnlyExcept) warnings.push(`resources :${name} uses only:/except: — route list may be incomplete. Full support planned for v2.`);
      if (hasShallow)    warnings.push(`resources :${name} uses shallow: — nested shallow routes not fully parsed.`);
      if (hasNestedDo)   warnings.push(`resources :${name} has nested resources (do block) — only top-level routes parsed.`);

      for (const a of RESOURCES_ACTIONS) {
        routes.push({ method: a.method, path: basePath + a.path, controller, action: a.action });
      }
      continue;
    }

    // resource :name (singular)
    const resourceMatch = line.match(/^resource\s+:(\w+)/);
    if (resourceMatch) {
      const name = resourceMatch[1];
      const controller = `${ctrlPrefix}${name}s`; // pluralize for controller
      const basePath = `${urlPrefix}/${name}`;

      if (hasOnlyExcept) warnings.push(`resource :${name} uses only:/except: — route list may be incomplete.`);

      for (const a of RESOURCE_ACTIONS) {
        routes.push({ method: a.method, path: basePath + a.path, controller, action: a.action });
      }
      continue;
    }

    // Explicit HTTP verb: get '/path', to: 'controller#action'
    const verbMatch = line.match(/^(get|post|patch|put|delete|head|options)\s+['"]([^'"]+)['"]\s*,\s*to:\s*['"]([^#'"]+)#([^'"]+)['"]/i);
    if (verbMatch) {
      routes.push({
        method: verbMatch[1].toUpperCase(),
        path: urlPrefix + verbMatch[2],
        controller: verbMatch[3].trim(),
        action: verbMatch[4].trim(),
      });
      continue;
    }

    // root to: 'controller#action'  /  root 'controller#action'
    const rootMatch = line.match(/^root\s+(?:to:\s*)?['"]([^#'"]+)#([^'"]+)['"]/);
    if (rootMatch) {
      routes.push({
        method: "GET",
        path: urlPrefix + "/",
        controller: rootMatch[1].trim(),
        action: rootMatch[2].trim(),
      });
      continue;
    }
  }

  return { routes, warnings };
}
