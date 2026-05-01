/**
 * File Walker Utility - v3.6.1
 * Centralized directory traversal with filtering
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";

export interface WalkOptions {
  /** Extensions to include (e.g., [".ts", ".js"]) */
  extensions?: readonly string[];
  /** Directories to exclude (e.g., ["node_modules", ".git"]) */
  excludeDirs?: readonly string[];
  /** Maximum files to collect (prevents OOM) */
  maxFiles?: number;
  /** Maximum total size in bytes (prevents OOM) */
  maxSize?: number;
  /** Callback for each file found */
  onFile?: (filePath: string) => Promise<void> | void;
}

/**
 * Recursively walks a directory tree with filtering options.
 * Supports extension filtering, directory exclusion, and size/count limits.
 * 
 * @param dir - Root directory to walk
 * @param options - Filtering and callback options
 * @param state - Internal state for tracking counts (do not pass manually)
 */
export async function walkDir(
  dir: string,
  options: WalkOptions = {},
  state: { fileCount: number; totalSize: number } = { fileCount: 0, totalSize: 0 }
): Promise<void> {
  // Check limits
  if (options.maxFiles && state.fileCount >= options.maxFiles) return;
  if (options.maxSize && state.totalSize >= options.maxSize) return;

  const entries = await fs.readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    // Check limits again in loop
    if (options.maxFiles && state.fileCount >= options.maxFiles) break;
    if (options.maxSize && state.totalSize >= options.maxSize) break;

    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      // Recurse if not excluded
      if (!options.excludeDirs || !options.excludeDirs.includes(entry.name)) {
        await walkDir(fullPath, options, state);
      }
    } else if (entry.isFile()) {
      // Check extension filter
      if (options.extensions) {
        const ext = path.extname(entry.name);
        if (!options.extensions.includes(ext)) continue;
      }

      // Update size tracking
      if (options.maxSize) {
        const stat = await fs.stat(fullPath);
        if (state.totalSize + stat.size > options.maxSize) break;
        state.totalSize += stat.size;
      }

      // Increment count and invoke callback
      state.fileCount++;
      if (options.onFile) {
        await options.onFile(fullPath);
      }
    }
  }
}
