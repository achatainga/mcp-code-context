/**
 * Confirmation Store - v3.7.0
 * Two-phase write: dry-run preview → confirm with token
 * Stores pending write operations with auto-expiry
 * NOW with SQLite persistence for crash recovery
 */

import * as crypto from "node:crypto";
import { PendingOperationStore } from "./pendingStore.js";

export interface PendingOperation {
  token: string;
  filePath: string;
  operation: string;
  symbolName?: string;
  newContent: string;
  diff: string;
  createdAt: number;
  expiresAt: number;
  originalHash?: string;
  /** Multi-file pending writes for rename operations */
  pendingWrites?: Array<{ filePath: string; newContent: string; originalHash?: string }>;
}

const EXPIRY_MS = 5 * 60 * 1000; // 5 minutes
const MAX_PENDING = 50;

export class ConfirmationStore {
  private pending: Map<string, PendingOperation> = new Map();
  private persistentStore: PendingOperationStore | null = null;
  private sessionId: string;
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor(sessionId: string = "default", projectRoot?: string) {
    this.sessionId = sessionId;
    if (projectRoot) {
      this.persistentStore = new PendingOperationStore(projectRoot);
    }
    this.cleanupInterval = setInterval(() => this.cleanup(), 60_000);
    if (this.cleanupInterval.unref) {
      this.cleanupInterval.unref();
    }
  }

  /**
   * Store a pending write operation and return a confirmation token.
   * Invalidates any existing pending token for the same file(s) —
   * prevents stale tokens from overwriting newer changes.
   * NOW persists to SQLite for crash recovery.
   */
  storePending(params: {
    filePath: string;
    operation: string;
    symbolName?: string;
    newContent: string;
    diff: string;
    originalHash?: string;
    pendingWrites?: Array<{ filePath: string; newContent: string; originalHash?: string }>;
  }): string {
    this.cleanup();

    // Collect all file paths this operation touches
    const affectedPaths = new Set<string>();
    affectedPaths.add(this.normalizePath(params.filePath));
    for (const pw of params.pendingWrites ?? []) {
      affectedPaths.add(this.normalizePath(pw.filePath));
    }

    // Invalidate any existing token that overlaps with these paths
    for (const [existingToken, op] of this.pending.entries()) {
      const opPaths = new Set<string>();
      opPaths.add(this.normalizePath(op.filePath));
      for (const pw of op.pendingWrites ?? []) {
        opPaths.add(this.normalizePath(pw.filePath));
      }
      const hasOverlap = [...affectedPaths].some(p => opPaths.has(p));
      if (hasOverlap) {
        this.pending.delete(existingToken);
      }
    }

    const token = crypto.randomBytes(16).toString("hex");
    const now = Date.now();

    const pendingOp: PendingOperation = {
      token,
      filePath: params.filePath,
      operation: params.operation,
      symbolName: params.symbolName,
      newContent: params.newContent,
      diff: params.diff,
      createdAt: now,
      expiresAt: now + EXPIRY_MS,
      originalHash: params.originalHash,
      pendingWrites: params.pendingWrites,
    };

    this.pending.set(token, pendingOp);

    // Persist to SQLite if available (fire-and-forget for crash recovery)
    this.persistentStore?.storePending(this.sessionId, token, params).catch(() => {});

    // Enforce max pending limit
    if (this.pending.size > MAX_PENDING) {
      const oldest = Array.from(this.pending.entries())
        .sort((a, b) => a[1].createdAt - b[1].createdAt);
      const toRemove = oldest.slice(0, this.pending.size - MAX_PENDING);
      for (const [key] of toRemove) {
        this.pending.delete(key);
      }
    }

    return token;
  }

  /**
   * Retrieve and consume a pending operation by token
   * Tries in-memory first, then falls back to SQLite for crash recovery
   */
  async consumePending(token: string): Promise<PendingOperation | null> {
    this.cleanup();

    // Check in-memory (primary path)
    const op = this.pending.get(token);
    if (op) {
      if (Date.now() > op.expiresAt) {
        this.pending.delete(token);
        return null;
      }
      this.pending.delete(token);
      // Fire-and-forget: remove from persistent store too
      this.persistentStore?.consumePending(token).catch(() => {});
      return op;
    }

    // SQLite fallback for crash recovery
    if (this.persistentStore) {
      try {
        const dbOp = await this.persistentStore.consumePending(token);
        if (dbOp) {
          let parsedPendingWrites: Array<{ filePath: string; newContent: string }> | undefined;
          if (dbOp.pendingWrites) {
            try {
              parsedPendingWrites = JSON.parse(dbOp.pendingWrites);
            } catch {
              // Ignore malformed JSON
            }
          }
          return {
            token: dbOp.token,
            filePath: dbOp.filePath,
            operation: dbOp.operation,
            symbolName: dbOp.symbolName,
            newContent: dbOp.newContent,
            diff: dbOp.diff,
            createdAt: dbOp.createdAt,
            expiresAt: dbOp.expiresAt,
            originalHash: dbOp.originalHash,
            pendingWrites: parsedPendingWrites,
          };
        }
      } catch {
        // Fail silently to prevent blocking normal operation
      }
    }

    return null;
  }

  /**
   * Check if any pending token exists for the given file path (without consuming).
   * Use before Phase 1 to warn the user of a stale pending operation.
   */
  hasConflictingPending(filePath: string): boolean {
    this.cleanup();
    const normalized = this.normalizePath(filePath);
    for (const op of this.pending.values()) {
      if (this.normalizePath(op.filePath) === normalized) return true;
      if (op.pendingWrites?.some(pw => this.normalizePath(pw.filePath) === normalized)) return true;
    }
    return false;
  }

  /**
   * Check if a token exists (without consuming)
   */
  hasPending(token: string): boolean {
    this.cleanup();
    const op = this.pending.get(token);
    return !!op && Date.now() <= op.expiresAt;
  }

  /**
   * Get count of pending operations
   */
  getPendingCount(): number {
    this.cleanup();
    return this.pending.size;
  }

  private normalizePath(filePath: string): string {
    return filePath.replace(/\\/g, '/').toLowerCase();
  }

  /**
   * Remove expired entries
   */
  private cleanup(): void {
    const now = Date.now();
    for (const [key, op] of this.pending.entries()) {
      if (now > op.expiresAt) {
        this.pending.delete(key);
      }
    }
  }

  /**
   * Clear all pending operations
   */
  clearAll(): void {
    this.pending.clear();
  }

  /**
   * List all pending operations (for recovery/debugging)
   */
  listAll(): Array<{token: string; filePath: string; operation: string; createdAt: number; expiresAt: number}> {
    this.cleanup();
    return Array.from(this.pending.values()).map(op => ({
      token: op.token,
      filePath: op.filePath,
      operation: op.operation,
      createdAt: op.createdAt,
      expiresAt: op.expiresAt,
    }));
  }

  /**
   * Returns true if SQLite persistence is active for this store
   */
  hasPersistentStore(): boolean {
    return this.persistentStore !== null;
  }

  /**
   * Activate SQLite persistence after construction.
   * Called when projectRoot becomes known (first real tool call).
   */
  activatePersistence(sessionId: string, projectRoot: string): void {
    if (this.persistentStore) return; // already active
    this.sessionId = sessionId;
    this.persistentStore = new PendingOperationStore(projectRoot);
  }

  /**
   * Close the persistent store
   */
  close(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.persistentStore?.close().catch(() => {});
  }
}
