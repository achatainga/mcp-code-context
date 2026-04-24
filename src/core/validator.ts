/**
 * Security Validator - v3.4.1
 * CRITICAL FIX: Path traversal check AFTER normalization
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
    // Resolve FIRST, then check
    const resolved = path.resolve(filePath);

    // CRITICAL: Check boundary AFTER normalization
    if (!resolved.startsWith(this.projectRoot)) {
      return { valid: false, error: "Path outside project boundary" };
    }

    // Additional dangerous pattern check
    if (filePath.includes("..") && !resolved.startsWith(this.projectRoot)) {
      return { valid: false, error: "Invalid path: contains dangerous patterns" };
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
