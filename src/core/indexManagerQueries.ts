/**
 * Index Manager query operations
 */

import type { Database } from "sql.js";
import * as fs from "node:fs/promises";
import { existsSync } from "fs";
import type { IndexedSymbol, IndexStats } from "./indexManager.js";

export function searchSymbolsInDb(
  db: Database,
  query: string,
  options: { fuzzy?: boolean; types?: string[]; maxResults?: number } = {}
): IndexedSymbol[] {
  const { fuzzy = false, types, maxResults = 50 } = options;
  const results: IndexedSymbol[] = [];
  const typeFilter =
    types && types.length > 0 ? `AND type IN (${types.map(() => "?").join(",")})` : "";

  let sql: string;
  let params: (string | number)[];

  if (fuzzy) {
    sql = `
      SELECT file_path, name, type, start_line, end_line, class_name
      FROM symbols WHERE LOWER(name) LIKE LOWER(?) ${typeFilter}
      ORDER BY CASE WHEN LOWER(name) = LOWER(?) THEN 0 WHEN LOWER(name) LIKE LOWER(?) THEN 1 ELSE 2 END, name
      LIMIT ?`;
    params = [`%${query}%`, ...(types ?? []), query, `${query}%`, maxResults];
  } else {
    sql = `
      SELECT file_path, name, type, start_line, end_line, class_name
      FROM symbols WHERE LOWER(name) = LOWER(?) ${typeFilter} ORDER BY name LIMIT ?`;
    params = [query, ...(types ?? []), maxResults];
  }

  const stmt = db.prepare(sql);
  stmt.bind(params);
  while (stmt.step()) {
    const row = stmt.getAsObject() as {
      file_path: string;
      name: string;
      type: string;
      start_line: number;
      end_line: number;
      class_name: string | null;
    };
    results.push({
      filePath: row.file_path,
      name: row.name,
      type: row.type,
      startLine: row.start_line,
      endLine: row.end_line,
      className: row.class_name ?? undefined,
    });
  }
  stmt.free();
  return results;
}

export function getDependentsFromDb(db: Database, filePath: string): string[] {
  const results: string[] = [];
  const stmt = db.prepare("SELECT from_file FROM dependencies WHERE to_file = ?");
  stmt.bind([filePath]);
  while (stmt.step()) {
    results.push((stmt.getAsObject() as { from_file: string }).from_file);
  }
  stmt.free();
  return results;
}

export function getDependenciesFromDb(db: Database, filePath: string): string[] {
  const results: string[] = [];
  const stmt = db.prepare("SELECT to_file FROM dependencies WHERE from_file = ?");
  stmt.bind([filePath]);
  while (stmt.step()) {
    results.push((stmt.getAsObject() as { to_file: string }).to_file);
  }
  stmt.free();
  return results;
}

export function hasIndexInDb(db: Database): boolean {
  const stmt = db.prepare("SELECT COUNT(*) as count FROM files");
  stmt.step();
  const count = (stmt.getAsObject() as { count: number }).count;
  stmt.free();
  return count > 0;
}

export async function getIndexStatsFromDb(db: Database, dbPath: string): Promise<IndexStats> {
  const files = db.prepare("SELECT COUNT(*) as c FROM files");
  files.step();
  const filesCount = (files.getAsObject() as { c: number }).c;
  files.free();

  const syms = db.prepare("SELECT COUNT(*) as c FROM symbols");
  syms.step();
  const symsCount = (syms.getAsObject() as { c: number }).c;
  syms.free();

  const deps = db.prepare("SELECT COUNT(*) as c FROM dependencies");
  deps.step();
  const depsCount = (deps.getAsObject() as { c: number }).c;
  deps.free();

  const last = db.prepare("SELECT MAX(indexed_at) as t FROM files");
  last.step();
  const lastAt = (last.getAsObject() as { t: number | null }).t;
  last.free();

  const dbSize = existsSync(dbPath) ? (await fs.stat(dbPath)).size : 0;

  return {
    filesIndexed: filesCount,
    symbolsIndexed: symsCount,
    dependenciesIndexed: depsCount,
    dbSizeBytes: dbSize,
    lastIndexedAt: lastAt,
  };
}
