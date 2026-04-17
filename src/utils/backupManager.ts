/**
 * backupManager.ts — File Backup & Restore Utility
 *
 * Provides opt-in backup functionality for surgical write operations.
 * Creates `.bak` files in the same directory as the source file.
 *
 * Usage:
 *   - Before modifying: createBackup(filePath) → returns backup path
 *   - On failure:       restoreBackup(filePath) → restores from .bak
 *   - On success:       cleanBackup(filePath)   → removes .bak
 */

import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Create a backup copy of a file before modifying it.
 * Keeps a rolling window of the last 5 backups per file in a hidden directory.
 */
export function createBackup(filePath: string): string {
  if (!fs.existsSync(filePath)) return "";
  
  const parsed = path.parse(filePath);
  const backupDir = path.join(parsed.dir, ".mcp-backups");
  
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }

  // Push existing backups down the stack (max 5)
  for (let i = 4; i >= 1; i--) {
    const oldB = path.join(backupDir, `${parsed.base}.${i}.backup`);
    const newB = path.join(backupDir, `${parsed.base}.${i + 1}.backup`);
    if (fs.existsSync(oldB)) {
      if (i === 4 && fs.existsSync(newB)) {
        fs.unlinkSync(newB); // Drop the 5th one to make room
      }
      fs.renameSync(oldB, newB);
    }
  }

  const backupPath = path.join(backupDir, `${parsed.base}.1.backup`);
  fs.copyFileSync(filePath, backupPath);
  return backupPath;
}

/**
 * Restore a file from its `.bak` backup.
 */
export function restoreBackup(filePath: string, steps = 1): boolean {
  const parsed = path.parse(filePath);
  const backupDir = path.join(parsed.dir, ".mcp-backups");
  const targetBackup = path.join(backupDir, `${parsed.base}.${steps}.backup`);

  if (!fs.existsSync(targetBackup)) return false;

  fs.copyFileSync(targetBackup, filePath);
  return true;
}

/**
 * Clean legacy backups.
 */
export function cleanBackup(filePath: string): void {
  // No-op. We keep the rolling 5 versions instead of deleting.
}
