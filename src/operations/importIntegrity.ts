/**
 * Import Integrity Verifier Operation
 * 
 * Verifies that all external packages, relative modules, and imported symbols
 * exist physically in the codebase or environment.
 * Prevents build-breaking import hallucinations and phantom dependencies.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { existsSync } from "node:fs";
import { ParserRegistry } from "../parsers/registry.js";
import { CodeContextEngine } from "../core/engine.js";
import type { ReadResult } from "./readCore.js";

export interface ImportIssue {
  importSource: string;
  symbolName?: string;
  line?: number;
  type: "UNRESOLVED_PACKAGE" | "UNRESOLVED_PATH" | "MISSING_EXPORT";
  message: string;
  suggestion?: string;
}

export interface ResolvedImport {
  importSource: string;
  type: "builtin" | "external_package" | "local_file";
  resolvedPath?: string;
  symbols: string[];
}

export interface ImportIntegrityReport {
  filePath: string;
  valid: boolean;
  totalImportsChecked: number;
  issueCount: number;
  issues: ImportIssue[];
  resolvedImports: ResolvedImport[];
}

const NODE_BUILTINS = new Set([
  "assert", "async_hooks", "buffer", "child_process", "cluster", "console",
  "constants", "crypto", "dgram", "diagnostics_channel", "dns", "domain",
  "events", "fs", "fs/promises", "http", "http2", "https", "inspector",
  "module", "net", "os", "path", "path/posix", "path/win32", "perf_hooks",
  "process", "punycode", "querystring", "readline", "repl", "stream",
  "stream/promises", "stream/consumers", "stream/web", "string_decoder",
  "test", "timers", "timers/promises", "tls", "trace_events", "tty", "url",
  "util", "util/types", "v8", "vm", "wasi", "worker_threads", "zlib"
]);

const PYTHON_BUILTINS = new Set([
  "os", "sys", "time", "datetime", "json", "re", "math", "random", "logging",
  "typing", "collections", "itertools", "functools", "pathlib", "subprocess",
  "threading", "asyncio", "urllib", "http", "dataclasses", "enum", "abc", "io",
  "hashlib", "copy", "shutil", "tempfile", "glob", "pickle", "csv", "sqlite3",
  "unittest", "pytest", "argparse", "inspect", "contextlib", "uuid", "base64"
]);

export interface RawImport {
  source: string;
  symbols: string[];
  isDefault: boolean;
  isNamespace: boolean;
  line: number;
}

/**
 * Parses raw import declarations from file content using regex and AST conventions
 */
export function extractImportStatements(content: string, ext: string): RawImport[] {
  const imports: RawImport[] = [];
  const lines = content.split("\n");

  if (ext === ".ts" || ext === ".tsx" || ext === ".js" || ext === ".jsx" || ext === ".mjs" || ext === ".cjs") {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line || line.startsWith("//") || line.startsWith("/*")) continue;

      // 1. import { a, b as c } from 'source'
      const namedMatch = line.match(/^import\s+(?:type\s+)?\{([^}]+)\}\s+from\s+['"]([^'"]+)['"]/);
      if (namedMatch) {
        const rawSymbols = namedMatch[1].split(",").map(s => {
          const parts = s.trim().split(/\s+as\s+/);
          return parts[0].trim().replace(/^type\s+/, "");
        }).filter(Boolean);

        imports.push({
          source: namedMatch[2].trim(),
          symbols: rawSymbols,
          isDefault: false,
          isNamespace: false,
          line: i + 1,
        });
        continue;
      }

      // 2. import * as foo from 'source'
      const nsMatch = line.match(/^import\s+\*\s+as\s+([a-zA-Z0-9_$]+)\s+from\s+['"]([^'"]+)['"]/);
      if (nsMatch) {
        imports.push({
          source: nsMatch[2].trim(),
          symbols: [nsMatch[1].trim()],
          isDefault: false,
          isNamespace: true,
          line: i + 1,
        });
        continue;
      }

      // 3. import defaultExport from 'source'
      const defaultMatch = line.match(/^import\s+([a-zA-Z0-9_$]+)\s+from\s+['"]([^'"]+)['"]/);
      if (defaultMatch) {
        imports.push({
          source: defaultMatch[2].trim(),
          symbols: [defaultMatch[1].trim()],
          isDefault: true,
          isNamespace: false,
          line: i + 1,
        });
        continue;
      }

      // 4. import 'source' (side-effect import)
      const sideMatch = line.match(/^import\s+['"]([^'"]+)['"]/);
      if (sideMatch) {
        imports.push({
          source: sideMatch[1].trim(),
          symbols: [],
          isDefault: false,
          isNamespace: false,
          line: i + 1,
        });
        continue;
      }

      // 5. const { a, b } = require('source')
      const reqNamed = line.match(/(?:const|let|var)\s+\{([^}]+)\}\s*=\s*require\s*\(\s*['"]([^'"]+)['"]\s*\)/);
      if (reqNamed) {
        const rawSymbols = reqNamed[1].split(",").map(s => s.trim().split(":")[0].trim()).filter(Boolean);
        imports.push({
          source: reqNamed[2].trim(),
          symbols: rawSymbols,
          isDefault: false,
          isNamespace: false,
          line: i + 1,
        });
        continue;
      }

      // 6. const foo = require('source')
      const reqDefault = line.match(/(?:const|let|var)\s+([a-zA-Z0-9_$]+)\s*=\s*require\s*\(\s*['"]([^'"]+)['"]\s*\)/);
      if (reqDefault) {
        imports.push({
          source: reqDefault[2].trim(),
          symbols: [reqDefault[1].trim()],
          isDefault: true,
          isNamespace: false,
          line: i + 1,
        });
        continue;
      }
    }
  } else if (ext === ".py") {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line || line.startsWith("#")) continue;

      // from module import a, b
      const pyFrom = line.match(/^from\s+([a-zA-Z0-9_.]+)\s+import\s+(.+)/);
      if (pyFrom) {
        const rawSymbols = pyFrom[2].split(",").map(s => s.trim().split(/\s+as\s+/)[0].trim()).filter(Boolean);
        imports.push({
          source: pyFrom[1].trim(),
          symbols: rawSymbols,
          isDefault: false,
          isNamespace: false,
          line: i + 1,
        });
        continue;
      }

      // import module
      const pyImp = line.match(/^import\s+([a-zA-Z0-9_.]+)/);
      if (pyImp) {
        imports.push({
          source: pyImp[1].trim(),
          symbols: [],
          isDefault: true,
          isNamespace: false,
          line: i + 1,
        });
        continue;
      }
    }
  }

  return imports;
}

