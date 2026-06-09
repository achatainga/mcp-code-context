/**
 * Audit log query helpers
 */

import * as fs from "node:fs/promises";
import type { AuditEntry } from "./auditLogger.js";
import { getLogFiles } from "./auditLogWriter.js";

export async function queryAuditLogs(
  logDir: string,
  filters: {
    startTime?: number;
    endTime?: number;
    level?: AuditEntry["level"];
    operation?: string;
    clientId?: string;
    result?: "success" | "failure";
    limit?: number;
  }
): Promise<AuditEntry[]> {
  const results: AuditEntry[] = [];
  const limit = filters.limit || 1000;

  try {
    const files = await getLogFiles(logDir);
    for (const file of files.reverse()) {
      if (results.length >= limit) break;
      const content = await fs.readFile(file, "utf-8");
      for (const line of content.split("\n").filter((l) => l.trim()).reverse()) {
        if (results.length >= limit) break;
        try {
          const entry: AuditEntry = JSON.parse(line);
          if (filters.startTime && entry.timestamp < filters.startTime) continue;
          if (filters.endTime && entry.timestamp > filters.endTime) continue;
          if (filters.level && entry.level !== filters.level) continue;
          if (filters.operation && entry.operation !== filters.operation) continue;
          if (filters.clientId && entry.clientId !== filters.clientId) continue;
          if (filters.result && entry.result !== filters.result) continue;
          results.push(entry);
        } catch {
          // skip invalid lines
        }
      }
    }
  } catch (error) {
    console.error("Failed to query audit logs:", error);
  }
  return results;
}

export async function getAuditStats(
  logDir: string,
  timeRange?: { start: number; end: number }
) {
  const entries = await queryAuditLogs(logDir, {
    startTime: timeRange?.start,
    endTime: timeRange?.end,
    limit: 100000,
  });

  const stats = {
    totalEntries: entries.length,
    byLevel: {} as Record<string, number>,
    byOperation: {} as Record<string, number>,
    byResult: {} as Record<string, number>,
    securityEvents: 0,
  };

  for (const entry of entries) {
    stats.byLevel[entry.level] = (stats.byLevel[entry.level] || 0) + 1;
    stats.byOperation[entry.operation] = (stats.byOperation[entry.operation] || 0) + 1;
    stats.byResult[entry.result] = (stats.byResult[entry.result] || 0) + 1;
    if (entry.level === "security") stats.securityEvents++;
  }
  return stats;
}
