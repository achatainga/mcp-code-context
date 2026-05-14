/**
 * Security Validator - v3.6.2
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

    // CRITICAL: Check boundary AFTER normalization (with path separator)
    if (resolved !== this.projectRoot && !resolved.startsWith(this.projectRoot + path.sep)) {
      return { 
        valid: false, 
        error: `Security: Path "${filePath}" is outside project boundary "${this.projectRoot}"` 
      };
    }

    // Existence check
    try {
      await fs.access(resolved);
    } catch {
      return { 
        valid: false, 
        error: `File not found: "${filePath}" (resolved to "${resolved}")` 
      };
    }

    return { valid: true, resolvedPath: resolved };
  }

  async validateFileSize(filePath: string, maxSize: number = 10 * 1024 * 1024): Promise<ValidationResult> {
    try {
      const stat = await fs.stat(filePath);
      if (stat.size > maxSize) {
        const sizeMB = (stat.size / 1024 / 1024).toFixed(2);
        const maxMB = (maxSize / 1024 / 1024).toFixed(2);
        return { 
          valid: false, 
          error: `File too large: ${sizeMB}MB exceeds maximum ${maxMB}MB` 
        };
      }
      return { valid: true };
    } catch (error) {
      return { 
        valid: false, 
        error: `Failed to check file size for "${filePath}": ${error instanceof Error ? error.message : String(error)}` 
      };
    }
  }
}
