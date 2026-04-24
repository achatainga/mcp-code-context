/**
 * utilHandlers.ts — Utility Tool Handlers
 * 
 * Handles utility operations:
 * - rollback_file
 * - clean_backups
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { restoreBackup, cleanAllBackups } from "../utils/backupManager.js";
import { validateFilePath, validateDirectoryPath } from "../utils/validation.js";

// ─── Handler: rollback_file ─────────────────────────────────────────

export async function handleRollbackFile(args: Record<string, unknown>) {
  const filePath = args.filePath as string;
  const steps = (args.steps as number) || 1;

  if (!filePath) return errorResponse("Missing required parameter: filePath");

  const validation = validateFilePath(filePath);
  if (!validation.valid) {
    return errorResponse(validation.error!);
  }

  const resolvedPath = validation.normalizedPath!;
  
  if (steps < 1 || steps > 5) {
    return errorResponse("Steps must be between 1 and 5");
  }

  const success = restoreBackup(resolvedPath, steps);

  if (!success) {
    return errorResponse(`No backup found for step ${steps}`);
  }

  return {
    content: [{
      type: "text" as const,
      text: `// ⏪ Rollback successful\n// Reverted ${path.basename(resolvedPath)} to ${steps} step(s) ago\n// File: ${resolvedPath}`,
    }],
  };
}

// ─── Handler: clean_backups ─────────────────────────────────────────

export async function handleCleanBackups(args: Record<string, unknown>) {
  const projectRoot = args.projectRoot as string;

  if (!projectRoot) return errorResponse("Missing required parameter: projectRoot");

  const validation = validateDirectoryPath(projectRoot);
  if (!validation.valid) {
    return errorResponse(validation.error!);
  }

  const resolvedPath = validation.normalizedPath!;
  
  const success = cleanAllBackups(resolvedPath);

  if (!success) {
    return {
      content: [{
        type: "text" as const,
        text: `// ℹ️ No backups found\n// No .mcp-backups directory at: ${resolvedPath}`,
      }],
    };
  }

  return {
    content: [{
      type: "text" as const,
      text: `// 🧹 Cleanup successful\n// Removed all backups from: ${resolvedPath}/.mcp-backups`,
    }],
  };
}

// ─── Utility Functions ──────────────────────────────────────────────

function errorResponse(message: string) {
  return {
    content: [{ type: "text" as const, text: `❌ ${message}` }],
    isError: true,
  };
}
