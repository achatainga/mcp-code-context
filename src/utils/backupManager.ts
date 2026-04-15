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

// ─── Public API ─────────────────────────────────────────────────────

/**
 * Create a backup copy of a file.
 * The backup is stored at `${filePath}.bak` in the same directory.
 *
 * @returns The absolute path to the backup file.
 * @throws If the original file doesn't exist or can't be read.
 */
export function createBackup(filePath: string): string {
  const backupPath = getBackupPath(filePath);

  if (!fs.existsSync(filePath)) {
    throw new Error(`Cannot create backup: file does not exist: ${filePath}`);
  }

  fs.copyFileSync(filePath, backupPath);
  return backupPath;
}

/**
 * Restore a file from its `.bak` backup.
 *
 * @returns true if the backup was successfully restored, false if no backup exists.
 */
export function restoreBackup(filePath: string): boolean {
  const backupPath = getBackupPath(filePath);

  if (!fs.existsSync(backupPath)) {
    return false;
  }

  fs.copyFileSync(backupPath, filePath);
  fs.unlinkSync(backupPath);
  return true;
}

/**
 * Remove the backup file for a given path.
 * No-op if no backup exists.
 */
export function cleanBackup(filePath: string): void {
  const backupPath = getBackupPath(filePath);

  if (fs.existsSync(backupPath)) {
    fs.unlinkSync(backupPath);
  }
}

// ─── Internals ──────────────────────────────────────────────────────

function getBackupPath(filePath: string): string {
  return `${filePath}.bak`;
}
