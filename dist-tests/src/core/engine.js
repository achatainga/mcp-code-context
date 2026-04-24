/**
 * Core Engine - v3.5.2
 * ASYNC I/O: Migrated to fs.promises
 */
import { Parser, Language } from "web-tree-sitter";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname } from "path";
import { createRequire } from "node:module";
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
            // 1. If running from src/core/engine.ts (ts-node)
            path.join(dirname(fileURLToPath(import.meta.url)), "..", "..", "node_modules", "tree-sitter-wasms", "out", wasmFile),
            // 2. If running from dist/src/core/engine.js (compiled)
            path.join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "node_modules", "tree-sitter-wasms", "out", wasmFile),
            // 3. Fallback to process.cwd()
            path.join(process.cwd(), "node_modules", "tree-sitter-wasms", "out", wasmFile),
        ];
        // 4. Robust Node.js module resolution (handles npx hoisting and global installs)
        try {
            const require = createRequire(import.meta.url);
            const pkgPath = require.resolve("tree-sitter-wasms/package.json");
            possiblePaths.unshift(path.join(path.dirname(pkgPath), "out", wasmFile));
        }
        catch {
            // Ignore resolution errors, fallback to manual paths
        }
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