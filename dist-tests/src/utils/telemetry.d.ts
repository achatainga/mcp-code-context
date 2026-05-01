/**
 * Telemetry - v3.5.3
 * Metrics collection and monitoring
 */
export interface Metric {
    name: string;
    value: number;
    timestamp: number;
    tags?: Record<string, string>;
}
export interface OperationMetrics {
    toolName: string;
    duration: number;
    success: boolean;
    error?: string;
    clientId?: string;
    timestamp: number;
}
export declare class TelemetryCollector {
    private metrics;
    private operations;
    private readonly maxMetrics;
    private readonly maxOperations;
    constructor(maxMetrics?: number, maxOperations?: number);
    /**
     * Record a metric
     */
    recordMetric(name: string, value: number, tags?: Record<string, string>): void;
    /**
     * Record operation execution
     */
    recordOperation(metrics: Omit<OperationMetrics, "timestamp">): void;
    /**
     * Get metrics summary
     */
    getSummary(): {
        totalOperations: number;
        successRate: number;
        averageDuration: number;
        errorRate: number;
        operationsByTool: Record<string, number>;
        recentErrors: Array<{
            tool: string;
            error: string;
            timestamp: number;
        }>;
    };
    /**
     * Get metrics for specific tool
     */
    getToolMetrics(toolName: string): {
        count: number;
        successRate: number;
        averageDuration: number;
        p50Duration: number;
        p95Duration: number;
        p99Duration: number;
    };
    /**
     * Get cache hit rate (if applicable)
     */
    getCacheMetrics(): {
        hits: number;
        misses: number;
        hitRate: number;
    };
    /**
     * Export metrics (for external monitoring)
     */
    exportMetrics(): {
        metrics: Metric[];
        operations: OperationMetrics[];
        summary: ReturnType<TelemetryCollector["getSummary"]>;
    };
    /**
     * Clear all metrics
     */
    clear(): void;
    /**
     * Get metrics in Prometheus format
     */
    toPrometheus(): string;
}
/**
 * Global telemetry instance
 */
export declare const globalTelemetry: TelemetryCollector;
/**
 * Helper to track operation duration
 */
export declare function trackOperation<T>(toolName: string, operation: () => Promise<T>): Promise<T>;
