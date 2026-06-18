/**
 * Telemetry - v3.7.1
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

export class TelemetryCollector {
  private metrics: Metric[] = [];
  private operations: OperationMetrics[] = [];
  private readonly maxMetrics: number;
  private readonly maxOperations: number;

  constructor(maxMetrics: number = 10000, maxOperations: number = 1000) {
    this.maxMetrics = maxMetrics;
    this.maxOperations = maxOperations;
  }

  /**
   * Record a metric
   */
  recordMetric(name: string, value: number, tags?: Record<string, string>): void {
    this.metrics.push({
      name,
      value,
      timestamp: Date.now(),
      tags,
    });

    // Cleanup old metrics
    if (this.metrics.length > this.maxMetrics) {
      this.metrics = this.metrics.slice(-this.maxMetrics);
    }
  }

  /**
   * Record operation execution
   */
  recordOperation(metrics: Omit<OperationMetrics, "timestamp">): void {
    this.operations.push({
      ...metrics,
      timestamp: Date.now(),
    });

    // Cleanup old operations
    if (this.operations.length > this.maxOperations) {
      this.operations = this.operations.slice(-this.maxOperations);
    }
  }

  /**
   * Get metrics summary
   */
  getSummary(): {
    totalOperations: number;
    successRate: number;
    averageDuration: number;
    errorRate: number;
    operationsByTool: Record<string, number>;
    recentErrors: Array<{ tool: string; error: string; timestamp: number }>;
  } {
    const total = this.operations.length;
    const successful = this.operations.filter((op) => op.success).length;
    const avgDuration =
      this.operations.reduce((sum, op) => sum + op.duration, 0) / total || 0;

    const operationsByTool: Record<string, number> = {};
    for (const op of this.operations) {
      operationsByTool[op.toolName] = (operationsByTool[op.toolName] || 0) + 1;
    }

    const recentErrors = this.operations
      .filter((op) => !op.success && op.error)
      .slice(-10)
      .map((op) => ({
        tool: op.toolName,
        error: op.error!,
        timestamp: op.timestamp,
      }));

    return {
      totalOperations: total,
      successRate: total > 0 ? (successful / total) * 100 : 0,
      averageDuration: avgDuration,
      errorRate: total > 0 ? ((total - successful) / total) * 100 : 0,
      operationsByTool,
      recentErrors,
    };
  }

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
  } {
    const toolOps = this.operations.filter((op) => op.toolName === toolName);
    const count = toolOps.length;

    if (count === 0) {
      return {
        count: 0,
        successRate: 0,
        averageDuration: 0,
        p50Duration: 0,
        p95Duration: 0,
        p99Duration: 0,
      };
    }

    const successful = toolOps.filter((op) => op.success).length;
    const durations = toolOps.map((op) => op.duration).sort((a, b) => a - b);

    return {
      count,
      successRate: (successful / count) * 100,
      averageDuration: durations.reduce((sum, d) => sum + d, 0) / count,
      p50Duration: durations[Math.floor(count * 0.5)],
      p95Duration: durations[Math.floor(count * 0.95)],
      p99Duration: durations[Math.floor(count * 0.99)],
    };
  }

  /**
   * Get cache hit rate (if applicable)
   */
  getCacheMetrics(): {
    hits: number;
    misses: number;
    hitRate: number;
  } {
    const cacheMetrics = this.metrics.filter((m) => m.name.startsWith("cache."));
    const hits = cacheMetrics.filter((m) => m.name === "cache.hit").length;
    const misses = cacheMetrics.filter((m) => m.name === "cache.miss").length;
    const total = hits + misses;

    return {
      hits,
      misses,
      hitRate: total > 0 ? (hits / total) * 100 : 0,
    };
  }

  /**
   * Export metrics (for external monitoring)
   */
  exportMetrics(): {
    metrics: Metric[];
    operations: OperationMetrics[];
    summary: ReturnType<TelemetryCollector["getSummary"]>;
  } {
    return {
      metrics: [...this.metrics],
      operations: [...this.operations],
      summary: this.getSummary(),
    };
  }

  /**
   * Clear all metrics
   */
  clear(): void {
    this.metrics = [];
    this.operations = [];
  }

  /**
   * Get metrics in Prometheus format
   */
  toPrometheus(): string {
    const lines: string[] = [];

    // Operation counts
    const summary = this.getSummary();
    lines.push(`# HELP mcp_operations_total Total number of operations`);
    lines.push(`# TYPE mcp_operations_total counter`);
    lines.push(`mcp_operations_total ${summary.totalOperations}`);

    // Success rate
    lines.push(`# HELP mcp_success_rate Success rate percentage`);
    lines.push(`# TYPE mcp_success_rate gauge`);
    lines.push(`mcp_success_rate ${summary.successRate.toFixed(2)}`);

    // Average duration
    lines.push(`# HELP mcp_duration_avg Average operation duration in ms`);
    lines.push(`# TYPE mcp_duration_avg gauge`);
    lines.push(`mcp_duration_avg ${summary.averageDuration.toFixed(2)}`);

    // Operations by tool
    lines.push(`# HELP mcp_operations_by_tool Operations count by tool`);
    lines.push(`# TYPE mcp_operations_by_tool counter`);
    for (const [tool, count] of Object.entries(summary.operationsByTool)) {
      lines.push(`mcp_operations_by_tool{tool="${tool}"} ${count}`);
    }

    return lines.join("\n");
  }
}

/**
 * Global telemetry instance
 */
export const globalTelemetry = new TelemetryCollector();

/**
 * Helper to track operation duration
 */
export async function trackOperation<T>(
  toolName: string,
  operation: () => Promise<T>
): Promise<T> {
  const startTime = Date.now();
  let success = true;
  let error: string | undefined;

  try {
    const result = await operation();
    return result;
  } catch (err) {
    success = false;
    error = err instanceof Error ? err.message : String(err);
    throw err;
  } finally {
    const duration = Date.now() - startTime;
    globalTelemetry.recordOperation({
      toolName,
      duration,
      success,
      error,
    });
  }
}
