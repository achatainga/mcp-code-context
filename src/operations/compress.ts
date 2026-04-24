/**
 * Semantic Compression - v3.1.0
 * Compress entire repositories to structural signatures
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { ParserRegistry } from "../parsers/registry.js";

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
}): Promise<CompressionResult> {
  try {
    const format = params.format || "xml";
    const files: any[] = [];
    const excludeDirs = ["node_modules", "dist", "build", ".git", "vendor", ".mcp-backups"];
    const maxFiles = 500;

    async function walkDir(dir: string) {
      if (files.length >= maxFiles) return;

      const entries = await fs.readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        if (files.length >= maxFiles) break;

        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
          if (!excludeDirs.includes(entry.name)) {
            await walkDir(fullPath);
          }
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name);
          const parser = params.registry.getParser(ext);

          if (parser) {
            try {
              const content = await fs.readFile(fullPath, "utf-8");
              const tree = parser.parse(content);
              const symbols = parser.findSymbols(tree);

              files.push({
                path: path.relative(params.directoryPath, fullPath),
                symbols: symbols.map(s => ({ type: s.type, name: s.name })),
              });
            } catch (error) {
              // Skip files that fail to parse
            }
          }
        }
      }
    }

    await walkDir(params.directoryPath);

    if (format === "xml") {
      let xml = '<?xml version="1.0" encoding="UTF-8"?>\n<repository>\n';
      for (const file of files) {
        xml += `  <file path="${file.path}">\n`;
        for (const symbol of file.symbols) {
          xml += `    <symbol type="${symbol.type}" name="${symbol.name}" />\n`;
        }
        xml += `  </file>\n`;
      }
      xml += '</repository>';

      return { success: true, content: xml };
    } else {
      let md = `# Repository Map\n\n`;
      for (const file of files) {
        md += `## ${file.path}\n\n`;
        for (const symbol of file.symbols) {
          md += `- **${symbol.type}**: \`${symbol.name}\`\n`;
        }
        md += `\n`;
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
