import fs from "node:fs";

const src = fs.readFileSync("src/utils/auditLogger.ts", "utf8");
const lines = src.split("\n");

const writerMethods = lines.slice(270, 324).join("\n");

const writerFile = `/**
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
): Promise<{ file: string; size: number }> {
  if (currentLogFile) return { file: currentLogFile, size: 0 };
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const file = path.join(logDir, \`audit-\${timestamp}.log\`);
  return { file, size: 0 };
}

export async function rotateLog(logDir: string, maxFiles: number): Promise<void> {
  const files = await getLogFiles(logDir);
  if (files.length > maxFiles) {
    const toDelete = files.slice(0, files.length - maxFiles);
    for (const file of toDelete) {
      try {
        await fs.unlink(file);
      } catch {
        // ignore
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
    return [];
  }
}
`;

fs.writeFileSync("src/utils/auditLogWriter.ts", writerFile);

const auditWithoutPrivate = [
  ...lines.slice(0, 269),
  `  private async initLogDir(): Promise<void> {
    await initLogDirHelper(this.config.logDir);
  }

  private async ensureLogFile(): Promise<void> {
    if (!this.currentLogFile) {
      const { file } = await ensureLogFileHelper(this.config.logDir, this.currentLogFile);
      this.currentLogFile = file;
      this.currentLogSize = 0;
    }
  }

  private async rotateLog(): Promise<void> {
    this.currentLogFile = null;
    this.currentLogSize = 0;
    await rotateLogHelper(this.config.logDir, this.config.maxFiles);
  }

  private async getLogFiles(): Promise<string[]> {
    return getLogFilesHelper(this.config.logDir);
  }`,
  ...lines.slice(324, 351),
].join("\n");

// Simpler approach: just import helpers in auditLogger and replace private methods
console.log("auditLogWriter created - update auditLogger manually if needed");
