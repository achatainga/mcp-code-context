/**
 * Impact analysis operation
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { EXCLUDE_DIRS, SUPPORTED_EXTENSIONS } from "../utils/constants.js";
import { walkDir } from "../utils/fileWalker.js";
import { IndexManager } from "../core/indexManager.js";
import type { ReadResult } from "./readCore.js";

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
    const targetFile = path.basename(params.filePath);

    await walkDir(params.rootDir, {
      extensions: SUPPORTED_EXTENSIONS,
      excludeDirs: EXCLUDE_DIRS,
      onFile: async (fullPath) => {
        const content = await fs.readFile(fullPath, "utf-8");

        const importPatterns = [
          new RegExp(`import.*from.*['"].*${targetFile.replace(/\.[^.]+$/, "")}`, "g"),
          new RegExp(`require\\(['"].*${targetFile}`, "g"),
          new RegExp(`from.*${targetFile.replace(/\.[^.]+$/, "")}.*import`, "g"),
        ];

        if (importPatterns.some(pattern => pattern.test(content))) {
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
