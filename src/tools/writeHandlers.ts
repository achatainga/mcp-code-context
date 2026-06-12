/** Tool handlers */

import * as path from "node:path";
import * as fs from "node:fs/promises";
import { SecurityValidator } from "../core/validator.js";
import { replaceSymbol, insertCode, removeSymbol, writeFile, renameSymbol } from "../operations/write.js";
import { astTransform, TransformParams } from "../operations/astTransform.js";
import { extractSymbol, readLines, searchPattern, analyzeImpact, searchSymbols, explainSymbol, batchRead } from "../operations/read.js";
import { compressRepository } from "../operations/compress.js";
import { globalAuditLogger } from "../utils/auditLogger.js";
import { globalTelemetry } from "../utils/telemetry.js";
import { OPERATION_COSTS } from "../utils/rateLimiter.js";
import { streamFile } from "../utils/streaming.js";
import { BackupManager } from "../utils/backupManager.js";
import { globalSessionManager } from "../core/sessionManager.js";
import { verifyFileUnchanged, assertNoPendingWriteConflict } from "../utils/toctou.js";
import { getSession, getCacheManager, getRegistry, SESSION_ID } from "./context.js";

export async function handleTwoPhaseWrite(
  args: Record<string, unknown>,
  operationName: string,
  executeWrite: () => Promise<any>
) {
  const confirm = Boolean(args.confirm);
  const token = args.confirmationToken ? String(args.confirmationToken) : undefined;
  const session = getSession();
  const projectRoot = args.projectRoot ? String(args.projectRoot) : undefined;

  // Proactively activate SQLite persistence if projectRoot is provided
  if (projectRoot && !session.confirmationStore.hasPersistentStore()) {
    session.confirmationStore.activatePersistence(SESSION_ID, projectRoot);
  }

  if (confirm) {
    if (!token) throw new Error("confirmationToken is required when confirm=true");
    const pendingOp = await session.confirmationStore.consumePending(token);
    if (!pendingOp) throw new Error(`Invalid or expired confirmation token: ${token}`);

    const projectRoot = String(args.projectRoot);
    const validator = new SecurityValidator(projectRoot);

    const lockReleases: Array<() => Promise<void>> = [];

    try {
      if (pendingOp.pendingWrites && pendingOp.pendingWrites.length > 0) {
        const sortedWrites = [...pendingOp.pendingWrites].sort((a, b) =>
          a.filePath.localeCompare(b.filePath)
        );

        // TOCTOU fix: Lock-Before-Verify — acquire locks first to prevent race conditions
        for (const pw of sortedWrites) {
          const validation = await validator.validateFilePath(pw.filePath);
          if (!validation.valid) throw new Error(validation.error);
          if (!await session.lockManager.isLocked(validation.resolvedPath!)) {
            lockReleases.push(await session.lockManager.acquireLock(validation.resolvedPath!));
          }
        }

        // Now verify hashes with locks held — no race window
        const resolvedWrites: Array<{ resolvedPath: string; newContent: string }> = [];
        for (const pw of sortedWrites) {
          const resolvedPath = await verifyFileUnchanged(validator, pw.filePath, pw.originalHash);
          resolvedWrites.push({ resolvedPath, newContent: pw.newContent });
        }

        for (const { resolvedPath, newContent } of resolvedWrites) {
          await BackupManager.createBackup(resolvedPath, projectRoot);
          await writeFile(resolvedPath, newContent);
        }
      } else {
        // TOCTOU fix: Lock-Before-Verify for single file path
        const validation = await validator.validateFilePath(pendingOp.filePath);
        if (!validation.valid) throw new Error(validation.error);
        if (!await session.lockManager.isLocked(validation.resolvedPath!)) {
          lockReleases.push(await session.lockManager.acquireLock(validation.resolvedPath!));
        }

        const resolvedPath = await verifyFileUnchanged(
          validator,
          pendingOp.filePath,
          pendingOp.originalHash
        );
        await BackupManager.createBackup(resolvedPath, projectRoot);
        await writeFile(resolvedPath, pendingOp.newContent);
      }
    } finally {
      for (const release of lockReleases) {
        await release();
      }
    }

    const fileCount = pendingOp.pendingWrites?.length || 1;
    return {
      content: [{ type: "text", text: `✅ Success. Changes applied to ${fileCount} file(s).` }],
    };
  }

  // Phase 1: Dry-run
  const result = await executeWrite();
  if (!result.success) throw new Error(result.error);

  const hadConflict = session.confirmationStore.hasConflictingPending(String(args.filePath));

  const newToken = session.confirmationStore.storePending({
    filePath: String(args.filePath),
    operation: operationName,
    symbolName: args.symbolName ? String(args.symbolName) : undefined,
    newContent: result.newContent!,
    diff: result.diff!,
    originalHash: result.originalHash,
    pendingWrites: result.pendingWrites,
  });

  const conflictWarning = hadConflict
    ? `\n⚠️  A previous pending token for this file was invalidated. Only this new token is valid.`
    : "";

  // ERG-01 + NEW-04: decode diff and apply diffFormat
  const rawDiff = decodeURIComponent(result.diff);
  const fmt = args.diffFormat ? String(args.diffFormat) : "unified";
  let displayDiff: string;
  if (fmt === "none") {
    displayDiff = `(diff omitted — use diffFormat="unified" to see changes)`;
  } else if (fmt === "summary") {
    const added = (rawDiff.match(/^\+[^+]/gm) || []).length;
    const removed = (rawDiff.match(/^-[^-]/gm) || []).length;
    displayDiff = `+${added} lines, -${removed} lines`;
  } else if (fmt === "compact") {
    displayDiff = rawDiff.split("\n").filter(l => l.startsWith("+") || l.startsWith("-")).join("\n");
  } else {
    displayDiff = rawDiff;
  }

  return {
    content: [{
      type: "text",
      text: `DRY RUN SUCCESSFUL.${conflictWarning}\nTo apply these changes, call this tool again with confirm=true and confirmationToken="${newToken}"\n\nDiff:\n${displayDiff}`
    }],
  };
}

