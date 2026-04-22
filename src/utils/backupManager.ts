/**
 * backupManager.ts — File Backup & Restore Utility
 *
 * Provides opt-in backup functionality for surgical write operations.
 * Creates centralized `.mcp-backups/` directory at project root.
 *
 * Usage:
 *   - Before modifying: createBackup(filePath) → returns backup path
 *   - On failure:       restoreBackup(filePath) → restores from backup
 *   - Cleanup:          cleanAllBackups(projectRoot) → removes all backups
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { findProjectRoot } from "./projectRoot.js";

/**
 * Create a backup copy of a file before modifying it.
 * Keeps a rolling window of the last 5 backups per file in a centralized directory.
 * 
 * Backups are stored at: [project-root]/.mcp-backups/[relative-path]/[filename].N.backup
 */
export function createBackup(filePath: string): string {
  if (!fs.existsSync(filePath)) return "";
  
  // Find project root
  const projectRoot = findProjectRoot(filePath);
  if (!projectRoot) {
    // Fallback to old behavior if no project root found
    return createBackupLegacy(filePath);
  }

  // Calculate relative path from project root
  const relativePath = path.relative(projectRoot, filePath);
  const parsed = path.parse(relativePath);
  
  // Create centralized backup directory
  const backupDir = path.join(projectRoot, ".mcp-backups", parsed.dir);
  
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
 * Legacy backup function (creates .mcp-backups in same directory)
 * Used as fallback when project root cannot be determined
 */
function createBackupLegacy(filePath: string): string {
  const parsed = path.parse(filePath);
  const backupDir = path.join(parsed.dir, ".mcp-backups");
  
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }

  for (let i = 4; i >= 1; i--) {
    const oldB = path.join(backupDir, `${parsed.base}.${i}.backup`);
    const newB = path.join(backupDir, `${parsed.base}.${i + 1}.backup`);
    if (fs.existsSync(oldB)) {
      if (i === 4 && fs.existsSync(newB)) {
        fs.unlinkSync(newB);
      }
      fs.renameSync(oldB, newB);
    }
  }

  const backupPath = path.join(backupDir, `${parsed.base}.1.backup`);
  fs.copyFileSync(filePath, backupPath);
  return backupPath;
}

/**
 * Restore a file from its backup.
 */
export function restoreBackup(filePath: string, steps = 1): boolean {
  // Try centralized backup first
  const projectRoot = findProjectRoot(filePath);
  
  if (projectRoot) {
    const relativePath = path.relative(projectRoot, filePath);
    const parsed = path.parse(relativePath);
    const backupDir = path.join(projectRoot, ".mcp-backups", parsed.dir);
    const targetBackup = path.join(backupDir, `${parsed.base}.${steps}.backup`);

    if (fs.existsSync(targetBackup)) {
      fs.copyFileSync(targetBackup, filePath);
      return true;
    }
  }
  
  // Fallback to legacy location
  const parsed = path.parse(filePath);
  const backupDir = path.join(parsed.dir, ".mcp-backups");
  const targetBackup = path.join(backupDir, `${parsed.base}.${steps}.backup`);

  if (!fs.existsSync(targetBackup)) return false;

  fs.copyFileSync(targetBackup, filePath);
  return true;
}

/**
 * Clean all backups for a project.
 * Removes the entire .mcp-backups directory at project root.
 */
export function cleanAllBackups(projectRoot: string): boolean {
  const backupDir = path.join(projectRoot, ".mcp-backups");
  
  if (!fs.existsSync(backupDir)) return false;
  
  try {
    fs.rmSync(backupDir, { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
}

/**
 * Clean legacy backups (no-op, kept for compatibility).
 */
export function cleanBackup(filePath: string): void {
  // No-op. We keep the rolling 5 versions instead of deleting.
}
