/**
 * Transaction Manager - Atomic Multi-File Operations
 * Ensures all-or-nothing writes with automatic rollback on failure
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { createBackup, restoreBackup } from "./backupManager.js";

export interface FileChange {
  filePath: string;
  newContent: string;
}

export class TransactionManager {
  private staging: Map<string, string> = new Map();
  private backedUpFiles: Set<string> = new Set();

  /**
   * Stage a file change for commit
   */
  stage(filePath: string, newContent: string): void {
    const resolved = path.resolve(filePath);
    this.staging.set(resolved, newContent);
  }

  /**
   * Stage multiple file changes
   */
  stageMultiple(changes: FileChange[]): void {
    for (const change of changes) {
      this.stage(change.filePath, change.newContent);
    }
  }

  /**
   * Commit all staged changes atomically
   * Creates backups first, then writes all files
   * Rolls back automatically on any failure
   */
  async commit(): Promise<{ success: boolean; error?: string }> {
    if (this.staging.size === 0) {
      return { success: true };
    }

    // Phase 1: Create backups
    try {
      for (const [filePath] of this.staging) {
        createBackup(filePath);
        this.backedUpFiles.add(filePath);
      }
    } catch (error) {
      await this.rollback();
      return {
        success: false,
        error: `Backup failed: ${error instanceof Error ? error.message : String(error)}`
      };
    }

    // Phase 2: Write all files
    try {
      for (const [filePath, content] of this.staging) {
        await fs.promises.writeFile(filePath, content, "utf-8");
      }
    } catch (error) {
      await this.rollback();
      return {
        success: false,
        error: `Write failed: ${error instanceof Error ? error.message : String(error)}`
      };
    }

    // Phase 3: Validate (optional syntax check could go here)
    // For now, we trust the write succeeded

    this.clear();
    return { success: true };
  }

  /**
   * Rollback all changes by restoring from backups
   */
  async rollback(): Promise<void> {
    for (const filePath of this.backedUpFiles) {
      try {
        restoreBackup(filePath);
      } catch (error) {
        // Log but continue rolling back other files
        console.error(`Failed to restore ${filePath}:`, error);
      }
    }
    this.clear();
  }

  /**
   * Clear staging area and backup tracking
   */
  clear(): void {
    this.staging.clear();
    this.backedUpFiles.clear();
  }

  /**
   * Get number of staged changes
   */
  get stagedCount(): number {
    return this.staging.size;
  }

  /**
   * Get list of staged file paths
   */
  getStagedFiles(): string[] {
    return Array.from(this.staging.keys());
  }
}
