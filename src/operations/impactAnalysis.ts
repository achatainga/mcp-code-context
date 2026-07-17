/**
 * Impact analysis operation
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { EXCLUDE_DIRS, SUPPORTED_EXTENSIONS } from "../utils/constants.js";
import { walkDir } from "../utils/fileWalker.js";
import { IndexManager } from "../core/indexManager.js";
import { safeRegexAnyTest } from "../utils/safeRegex.js";
import { sanitizeRegexPattern } from "../utils/regexValidator.js";
import type { ReadResult } from "./readCore.js";

/**
 * Check if a module name resolves to an actual file via Rails convention.
 * Prevents false positives for stdlib mixins like `include Comparable`.
 * Only adds include/extend to impact patterns when a matching file exists.
 */
async function rubyModuleResolvesToFile(moduleName: string, rootDir: string): Promise<boolean> {
  // First check if it's a known concern
  try {
    const { findRailsConcerns } = await import("../utils/railsSchema.js");
    const concernMap = await findRailsConcerns(rootDir);
    if (concernMap.has(moduleName)) {
      return true;
    }
  } catch {
    // fall through to file search
  }

  // Convert ModuleName → module_name (snake_case)
  const snakeName = moduleName
    .replace(/([A-Z])/g, (c, _, i) => i === 0 ? c.toLowerCase() : `_${c.toLowerCase()}`);
  const candidates = [
    path.join(rootDir, "app", "models", "concerns", `${snakeName}.rb`),
    path.join(rootDir, "app", "controllers", "concerns", `${snakeName}.rb`),
    path.join(rootDir, "lib", `${snakeName}.rb`),
    path.join(rootDir, "app", "models", `${snakeName}.rb`),
  ];
  for (const candidate of candidates) {
    try {
      await fs.access(candidate);
      return true;
    } catch {
      // not found — try next
    }
  }
  return false;
}

export async function analyzeImpact(params: {
  filePath: string;
  rootDir: string;
  projectRoot: string;
}): Promise<ReadResult> {
  try {
    // ── Fast path: use persistent index if available ──────────────────────
    const indexManager = new IndexManager(params.projectRoot);
    if (await indexManager.hasIndex()) {
      const dependents = await indexManager.getDependents(params.filePath);
      return {
        success: true,
        content: JSON.stringify(
          { file: params.filePath, dependents, source: "index" },
          null, 2
        ),
      };
    }

    // ── Slow path: regex scan (no index yet) ─────────────────────────────
    const dependents: string[] = [];
    const fileName = path.basename(params.filePath);
    const fileExt = path.extname(params.filePath);
    const baseName = sanitizeRegexPattern(fileName.replace(/\.[^.]+$/, ""));
    const fullName = sanitizeRegexPattern(fileName);

    // Base patterns (JS/TS/Python)
    const importPatterns = [
      `import.*from.*['"].*${baseName}`,
      `require\\(['"].*${fullName}`,
      `from.*${baseName}.*import`,
    ];

    // Ruby-specific patterns — only for .rb files
    if (fileExt === ".rb") {
      // require 'path' and require_relative '../path'
      importPatterns.push(`require\\s+['"].*${baseName}`);
      importPatterns.push(`require_relative\\s+['"].*${baseName}`);

      // include/extend ModuleName — only if the module name resolves to an actual file
      // (prevents false positives for stdlib: `include Comparable` matching comparable.rb)
      const moduleNameFromFile = baseName
        .split("_")
        .map(w => w.charAt(0).toUpperCase() + w.slice(1))
        .join("");
      const moduleResolvable = await rubyModuleResolvesToFile(moduleNameFromFile, params.rootDir);
      if (moduleResolvable) {
        importPatterns.push(`include\\s+${sanitizeRegexPattern(moduleNameFromFile)}`);
        importPatterns.push(`extend\\s+${sanitizeRegexPattern(moduleNameFromFile)}`);
        importPatterns.push(`prepend\\s+${sanitizeRegexPattern(moduleNameFromFile)}`);
      }
    }

    await walkDir(params.rootDir, {
      extensions: SUPPORTED_EXTENSIONS,
      excludeDirs: EXCLUDE_DIRS,
      onFile: async (fullPath) => {
        const content = await fs.readFile(fullPath, "utf-8");
        const matchResult = await safeRegexAnyTest(importPatterns, content);
        if (matchResult.timedOut) {
          throw new Error(matchResult.error ?? "Regex timed out during impact scan (ReDoS prevented)");
        }
        if (!matchResult.success) {
          throw new Error(matchResult.error ?? "Impact scan regex failed");
        }
        if (matchResult.matched) {
          dependents.push(fullPath);
        }
      },
    });

    return {
      success: true,
      content: JSON.stringify(
        { file: params.filePath, dependents, source: "regex scan — run get_semantic_repo_map to build index" },
        null, 2
      ),
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
