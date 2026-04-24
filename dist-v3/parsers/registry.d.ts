/**
 * Parser Registry - v3.0.0
 * Manages all language parsers
 */
import { BaseParser } from "./base.js";
import { CodeContextEngine } from "../core/engine.js";
export declare class ParserRegistry {
    private parsers;
    private engine;
    private extensionMap;
    constructor(engine: CodeContextEngine);
    init(): Promise<void>;
    getParser(fileExtension: string): BaseParser | undefined;
    getSupportedExtensions(): string[];
}
