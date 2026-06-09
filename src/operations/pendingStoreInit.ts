/**
 * Pending store database initialization
 */

import initSqlJs, { Database } from "sql.js";
import * as fs from "node:fs/promises";
import { existsSync } from "fs";
import * as path from "node:path";

export function initPendingSchema(db: Database): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS pending_operations (
      token TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      file_path TEXT NOT NULL,
      operation TEXT NOT NULL,
      symbol_name TEXT,
      new_content TEXT NOT NULL,
      diff TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      original_hash TEXT,
      pending_writes TEXT
    )
  `);
  db.run(`CREATE INDEX IF NOT EXISTS idx_session_id ON pending_operations(session_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_expires_at ON pending_operations(expires_at)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_file_path ON pending_operations(file_path)`);
}

export async function openPendingDatabase(dbPath: string): Promise<Database> {
  const SQL = await initSqlJs();
  let db: Database;
  if (existsSync(dbPath)) {
    db = new SQL.Database(await fs.readFile(dbPath));
  } else {
    db = new SQL.Database();
  }
  initPendingSchema(db);
  await fs.mkdir(path.dirname(dbPath), { recursive: true });
  await fs.writeFile(dbPath, db.export());
  return db;
}
