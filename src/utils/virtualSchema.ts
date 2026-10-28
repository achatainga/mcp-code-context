import * as fs from "node:fs/promises";
import * as path from "node:path";
import { loadRailsSchema, modelToTable, type TableSchema, type ProjectDbSchema } from "./railsSchema.js";

export { type TableSchema, type ProjectDbSchema, modelToTable };

// Cache for Laravel schemas
const laravelCache = new Map<string, { schema: ProjectDbSchema; mtime: number }>();
// Cache for Django schemas
const djangoCache = new Map<string, { schema: ProjectDbSchema; mtime: number }>();

/**
 * Extract virtual database schema from Laravel database/migrations
 */
export async function loadLaravelSchema(projectRoot: string): Promise<ProjectDbSchema | null> {
  const migrationsDir = path.join(projectRoot, "database", "migrations");
  let migrationFiles: string[];

  try {
    const entries = await fs.readdir(migrationsDir, { withFileTypes: true });
    migrationFiles = entries
      .filter(e => e.isFile() && e.name.endsWith(".php"))
      .map(e => path.join(migrationsDir, e.name));
  } catch {
    return null; // Not a Laravel project with migrations
  }

  if (migrationFiles.length === 0) return null;

  // Compute aggregate mtime of migrations
  let aggregateMtime = 0;
  for (const file of migrationFiles) {
    try {
      const stat = await fs.stat(file);
      aggregateMtime += stat.mtimeMs;
    } catch {
      // ignore stat failures
    }
  }

  const cached = laravelCache.get(projectRoot);
  if (cached && cached.mtime === aggregateMtime) return cached.schema;

  const schema: ProjectDbSchema = {};

  for (const file of migrationFiles) {
    try {
      const content = await fs.readFile(file, "utf-8");
      parseLaravelMigration(content, schema);
    } catch {
      // Skip unreadable files
    }
  }

  laravelCache.set(projectRoot, { schema, mtime: aggregateMtime });
  return Object.keys(schema).length > 0 ? schema : null;
}

export function parseLaravelMigration(content: string, schema: ProjectDbSchema = {}): ProjectDbSchema {
  // Matches Schema::create('table_name', function (Blueprint $table) { ... })
  const createTableRe = /Schema::create\s*\(\s*['"]([^'"]+)['"]\s*,\s*function\s*\([^)]*\)\s*\{([\s\S]*?)\}\s*\);/g;
  let match: RegExpExecArray | null;

  while ((match = createTableRe.exec(content)) !== null) {
    const tableName = match[1];
    const body = match[2];
    const columns: TableSchema = schema[tableName] || {};

    const colRe = /\$table->(\w+)\s*\(\s*(?:['"]([^'"]+)['"])?/g;
    let colMatch: RegExpExecArray | null;

    while ((colMatch = colRe.exec(body)) !== null) {
      const colType = colMatch[1];
      const colName = colMatch[2];

      if (colType === "id" || colType === "bigIncrements" || colType === "increments") {
        columns[colName || "id"] = "bigint primary key";
      } else if (colType === "timestamps" || colType === "timestampsTz") {
        columns["created_at"] = "timestamp";
        columns["updated_at"] = "timestamp";
      } else if (colType === "softDeletes") {
        columns["deleted_at"] = "timestamp nullable";
      } else if (colType === "rememberToken") {
        columns["remember_token"] = "string(100)";
      } else if (colName) {
        columns[colName] = colType;
      }
    }

    schema[tableName] = columns;
  }

  return schema;
}

/**
 * Extract virtual database schema from Django models.py files
 */
export async function loadDjangoSchema(projectRoot: string): Promise<ProjectDbSchema | null> {
  const schema: ProjectDbSchema = {};
  const foundModels = await findDjangoModelFiles(projectRoot);

  if (foundModels.length === 0) return null;

  let aggregateMtime = 0;
  for (const file of foundModels) {
    try {
      const stat = await fs.stat(file);
      aggregateMtime += stat.mtimeMs;
    } catch {
      // ignore
    }
  }

  const cached = djangoCache.get(projectRoot);
  if (cached && cached.mtime === aggregateMtime) return cached.schema;

  for (const file of foundModels) {
    try {
      const content = await fs.readFile(file, "utf-8");
      parseDjangoModels(content, schema);
    } catch {
      // skip
    }
  }

  djangoCache.set(projectRoot, { schema, mtime: aggregateMtime });
  return Object.keys(schema).length > 0 ? schema : null;
}

async function findDjangoModelFiles(dir: string, depth = 0): Promise<string[]> {
  if (depth > 4) return [];
  const results: string[] = [];

  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (["node_modules", ".git", "venv", ".venv", "env", "__pycache__"].includes(entry.name)) {
          continue;
        }
        const sub = await findDjangoModelFiles(path.join(dir, entry.name), depth + 1);
        results.push(...sub);
      } else if (entry.isFile() && (entry.name === "models.py" || entry.name.endsWith("_models.py"))) {
        results.push(path.join(dir, entry.name));
      }
    }
  } catch {
    // Ignore read errors
  }

  return results;
}

export function parseDjangoModels(content: string, schema: ProjectDbSchema = {}): ProjectDbSchema {
  // Matches class ModelName(models.Model):
  const classRe = /class\s+(\w+)\s*\([^)]*models\.Model[^)]*\):([\s\S]*?)(?=\nclass\s|\n[^\s#]|$)/g;
  let match: RegExpExecArray | null;

  while ((match = classRe.exec(content)) !== null) {
    const className = match[1];
    const body = match[2];
    const tableName = modelToTable(className);
    const columns: TableSchema = schema[tableName] || { id: "AutoField(primary_key=True)" };

    // Matches field_name = models.FieldType(...)
    const fieldRe = /^\s{4,8}(\w+)\s*=\s*models\.(\w+Field|\w+)\(([^)]*)\)/gm;
    let fieldMatch: RegExpExecArray | null;

    while ((fieldMatch = fieldRe.exec(body)) !== null) {
      const fieldName = fieldMatch[1];
      const fieldType = fieldMatch[2];
      columns[fieldName] = fieldType;
    }

    schema[tableName] = columns;
  }

  return schema;
}

/**
 * Unified virtual schema loader supporting Rails, Laravel & Django
 */
export async function loadUnifiedVirtualSchema(
  projectRoot: string,
  fileExtension?: string
): Promise<{ framework: "ActiveRecord" | "Eloquent" | "Django"; schema: ProjectDbSchema } | null> {
  if (!fileExtension || fileExtension === ".rb") {
    const rails = await loadRailsSchema(projectRoot).catch(() => null);
    if (rails && Object.keys(rails).length > 0) {
      return { framework: "ActiveRecord", schema: rails };
    }
  }

  if (!fileExtension || fileExtension === ".php") {
    const laravel = await loadLaravelSchema(projectRoot).catch(() => null);
    if (laravel && Object.keys(laravel).length > 0) {
      return { framework: "Eloquent", schema: laravel };
    }
  }

  if (!fileExtension || fileExtension === ".py") {
    const django = await loadDjangoSchema(projectRoot).catch(() => null);
    if (django && Object.keys(django).length > 0) {
      return { framework: "Django", schema: django };
    }
  }

  return null;
}

export function formatUnifiedSchemaAnnotation(
  framework: "ActiveRecord" | "Eloquent" | "Django",
  tableName: string,
  columns: TableSchema
): string {
  const cols = Object.entries(columns)
    .map(([col, type]) => `  <column name="${col}" type="${type}" />`)
    .join("\n");
  return `<!-- ${framework} Virtual Schema: ${tableName}\n${cols}\n-->`;
}
