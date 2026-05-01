/**
 * Backup Manager - v3.6.0
 * Handles rolling backups in OS temp directory
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { tmpdir } from "os";
import { existsSync, mkdirSync } from "fs";
import { MAX_BACKUPS_PER_FILE, HASH_LENGTH } from './constants.js';

/**
 * Manages file backups with automatic rotation.
 * Backups are stored in OS temp directory to prevent hot-reload loops.
 */
export class BackupManager {
  private static readonly MAX_BACKUPS = MAX_BACKUPS_PER_FILE;
  private static backupRootCache = new Map<string, string>();

  private static getBackupRoot(projectRoot: string): string {
    if (this.backupRootCache.has(projectRoot)) {
      return this.backupRootCache.get(projectRoot)!;
    }

    const projectHash = crypto.createHash('md5')
      .update(projectRoot)
      .digest('hex')
      .substring(0, HASH_LENGTH);
    
    const backupRoot = path.join(tmpdir(), 'mcp-backups', projectHash);
    
    if (!existsSync(backupRoot)) {
      mkdirSync(backupRoot, { recursive: true });
    }

    this.backupRootCache.set(projectRoot, backupRoot);
    return backupRoot;
  }

  /**
   * Creates a backup of a file before modification.
   * Automatically enforces backup limit per file.
   * 
   * @param filePath - Absolute path to file to backup
   * @param projectRoot - Project root directory
   */
  static async createBackup(filePath: string, projectRoot: string): Promise<void> {
    try {
      await fs.access(filePath);
    } catch {
      return;
    }

    const backupDir = this.getBackupRoot(projectRoot);
    
    if (!existsSync(backupDir)) {
      mkdirSync(backupDir, { recursive: true });
    }

    const relativePath = path.relative(projectRoot, filePath);
    const safeName = crypto.createHash('md5').update(relativePath).digest('hex').substring(0, HASH_LENGTH) + "_" + path.basename(filePath);
    
    const timestamp = Date.now();
    const backupFileName = `${safeName}_${timestamp}.bak`;
    const backupFilePath = path.join(backupDir, backupFileName);

    await fs.copyFile(filePath, backupFilePath);
    await this.enforceBackupLimit(backupDir, safeName);
  }

  /**
   * Restores a file from backup.
   * 
   * @param filePath - Absolute path to file to restore
   * @param projectRoot - Project root directory
   * @param steps - Number of versions to roll back (default: 1)
   * @returns Result with success status and restored backup name
   */
  static async rollback(filePath: string, projectRoot: string, steps: number = 1): Promise<{ success: boolean; error?: string; restoredFrom?: string }> {
    try {
      const backupDir = this.getBackupRoot(projectRoot);
      const relativePath = path.relative(projectRoot, filePath);
      const safeName = crypto.createHash('md5').update(relativePath).digest('hex').substring(0, HASH_LENGTH) + "_" + path.basename(filePath);

      let files: string[];
      try {
        files = await fs.readdir(backupDir);
      } catch {
        return { success: false, error: `No backups directory found for project "${projectRoot}"` };
      }

      const fileBackups = files
        .filter(f => f.startsWith(safeName + "_") && f.endsWith(".bak"))
        .sort((a, b) => b.localeCompare(a));

      if (fileBackups.length === 0) {
        return { success: false, error: `No backups found for file "${path.basename(filePath)}" in project "${projectRoot}"` };
      }

      const targetIndex = Math.min(steps - 1, fileBackups.length - 1);
      const targetBackup = fileBackups[targetIndex];
      const backupFilePath = path.join(backupDir, targetBackup);

      await fs.copyFile(backupFilePath, filePath);

      return { success: true, restoredFrom: targetBackup };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  /**
   * Removes all backups for a project.
   * 
   * @param projectRoot - Project root directory
   * @returns Result with success status and count of deleted files
   */
  static async clean(projectRoot: string): Promise<{ success: boolean; error?: string; deletedCount?: number }> {
    try {
      const backupDir = this.getBackupRoot(projectRoot);
      try {
        const files = await fs.readdir(backupDir);
        let deletedCount = 0;
        for (const file of files) {
          const filePath = path.join(backupDir, file);
          const stat = await fs.stat(filePath);
          if (stat.isDirectory()) {
            await fs.rm(filePath, { recursive: true, force: true });
          } else {
            await fs.unlink(filePath);
          }
          deletedCount++;
        }
        await fs.rmdir(backupDir);
        return { success: true, deletedCount };
      } catch (e: any) {
        if (e.code === 'ENOENT') {
          return { success: true, deletedCount: 0 };
        }
        throw e;
      }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  private static async enforceBackupLimit(backupDir: string, safeName: string): Promise<void> {
    try {
      const files = await fs.readdir(backupDir);
      const fileBackups = files
        .filter(f => f.startsWith(safeName + "_") && f.endsWith(".bak"))
        .sort((a, b) => b.localeCompare(a));

      if (fileBackups.length > this.MAX_BACKUPS) {
        const backupsToDelete = fileBackups.slice(this.MAX_BACKUPS);
        for (const backup of backupsToDelete) {
          await fs.unlink(path.join(backupDir, backup));
        }
      }
    } catch (error) {
      console.error(`Failed to enforce backup limits in ${backupDir}`, error);
    }
  }

  /**
   * Lists all available backups for a file.
   * 
   * @param filePath - Absolute path to file
   * @param projectRoot - Project root directory
   * @returns Array of backup file paths, sorted newest first
   */
  static async listBackups(filePath: string, projectRoot: string): Promise<string[]> {
    try {
      const backupDir = this.getBackupRoot(projectRoot);
      const relativePath = path.relative(projectRoot, filePath);
      const safeName = crypto.createHash('md5').update(relativePath).digest('hex').substring(0, HASH_LENGTH) + "_" + path.basename(filePath);

      const files = await fs.readdir(backupDir);
      return files
        .filter(f => f.startsWith(safeName + "_") && f.endsWith(".bak"))
        .map(f => path.join(backupDir, f))
        .sort((a, b) => b.localeCompare(a));
    } catch {
      return [];
    }
  }
}
