/**
 * Secure Project Root Detection
 * Ensures all file operations are contained within project boundaries
 */

import * as fs from "node:fs";
import * as path from "node:path";

const ROOT_MARKERS = ["package.json", ".git", "pubspec.yaml", "pyproject.toml", "Cargo.toml"];

/**
 * Find project root by walking up from a file path
 * Returns undefined if no root marker found
 */
export function findProjectRoot(filePath: string): string | undefined {
  let current = path.dirname(path.resolve(filePath));
  const root = path.parse(current).root;

  while (current !== root) {
    for (const marker of ROOT_MARKERS) {
      if (fs.existsSync(path.join(current, marker))) {
        return current;
      }
    }
    current = path.dirname(current);
  }

  return undefined;
}

/**
 * Validate that a file path is within project boundaries
 * MANDATORY for all write operations
 */
export function enforceProjectBoundary(
  filePath: string,
  projectRoot: string
): { valid: boolean; error?: string } {
  const normalized = path.resolve(filePath);
  const normalizedRoot = path.resolve(projectRoot);
  const relative = path.relative(normalizedRoot, normalized);

  // If relative path starts with .., it's outside the project root
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return {
      valid: false,
      error: `Security: Path outside project root. File: ${normalized}, Root: ${normalizedRoot}`
    };
  }

  return { valid: true };
}
