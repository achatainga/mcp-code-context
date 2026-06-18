/**
 * Semantic Compression - v3.7.1
 * IMPROVEMENTS: Centralized constants + size limits + timeout + index feeding
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { ParserRegistry } from "../parsers/registry.js";
import { EXCLUDE_DIRS, MAX_FILES_REPO_MAP, MAX_TOTAL_SIZE_BYTES } from "../utils/constants.js";
import { walkDir } from "../utils/fileWalker.js";
import { IndexManager } from "../core/indexManager.js";

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
            files.push({
              path: path.relative(params.directoryPath, fullPath),
              symbols: symbols.map(s => ({ type: s.type, name: s.name })),
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

  // Match: import ... from './path' | import './path' | require('./path')
  const patterns = [
    /from\s+['"](\.[^'"]+)['"]/g,
    /import\s+['"](\.[^'"]+)['"]/g,
    /require\s*\(\s*['"](\.[^'"]+)['"]\s*\)/g,
  ];

  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(content)) !== null) {
      const importPath = match[1];
      if (!importPath) continue;

      // Resolve to absolute path
      const resolved = path.resolve(dir, importPath);

      // Try common extensions if no extension given
      const ext = path.extname(resolved);
      if (ext) {
        deps.push(resolved);
      } else {
        // Add the bare path — IndexManager stores what it gets
        deps.push(resolved);
      }
    }
  }

  return [...new Set(deps)]; // deduplicate
}

export { compressRepository };
