/** Pending Operation Store - SQLite crash recovery */

import type { Database } from "sql.js";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { getAppDir } from "../utils/appDir.js";
import { openPendingDatabase } from "./pendingStoreInit.js";

export interface PendingOperation {
  token: string;
  sessionId: string;
  filePath: string;
  operation: string;
  symbolName?: string;
  newContent: string;
  diff: string;
  createdAt: number;
  expiresAt: number;
  originalHash?: string;
  pendingWrites?: string; // JSON serialized
}

interface PendingOperationRow {
  token: string;
  session_id: string;
  file_path: string;
  operation: string;
  symbol_name: string | null;
  new_content: string;
  diff: string;
  created_at: number;
  expires_at: number;
  original_hash: string | null;
  pending_writes: string | null;
}

interface PendingOperationSummaryRow {
  token: string;
  file_path: string;
  operation: string;
  created_at: number;
  expires_at: number;
}

const EXPIRY_MS = 5 * 60 * 1000;

/** SQLite-backed pending operation store */
export class PendingOperationStore {
  private db: Database | null = null;
  private projectRoot: string;
  private dbPath: string;
  private initialized: boolean = false;

  constructor(projectRoot: string) {
    this.projectRoot = projectRoot;
    const projectHash = crypto.createHash('sha256')
      .update(projectRoot)
      .digest('hex')
      .substring(0, 8);

    this.dbPath = path.join(getAppDir(`pending/${projectHash}`), 'pending.db');
  }

  private async init(): Promise<void> {
    if (this.initialized) return;
    this.db = await openPendingDatabase(this.dbPath);
    this.initialized = true;
    this.cleanup();
  }

  private async persist(): Promise<void> {
    if (!this.db) return;

    const data = this.db.export();
    await fs.mkdir(path.dirname(this.dbPath), { recursive: true });
    const tmpPath = `${this.dbPath}.tmp`;
    await fs.writeFile(tmpPath, data);
    await fs.rename(tmpPath, this.dbPath);
  }

  async storePending(sessionId: string, token: string, params: {
    filePath: string;
    operation: string;
    symbolName?: string;
    newContent: string;
    diff: string;
    originalHash?: string;
    pendingWrites?: Array<{ filePath: string; newContent: string }>;
  }): Promise<void> {
    await this.init();
    if (!this.db) throw new Error("Database not initialized");

    this.cleanup();

    // Invalidate conflicting operations (same file)
    const normalizedPath = this.normalizePath(params.filePath);
    this.db.run(`
      DELETE FROM pending_operations 
      WHERE file_path = ? OR pending_writes LIKE ?
    `, [normalizedPath, `%"${normalizedPath}"%`]);

    const now = Date.now();

    this.db.run(`
      INSERT INTO pending_operations (
        token, session_id, file_path, operation, symbol_name,
        new_content, diff, created_at, expires_at, original_hash, pending_writes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      token,
      sessionId,
      normalizedPath,
      params.operation,
      params.symbolName || null,
      params.newContent,
      params.diff,
      now,
      now + EXPIRY_MS,
      params.originalHash || null,
      params.pendingWrites ? JSON.stringify(params.pendingWrites) : null
    ]);

    await this.persist();
  }

  async consumePending(token: string): Promise<PendingOperation | null> {
    await this.init();
    if (!this.db) return null;

    this.cleanup();

    const stmt = this.db.prepare(`
      SELECT * FROM pending_operations WHERE token = ?
    `);
    stmt.bind([token]);
    
    let row: PendingOperationRow | null = null;
    if (stmt.step()) {
      row = stmt.getAsObject() as unknown as PendingOperationRow;
    }
    stmt.free();

    if (!row) return null;

    if (Date.now() > row.expires_at) {
      this.db.run(`DELETE FROM pending_operations WHERE token = ?`, [token]);
      await this.persist();
      return null;
    }

    // Delete after retrieval (consume)
    this.db.run(`DELETE FROM pending_operations WHERE token = ?`, [token]);
    await this.persist();

    return {
      token: row.token as string,
      sessionId: row.session_id as string,
      filePath: row.file_path as string,
      operation: row.operation as string,
      symbolName: (row.symbol_name as string) || undefined,
      newContent: row.new_content as string,
      diff: row.diff as string,
      createdAt: row.created_at as number,
      expiresAt: row.expires_at as number,
      originalHash: (row.original_hash as string) || undefined,
      pendingWrites: (row.pending_writes as string) || undefined,
    };
  }

  async listPendingForSession(sessionId: string): Promise<Array<{
    token: string;
    filePath: string;
    operation: string;
    createdAt: number;
    expiresAt: number;
  }>> {
    await this.init();
    if (!this.db) return [];

    this.cleanup();

    const stmt = this.db.prepare(`
      SELECT token, file_path, operation, created_at, expires_at
      FROM pending_operations
      WHERE session_id = ? AND expires_at > ?
      ORDER BY created_at DESC
    `);
    stmt.bind([sessionId, Date.now()]);

    const results: PendingOperationSummaryRow[] = [];
    while (stmt.step()) {
      results.push(stmt.getAsObject() as unknown as PendingOperationSummaryRow);
    }
    stmt.free();

    return results.map((row) => ({
      token: row.token,
      filePath: row.file_path,
      operation: row.operation,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
    }));
  }

  async hasConflictingPending(filePath: string): Promise<boolean> {
    await this.init();
    if (!this.db) return false;

    this.cleanup();
    const normalizedPath = this.normalizePath(filePath);

    const stmt = this.db.prepare(`
      SELECT COUNT(*) as count FROM pending_operations
      WHERE (file_path = ? OR pending_writes LIKE ?) AND expires_at > ?
    `);
    stmt.bind([normalizedPath, `%"${normalizedPath}"%`, Date.now()]);
    
    let count = 0;
    if (stmt.step()) {
      const row = stmt.getAsObject();
      count = row.count as number;
    }
    stmt.free();

    return count > 0;
  }

  async getPendingCount(sessionId: string): Promise<number> {
    await this.init();
    if (!this.db) return 0;

    this.cleanup();

    const stmt = this.db.prepare(`
      SELECT COUNT(*) as count FROM pending_operations
      WHERE session_id = ? AND expires_at > ?
    `);
    stmt.bind([sessionId, Date.now()]);
    
    let count = 0;
    if (stmt.step()) {
      const row = stmt.getAsObject();
      count = row.count as number;
    }
    stmt.free();

    return count;
  }

  async clearSession(sessionId: string): Promise<void> {
    await this.init();
    if (!this.db) return;

    this.db.run(`DELETE FROM pending_operations WHERE session_id = ?`, [sessionId]);
    await this.persist();
  }

  async clearAll(): Promise<void> {
    await this.init();
    if (!this.db) return;

    this.db.run(`DELETE FROM pending_operations`);
    await this.persist();
  }

  private cleanup(): void {
    if (!this.db) return;
    const now = Date.now();
    this.db.run(`DELETE FROM pending_operations WHERE expires_at < ?`, [now]);
  }

  private normalizePath(filePath: string): string {
    return filePath.replace(/\\/g, '/').toLowerCase();
  }

  async close(): Promise<void> {
    if (this.db) {
      await this.persist();
      this.db.close();
      this.db = null;
    }
  }
}
