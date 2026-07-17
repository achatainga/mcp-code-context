import * as fs from "node:fs/promises";
import * as path from "node:path";

export interface TableSchema {
  [columnName: string]: string;
}

export interface ProjectDbSchema {
  [tableName: string]: TableSchema;
}

// mtime-keyed cache — one entry per projectRoot
const schemaCache = new Map<string, { schema: ProjectDbSchema; mtime: number }>();

export async function loadRailsSchema(projectRoot: string): Promise<ProjectDbSchema | null> {
  const schemaPath = path.join(projectRoot, "db", "schema.rb");

  let mtime: number;
  try {
    mtime = (await fs.stat(schemaPath)).mtimeMs;
  } catch {
    return null; // no schema.rb — not a Rails project or uses structure.sql
  }

  const cached = schemaCache.get(projectRoot);
  if (cached?.mtime === mtime) return cached.schema;

  const content = await fs.readFile(schemaPath, "utf-8");
  const schema = parseSchemaRb(content);
  schemaCache.set(projectRoot, { schema, mtime });
  return schema;
}

// Exported for unit testing
export function parseSchemaRb(content: string): ProjectDbSchema {
  const schema: ProjectDbSchema = {};
  const tableRe = /create_table\s+"([^"]+)"/;
  const colRe = /t\.(\w+)\s+"([^"]+)"/;
  // Matches lines that open a nested do...end block (e.g. t.index [...] do |i|)
  const nestedDoRe = /\bdo\s*(\|[^|]*\|)?\s*$/;

  let currentTable: string | null = null;
  let currentColumns: TableSchema = {};
  // Track nesting depth so t.index do...end blocks don't close the table
  let depth = 0;

  for (const line of content.split("\n")) {
    if (currentTable === null) {
      const m = tableRe.exec(line);
      if (m) {
        currentTable = m[1];
        currentColumns = {};
        depth = 1; // the create_table do block itself
      }
    } else {
      // Detect lines that open a nested do block (NOT the create_table line itself)
      if (nestedDoRe.test(line) && !tableRe.test(line)) {
        depth++;
        continue; // nested block openers are never column definitions
      }

      if (/^\s*end\s*$/.test(line)) {
        depth--;
        if (depth === 0) {
          // This end closes the create_table block
          schema[currentTable] = currentColumns;
          currentTable = null;
        }
        continue;
      }

      // Only capture columns at depth === 1 (directly inside create_table)
      if (depth === 1) {
        const col = colRe.exec(line);
        if (col) {
          currentColumns[col[2]] = col[1]; // { email: "string" }
        }
      }
    }
  }

  // Handle schema files that don't end with a clean `end` (edge case)
  if (currentTable !== null) {
    schema[currentTable] = currentColumns;
  }

  return schema;
}

// Rails CoC: PascalCase → snake_case → pluralize
// Handles namespaced models: Billing::Invoice → billing_invoices
// Does NOT handle STI (class AdminUser < User maps to 'users' not 'admin_users' in Rails STI).
// For STI models, schema injection is skipped gracefully — no columns are injected if the
// table name doesn't exist in schema.rb. This is correct behavior (no false data).
export function modelToTable(className: string): string {
  // Strip namespace prefix: Billing::Invoice → Invoice, then prefix with billing_
  const parts = className.split("::");
  const baseName = parts[parts.length - 1];
  const namespaceParts = parts.slice(0, -1);

  const baseSnake = toSnakeCase(baseName);
  const namespaceSnake = namespaceParts.map(toSnakeCase).join("_");

  const full = namespaceSnake ? `${namespaceSnake}_${baseSnake}` : baseSnake;
  return pluralize(full);
}

function toSnakeCase(name: string): string {
  // PascalCase → snake_case: AdminUser → admin_user
  return name.replace(/([A-Z])/g, (c, _, i) =>
    i === 0 ? c.toLowerCase() : `_${c.toLowerCase()}`
  );
}

function pluralize(word: string): string {
  if (/[^aeiou]y$/.test(word)) return word.slice(0, -1) + "ies"; // category → categories
  if (/(s|x|z|ch|sh)$/.test(word)) return word + "es";
  return word + "s";
}

export function formatSchemaAnnotation(tableName: string, columns: TableSchema): string {
  const cols = Object.entries(columns)
    .map(([col, type]) => `  <column name="${col}" type="${type}" />`)
    .join("\n");
  return `<!-- ActiveRecord Virtual Schema: ${tableName}\n${cols}\n-->`;
}

// R5: Concern Resolution - Scan for concerns in app/models/concerns and app/controllers/concerns
export async function findRailsConcerns(projectRoot: string): Promise<Map<string, string[]>> {
  const concernMap = new Map<string, string[]>();
  const concernsDirs = [
    path.join(projectRoot, "app", "models", "concerns"),
    path.join(projectRoot, "app", "controllers", "concerns"),
  ];

  for (const dir of concernsDirs) {
    try {
      const files = await fs.readdir(dir, { withFileTypes: true });
      for (const file of files) {
        if (file.isFile() && file.name.endsWith(".rb")) {
          const moduleName = file.name.replace(/\.rb$/, "").split("_").map(
            part => part.charAt(0).toUpperCase() + part.slice(1)
          ).join("");
          concernMap.set(moduleName, [path.join(dir, file.name)]);
        }
      }
    } catch {
      // Directory doesn't exist, skip
    }
  }

  return concernMap;
}