/**
 * Loads declared packages from package.json in project root
 */
async function loadManifestDependencies(projectRoot: string): Promise<Set<string>> {
  const declared = new Set<string>();
  const pkgPath = path.join(projectRoot, "package.json");
  if (!existsSync(pkgPath)) return declared;

  try {
    const raw = await fs.readFile(pkgPath, "utf-8");
    const json = JSON.parse(raw);
    const sections = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"];
    for (const sec of sections) {
      if (json[sec] && typeof json[sec] === "object") {
        for (const pkg of Object.keys(json[sec])) {
          declared.add(pkg);
        }
      }
    }
  } catch {
    // Ignore json parse failures
  }
  return declared;
}

/**
 * Resolves local relative import path against filesystem candidates
 */
function resolveLocalPath(fileDir: string, importSource: string, projectRoot: string): string | null {
  let targetBase: string;

  if (importSource.startsWith("@/") || importSource.startsWith("~/")) {
    targetBase = path.join(projectRoot, importSource.slice(2));
  } else {
    targetBase = path.resolve(fileDir, importSource);
  }

  // Strip .js / .jsx if present for TS NodeNext ESM resolution
  const noExt = targetBase.replace(/\.(js|jsx|mjs|cjs)$/, "");

  // Candidate extensions
  const candidates = [
    targetBase,
    `${noExt}.ts`,
    `${noExt}.tsx`,
    `${noExt}.d.ts`,
    `${targetBase}.ts`,
    `${targetBase}.tsx`,
    `${targetBase}.d.ts`,
    `${targetBase}.js`,
    `${targetBase}.jsx`,
    `${targetBase}.mjs`,
    `${targetBase}.cjs`,
    `${targetBase}.py`,
    path.join(targetBase, "index.ts"),
    path.join(targetBase, "index.tsx"),
    path.join(targetBase, "index.js"),
    path.join(targetBase, "index.jsx"),
    path.join(targetBase, "__init__.py"),
    path.join(noExt, "index.ts"),
    path.join(noExt, "index.tsx"),
  ];

  for (const cand of candidates) {
    if (existsSync(cand)) {
      return cand;
    }
  }

  return null;
}

/**
 * Extract exported symbols from target module using AST
 */
async function getExportedSymbols(targetPath: string, registry: ParserRegistry): Promise<Set<string>> {
  const exported = new Set<string>();
  const ext = path.extname(targetPath);
  const parser = registry.getParser(ext);
  if (!parser) return exported;

  let content: string;
  try {
    content = await fs.readFile(targetPath, "utf-8");
  } catch {
    return exported;
  }

  let tree;
  try {
    tree = parser.parse(content);
    const symbols = parser.findSymbols(tree);
    for (const sym of symbols) {
      exported.add(sym.name);
    }

    // Secondary regex scan for TS/JS export keywords: export const foo, export function bar, export type/interface
    const exportRegex = /export\s+(?:default\s+)?(?:async\s+)?(?:function|class|const|let|var|type|interface|enum)\s+([a-zA-Z0-9_$]+)/g;
    let m: RegExpExecArray | null;
    while ((m = exportRegex.exec(content)) !== null) {
      if (m[1]) exported.add(m[1]);
    }

    // export { a, b }
    const exportBlockRegex = /export\s+\{([^}]+)\}/g;
    while ((m = exportBlockRegex.exec(content)) !== null) {
      if (m[1]) {
        const items = m[1].split(",").map(i => i.trim().split(/\s+as\s+/)[0].trim());
        for (const item of items) {
          if (item) exported.add(item);
        }
      }
    }
  } catch {
    // Parser fallback
  } finally {
    try {
      tree?.delete();
    } catch {
      // Safe deallocation of WASM linear memory
    }
  }

  return exported;
}

