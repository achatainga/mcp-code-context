/**
 * Index Manager - v3.8.1
 * Persistent symbol index and dependency graph in ~/.mcp-code-context/index/
 * Enables O(1) search_symbols and analyze_impact queries.
 */

import initSqlJs, { Database } from "sql.js";
import * as fs from "node:fs/promises";
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from "fs";
import * as path from "path";
import * as crypto from "node:crypto";
import { logger } from "../utils/logger.js";
import { getAppDir } from "../utils/appDir.js";
import type { SymbolInfo } from "../parsers/base.js";
import {
  searchSymbolsInDb,
  getDependentsFromDb,
  getDependenciesFromDb,
  hasIndexInDb,
  getIndexStatsFromDb,
} from "./indexManagerQueries.js";

export interface IndexedSymbol {
  filePath: string;
  name: string;
  type: string;
  startLine: number;
  endLine: number;
  className?: string;
}

export interface IndexStats {
  filesIndexed: number;
  symbolsIndexed: number;
  dependenciesIndexed: number;
  dbSizeBytes: number;
  lastIndexedAt: number | null;
}

export class IndexManager {
  private db: Database | null = null;
  private dbPath: string;
  private indexDir: string;
  private isDirty = false;
  private persistTimer: NodeJS.Timeout | null = null;
  private initPromise: Promise<void>;

  constructor(projectRoot: string) {
    const projectHash = crypto
      .createHash("sha256")
      .update(projectRoot)
      .digest("hex")
      .substring(0, 8);

    this.indexDir = getAppDir(`index/${projectHash}`);
    this.dbPath = path.join(this.indexDir, "index.db");
    this.initPromise = this.init();
  }

  private async init(): Promise<void> {
    try {
      if (!existsSync(this.indexDir)) {
        mkdirSync(this.indexDir, { recursive: true });
      }

      const SQL = await initSqlJs();

      if (existsSync(this.dbPath)) {
        const buffer = readFileSync(this.dbPath);
        this.db = new SQL.Database(buffer);
        logger.debug({ dbPath: this.dbPath }, "Loaded existing index database");
      } else {
        this.db = new SQL.Database();
        this.initSchema();
        logger.info({ dbPath: this.dbPath }, "Created new index database");
      }
    } catch (error) {
      logger.error({ error }, "Failed to initialize index");
      throw error;
    }
  }

