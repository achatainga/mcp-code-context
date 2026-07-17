/**
 * App Directory - v3.9.0
 * Centralizes ~/.mcp-code-context/ path resolution across all OS.
 * Fallback to os.tmpdir() in environments without HOME (CI, Docker).
 */

import * as path from "node:path";
import * as os from "node:os";
import { mkdirSync, existsSync } from "node:fs";

const APP_DIR_NAME = ".mcp-code-context";

/**
 * Resolves the base ~/.mcp-code-context/ directory.
 * Windows : %USERPROFILE%\.mcp-code-context\
 * Mac/Linux: ~/.mcp-code-context/
 * Fallback : os.tmpdir()/.mcp-code-context/  (CI/Docker without HOME)
 */
function resolveBaseDir(): string {
  const home = os.homedir();
  if (home && home !== os.tmpdir()) {
    return path.join(home, APP_DIR_NAME);
  }
  // Fallback for environments without a real home directory
  return path.join(os.tmpdir(), APP_DIR_NAME);
}

const BASE_DIR = resolveBaseDir();

/**
 * Returns an absolute path under ~/.mcp-code-context/{subdir}
 * and ensures the directory exists.
 *
 * @example
 * getAppDir("cache/abc123")   // ~/.mcp-code-context/cache/abc123/
 * getAppDir("backups/abc123") // ~/.mcp-code-context/backups/abc123/
 * getAppDir("index/abc123")   // ~/.mcp-code-context/index/abc123/
 */
export function getAppDir(subdir: string): string {
  const fullPath = path.join(BASE_DIR, subdir);
  if (!existsSync(fullPath)) {
    mkdirSync(fullPath, { recursive: true });
  }
  return fullPath;
}

/**
 * Returns the base ~/.mcp-code-context/ directory (no subdir).
 */
export function getBaseAppDir(): string {
  if (!existsSync(BASE_DIR)) {
    mkdirSync(BASE_DIR, { recursive: true });
  }
  return BASE_DIR;
}
