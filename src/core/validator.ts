/**
 * Security Validator - v3.9.0
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
    // normalize: resolve + lowercase for case-insensitive Windows FS comparison
    this.projectRoot = path.resolve(projectRoot).toLowerCase();
  }

  async validateFilePath(filePath: string): Promise<ValidationResult> {
    const resolved = path.resolve(filePath);
    const resolvedNorm = resolved.toLowerCase();

    if (resolvedNorm !== this.projectRoot && !resolvedNorm.startsWith(this.projectRoot + path.sep)) {
      return {
        valid: false,
        error: `Security: Path "${filePath}" is outside project boundary "${this.projectRoot}"`,
      };
    }

    try {
      const realPath = await fs.realpath(resolved);
      const realPathNorm = realPath.toLowerCase();

      if (realPathNorm !== this.projectRoot && !realPathNorm.startsWith(this.projectRoot + path.sep)) {
        return {
          valid: false,
          error: `Security: Symlink "${filePath}" resolves outside project boundary "${this.projectRoot}"`,
        };
      }

      await fs.access(realPath);
      return { valid: true, resolvedPath: realPath };
    } catch {
      // fs.realpath or fs.access failed — file does not exist or is inaccessible
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
