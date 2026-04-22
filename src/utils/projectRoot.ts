/**
 * projectRoot.ts — Project Root Discovery Utility
 * 
 * Finds the root directory of a project by looking for common markers.
 */

import * as fs from "node:fs";
import * as path from "node:path";

const ROOT_MARKERS = [
  "package.json",
  ".git",
  "pyproject.toml",
  "setup.py",
  "Cargo.toml",
  "go.mod",
  "pom.xml",
  "build.gradle",
  "CMakeLists.txt",
  ".gitignore",
  "Gemfile",
  "composer.json",
  "pubspec.yaml",
];

/**
 * Find the project root by walking up from a file path.
 * Returns undefined if no root marker is found.
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
