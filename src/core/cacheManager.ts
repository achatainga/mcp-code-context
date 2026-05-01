/**
 * Cache Manager - v3.6.0
 * WASM SQLite cache with debounced persistence
 */

import initSqlJs, { Database } from 'sql.js';
import * as fs from 'node:fs/promises';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import * as path from 'path';
import * as crypto from 'node:crypto';
import { tmpdir } from 'os';
import { logger } from '../utils/logger.js';
import { FileWatcher } from '../utils/fileWatcher.js';

export interface CachedFile {
  filePath: string;
  hash: string;
  symbols: any[];
  lastModified: number;
  cachedAt: number;
}

export class CacheManager {
  private db: Database | null = null;
  private dbPath: string;
  private cacheDir: string;
  private isDirty = false;
  private persistTimer: NodeJS.Timeout | null = null;
  private initPromise: Promise<void>;
  private watcher: FileWatcher | null = null;
  private projectRoot: string;

  constructor(projectRoot: string) {
    this.projectRoot = projectRoot;
    const projectHash = crypto.createHash('md5')
      .update(projectRoot)
      .digest('hex')
      .substring(0, 8);
    
    this.cacheDir = path.join(tmpdir(), 'mcp-cache', projectHash);
    this.dbPath = path.join(this.cacheDir, 'cache.db');
    
    // Initialize on construction
    this.initPromise = this.init();
    
    // Persist on process exit
    process.on('SIGINT', () => this.persistSync());
    process.on('SIGTERM', () => this.persistSync());
    process.on('exit', () => this.persistSync());
  }

  private async init(): Promise<void> {
    try {
      // Ensure cache directory exists (OS cleanup recovery)
      if (!existsSync(this.cacheDir)) {
        logger.warn({ cacheDir: this.cacheDir }, 'Cache directory deleted by OS, recreating');
        mkdirSync(this.cacheDir, { recursive: true });
      }

      const SQL = await initSqlJs();
      
      // Load existing database or create new
      if (existsSync(this.dbPath)) {
        const buffer = readFileSync(this.dbPath);
        this.db = new SQL.Database(buffer);
        logger.debug({ dbPath: this.dbPath }, 'Loaded existing cache database');
      } else {
        this.db = new SQL.Database();
        this.initSchema();
        logger.info({ dbPath: this.dbPath }, 'Created new cache database');
      }
    } catch (error) {
      logger.error({ error }, 'Failed to initialize cache');
      throw error;
    }
  }

  private initSchema(): void {
    if (!this.db) return;
    
    this.db.run(`
      CREATE TABLE IF NOT EXISTS file_cache (
        file_path TEXT PRIMARY KEY,
        hash TEXT NOT NULL,
        symbols TEXT NOT NULL,
        last_modified INTEGER NOT NULL,
        cached_at INTEGER NOT NULL
      )
    `);
    
    this.db.run(`
      CREATE INDEX IF NOT EXISTS idx_cached_at ON file_cache(cached_at)
    `);
  }

  async get(filePath: string, currentHash: string): Promise<CachedFile | null> {
    await this.initPromise;
    if (!this.db) return null;

    try {
      const stmt = this.db.prepare(
        'SELECT * FROM file_cache WHERE file_path = ? AND hash = ?'
      );
      stmt.bind([filePath, currentHash]);
      
      if (stmt.step()) {
        const row = stmt.getAsObject();
        stmt.free();
        
        return {
          filePath: row.file_path as string,
          hash: row.hash as string,
          symbols: JSON.parse(row.symbols as string),
          lastModified: row.last_modified as number,
          cachedAt: row.cached_at as number,
        };
      }
      
      stmt.free();
      return null;
    } catch (error) {
      logger.error({ error, filePath }, 'Cache get failed');
      return null;
    }
  }

