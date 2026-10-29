/**
 * Semantic Compression - v3.9.2
 * IMPROVEMENTS: Centralized constants + size limits + timeout + index feeding
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { ParserRegistry } from "../parsers/registry.js";
import { EXCLUDE_DIRS, MAX_FILES_REPO_MAP, MAX_TOTAL_SIZE_BYTES } from "../utils/constants.js";
import { walkDir } from "../utils/fileWalker.js";
import { IndexManager } from "../core/indexManager.js";
import { loadRailsSchema, modelToTable, findRailsConcerns } from "../utils/railsSchema.js";
import { loadUnifiedVirtualSchema } from "../utils/virtualSchema.js";
import { parseGemfile } from "../utils/gemfileParser.js";

export interface CompressionResult {
  success: boolean;
  content?: string;
  error?: string;
}

interface CompressedFile {
  path: string;
  symbols: Array<{ type: string; name: string }>;
}

/**
 * Generate semantic repository map
 */
async function compressRepository(params: {
  directoryPath: string;
  projectRoot: string;
  format?: "xml" | "markdown" | "html";
  registry: ParserRegistry;
  maxDepth?: number;
  includeSymbols?: boolean;
}): Promise<CompressionResult> {
  try {
    const format = params.format || "xml";
    const files: CompressedFile[] = [];
    let totalSymbols = 0;

    // Index manager — feeds symbol index and dependency graph as a side-effect
    const indexManager = new IndexManager(params.projectRoot);

    await walkDir(params.directoryPath, {
      excludeDirs: EXCLUDE_DIRS,
      maxFiles: MAX_FILES_REPO_MAP,
      maxSize: MAX_TOTAL_SIZE_BYTES,
      onFile: async (fullPath) => {
        const ext = path.extname(fullPath);
        const parser = params.registry.getParser(ext);

        if (parser) {
          try {
            const content = await fs.readFile(fullPath, "utf-8");

            // Compute hash for stale check
            const fileHash = crypto
              .createHash("sha256")
              .update(content)
              .digest("hex");

            const symbols = await (async () => {
              // Skip re-parsing if index is up to date
              if (!(await indexManager.isStale(fullPath, fileHash))) {
                const tree = parser.parse(content);
                return parser.findSymbols(tree);
              }
              const tree = parser.parse(content);
              const syms = parser.findSymbols(tree);

              // Extract import dependencies
              const deps = extractImports(content, fullPath, params.directoryPath);

              // Feed index (fire-and-forget, never blocks the repo map)
              indexManager.indexFile(fullPath, fileHash, syms, deps).catch(() => {
                // Index feeding is fire-and-forget — never blocks repo map generation
              });

              return syms;
            })();

            totalSymbols += symbols.length;

                    // R1: Virtual ORM schema injection for .rb, .php, .py, .ts, .tsx in repo map
            let fileSymbols = symbols.map(s => ({ type: s.type, name: s.name }));
            const ext = path.extname(fullPath);
            if (ext === ".rb" || ext === ".php" || ext === ".py" || ext === ".ts" || ext === ".tsx") {
              const unified = await loadUnifiedVirtualSchema(params.projectRoot, ext).catch(() => null);
              const schema = unified?.schema;
              if (schema) {
                for (const sym of symbols) {
                  if (sym.type === "class" || sym.type === "interface" || sym.type === "variable_declarator") {
                    const tableName = modelToTable(sym.name);
                    const columns = schema[tableName] || schema[sym.name.toLowerCase()] || schema[sym.name];
                    if (columns && Object.keys(columns).length > 0) {
                      const dbCols = Object.entries(columns).map(([col, type]) => ({
                        type: "db_column",
                        name: `${col}:${type}`,
                      }));
                      fileSymbols = [...fileSymbols, ...dbCols];
                      totalSymbols += dbCols.length;
                    }
                  }
                }
              }
            }

            files.push({
              path: path.relative(params.directoryPath, fullPath),
              symbols: fileSymbols,
            });
          } catch {
            // Skip files that fail to parse or read (IO errors, encoding issues)
            // Non-parseable files are still included below without symbols
          }
        } else {
          // Non-parseable file — still include in map without symbols
          files.push({
            path: path.relative(params.directoryPath, fullPath),
            symbols: [],
          });
        }
      },
    });

    // Auto-optimize: disable symbols if >100 files or >1000 symbols
    const includeSymbols = params.includeSymbols !== false && files.length <= 100 && totalSymbols <= 1000;

    // Project-wide metadata: Gemfile + Concerns
    let projectMetadata = "";
        if (format === "html") {
      const escapedPath = params.directoryPath.replace(/</g, "&lt;").replace(/>/g, "&gt;");
      const filesJson = JSON.stringify(files.map(f => ({
        path: f.path,
        symbols: f.symbols
      })));

      const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Architecture Map - ${escapedPath}</title>
  <style>
    :root {
      --bg: #0f172a;
      --card-bg: #1e293b;
      --border: #334155;
      --text: #f8fafc;
      --text-muted: #94a3b8;
      --accent: #f26419;
      --badge-class: #38bdf8;
      --badge-fn: #4ade80;
      --badge-db: #f59e0b;
      --badge-other: #a78bfa;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, monospace; }
    body { background: var(--bg); color: var(--text); padding: 24px; }
    header { margin-bottom: 24px; border-bottom: 1px solid var(--border); padding-bottom: 16px; }
    h1 { font-size: 1.5rem; display: flex; align-items: center; gap: 10px; }
    .badge { font-size: 0.75rem; padding: 2px 8px; border-radius: 9999px; background: var(--accent); color: white; font-weight: bold; }
    .stats { display: flex; gap: 16px; margin-top: 12px; font-size: 0.875rem; color: var(--text-muted); }
    .stat-val { color: var(--text); font-weight: bold; }
    .controls { margin-bottom: 20px; display: flex; gap: 12px; }
    input#search { flex: 1; padding: 10px 14px; background: var(--card-bg); border: 1px solid var(--border); border-radius: 8px; color: var(--text); font-size: 0.9rem; }
    input#search:focus { outline: 2px solid var(--accent); border-color: transparent; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(360px, 1fr)); gap: 16px; }
    .card { background: var(--card-bg); border: 1px solid var(--border); border-radius: 8px; padding: 16px; transition: border-color 0.2s; }
    .card:hover { border-color: var(--accent); }
    .card-path { font-weight: bold; font-size: 0.875rem; color: #38bdf8; word-break: break-all; margin-bottom: 8px; }
    .symbols-list { display: flex; flex-wrap: wrap; gap: 6px; }
    .sym-badge { font-size: 0.75rem; padding: 3px 6px; border-radius: 4px; background: #0f172a; border: 1px solid var(--border); }
    .sym-class { border-color: var(--badge-class); color: var(--badge-class); }
    .sym-function { border-color: var(--badge-fn); color: var(--badge-fn); }
    .sym-db { border-color: var(--badge-db); color: var(--badge-db); }
    .empty-note { font-size: 0.75rem; color: var(--text-muted); font-style: italic; }
  </style>
</head>
<body>
  <header>
    <h1><span>Architecture & Semantic Repo Map</span> <span class="badge">v4.0.0 Enterprise</span></h1>
    <div class="stats">
      <div>Files: <span class="stat-val">${files.length}</span></div>
      <div>Indexed Symbols: <span class="stat-val">${totalSymbols}</span></div>
      <div>Path: <span class="stat-val">${escapedPath}</span></div>
    </div>
  </header>

  <div class="controls">
    <input type="text" id="search" placeholder="Filter files or symbols (e.g. User, Controller, handle, schema)..." autofocus>
  </div>

  <div class="grid" id="fileGrid"></div>

  <script>
    const files = ${filesJson};
    const grid = document.getElementById("fileGrid");
    const search = document.getElementById("search");

    function render(list) {
      grid.innerHTML = "";
      if (list.length === 0) {
        grid.innerHTML = '<div style="color: var(--text-muted); grid-column: 1/-1;">No matching files found.</div>';
        return;
      }
      for (const f of list) {
        const card = document.createElement("div");
        card.className = "card";
        const symHtml = f.symbols.length > 0 
          ? f.symbols.map(s => {
              const cls = s.type === "class" ? "sym-class" : s.type === "db_column" ? "sym-db" : "sym-function";
              return '<span class="sym-badge ' + cls + '">' + s.type + ': ' + s.name + '</span>';
            }).join("")
          : '<span class="empty-note">No exported AST symbols</span>';
        card.innerHTML = '<div class="card-path">' + f.path + '</div><div class="symbols-list">' + symHtml + '</div>';
        grid.appendChild(card);
      }
    }

    search.addEventListener("input", (e) => {
      const q = e.target.value.toLowerCase().trim();
      if (!q) { render(files); return; }
      const filtered = files.filter(f => 
        f.path.toLowerCase().includes(q) || 
        f.symbols.some(s => s.name.toLowerCase().includes(q) || s.type.toLowerCase().includes(q))
      );
      render(filtered);
    });

    render(files);
  </script>
</body>
</html>`;

      return { success: true, content: html };
    }

    if (format === "xml") {
      try {
        const gemfileResult = await parseGemfile(params.projectRoot);
        if (gemfileResult && gemfileResult.knownGems.length > 0) {
          projectMetadata += '\n  <!-- Gemfile: installed gems with implicit behavior -->\n';
          for (const gem of gemfileResult.knownGems) {
            projectMetadata += `  <gem name="${gem.name}"${gem.version ? ` version="${gem.version}"` : ""}>\n    ${gem.implicitBehavior}\n  </gem>\n`;
          }
        }

        const concernMap = await findRailsConcerns(params.projectRoot);
        if (concernMap.size > 0) {
          projectMetadata += '\n  <!-- Rails Concerns -->\n';
          for (const [concernName, filePaths] of concernMap.entries()) {
            for (const filePath of filePaths) {
              const relPath = path.relative(params.directoryPath, filePath);
              projectMetadata += `  <concern name="${concernName}" file="${relPath}" />\n`;
            }
          }
        }
      } catch {
        // Silent fail — metadata is optional
      }
    }

        

    if (format === "xml") {
      let xml = '<?xml version="1.0" encoding="UTF-8"?>\n<repository>\n';
      for (const file of files) {
        xml += `  <file path="${file.path}"`;
        if (includeSymbols && file.symbols.length > 0) {
          xml += '>\n';
          for (const symbol of file.symbols) {
            xml += `    <symbol type="${symbol.type}" name="${symbol.name}" />\n`;
          }
          xml += `  </file>\n`;
        } else {
          xml += ' />\n';
        }
      }
      xml += projectMetadata;
      xml += '</repository>';

      if (!includeSymbols) {
        xml += `\n\n<!-- Symbols omitted: ${files.length} files, ${totalSymbols} symbols (auto-optimized for token efficiency) -->`;
      }

      return { success: true, content: xml };
    } else {
      let md = `# Repository Map\n\n`;
      for (const file of files) {
        md += `## ${file.path}\n`;
        if (includeSymbols && file.symbols.length > 0) {
          for (const symbol of file.symbols) {
            md += `- **${symbol.type}**: \`${symbol.name}\`\n`;
          }
        }
        md += `\n`;
      }

      // Markdown version of metadata
      try {
        const gemfileResult = await parseGemfile(params.projectRoot);
        if (gemfileResult && gemfileResult.knownGems.length > 0) {
          md += `\n## Gems with Implicit Behavior\n`;
          for (const gem of gemfileResult.knownGems) {
            md += `- **${gem.name}**${gem.version ? ` (${gem.version})` : ''}: ${gem.implicitBehavior}\n`;
          }
        }

        const concernMap = await findRailsConcerns(params.projectRoot);
        if (concernMap.size > 0) {
          md += `\n## Rails Concerns\n`;
          for (const [concernName, filePaths] of concernMap.entries()) {
            for (const filePath of filePaths) {
              const relPath = path.relative(params.directoryPath, filePath);
              md += `- **${concernName}**: \`${relPath}\`\n`;
            }
          }
        }
      } catch {
        // Silent fail
      }

      if (!includeSymbols) {
        md += `\n---\n*Symbols omitted: ${files.length} files, ${totalSymbols} symbols (auto-optimized for token efficiency)*\n`;
      }

      return { success: true, content: md };
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Extract import dependencies from file content.
 * Returns absolute paths of files this file imports.
 */
function extractImports(content: string, filePath: string, rootDir: string): string[] {
  const deps: string[] = [];
  const dir = path.dirname(filePath);

  // JS/TS: import ... from './path' | import './path' | require('./path')
  const jsPatterns = [
    /from\s+['"](\.[^'"]+)['"]/g,
    /import\s+['"](\.[^'"]+)['"]/g,
    /require\s*\(\s*['"](\.[^'"]+)['"]\s*\)/g,
  ];

  for (const pattern of jsPatterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(content)) !== null) {
      const importPath = match[1];
      if (!importPath) continue;
      deps.push(path.resolve(dir, importPath));
    }
  }

  // Ruby: require 'path' | require_relative '../path'
  const rubyRequire = /require\s+['"]([^'"]+)['"]/g;
  const rubyRequireRel = /require_relative\s+['"]([^'"]+)['"]/g;

  let match: RegExpExecArray | null;

  // require 'path' — treat as relative to projectRoot (lib/ or gems — best effort)
  while ((match = rubyRequire.exec(content)) !== null) {
    const importPath = match[1];
    if (!importPath || importPath.includes("/") === false) continue; // skip bare gem names like 'devise'
    deps.push(path.resolve(dir, importPath));
  }

  // require_relative '../path' — always relative to the file doing the require
  while ((match = rubyRequireRel.exec(content)) !== null) {
    const importPath = match[1];
    if (!importPath) continue;
    deps.push(path.resolve(dir, importPath));
  }

  return [...new Set(deps)]; // deduplicate
}

export { compressRepository };
