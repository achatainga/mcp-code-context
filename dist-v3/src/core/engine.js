/**
 * Core Engine - v3.0.0
 * Tree-sitter WASM-based parsing engine
 */
import Parser from "tree-sitter";
import * as path from "node:path";
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
        this.parser = new Parser();
        this.initialized = true;
    }
    async loadLanguage(name) {
        if (!this.initialized || !this.parser) {
            throw new Error("Engine not initialized");
        }
        let language;
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