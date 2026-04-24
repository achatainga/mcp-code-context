/**
 * Backup Manager - v3.4.0
 * Handles rolling backups for file modifications
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as crypto from "node:crypto";

export class BackupManager {
  private static readonly MAX_BACKUPS = 5;
  private static readonly BACKUP_DIR_NAME = ".mcp-backups";

  /**
   * Creates a backup of the specified file before it gets modified
   */
  static async createBackup(filePath: string, projectRoot: string): Promise<void> {
    try {
      // Check if original file exists before backing up
      await fs.access(filePath);
    } catch {
      // File doesn't exist yet (it's a new file), no backup needed
      return;
    }

    const backupDir = path.join(projectRoot, this.BACKUP_DIR_NAME);
    await fs.mkdir(backupDir, { recursive: true });

    // Generate a safe identifier for the file (hash of its path to avoid deep nesting in backup dir)
    const relativePath = path.relative(projectRoot, filePath);
    const safeName = crypto.createHash('md5').update(relativePath).digest('hex').substring(0, 8) + "_" + path.basename(filePath);
    
    // Save backup with timestamp
    const timestamp = Date.now();
    const backupFileName = `${safeName}_${timestamp}.bak`;
    const backupFilePath = path.join(backupDir, backupFileName);

    // Copy original file to backup
    await fs.copyFile(filePath, backupFilePath);

    // Enforce rolling backup limit per file
    await this.enforceBackupLimit(backupDir, safeName);
  }

  /**
   * Restores a file to its previous state
   * @param steps How many versions to go back (1 = last version)
   */
  static async rollback(filePath: string, projectRoot: string, steps: number = 1): Promise<{ success: boolean; error?: string; restoredFrom?: string }> {
    try {
      const backupDir = path.join(projectRoot, this.BACKUP_DIR_NAME);
      const relativePath = path.relative(projectRoot, filePath);
      const safeName = crypto.createHash('md5').update(relativePath).digest('hex').substring(0, 8) + "_" + path.basename(filePath);

      let files: string[];
      try {
        files = await fs.readdir(backupDir);
      } catch {
        return { success: false, error: "No backups found for this project." };
      }

      // Filter backups for this specific file and sort by timestamp descending (newest first)
      const fileBackups = files
        .filter(f => f.startsWith(safeName + "_") && f.endsWith(".bak"))
        .sort((a, b) => b.localeCompare(a)); // String comparison of timestamps works because they are unix ms

      if (fileBackups.length === 0) {
        return { success: false, error: `No backups found for file: ${path.basename(filePath)}` };
      }

      // Determine which backup to restore
      const targetIndex = Math.min(steps - 1, fileBackups.length - 1);
      const targetBackup = fileBackups[targetIndex];
      const backupFilePath = path.join(backupDir, targetBackup);

      // Restore: copy backup back to original location
      await fs.copyFile(backupFilePath, filePath);

      return { success: true, restoredFrom: targetBackup };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  /**
   * Deletes all backups for a project
   */
  static async clean(projectRoot: string): Promise<{ success: boolean; error?: string; deletedCount?: number }> {
    try {
      const backupDir = path.join(projectRoot, this.BACKUP_DIR_NAME);
      try {
        const files = await fs.readdir(backupDir);
        for (const file of files) {
          await fs.unlink(path.join(backupDir, file));
        }
        await fs.rmdir(backupDir);
        return { success: true, deletedCount: files.length };
      } catch {
        // Directory doesn't exist
        return { success: true, deletedCount: 0 };
      }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  /**
   * Private helper to delete oldest backups if exceeding limit
   */
  private static async enforceBackupLimit(backupDir: string, safeName: string): Promise<void> {
    try {
      const files = await fs.readdir(backupDir);
      const fileBackups = files
        .filter(f => f.startsWith(safeName + "_") && f.endsWith(".bak"))
        .sort((a, b) => b.localeCompare(a)); // Newest first

      // If we have more than MAX_BACKUPS, delete the oldest ones
      if (fileBackups.length > this.MAX_BACKUPS) {
        const backupsToDelete = fileBackups.slice(this.MAX_BACKUPS);
        for (const backup of backupsToDelete) {
          await fs.unlink(path.join(backupDir, backup));
        }
      }
    } catch (error) {
      // Non-fatal, just logging silently
      console.error(`Failed to enforce backup limits in ${backupDir}`, error);
    }
  }
}
