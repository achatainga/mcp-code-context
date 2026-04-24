/**
 * Audit Logger - v3.5.0
 * Comprehensive audit trail for all operations
 */
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
    maxFileSize: number;
    maxFiles: number;
    enableConsole: boolean;
    enableFile: boolean;
}
export declare class AuditLogger {
    private config;
    private currentLogFile;
    private currentLogSize;
    private logBuffer;
    private flushInterval;
    private _ready;
    constructor(config?: Partial<AuditLogConfig>);
    /**
     * Log an audit entry
     */
    log(entry: Omit<AuditEntry, "timestamp">): Promise<void>;
    /**
     * Log security event
     */
    logSecurity(operation: string, details: Record<string, any>, result: "success" | "failure", error?: string): Promise<void>;
    /**
     * Log write operation
     */
    logWrite(operation: string, filePath: string, clientId: string, result: "success" | "failure", details?: Record<string, any>, error?: string): Promise<void>;
    /**
     * Log read operation
     */
    logRead(operation: string, filePath: string, clientId: string, duration: number, result: "success" | "failure", error?: string): Promise<void>;
    /**
     * Flush buffer to file
     */
    flush(): Promise<void>;
    /**
     * Query audit logs
     */
    query(filters: {
        startTime?: number;
        endTime?: number;
        level?: AuditEntry["level"];
        operation?: string;
        clientId?: string;
        result?: "success" | "failure";
        limit?: number;
    }): Promise<AuditEntry[]>;
    /**
     * Get audit statistics
     */
    getStats(timeRange?: {
        start: number;
        end: number;
    }): Promise<{
        totalEntries: number;
        byLevel: Record<string, number>;
        byOperation: Record<string, number>;
        byResult: Record<string, number>;
        securityEvents: number;
    }>;
    /**
     * Stop logger and flush
     */
    stop(): Promise<void>;
    private initLogDir;
    private ensureLogFile;
    private rotateLog;
    private getLogFiles;
    private logToConsole;
    private startFlushInterval;
}
/**
 * Global audit logger instance
 */
export declare const globalAuditLogger: AuditLogger;
