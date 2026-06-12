/**
 * TOCTOU helpers — verify file integrity between Phase 1 and Phase 2
 */

import * as fs from "node:fs/promises";
import * as crypto from "node:crypto";
import { SecurityValidator } from "../core/validator.js";
import type { ConfirmationStore } from "../operations/confirmationStore.js";

export async function verifyFileUnchanged(
  validator: SecurityValidator,
  filePath: string,
  expectedHash: string | undefined
): Promise<string> {
  const validation = await validator.validateFilePath(filePath);
  if (!validation.valid) throw new Error(validation.error);

  if (expectedHash) {
    const currentContent = await fs.readFile(validation.resolvedPath!, "utf-8");
    const currentHash = crypto.createHash("sha256").update(currentContent).digest("hex");
    if (currentHash !== expectedHash) {
      throw new Error(
        `File "${filePath}" was modified by another process after Phase 1. Please repeat the operation to prevent data loss.`
      );
    }
  }

  return validation.resolvedPath!;
}

export function assertNoPendingWriteConflict(
  confirmationStore: ConfirmationStore,
  filePath: string
): void {
  if (confirmationStore.hasConflictingPending(filePath)) {
    throw new Error(
      `A pending write exists for "${filePath}". Complete or cancel Phase 2 before reading to avoid stale content.`
    );
  }
}
