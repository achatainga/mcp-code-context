/**
 * Core Engine - v3.5.0
 * ASYNC I/O: Migrated to fs.promises
 */
import { Parser, Language } from "web-tree-sitter";
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
    getLanguage(name: string): Language | undefined;
    createParser(): Parser;
    isInitialized(): boolean;
}
