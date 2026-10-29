/**
 * Concept Search Operation
 * 
 * Provides AST-aware conceptual and semantic code search.
 * Discovers functions, classes, and methods based on domain concepts,
 * docstring intent, and parameter patterns rather than exact name matching.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { EXCLUDE_DIRS, SUPPORTED_EXTENSIONS, MAX_FILES_SEARCH, MAX_FILE_SIZE_BYTES } from "../utils/constants.js";
import { walkDir } from "../utils/fileWalker.js";
import { ParserRegistry } from "../parsers/registry.js";
import { CodeContextEngine } from "../core/engine.js";
import {
  tokenizeText,
  buildConceptVector,
  calculateConceptSimilarity,
  type ConceptMatch,
} from "../utils/conceptEngine.js";
import type { ReadResult } from "./readCore.js";

const DEFAULT_THRESHOLD = 0.25;
const DEFAULT_MAX_RESULTS = 15;

export async function searchCodeConcept(params: {
  rootDir: string;
  projectRoot: string;
  query: string;
  threshold?: number;
  maxResults?: number;
  fileExtensions?: string[];
  excludeDirs?: string[];
  registry?: ParserRegistry;
}): Promise<ReadResult> {
  try {
    const query = (params.query || "").trim();
    if (!query) {
      return {
        success: false,
        error: "Query parameter cannot be empty for search_code_concept",
      };
    }

    const threshold = params.threshold !== undefined ? params.threshold : DEFAULT_THRESHOLD;
    const maxResults = params.maxResults || DEFAULT_MAX_RESULTS;
    const extensions = params.fileExtensions || SUPPORTED_EXTENSIONS;
    const excludeDirs = params.excludeDirs || EXCLUDE_DIRS;

    // 1. Build Query Concept Vector
    const queryTokens = tokenizeText(query);
    if (queryTokens.length === 0) {
      return {
        success: false,
        error: `Could not extract conceptual tokens from query: "${query}"`,
      };
    }
    const queryVector = buildConceptVector(queryTokens);

    // 2. Initialize Parser Registry
    let registry = params.registry;
    if (!registry) {
      const engine = new CodeContextEngine();
      await engine.init();
      registry = new ParserRegistry(engine);
      await registry.init();
    }

    const candidateMatches: ConceptMatch[] = [];
    let scannedFilesCount = 0;

    // 3. Walk Files and Extract AST Symbols with Context
    await walkDir(params.rootDir, {
      extensions,
      excludeDirs,
      onFile: async (fullPath) => {
        if (scannedFilesCount >= MAX_FILES_SEARCH) return;

        const ext = path.extname(fullPath);
        const parser = registry!.getParser(ext);
        if (!parser) return;

        let content: string;
        try {
          const stat = await fs.stat(fullPath);
          if (stat.size > Math.min(MAX_FILE_SIZE_BYTES, 2 * 1024 * 1024)) return; // Max 2MB for AST concept scan
          content = await fs.readFile(fullPath, "utf-8");
          scannedFilesCount++;
        } catch {
          return;
        }

        let tree;
        try {
          tree = parser.parse(content);
          const symbols = parser.findSymbols(tree);
          const fileLines = content.split("\n");
          const filePathTokens = tokenizeText(path.relative(params.projectRoot, fullPath));

          for (const sym of symbols) {
            // Extract preceding docstring / comment lines (up to 6 lines before startLine)
            let docstring = "";
            if (sym.startLine && sym.startLine > 1) {
              const startIdx = Math.max(0, sym.startLine - 7);
              const preceding = fileLines.slice(startIdx, sym.startLine - 1).join("\n");
              const docMatch = preceding.match(/\/\*\*[\s\S]*?\*\/|"""[\s\S]*?"""|'''[\s\S]*?'''|(?:(?:\/\/|\#)[^\n]*(?:\n|$))+$/);
              if (docMatch) {
                docstring = docMatch[0].replace(/[\/*#"']/g, " ").trim();
              }
            }

            // Extract signature snippet (from symbol startIndex to next brace or newline)
            const symSnippet = content.slice(sym.startIndex, Math.min(content.length, sym.startIndex + 250));
            const signatureLine = symSnippet.split(/[{;:\n]/)[0].trim();

            // Build composite symbol document tokens
            const nameTokens = tokenizeText(sym.name);
            const classTokens = sym.className ? tokenizeText(sym.className) : [];
            const docTokens = tokenizeText(docstring);
            const sigTokens = tokenizeText(signatureLine);

            const compositeTokens = [
              ...nameTokens,
              ...nameTokens, // double weight on symbol name
              ...classTokens,
              ...docTokens,
              ...sigTokens,
              ...filePathTokens,
            ];

            const docVector = buildConceptVector(compositeTokens);
            const sim = calculateConceptSimilarity(queryVector, docVector);

            if (sim.score >= threshold) {
              let rationale = "";
              if (sim.matchedConcepts.length > 0 && sim.overlappingTokens.length > 0) {
                rationale = `Matches concepts [${sim.matchedConcepts.join(", ")}] via terms: ${sim.overlappingTokens.slice(0, 5).join(", ")}`;
              } else if (sim.matchedConcepts.length > 0) {
                rationale = `Matches concepts [${sim.matchedConcepts.join(", ")}] based on semantic domain proximity`;
              } else if (sim.overlappingTokens.length > 0) {
                rationale = `Matches lexical terms: ${sim.overlappingTokens.slice(0, 5).join(", ")}`;
              } else {
                rationale = "Matches contextual signature profile";
              }

              candidateMatches.push({
                name: sym.name,
                type: sym.type,
                filePath: fullPath,
                startLine: sym.startLine,
                endLine: sym.endLine,
                className: sym.className,
                signature: signatureLine,
                docstring: docstring ? docstring.slice(0, 100) : undefined,
                score: sim.score,
                matchedConcepts: sim.matchedConcepts,
                rationale,
              });
            }
          }
        } catch {
          return;
        } finally {
          try {
            tree?.delete();
          } catch {
            // Safe deallocation of WASM linear memory
          }
        }
      },
    });

    // 4. Sort and Paginate
    candidateMatches.sort((a, b) => b.score - a.score);
    const topMatches = candidateMatches.slice(0, maxResults);

    const formattedResults = topMatches.map((m) => ({
      name: m.name,
      type: m.type,
      file: path.relative(params.projectRoot, m.filePath).replace(/\\/g, "/"),
      line: m.startLine,
      score: m.score,
      className: m.className,
      signature: m.signature,
      docstring: m.docstring,
      rationale: m.rationale,
    }));

    const footer = `\n\nFound ${candidateMatches.length} conceptual matches (showing top ${formattedResults.length}, threshold: ${threshold})`;
    return {
      success: true,
      content: JSON.stringify(formattedResults, null, 2) + footer,
    };
  } catch (error: any) {
    return {
      success: false,
      error: `search_code_concept failed: ${error.message || String(error)}`,
    };
  }
}