  private initSchema(): void {
    if (!this.db) return;

    this.db.run(`
      CREATE TABLE IF NOT EXISTS files (
        file_path   TEXT PRIMARY KEY,
        file_hash   TEXT NOT NULL,
        indexed_at  INTEGER NOT NULL
      )
    `);

    this.db.run(`
      CREATE TABLE IF NOT EXISTS symbols (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        file_path   TEXT NOT NULL,
        name        TEXT NOT NULL,
        type        TEXT NOT NULL,
        start_line  INTEGER NOT NULL DEFAULT 0,
        end_line    INTEGER NOT NULL DEFAULT 0,
        class_name  TEXT,
        FOREIGN KEY (file_path) REFERENCES files(file_path) ON DELETE CASCADE
      )
    `);

    this.db.run(`CREATE INDEX IF NOT EXISTS idx_symbols_name      ON symbols(name)`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_symbols_file      ON symbols(file_path)`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_symbols_name_lower ON symbols(LOWER(name))`);

    this.db.run(`
      CREATE TABLE IF NOT EXISTS dependencies (
        from_file   TEXT NOT NULL,
        to_file     TEXT NOT NULL,
        import_stmt TEXT,
        PRIMARY KEY (from_file, to_file)
      )
    `);

    this.db.run(`CREATE INDEX IF NOT EXISTS idx_deps_from ON dependencies(from_file)`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_deps_to   ON dependencies(to_file)`);
  }

  // ── Public API ────────────────────────────────────────────────────────────

  /**
   * Check if a file needs re-indexing based on its hash.
   */
  async isStale(filePath: string, currentHash: string): Promise<boolean> {
    await this.initPromise;
    if (!this.db) return true;

    const stmt = this.db.prepare(
      "SELECT file_hash FROM files WHERE file_path = ?"
    );
    stmt.bind([filePath]);
    const exists = stmt.step();
    const row = exists ? (stmt.getAsObject() as { file_hash: string }) : null;
    stmt.free();

    return !row || row.file_hash !== currentHash;
  }

  /**
   * Index a single file: upsert symbols and dependencies atomically.
   */
  async indexFile(
    filePath: string,
    fileHash: string,
    symbols: SymbolInfo[],
    dependencies: string[]
  ): Promise<void> {
    await this.initPromise;
    if (!this.db) return;

    try {
      this.db.run("BEGIN");

      // Upsert file record
      this.db.run(
        "INSERT OR REPLACE INTO files (file_path, file_hash, indexed_at) VALUES (?, ?, ?)",
        [filePath, fileHash, Date.now()]
      );

      // Delete old symbols for this file
      this.db.run("DELETE FROM symbols WHERE file_path = ?", [filePath]);

      // Insert new symbols
      const symStmt = this.db.prepare(
        `INSERT INTO symbols (file_path, name, type, start_line, end_line, class_name)
         VALUES (?, ?, ?, ?, ?, ?)`
      );
      for (const sym of symbols) {
        symStmt.run([
          filePath,
          sym.name,
          sym.type,
          sym.startLine ?? 0,
          sym.endLine ?? 0,
          sym.className ?? null,
        ]);
      }
      symStmt.free();

      // Delete old dependencies from this file
      this.db.run("DELETE FROM dependencies WHERE from_file = ?", [filePath]);

      // Insert new dependencies
      const depStmt = this.db.prepare(
        "INSERT OR IGNORE INTO dependencies (from_file, to_file) VALUES (?, ?)"
      );
      for (const dep of dependencies) {
        depStmt.run([filePath, dep]);
      }
      depStmt.free();

      this.db.run("COMMIT");
      this.isDirty = true;
      this.schedulePersist();
    } catch (error) {
      this.db.run("ROLLBACK");
      logger.error({ error, filePath }, "Failed to index file");
    }
  }

  /**
   * Remove a file from the index (called by file watcher on delete).
   */
  async removeFile(filePath: string): Promise<void> {
    await this.initPromise;
    if (!this.db) return;

    this.db.run("DELETE FROM files WHERE file_path = ?", [filePath]);
    this.db.run("DELETE FROM symbols WHERE file_path = ?", [filePath]);
    this.db.run("DELETE FROM dependencies WHERE from_file = ? OR to_file = ?", [
      filePath,
      filePath,
    ]);
    this.isDirty = true;
    this.schedulePersist();
  }

  async searchSymbols(
    query: string,
    options: { fuzzy?: boolean; types?: string[]; maxResults?: number } = {}
  ): Promise<IndexedSymbol[]> {
    await this.initPromise;
    if (!this.db) return [];
    return searchSymbolsInDb(this.db, query, options);
  }

  async getDependents(filePath: string): Promise<string[]> {
    await this.initPromise;
    if (!this.db) return [];
    return getDependentsFromDb(this.db, filePath);
  }

  async getDependencies(filePath: string): Promise<string[]> {
    await this.initPromise;
    if (!this.db) return [];
    return getDependenciesFromDb(this.db, filePath);
  }

  async hasIndex(): Promise<boolean> {
    await this.initPromise;
    if (!this.db) return false;
    return hasIndexInDb(this.db);
  }

  async getStats(): Promise<IndexStats> {
    await this.initPromise;
    if (!this.db) {
      return { filesIndexed: 0, symbolsIndexed: 0, dependenciesIndexed: 0, dbSizeBytes: 0, lastIndexedAt: null };
    }
    return getIndexStatsFromDb(this.db, this.dbPath);
  }

  async clear(): Promise<void> {
    await this.initPromise;
    if (!this.db) return;
    this.db.run("DELETE FROM dependencies");
    this.db.run("DELETE FROM symbols");
    this.db.run("DELETE FROM files");
    this.isDirty = true;
    await this.persist();
  }

  // ── Persistence ───────────────────────────────────────────────────────────

  private schedulePersist(): void {
    if (this.persistTimer) clearTimeout(this.persistTimer);
    this.persistTimer = setTimeout(() => this.persist(), 5000);
  }

  private async persist(): Promise<void> {
    if (!this.isDirty || !this.db) return;
    try {
      const data = this.db.export();
      const tmpPath = `${this.dbPath}.tmp`;
      await fs.writeFile(tmpPath, Buffer.from(data));
      await fs.rename(tmpPath, this.dbPath);
      this.isDirty = false;
      logger.debug({ dbPath: this.dbPath }, "Index persisted");
    } catch (error) {
      logger.error({ error }, "Failed to persist index");
    }
  }

  persistOnExit(): void {
    if (!this.isDirty || !this.db) return;
    try {
      const data = this.db.export();
      const tmpPath = `${this.dbPath}.tmp`;
      writeFileSync(tmpPath, Buffer.from(data));
      renameSync(tmpPath, this.dbPath);
      this.isDirty = false;
    } catch (error) {
      console.error("Failed to persist index on exit:", error);
    }
  }

  async close(): Promise<void> {
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
      this.persistTimer = null;
    }
    await this.persist();
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}
