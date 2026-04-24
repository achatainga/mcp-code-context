/**
 * Base Parser - v3.0.0
 * Abstract base for all language parsers
 */
import { Parser, Tree, Language } from "web-tree-sitter";
export interface ParseResult {
    tree: Tree;
    language: string;
}
export interface SymbolInfo {
    name: string;
    type: string;
    startIndex: number;
    endIndex: number;
    className?: string;
}
export declare abstract class BaseParser {
    protected parser: Parser;
    protected language: Language;
    protected languageName: string;
    constructor(languageName: string);
    init(parser: Parser, language: Language): Promise<void>;
    parse(content: string, oldTree?: Tree): Tree;
    abstract extractSymbol(tree: Tree, symbolName: string, className?: string): string | null;
    abstract replaceSymbol(content: string, tree: Tree, symbolName: string, newContent: string, className?: string): string;
    abstract findSymbols(tree: Tree): SymbolInfo[];
    getName(): string;
}
