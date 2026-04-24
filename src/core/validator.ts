/**
 * Security Validator - v3.0.0
 * Mandatory project boundary enforcement
 */

import * as path from "node:path";
import * as fs from "node:fs/promises";

export interface ValidationResult {
  valid: boolean;
  resolvedPath?: string;
  error?: string;
}

export class SecurityValidator {
  private projectRoot: string;

  constructor(projectRoot: string) {
    this.projectRoot = path.resolve(projectRoot);
  }

  async validateFilePath(filePath: string): Promise<ValidationResult> {
    const resolved = path.resolve(filePath);

    // Path traversal check (but allow Windows drive letters)
    if (filePath.includes("..")) {
      return { valid: false, error: "Invalid path: contains dangerous patterns" };
    }

    // Project boundary check (MANDATORY)
    if (!resolved.startsWith(this.projectRoot)) {
      return { valid: false, error: "Path outside project boundary" };
    }

    // Existence check
    try {
      await fs.access(resolved);
    } catch {
      return { valid: false, error: "File does not exist" };
    }

    return { valid: true, resolvedPath: resolved };
  }

  async validateFileSize(filePath: string, maxSize: number = 10 * 1024 * 1024): Promise<ValidationResult> {
    try {
      const stat = await fs.stat(filePath);
      if (stat.size > maxSize) {
        return { valid: false, error: `File too large: ${(stat.size / 1024 / 1024).toFixed(2)}MB` };
      }
      return { valid: true };
    } catch (error) {
      return { valid: false, error: `Failed to check file size: ${error}` };
    }
  }
}
