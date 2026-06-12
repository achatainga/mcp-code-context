/**
 * Audit log file I/O helpers
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";

export async function initLogDir(logDir: string): Promise<void> {
  try {
    await fs.mkdir(logDir, { recursive: true });
  } catch (error) {
    console.error("Failed to create audit log directory:", error);
  }
}

export async function ensureLogFile(
  logDir: string,
  currentLogFile: string | null
): Promise<{ file: string }> {
  if (currentLogFile) return { file: currentLogFile };
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  return { file: path.join(logDir, `audit-${timestamp}.log`) };
}

export async function rotateLog(logDir: string, maxFiles: number): Promise<void> {
  const files = await getLogFiles(logDir);
  if (files.length > maxFiles) {
    for (const file of files.slice(0, files.length - maxFiles)) {
      try {
        await fs.unlink(file);
      } catch {
        // Old audit log deletion is best-effort — continue with remaining files
      }
    }
  }
}

export async function getLogFiles(logDir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(logDir);
    const files = entries
      .filter((name) => name.startsWith("audit-") && name.endsWith(".log"))
      .map((name) => path.join(logDir, name));

    const stats = await Promise.all(
      files.map(async (file) => ({
        file,
        mtime: (await fs.stat(file)).mtime.getTime(),
      }))
    );

    return stats.sort((a, b) => a.mtime - b.mtime).map((s) => s.file);
  } catch {
    return []; // Log directory may not exist yet (first run)
  }
}
