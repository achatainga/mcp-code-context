/**
 * Symbol query operations — search, explain, batch read
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { EXCLUDE_DIRS, SUPPORTED_EXTENSIONS } from "../utils/constants.js";
import { walkDir } from "../utils/fileWalker.js";
import { IndexManager } from "../core/indexManager.js";
import { fuzzySearch } from "../utils/fuzzySearch.js";
import { BaseParser } from "../parsers/base.js";
import { extractSymbol, type ReadResult } from "./readCore.js";

export async function searchSymbols(params: {
  rootDir: string;
  query: string;
  projectRoot: string;
  fuzzy?: boolean;
  types?: string[];
  fileExtensions?: string[];
  excludeDirs?: string[];
  maxResults?: number;
}): Promise<ReadResult> {
  try {
    const maxResults = params.maxResults || 20;

    // ── Fast path: use persistent index if available ──────────────────────
    const indexManager = new IndexManager(params.projectRoot);
    if (await indexManager.hasIndex()) {
      const results = await indexManager.searchSymbols(params.query, {
        fuzzy: params.fuzzy,
        types: params.types,
        maxResults,
      });

      const mapped = results.map(r => ({
        name: r.name,
        type: r.type,
        file: r.filePath,
        startLine: r.startLine,
        endLine: r.endLine,
        className: r.className,
      }));

      const footer = `\n\nShowing ${mapped.length} of ${mapped.length} symbols (index)`;
      return {
        success: true,
        content: JSON.stringify(mapped, null, 2) + footer,
      };
    }

    // ── Slow path: AST scan (no index yet) ───────────────────────────────
    const { ParserRegistry } = await import('../parsers/registry.js');
    const { CodeContextEngine } = await import('../core/engine.js');

    const engine = new CodeContextEngine();
    await engine.init();
    const registry = new ParserRegistry(engine);
    await registry.init();

    const extensions = params.fileExtensions || SUPPORTED_EXTENSIONS;
    const excludeDirs = params.excludeDirs || EXCLUDE_DIRS;
    const results: Array<{ name: string; type: string; file: string; startLine?: number; endLine?: number; className?: string }> = [];

    await walkDir(params.rootDir, {
      extensions,
      excludeDirs,
      onFile: async (fullPath) => {
        if (results.length >= maxResults * 3) return;
        const ext = path.extname(fullPath);
        const parser = registry.getParser(ext);
        if (!parser) return;

        const content = await fs.readFile(fullPath, 'utf-8');
        const tree = parser.parse(content);
        const symbols = parser.findSymbols(tree);

        for (const sym of symbols) {
          if (params.types && params.types.length > 0 && !params.types.includes(sym.type)) continue;
          results.push({
            name: sym.name,
            type: sym.type,
            file: fullPath,
            startLine: sym.startLine,
            endLine: sym.endLine,
            className: sym.className,
          });
        }
      },
    });

    let filtered = results;
    if (params.fuzzy) {
      const fuzzyResults = fuzzySearch(results, params.query, {
        threshold: 0.4,
        keys: ['name'],
      });
      filtered = fuzzyResults.map(r => r.item);
    } else {
      const q = params.query.toLowerCase();
      filtered = results.filter(r => r.name.toLowerCase().includes(q));
    }

    const paginated = filtered.slice(0, maxResults);
    const hasMore = filtered.length > maxResults;
    const footer = `\n\nShowing ${paginated.length} of ${filtered.length} symbols${hasMore ? ' (increase maxResults to see more)' : ''} (AST scan — run get_semantic_repo_map to build index)`;

    return {
      success: true,
      content: JSON.stringify(paginated, null, 2) + footer,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * NEW-03: Explain a symbol — signature + callers + callees in one call
 */
export async function explainSymbol(params: {
  filePath: string;
  projectRoot: string;
  symbolName: string;
  className?: string;
  parser: BaseParser;
  rootDir: string;
}): Promise<ReadResult> {
  try {
    const content = await fs.readFile(params.filePath, 'utf-8');
    const tree = params.parser.parse(content);
    const symbols = params.parser.findSymbols(tree);

    const sym = symbols.find(s =>
      s.name === params.symbolName && (!params.className || s.className === params.className)
    );

    if (!sym) {
      return {
        success: false,
        error: `Symbol "${params.symbolName}" not found. Available: ${symbols.map(s => s.name).join(', ')}`,
      };
    }

    const extracted = params.parser.extractSymbol(tree, params.symbolName, params.className);

    // Extract signature (first line of the symbol)
    const signature = extracted ? extracted.split('\n')[0].trim() : '';

    // Find callers (files that reference this symbol name)
    const callers: string[] = [];
    await walkDir(params.rootDir, {
      extensions: SUPPORTED_EXTENSIONS,
      excludeDirs: EXCLUDE_DIRS,
      onFile: async (fullPath) => {
        if (fullPath === params.filePath) return;
        const c = await fs.readFile(fullPath, 'utf-8');
        if (c.includes(params.symbolName)) callers.push(fullPath);
      },
    });

    const result = {
      name: sym.name,
      type: sym.type,
      className: sym.className,
      signature,
      startLine: sym.startLine,
      endLine: sym.endLine,
      file: params.filePath,
      callers: callers.slice(0, 10), // cap at 10
      callerCount: callers.length,
    };

    return {
      success: true,
      content: JSON.stringify(result, null, 2),
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * NEW-05: Batch read multiple symbols in one call
 */
export async function batchRead(params: {
  reads: Array<{ filePath: string; symbolName: string; className?: string }>;
  projectRoot: string;
  parser: (ext: string) => BaseParser | null;
}): Promise<ReadResult> {
  try {
    const results: Array<{
      filePath: string;
      symbolName: string;
      className?: string;
      content?: string;
      error?: string;
    }> = [];

    for (const read of params.reads) {
      const ext = path.extname(read.filePath);
      const parser = params.parser(ext);
      if (!parser) {
        results.push({ ...read, error: `No parser for ${ext}` });
        continue;
      }

      const r = await extractSymbol({
        filePath: read.filePath,
        projectRoot: params.projectRoot,
        symbolName: read.symbolName,
        className: read.className,
        parser,
      });

      results.push({
        filePath: read.filePath,
        symbolName: read.symbolName,
        className: read.className,
        content: r.content,
        error: r.error,
      });
    }

    return {
      success: true,
      content: JSON.stringify(results, null, 2),
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