export async function handleWriteFileSurgical(args: Record<string, unknown>) {
  return handleTwoPhaseWrite(args, "write_file_surgical", async () => {
    const ext = path.extname(String(args.filePath));
    const parser = getRegistry().getParser(ext);
    if (!parser) throw new Error(`No parser available for ${ext} files`);

    return await replaceSymbol({
      filePath: String(args.filePath),
      projectRoot: String(args.projectRoot),
      symbolName: String(args.symbolName),
      newContent: String(args.newContent),
      className: args.className ? String(args.className) : undefined,
      parser,
    });
  });
}

export async function handleInsertSymbol(args: Record<string, unknown>) {
  return handleTwoPhaseWrite(args, "insert_symbol", async () => {
    const ext = path.extname(String(args.filePath));
    const parser = getRegistry().getParser(ext);
    if (!parser) throw new Error(`No parser available for ${ext} files`);

    return await insertCode({
      filePath: String(args.filePath),
      projectRoot: String(args.projectRoot),
      code: String(args.code),
      anchorSymbol: args.anchorSymbol ? String(args.anchorSymbol) : undefined,
      position: args.position !== undefined ? String(args.position) as "before" | "after" | "inside_start" | "inside_end" : undefined,
      className: args.className ? String(args.className) : undefined,
      parser,
    });
  });
}

export async function handleRemoveSymbol(args: Record<string, unknown>) {
  return handleTwoPhaseWrite(args, "remove_symbol", async () => {
    const ext = path.extname(String(args.filePath));
    const parser = getRegistry().getParser(ext);
    if (!parser) throw new Error(`No parser available for ${ext} files`);

    return await removeSymbol({
      filePath: String(args.filePath),
      projectRoot: String(args.projectRoot),
      symbolName: String(args.symbolName),
      className: args.className ? String(args.className) : undefined,
      parser,
    });
  });
}

export async function handleRenameSymbol(args: Record<string, unknown>) {
  return handleTwoPhaseWrite(args, "rename_symbol", async () => {
    const ext = path.extname(String(args.filePath));
    const parser = getRegistry().getParser(ext);
    if (!parser) throw new Error(`No parser available for ${ext} files`);

    return await renameSymbol({
      filePath: String(args.filePath),
      projectRoot: String(args.projectRoot),
      oldName: String(args.oldName),
      newName: String(args.newName),
      rootDir: args.rootDir ? String(args.rootDir) : String(args.projectRoot),
      parser,
    });
  });
}

export async function handleAstTransform(args: Record<string, unknown>) {
  return handleTwoPhaseWrite(args, "ast_transform", async () => {
    const ext = path.extname(String(args.filePath));
    const parser = getRegistry().getParser(ext);
    if (!parser) throw new Error(`No parser available for ${ext} files`);

    const transform = args.transform as TransformParams;
    if (!transform || !transform.kind) {
      throw new Error('"transform" object with "kind" is required');
    }

    return await astTransform({
      filePath: String(args.filePath),
      projectRoot: String(args.projectRoot),
      symbolName: String(args.symbolName),
      className: args.className ? String(args.className) : undefined,
      transform,
      parser,
    });
  });
}
