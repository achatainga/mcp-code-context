/**
 * Confirmation Store - v3.6.3
 * Two-phase write: dry-run preview → confirm with token
 * Stores pending write operations with auto-expiry
 */

import * as crypto from "node:crypto";

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
  pendingWrites?: Array<{ filePath: string; newContent: string }>;
}

const EXPIRY_MS = 5 * 60 * 1000; // 5 minutes
const MAX_PENDING = 50;

class ConfirmationStore {
  private pending: Map<string, PendingOperation> = new Map();

  /**
   * Store a pending write operation and return a confirmation token.
   * Invalidates any existing pending token for the same file(s) —
   * prevents stale tokens from overwriting newer changes.
   */
  storePending(params: {
    filePath: string;
    operation: string;
    symbolName?: string;
    newContent: string;
    diff: string;
    originalHash?: string;
    pendingWrites?: Array<{ filePath: string; newContent: string }>;
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

    this.pending.set(token, {
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
    });

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
   */
  consumePending(token: string): PendingOperation | null {
    this.cleanup();

    const op = this.pending.get(token);
    if (!op) return null;

    if (Date.now() > op.expiresAt) {
      this.pending.delete(token);
      return null;
    }

    this.pending.delete(token);
    return op;
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
}

/**
 * Global confirmation store instance
 */
export const globalConfirmationStore = new ConfirmationStore();
