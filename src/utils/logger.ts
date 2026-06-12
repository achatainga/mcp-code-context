/**
 * Logger - v3.7.0
 * Structured logging with pino (JSON to stderr, MCP-safe)
 */

import pino from 'pino';
import { tmpdir } from 'os';
import path from 'path';
import crypto from 'crypto';

const isDevelopment = process.env.NODE_ENV !== 'production';

// Calculate project-specific log directory in OS temp
const projectHash = crypto.createHash('sha256')
  .update(process.cwd())
  .digest('hex')
  .substring(0, 8);

const logDir = path.join(tmpdir(), 'mcp-logs', projectHash);

/**
 * Create pino logger instance
 * - Development: Pretty print to stderr
 * - Production: JSON to stderr (MCP-safe)
 */
export const logger = pino({
  level: process.env.LOG_LEVEL || (isDevelopment ? 'debug' : 'info'),
  transport: isDevelopment
    ? {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'HH:MM:ss',
          ignore: 'pid,hostname',
          destination: 2, // stderr
        },
      }
    : undefined,
  base: {
    pid: process.pid,
    service: 'mcp-code-context',
  },
  timestamp: pino.stdTimeFunctions.isoTime,
});

/**
 * Create child logger with context
 */
export function createLogger(context: Record<string, any>) {
  return logger.child(context);
}

/**
 * Log directory path (for audit logs if needed)
 */
export const LOG_DIR = logDir;
