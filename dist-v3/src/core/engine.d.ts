/**
 * Core Engine - v3.0.0
 * Tree-sitter WASM-based parsing engine
 */
import Parser from "tree-sitter";
export interface EngineConfig {
    wasmPath?: string;
    maxCacheSize?: number;
}
export declare class CodeContextEngine {
    private config;
    private initialized;
    private parser;
    private languages;
    constructor(config?: EngineConfig);
    init(): Promise<void>;
    loadLanguage(name: string): Promise<void>;
    getLanguage(name: string): any;
    createParser(): Parser;
    isInitialized(): boolean;
}