export async function verifyImportIntegrity(params: {
  filePath: string;
  projectRoot: string;
  content?: string;
  registry?: ParserRegistry;
}): Promise<ReadResult> {
  try {
    const ext = path.extname(params.filePath);
    let content = params.content;

    if (!content) {
      if (!existsSync(params.filePath)) {
        return {
          success: false,
          error: `File does not exist: ${params.filePath}`,
        };
      }
      content = await fs.readFile(params.filePath, "utf-8");
    }

    let registry = params.registry;
    if (!registry) {
      const engine = new CodeContextEngine();
      await engine.init();
      registry = new ParserRegistry(engine);
      await registry.init();
    }

    const declaredDeps = await loadManifestDependencies(params.projectRoot);
    const imports = extractImportStatements(content, ext);
    const fileDir = path.dirname(params.filePath);

    const issues: ImportIssue[] = [];
    const resolvedImports: ResolvedImport[] = [];

    for (const imp of imports) {
      const cleanSource = imp.source.startsWith("node:") ? imp.source.slice(5) : imp.source;

      // 1. Built-in language module check
      if (imp.source.startsWith("node:") || NODE_BUILTINS.has(cleanSource) || (ext === ".py" && PYTHON_BUILTINS.has(imp.source))) {
        resolvedImports.push({
          importSource: imp.source,
          type: "builtin",
          symbols: imp.symbols,
        });
        continue;
      }

      // 2. Relative or aliased local path check
      if (imp.source.startsWith(".") || imp.source.startsWith("/") || imp.source.startsWith("@/") || imp.source.startsWith("~/")) {
        const resolvedPath = resolveLocalPath(fileDir, imp.source, params.projectRoot);

        if (!resolvedPath) {
          issues.push({
            importSource: imp.source,
            line: imp.line,
            type: "UNRESOLVED_PATH",
            message: `Cannot resolve local module '${imp.source}' from '${path.relative(params.projectRoot, params.filePath)}'`,
            suggestion: `Verify that target file exists or check path typo. Looked for candidates in: ${fileDir}`,
          });
          continue;
        }

        // Check named exports if not default or namespace import
        if (!imp.isDefault && !imp.isNamespace && imp.symbols.length > 0) {
          const availableExports = await getExportedSymbols(resolvedPath, registry);

          for (const sym of imp.symbols) {
            if (!availableExports.has(sym)) {
              issues.push({
                importSource: imp.source,
                symbolName: sym,
                line: imp.line,
                type: "MISSING_EXPORT",
                message: `Symbol '${sym}' is not exported by module '${imp.source}'`,
                suggestion: `Available exports in '${path.basename(resolvedPath)}': [${Array.from(availableExports).slice(0, 10).join(", ")}]`,
              });
            }
          }
        }

        resolvedImports.push({
          importSource: imp.source,
          type: "local_file",
          resolvedPath: path.relative(params.projectRoot, resolvedPath).replace(/\\/g, "/"),
          symbols: imp.symbols,
        });
        continue;
      }

      // 3. External npm/pip package check
      const rootPkg = imp.source.startsWith("@")
        ? imp.source.split("/").slice(0, 2).join("/")
        : imp.source.split("/")[0];

      const existsInNodeModules = existsSync(path.join(params.projectRoot, "node_modules", rootPkg));
      const isDeclaredInManifest = declaredDeps.has(rootPkg);

      if (!isDeclaredInManifest && !existsInNodeModules) {
        issues.push({
          importSource: imp.source,
          line: imp.line,
          type: "UNRESOLVED_PACKAGE",
          message: `Package '${rootPkg}' is neither declared in package.json nor installed in node_modules`,
          suggestion: `Run 'npm install ${rootPkg}' or verify if this external package was hallucinated by the agent.`,
        });
      } else {
        resolvedImports.push({
          importSource: imp.source,
          type: "external_package",
          symbols: imp.symbols,
        });
      }
    }

    const report: ImportIntegrityReport = {
      filePath: path.relative(params.projectRoot, params.filePath).replace(/\\/g, "/"),
      valid: issues.length === 0,
      totalImportsChecked: imports.length,
      issueCount: issues.length,
      issues,
      resolvedImports,
    };

    const footer = issues.length === 0
      ? `\n\n✅ Import Integrity Verified: All ${imports.length} imports and symbols resolved cleanly.`
      : `\n\n⚠️ Import Integrity Violation: Found ${issues.length} unresolved imports or missing symbols.`;

    return {
      success: true,
      content: JSON.stringify(report, null, 2) + footer,
    };
  } catch (error: any) {
    return {
      success: false,
      error: `verify_import_integrity failed: ${error.message || String(error)}`,
    };
  }
}