  async set(file: CachedFile): Promise<void> {
    await this.initPromise;
    if (!this.db) return;

    try {
      this.db.run(
        `INSERT OR REPLACE INTO file_cache 
         (file_path, hash, symbols, last_modified, cached_at) 
         VALUES (?, ?, ?, ?, ?)`,
        [
          file.filePath,
          file.hash,
          JSON.stringify(file.symbols),
          file.lastModified,
          file.cachedAt,
        ]
      );
      
      this.isDirty = true;
      this.schedulePersist();
    } catch (error) {
      logger.error({ error, filePath: file.filePath }, 'Cache set failed');
    }
  }

  async invalidate(filePath: string): Promise<void> {
    await this.initPromise;
    if (!this.db) return;

    try {
      this.db.run('DELETE FROM file_cache WHERE file_path = ?', [filePath]);
      this.isDirty = true;
      this.schedulePersist();
    } catch (error) {
      logger.error({ error, filePath }, 'Cache invalidate failed');
    }
  }

  async clear(): Promise<void> {
    await this.initPromise;
    if (!this.db) return;

    try {
      this.db.run('DELETE FROM file_cache');
      this.isDirty = true;
      await this.persist();
      logger.info('Cache cleared');
    } catch (error) {
      logger.error({ error }, 'Cache clear failed');
    }
  }

  async getStats(): Promise<{
    totalEntries: number;
    totalSize: number;
    oldestEntry: number | null;
    newestEntry: number | null;
  }> {
    await this.initPromise;
    if (!this.db) {
      return { totalEntries: 0, totalSize: 0, oldestEntry: null, newestEntry: null };
    }

    try {
      const stmt = this.db.prepare(`
        SELECT 
          COUNT(*) as count,
          MIN(cached_at) as oldest,
          MAX(cached_at) as newest
        FROM file_cache
      `);
      
      stmt.step();
      const row = stmt.getAsObject();
      stmt.free();
      
      const totalSize = existsSync(this.dbPath)
        ? (await fs.stat(this.dbPath)).size
        : 0;
      
      return {
        totalEntries: row.count as number,
        totalSize,
        oldestEntry: row.oldest as number | null,
        newestEntry: row.newest as number | null,
      };
    } catch (error) {
      logger.error({ error }, 'Failed to get cache stats');
      return { totalEntries: 0, totalSize: 0, oldestEntry: null, newestEntry: null };
    }
  }

  private schedulePersist(): void {
    if (this.persistTimer) clearTimeout(this.persistTimer);
    this.persistTimer = setTimeout(() => this.persist(), 5000);
  }

  private async persist(): Promise<void> {
    if (!this.isDirty || !this.db) return;

    try {
      const data = this.db.export();
      const buffer = Buffer.from(data);
      await fs.writeFile(this.dbPath, buffer);
      this.isDirty = false;
      logger.debug({ dbPath: this.dbPath, size: buffer.length }, 'Cache persisted');
    } catch (error) {
      logger.error({ error }, 'Failed to persist cache');
    }
  }

  private persistSync(): void {
    if (!this.isDirty || !this.db) return;

    try {
      const data = this.db.export();
      const buffer = Buffer.from(data);
      writeFileSync(this.dbPath, buffer);
      this.isDirty = false;
    } catch (error) {
      console.error('Failed to persist cache on exit:', error);
    }
  }

  async close(): Promise<void> {
    if (this.watcher) {
      this.watcher.stop();
      this.watcher = null;
    }
    
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

  startWatcher(debounceMs: number = 500): void {
    if (this.watcher) {
      logger.warn({ projectRoot: this.projectRoot }, 'Watcher already started');
      return;
    }

    this.watcher = new FileWatcher({
      debounceMs,
      ignored: [],
      onFileChange: async (filePath) => {
        await this.invalidate(filePath);
        logger.debug({ filePath }, 'Cache invalidated by file watcher');
      },
    });

    this.watcher.start(this.projectRoot);
  }

  stopWatcher(): void {
    if (this.watcher) {
      this.watcher.stop();
      this.watcher = null;
    }
  }

  getWatcherStatus(): { isWatching: boolean; watchedFiles: number } {
    return this.watcher ? this.watcher.getStatus() : { isWatching: false, watchedFiles: 0 };
  }
}
