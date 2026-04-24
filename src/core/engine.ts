/**
 * Core Engine - v3.0.0
 * Tree-sitter WASM-based parsing engine
 */

import { Parser, Language } from "web-tree-sitter";
import * as path from "node:path";
import * as fs from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname } from "path";
 
export interface EngineConfig {
  wasmPath?: string;
  maxCacheSize?: number;
}
 
export class CodeContextEngine {
  private config: EngineConfig;
  private initialized: boolean = false;
  private parser: Parser | null = null;
  private languages: Map<string, Language> = new Map();
 
  constructor(config: EngineConfig = {}) {
    this.config = {
      wasmPath: path.join(process.cwd(), "wasm"),
      maxCacheSize: 200 * 1024 * 1024,
      ...config,
    };
  }
 
  async init(): Promise<void> {
    if (this.initialized) return;
 
    await Parser.init();
 
    this.parser = new Parser();
    this.initialized = true;
  }
 
  async loadLanguage(name: string): Promise<void> {
    if (!this.initialized || !this.parser) {
      throw new Error("Engine not initialized");
    }
 
    const wasmFile = `tree-sitter-${name}.wasm`;
    
    // Try multiple paths: installed module, local dev, CWD fallback
    const possiblePaths = [
      // When installed as npm package
      path.join(dirname(fileURLToPath(import.meta.url)), "..", "..", "node_modules", "tree-sitter-wasms", "out", wasmFile),
      // When running from source
      path.join(process.cwd(), "node_modules", "tree-sitter-wasms", "out", wasmFile),
    ];
    
    let wasmPath: string | null = null;
    for (const p of possiblePaths) {
      if (fs.existsSync(p)) {
        wasmPath = p;
        break;
      }
    }
    
    if (!wasmPath) {
      throw new Error(`WASM file not found: ${wasmFile}. Tried paths: ${possiblePaths.join(", ")}`);
    }
    
    const wasmBuffer = fs.readFileSync(wasmPath);
    const language = await Language.load(wasmBuffer);
    this.languages.set(name, language);
  }
 
  getLanguage(name: string): Language | undefined {
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
