/**
 * Semantic Compression - v3.6.2
 * IMPROVEMENTS: Centralized constants + size limits + timeout
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { ParserRegistry } from "../parsers/registry.js";
import { EXCLUDE_DIRS, MAX_FILES_REPO_MAP, MAX_TOTAL_SIZE_BYTES } from "../utils/constants.js";
import { walkDir } from "../utils/fileWalker.js";

export interface CompressionResult {
  success: boolean;
  content?: string;
  error?: string;
}

/**
 * Generate semantic repository map
 */
export async function compressRepository(params: {
  directoryPath: string;
  format?: "xml" | "markdown";
  registry: ParserRegistry;
  maxDepth?: number;
  includeSymbols?: boolean;
}): Promise<CompressionResult> {
  try {
    const format = params.format || "xml";
    const files: any[] = [];
    let totalSymbols = 0;

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
            const tree = parser.parse(content);
            const symbols = parser.findSymbols(tree);
            totalSymbols += symbols.length;

            files.push({
              path: path.relative(params.directoryPath, fullPath),
              symbols: symbols.map(s => ({ type: s.type, name: s.name })),
            });
          } catch (error) {
            // Skip files that fail to parse
          }
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
