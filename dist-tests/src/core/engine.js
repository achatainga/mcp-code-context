/**
 * Core Engine - v3.4.0
 * ASYNC I/O: Migrated to fs.promises
 */
import { Parser, Language } from "web-tree-sitter";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname } from "path";
export class CodeContextEngine {
    config;
    initialized = false;
    parser = null;
    languages = new Map();
    constructor(config = {}) {
        this.config = {
            wasmPath: path.join(process.cwd(), "wasm"),
            maxCacheSize: 200 * 1024 * 1024,
            ...config,
        };
    }
    async init() {
        if (this.initialized)
            return;
        await Parser.init();
        this.parser = new Parser();
        this.initialized = true;
    }
    async loadLanguage(name) {
        if (!this.initialized || !this.parser) {
            throw new Error("Engine not initialized");
        }
        const wasmFile = `tree-sitter-${name}.wasm`;
        const possiblePaths = [
            path.join(dirname(fileURLToPath(import.meta.url)), "..", "..", "node_modules", "tree-sitter-wasms", "out", wasmFile),
            path.join(process.cwd(), "node_modules", "tree-sitter-wasms", "out", wasmFile),
        ];
        let wasmPath = null;
        for (const p of possiblePaths) {
            try {
                await fs.access(p);
                wasmPath = p;
                break;
            }
            catch {
                continue;
            }
        }
        if (!wasmPath) {
            throw new Error(`WASM file not found: ${wasmFile}. Tried paths: ${possiblePaths.join(", ")}`);
        }
        // CRITICAL FIX: Async I/O
        const wasmBuffer = await fs.readFile(wasmPath);
        const language = await Language.load(wasmBuffer);
        this.languages.set(name, language);
    }
    getLanguage(name) {
        return this.languages.get(name);
    }
    createParser() {
        if (!this.initialized || !this.parser) {
            throw new Error("Engine not initialized");
        }
        return new Parser();
    }
    isInitialized() {
        return this.initialized;
    }
}
//# sourceMappingURL=engine.js.map