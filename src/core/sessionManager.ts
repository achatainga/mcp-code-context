/**
 * Session Manager - v3.7.0
 * Manages per-MCP-client state isolation
 * Prevents state leakage between concurrent clients
 */

import { FileLockManager } from "../utils/fileLock.js";
import { ConfirmationStore } from "../operations/confirmationStore.js";
import { RateLimiter } from "../utils/rateLimiter.js";
import { CacheManager } from "./cacheManager.js";
import * as crypto from "node:crypto";

interface CacheEntry {
  cache: CacheManager;
  lastUsed: number;
}

interface SessionState {
  sessionId: string;
  lockManager: FileLockManager;
  confirmationStore: ConfirmationStore;
  rateLimiter: RateLimiter;
  cacheManagers: Map<string, CacheEntry>;
  createdAt: number;
  lastActivity: number;
}

export interface SessionStats {
  exists: boolean;
  sessionId?: string;
  createdAt?: number;
  lastActivity?: number;
  pendingOperations: number;
  locksHeld: number;
  rateLimiterTokens: number;
  cacheManagers: number;
}

export interface PendingOperationSummary {
  token: string;
  filePath: string;
  operation: string;
  createdAt: number;
  expiresAt: number;
}

const MAX_CACHE_MANAGERS = 10;
const SESSION_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

/**
 * SessionManager - Manages isolated state per MCP client connection
 * 
 * Each MCP client connection gets:
 * - Dedicated FileLockManager (no lock conflicts)
 * - Dedicated ConfirmationStore (no token leakage)
 * - Dedicated RateLimiter bucket (fair quota)
 * - Dedicated CacheManager pool (no cache pollution)
 */
export class SessionManager {
  private sessions: Map<string, SessionState> = new Map();
  private cleanupTimer: NodeJS.Timeout | null = null;

  constructor() {
    this.startCleanupTimer();
  }

  /**
   * Get or create session state for a client
   * 
   * @param sessionId - Unique identifier for MCP client connection
   * @returns Isolated session state
   */
  getOrCreate(sessionId: string, projectRoot?: string): SessionState {
    let session = this.sessions.get(sessionId);

    if (!session) {
      session = {
        sessionId,
        lockManager: new FileLockManager(),
        // Pass sessionId + projectRoot so SQLite crash recovery activates
        confirmationStore: new ConfirmationStore(sessionId, projectRoot),
        rateLimiter: new RateLimiter(),
        cacheManagers: new Map(),
        createdAt: Date.now(),
        lastActivity: Date.now(),
      };
      this.sessions.set(sessionId, session);
    } else if (projectRoot && !session.confirmationStore.hasPersistentStore()) {
      // Session existed but was created without projectRoot — activate SQLite now
      session.confirmationStore.activatePersistence(sessionId, projectRoot);
    }

    session.lastActivity = Date.now();
    return session;
  }

  /**
   * Get CacheManager for a project within this session
   * 
   * @param sessionId - Session identifier
   * @param projectRoot - Project root path
   * @returns CacheManager instance
   */
  getCacheManager(sessionId: string, projectRoot: string): CacheManager {
    // Pass projectRoot so crash recovery SQLite activates on first real tool call
    const session = this.getOrCreate(sessionId, projectRoot);
    const now = Date.now();

    if (session.cacheManagers.has(projectRoot)) {
      const entry = session.cacheManagers.get(projectRoot)!;
      entry.lastUsed = now;
      return entry.cache;
    }

    // Evict LRU if at capacity
    if (session.cacheManagers.size >= MAX_CACHE_MANAGERS) {
      let oldestKey: string | null = null;
      let oldestTime = Infinity;

      for (const [key, entry] of session.cacheManagers.entries()) {
        if (entry.lastUsed < oldestTime) {
          oldestTime = entry.lastUsed;
          oldestKey = key;
        }
      }

      if (oldestKey) {
        const evicted = session.cacheManagers.get(oldestKey)!;
        evicted.cache.persistOnExit();
        evicted.cache.close();
        session.cacheManagers.delete(oldestKey);
      }
    }

    const cache = new CacheManager(projectRoot);
    session.cacheManagers.set(projectRoot, { cache, lastUsed: now });
    return cache;
  }

