/**
 * Semantic Compression - v3.9.1
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
  format?: "xml" | "markdown";
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

                    // R1: Rails AR schema injection for .rb files in repo map
            let fileSymbols = symbols.map(s => ({ type: s.type, name: s.name }));
            if (path.extname(fullPath) === ".rb") {
              const schema = await loadRailsSchema(params.projectRoot).catch(() => null);
              if (schema) {
                for (const sym of symbols) {
                  if (sym.type === "class") {
                    const tableName = modelToTable(sym.name);
                    const columns = schema[tableName];
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
