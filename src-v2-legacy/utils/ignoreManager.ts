/**
 * IgnoreManager — Reads .gitignore / .repomixignore and walks directories
 * filtering out ignored paths. Always excludes common heavy directories.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { createRequire } from "node:module";
import type { Ignore } from "ignore";

// CJS interop: 'ignore' uses module.exports which doesn't resolve
// as a callable default export under Node16 module resolution.
const require = createRequire(import.meta.url);
const ignore: (opts?: Record<string, unknown>) => Ignore = require("ignore");

/** Directories and patterns that are ALWAYS excluded regardless of .gitignore */
const ALWAYS_IGNORE: string[] = [
  "node_modules",
  ".git",
  "dist",
  "build",
  "vendor",
  ".next",
  ".nuxt",
  ".output",
  "__pycache__",
  ".pytest_cache",
  "coverage",
  ".nyc_output",
  ".turbo",
  ".cache",
  ".parcel-cache",
  ".venv",
  "venv",
  "env",
  ".env.local",
  ".tsbuildinfo",
  "*.lock",
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "bun.lockb",
  "*.min.js",
  "*.min.css",
  "*.map",
  "*.chunk.js",
  "*.bundle.js",
];

/** Max file size to read (512 KB). Files larger than this are skipped. */
const MAX_FILE_SIZE_BYTES = 512 * 1024;

export class IgnoreManager {
  private ig: Ignore;
  private rootDir: string;

  constructor(rootDir: string) {
    this.rootDir = path.resolve(rootDir);
    this.ig = ignore();

    // Load hardcoded ignores first
    this.ig.add(ALWAYS_IGNORE);

    // Load .gitignore
    this.loadIgnoreFile(path.join(this.rootDir, ".gitignore"));

    // Load .repomixignore (Repomix-style overrides)
    this.loadIgnoreFile(path.join(this.rootDir, ".repomixignore"));
  }

  /**
   * Reads an ignore-pattern file and adds its rules to the filter.
   * Silently skips if the file doesn't exist or is unreadable.
   */
  private loadIgnoreFile(filePath: string): void {
    try {
      if (!fs.existsSync(filePath)) return;

      const content = fs.readFileSync(filePath, "utf-8");
      const patterns = content
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && !line.startsWith("#"));

      if (patterns.length > 0) {
        this.ig.add(patterns);
      }
    } catch {
      // File unreadable — skip silently
    }
  }

  /** Check if a relative path should be ignored. */
  public isIgnored(relativePath: string): boolean {
    if (!relativePath) return false;
    return this.ig.ignores(relativePath);
  }

  /**
   * Recursively walk a directory, returning absolute paths to all
   * non-ignored files. Uses async I/O to avoid blocking event loop.
   */
  public async walkDirectory(dir?: string, signal?: AbortSignal): Promise<string[]> {
    const baseDir = dir ? path.resolve(dir) : this.rootDir;
    const files: string[] = [];
    await this.walk(baseDir, files, signal);
    return files;
  }

  /**
   * @deprecated Use walkDirectory() instead (now async by default)
   */
  public async walkDirectoryAsync(dir?: string, signal?: AbortSignal): Promise<string[]> {
    return this.walkDirectory(dir, signal);
  }

  /**
   * Async recursive walk implementation
   */
  private async walk(currentDir: string, collected: string[], signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) throw new Error("Operation cancelled");
    
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(currentDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (signal?.aborted) throw new Error("Operation cancelled");
      
      const fullPath = path.join(currentDir, entry.name);
      const relativePath = path
        .relative(this.rootDir, fullPath)
        .replace(/\\/g, "/");

      if (this.isIgnored(relativePath)) continue;

      if (entry.isDirectory()) {
        if (this.isIgnored(relativePath + "/")) continue;
        await this.walk(fullPath, collected, signal);
      } else if (entry.isFile()) {
        try {
          const stat = await fs.promises.stat(fullPath);
          if (stat.size > MAX_FILE_SIZE_BYTES) continue;
        } catch {
          continue;
        }
        collected.push(fullPath);
      }
    }
  }
}