  /**
   * Cleanup session and release all resources
   * 
   * @param sessionId - Session to cleanup
   */
  async cleanup(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    // Release all file locks
    await session.lockManager.releaseAll();

    // Stop rate limiter timer
    session.rateLimiter.stop();

    // Close all cache managers (persist + stop watchers + free WASM heap)
    for (const entry of session.cacheManagers.values()) {
      entry.cache.persistOnExit();
      entry.cache.close();
    }
    session.cacheManagers.clear();

    // Clear confirmation store
    session.confirmationStore.clearAll();

    this.sessions.delete(sessionId);
  }

  /**
   * Get stats for a specific session
   * 
   * @param sessionId - Session identifier
   * @returns Session statistics
   */
  getSessionStats(sessionId: string): SessionStats {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return {
        exists: false,
        pendingOperations: 0,
        locksHeld: 0,
        rateLimiterTokens: 0,
        cacheManagers: 0,
      };
    }

    return {
      exists: true,
      sessionId: session.sessionId,
      createdAt: session.createdAt,
      lastActivity: session.lastActivity,
      pendingOperations: session.confirmationStore.getPendingCount(),
      locksHeld: session.lockManager.getActiveLockCount(),
      rateLimiterTokens: session.rateLimiter.getTokens(sessionId),
      cacheManagers: session.cacheManagers.size,
    };
  }

  /**
   * Clear cache for a specific session
   * 
   * @param sessionId - Session identifier
   * @param projectRoot - Project root path
   * @returns Number of cache entries cleared
   */
  async clearSessionCache(sessionId: string, projectRoot?: string): Promise<number> {
    const session = this.sessions.get(sessionId);
    if (!session) return 0;

    if (projectRoot) {
      const entry = session.cacheManagers.get(projectRoot);
      if (entry) {
        await entry.cache.clear();
        return 1;
      }
      return 0;
    }

    // Clear all caches for this session
    let cleared = 0;
    for (const entry of session.cacheManagers.values()) {
      await entry.cache.clear();
      cleared++;
    }
    return cleared;
  }

  /**
   * List all pending operations for a session
   * 
   * @param sessionId - Session identifier
   * @returns Array of pending operations
   */
  listPendingOperations(sessionId: string): PendingOperationSummary[] {
    const session = this.sessions.get(sessionId);
    if (!session) return [];

    return session.confirmationStore.listAll();
  }

  /**
   * Get count of active sessions
   */
  getActiveSessionCount(): number {
    return this.sessions.size;
  }

  /**
   * Auto-cleanup inactive sessions
   */
  private startCleanupTimer(): void {
    this.cleanupTimer = setInterval(async () => {
      const now = Date.now();
      const toCleanup: string[] = [];

      for (const [sessionId, session] of this.sessions.entries()) {
        const inactive = now - session.lastActivity;
        if (inactive > SESSION_TIMEOUT_MS) {
          toCleanup.push(sessionId);
        }
      }

      for (const sessionId of toCleanup) {
        await this.cleanup(sessionId);
      }
    }, 60 * 1000); // Check every minute
    if (this.cleanupTimer.unref) {
      this.cleanupTimer.unref();
    }
  }

  /**
   * Stop cleanup timer
   */
  stop(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  /**
   * Cleanup all sessions on shutdown
   */
  async shutdownAll(): Promise<void> {
    this.stop();
    const sessionIds = Array.from(this.sessions.keys());
    await Promise.all(sessionIds.map(id => this.cleanup(id)));
  }
}

/**
 * Global session manager instance
 */
export const globalSessionManager = new SessionManager();
