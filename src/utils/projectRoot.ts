import * as path from "node:path";
import * as fs from "node:fs";

const ROOT_MARKERS = [
  ".git",
  "package.json",
  "composer.json",
  "pyproject.toml",
  "requirements.txt",
  "Cargo.toml",
  "go.mod",
  "Gemfile",
  "pom.xml",
  "build.gradle",
];

/**
 * Searches upward from startPath to find the nearest project root directory marked by common indicators.
 */
export function findProjectRoot(startPath: string): string {
  try {
    let current = path.resolve(startPath);
    if (fs.existsSync(current)) {
      const stat = fs.statSync(current);
      if (stat.isFile()) {
        current = path.dirname(current);
      }
    } else {
      // If path does not exist yet, start from dirname
      current = path.dirname(current);
    }

    while (true) {
      for (const marker of ROOT_MARKERS) {
        if (fs.existsSync(path.join(current, marker))) {
          return current;
        }
      }
      const parent = path.dirname(current);
      if (parent === current) {
        break;
      }
      current = parent;
    }
  } catch {
    // Fallback if filesystem access fails
  }
  return path.resolve(startPath);
}

/**
 * Resolves the effective projectRoot from tool arguments, candidate paths, or process.cwd().
 * Eliminates the bug where undefined projectRoot was stringified as literal "undefined".
 */
export function resolveProjectRoot(
  args?: Record<string, unknown>,
  fallbackPath?: string
): string {
  if (args) {
    if (
      typeof args.projectRoot === "string" &&
      args.projectRoot.trim().length > 0 &&
      args.projectRoot !== "undefined" &&
      args.projectRoot !== "null"
    ) {
      return path.resolve(args.projectRoot.trim());
    }

    if (
      typeof args.rootDir === "string" &&
      args.rootDir.trim().length > 0 &&
      args.rootDir !== "undefined" &&
      args.rootDir !== "null"
    ) {
      return findProjectRoot(args.rootDir.trim());
    }

    if (
      typeof args.directoryPath === "string" &&
      args.directoryPath.trim().length > 0 &&
      args.directoryPath !== "undefined" &&
      args.directoryPath !== "null"
    ) {
      return findProjectRoot(args.directoryPath.trim());
    }

    if (
      typeof args.filePath === "string" &&
      args.filePath.trim().length > 0 &&
      args.filePath !== "undefined" &&
      args.filePath !== "null"
    ) {
      return findProjectRoot(args.filePath.trim());
    }

    if (Array.isArray(args.reads) && args.reads.length > 0) {
      const first = args.reads[0];
      if (first && typeof first === "object" && typeof (first as any).filePath === "string") {
        return findProjectRoot((first as any).filePath);
      }
    }
  }

  if (
    typeof fallbackPath === "string" &&
    fallbackPath.trim().length > 0 &&
    fallbackPath !== "undefined" &&
    fallbackPath !== "null"
  ) {
    return findProjectRoot(fallbackPath.trim());
  }

  return process.cwd();
}
