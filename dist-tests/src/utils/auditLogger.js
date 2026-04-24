/**
 * Audit Logger - v3.4.0
 * Comprehensive audit trail for all operations
 */
import * as fs from "node:fs/promises";
import * as path from "node:path";
export class AuditLogger {
    config;
    currentLogFile = null;
    currentLogSize = 0;
    logBuffer = [];
    flushInterval = null;
    _ready = Promise.resolve();
    constructor(config = {}) {
        this.config = {
            logDir: config.logDir || "./.mcp-audit-logs",
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
    async log(entry) {
        const fullEntry = {
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
    async logSecurity(operation, details, result, error) {
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
    async logWrite(operation, filePath, clientId, result, details = {}, error) {
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
    async logRead(operation, filePath, clientId, duration, result, error) {
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
    async flush() {
        if (this.logBuffer.length === 0)
            return;
        await this._ready;
        try {
            await this.ensureLogFile();
            const logLines = this.logBuffer.map((entry) => JSON.stringify(entry)).join("\n") + "\n";
            const logSize = Buffer.byteLength(logLines, "utf-8");
            await fs.appendFile(this.currentLogFile, logLines, "utf-8");
            this.currentLogSize += logSize;
            this.logBuffer = [];
            // Rotate if needed
            if (this.currentLogSize >= this.config.maxFileSize) {
                await this.rotateLog();
            }
        }
        catch (error) {
            console.error("Failed to flush audit log:", error);
        }
    }
    /**
     * Query audit logs
     */
    async query(filters) {
        const results = [];
        const limit = filters.limit || 1000;
        try {
            const files = await this.getLogFiles();
            for (const file of files.reverse()) {
                if (results.length >= limit)
                    break;
                const content = await fs.readFile(file, "utf-8");
                const lines = content.split("\n").filter((line) => line.trim());
                for (const line of lines.reverse()) {
                    if (results.length >= limit)
                        break;
                    try {
                        const entry = JSON.parse(line);
                        // Apply filters
                        if (filters.startTime && entry.timestamp < filters.startTime)
                            continue;
                        if (filters.endTime && entry.timestamp > filters.endTime)
                            continue;
                        if (filters.level && entry.level !== filters.level)
                            continue;
                        if (filters.operation && entry.operation !== filters.operation)
                            continue;
                        if (filters.clientId && entry.clientId !== filters.clientId)
                            continue;
                        if (filters.result && entry.result !== filters.result)
                            continue;
                        results.push(entry);
                    }
                    catch {
                        // Skip invalid lines
                    }
                }
            }
        }
        catch (error) {
            console.error("Failed to query audit logs:", error);
        }
        return results;
    }
    /**
     * Get audit statistics
     */
    async getStats(timeRange) {
        const entries = await this.query({
            startTime: timeRange?.start,
            endTime: timeRange?.end,
            limit: 100000,
        });
        const stats = {
            totalEntries: entries.length,
            byLevel: {},
            byOperation: {},
            byResult: {},
            securityEvents: 0,
        };
        for (const entry of entries) {
            stats.byLevel[entry.level] = (stats.byLevel[entry.level] || 0) + 1;
            stats.byOperation[entry.operation] = (stats.byOperation[entry.operation] || 0) + 1;
            stats.byResult[entry.result] = (stats.byResult[entry.result] || 0) + 1;
            if (entry.level === "security") {
                stats.securityEvents++;
            }
        }
        return stats;
    }
    /**
     * Stop logger and flush
     */
    async stop() {
        if (this.flushInterval) {
            clearInterval(this.flushInterval);
            this.flushInterval = null;
        }
        await this.flush();
    }
    // Private methods
    async initLogDir() {
        try {
            await fs.mkdir(this.config.logDir, { recursive: true });
        }
        catch (error) {
            console.error("Failed to create audit log directory:", error);
        }
    }
    async ensureLogFile() {
        if (!this.currentLogFile) {
            const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
            this.currentLogFile = path.join(this.config.logDir, `audit-${timestamp}.log`);
            this.currentLogSize = 0;
        }
    }
    async rotateLog() {
        this.currentLogFile = null;
        this.currentLogSize = 0;
        // Cleanup old logs
        const files = await this.getLogFiles();
        if (files.length > this.config.maxFiles) {
            const toDelete = files.slice(0, files.length - this.config.maxFiles);
            for (const file of toDelete) {
                try {
                    await fs.unlink(file);
                }
                catch {
                    // Ignore errors
                }
            }
        }
    }
    async getLogFiles() {
        try {
            const entries = await fs.readdir(this.config.logDir);
            const files = entries
                .filter((name) => name.startsWith("audit-") && name.endsWith(".log"))
                .map((name) => path.join(this.config.logDir, name));
            // Sort by creation time
            const stats = await Promise.all(files.map(async (file) => ({
                file,
                mtime: (await fs.stat(file)).mtime.getTime(),
            })));
            return stats.sort((a, b) => a.mtime - b.mtime).map((s) => s.file);
        }
        catch {
            return [];
        }
    }
    logToConsole(entry) {
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
        }
        else {
            console.error(message);
        }
    }
    startFlushInterval() {
        this.flushInterval = setInterval(() => {
            this.flush().catch((error) => {
                console.error("Failed to flush audit log:", error);
            });
        }, 5000); // Flush every 5 seconds
    }
}
/**
 * Global audit logger instance
 */
export const globalAuditLogger = new AuditLogger();
//# sourceMappingURL=auditLogger.js.map