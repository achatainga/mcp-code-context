/**
 * Parser Registry - v3.0.0
 * Manages all language parsers
 */

import { BaseParser } from "./base.js";
import { TypeScriptParser } from "./typescript.js";
import { CodeContextEngine } from "../core/engine.js";

export class ParserRegistry {
  private parsers: Map<string, BaseParser> = new Map();
  private engine: CodeContextEngine;
  private extensionMap: Map<string, string> = new Map([
    [".ts", "typescript"],
    [".tsx", "typescript"],
    [".js", "typescript"],
    [".jsx", "typescript"],
    [".mts", "typescript"],
    [".mjs", "typescript"],
  ]);

  constructor(engine: CodeContextEngine) {
    this.engine = engine;
  }

  async init(): Promise<void> {
    // Load TypeScript language
    await this.engine.loadLanguage("typescript");
    
    const tsLang = this.engine.getLanguage("typescript");
    if (!tsLang) throw new Error("Failed to load TypeScript language");

    const tsParser = new TypeScriptParser();
    await tsParser.init(this.engine.createParser(), tsLang);
    this.parsers.set("typescript", tsParser);
  }

  getParser(fileExtension: string): BaseParser | undefined {
    const language = this.extensionMap.get(fileExtension);
    return language ? this.parsers.get(language) : undefined;
  }

  getSupportedExtensions(): string[] {
    return Array.from(this.extensionMap.keys());
  }
}
