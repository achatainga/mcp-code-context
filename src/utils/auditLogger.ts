/**
 * Audit Logger - v3.9.0
 * Comprehensive audit trail for all operations
 */

import * as fs from "node:fs/promises";
import { LOG_DIR } from "./logger.js";
import {
  initLogDir as initAuditLogDir,
  ensureLogFile as ensureAuditLogFile,
  rotateLog as rotateAuditLog,
  getLogFiles as getAuditLogFiles,
} from "./auditLogWriter.js";
import { queryAuditLogs, getAuditStats } from "./auditQuery.js";

export interface AuditEntry {
  timestamp: number;
  level: "info" | "warn" | "error" | "security";
  operation: string;
  clientId?: string;
  filePath?: string;
  details: Record<string, any>;
  result: "success" | "failure";
  error?: string;
  duration?: number;
}

export interface AuditLogConfig {
  logDir: string;
  maxFileSize: number; // bytes
  maxFiles: number;
  enableConsole: boolean;
  enableFile: boolean;
}

export class AuditLogger {
  private config: AuditLogConfig;
  private currentLogFile: string | null = null;
  private currentLogSize: number = 0;
  private logBuffer: AuditEntry[] = [];
  private flushInterval: NodeJS.Timeout | null = null;

  private _ready: Promise<void> = Promise.resolve();

  constructor(config: Partial<AuditLogConfig> = {}) {
    this.config = {
      logDir: config.logDir || LOG_DIR,
      maxFileSize: config.maxFileSize || 10 * 1024 * 1024, // 10MB
      maxFiles: config.maxFiles || 10,
      enableConsole: config.enableConsole ?? true,
      enableFile: config.enableFile ?? true,
    };

    if (this.config.enableFile) {
      // Properly await dir creation before any writes
      this._ready = this.initLogDir();
      this.startFlushInterval();
    }
  }

  /**
   * Log an audit entry
   */
  async log(entry: Omit<AuditEntry, "timestamp">): Promise<void> {
    const fullEntry: AuditEntry = {
      ...entry,
      timestamp: Date.now(),
    };

    // Console output
    if (this.config.enableConsole) {
      this.logToConsole(fullEntry);
    }

    // File output
    if (this.config.enableFile) {
      this.logBuffer.push(fullEntry);
      
      // Flush if buffer is large
      if (this.logBuffer.length >= 100) {
        await this.flush();
      }
    }
  }

  /**
   * Log security event
   */
  async logSecurity(
    operation: string,
    details: Record<string, any>,
    result: "success" | "failure",
    error?: string
  ): Promise<void> {
    await this.log({
      level: "security",
      operation,
      details,
      result,
      error,
    });
  }

  /**
   * Log write operation
   */
  async logWrite(
    operation: string,
    filePath: string,
    clientId: string,
    result: "success" | "failure",
    details: Record<string, any> = {},
    error?: string
  ): Promise<void> {
    await this.log({
      level: result === "success" ? "info" : "error",
      operation,
      clientId,
      filePath,
      details,
      result,
      error,
    });
  }

  /**
   * Log read operation
   */
  async logRead(
    operation: string,
    filePath: string,
    clientId: string,
    duration: number,
    result: "success" | "failure",
    error?: string
  ): Promise<void> {
    await this.log({
      level: "info",
      operation,
      clientId,
      filePath,
      details: {},
      result,
      error,
      duration,
    });
  }

  /**
   * Flush buffer to file
   */
  async flush(): Promise<void> {
    if (this.logBuffer.length === 0) return;
    await this._ready;

    try {
      await this.ensureLogFile();
      
      const logLines = this.logBuffer.map((entry) => JSON.stringify(entry)).join("\n") + "\n";
      const logSize = Buffer.byteLength(logLines, "utf-8");

      await fs.appendFile(this.currentLogFile!, logLines, "utf-8");
      this.currentLogSize += logSize;

      this.logBuffer = [];

      // Rotate if needed
      if (this.currentLogSize >= this.config.maxFileSize) {
        await this.rotateLog();
      }
    } catch (error) {
      console.error("Failed to flush audit log:", error);
    }
  }

  async query(filters: {
    startTime?: number;
    endTime?: number;
    level?: AuditEntry["level"];
    operation?: string;
    clientId?: string;
    result?: "success" | "failure";
    limit?: number;
  }): Promise<AuditEntry[]> {
    return queryAuditLogs(this.config.logDir, filters);
  }

  async getStats(timeRange?: { start: number; end: number }) {
    return getAuditStats(this.config.logDir, timeRange);
  }

  async stop(): Promise<void> {
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
      this.flushInterval = null;
    }
    await this.flush();
  }

  private async initLogDir(): Promise<void> {
    await initAuditLogDir(this.config.logDir);
  }

  private async ensureLogFile(): Promise<void> {
    if (!this.currentLogFile) {
      const { file } = await ensureAuditLogFile(this.config.logDir, this.currentLogFile);
      this.currentLogFile = file;
      this.currentLogSize = 0;
    }
  }

  private async rotateLog(): Promise<void> {
    this.currentLogFile = null;
    this.currentLogSize = 0;
    await rotateAuditLog(this.config.logDir, this.config.maxFiles);
  }

  private async getLogFiles(): Promise<string[]> {
    return getAuditLogFiles(this.config.logDir);
  }

  private logToConsole(entry: AuditEntry): void {
    const emoji = {
      info: "ℹ️",
      warn: "⚠️",
      error: "❌",
      security: "🔒",
    }[entry.level];

    const timestamp = new Date(entry.timestamp).toISOString();
    const message = `${emoji} [${timestamp}] ${entry.operation} - ${entry.result}`;

    if (entry.level === "error" || entry.level === "security") {
      console.error(message, entry.error || "");
    } else {
      console.error(message);
    }
  }

  private startFlushInterval(): void {
    this.flushInterval = setInterval(() => {
      this.flush().catch((error) => {
        console.error("Failed to flush audit log:", error);
      });
    }, 5000); // Flush every 5 seconds
    if (this.flushInterval.unref) {
      this.flushInterval.unref();
    }
  }
}

/**
 * Global audit logger instance
 */
export const globalAuditLogger = new AuditLogger();
