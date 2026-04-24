/**
 * Core Engine - v3.0.0
 * Tree-sitter WASM-based parsing engine
 */

import Parser from "tree-sitter";
import * as path from "node:path";

export interface EngineConfig {
  wasmPath?: string;
  maxCacheSize?: number;
}

export class CodeContextEngine {
  private config: EngineConfig;
  private initialized: boolean = false;
  private parser: Parser | null = null;
  private languages: Map<string, any> = new Map();

  constructor(config: EngineConfig = {}) {
    this.config = {
      wasmPath: path.join(process.cwd(), "wasm"),
      maxCacheSize: 200 * 1024 * 1024,
      ...config,
    };
  }

  async init(): Promise<void> {
    if (this.initialized) return;
    this.parser = new Parser();
    this.initialized = true;
  }

  async loadLanguage(name: string): Promise<void> {
    if (!this.initialized || !this.parser) {
      throw new Error("Engine not initialized");
    }

    let language: any;
    switch (name) {
      case "typescript":
        language = (await import("tree-sitter-typescript")).default.typescript;
        break;
      case "python":
        language = (await import("tree-sitter-python")).default;
        break;
      case "php":
        language = (await import("tree-sitter-php")).default.php;
        break;
      default:
        throw new Error(`Unsupported language: ${name}`);
    }

    this.languages.set(name, language);
  }

  getLanguage(name: string): any {
    return this.languages.get(name);
  }

  createParser(): Parser {
    if (!this.initialized || !this.parser) {
      throw new Error("Engine not initialized");
    }
    return new Parser();
  }

  isInitialized(): boolean {
    return this.initialized;
  }
}
