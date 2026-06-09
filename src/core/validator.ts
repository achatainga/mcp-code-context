/**
 * Security Validator - v3.7.0
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
    const resolved = path.resolve(filePath);

    if (resolved !== this.projectRoot && !resolved.startsWith(this.projectRoot + path.sep)) {
      return {
        valid: false,
        error: `Security: Path "${filePath}" is outside project boundary "${this.projectRoot}"`,
      };
    }

    try {
      const realPath = await fs.realpath(resolved);

      if (realPath !== this.projectRoot && !realPath.startsWith(this.projectRoot + path.sep)) {
        return {
          valid: false,
          error: `Security: Symlink "${filePath}" resolves outside project boundary "${this.projectRoot}"`,
        };
      }

      await fs.access(realPath);
      return { valid: true, resolvedPath: realPath };
    } catch {
      return {
        valid: false,
        error: `File not found: "${filePath}" (resolved to "${resolved}")`,
      };
    }
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
