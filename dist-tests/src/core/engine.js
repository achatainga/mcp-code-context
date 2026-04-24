/**
 * Core Engine - v3.0.0
 * Tree-sitter WASM-based parsing engine
 */
import { Parser, Language } from "web-tree-sitter";
import * as path from "node:path";
import * as fs from "node:fs";
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
        // Try multiple paths: installed module, local dev, CWD fallback
        const possiblePaths = [
            // When installed as npm package
            path.join(dirname(fileURLToPath(import.meta.url)), "..", "..", "node_modules", "tree-sitter-wasms", "out", wasmFile),
            // When running from source
            path.join(process.cwd(), "node_modules", "tree-sitter-wasms", "out", wasmFile),
        ];
        let wasmPath = null;
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