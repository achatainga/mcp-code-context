/**
 * Base Parser - v3.0.0
 * Abstract base for all language parsers
 */
import Parser from "tree-sitter";
export interface ParseResult {
    tree: Parser.Tree;
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
    protected language: any;
    protected languageName: string;
    constructor(languageName: string);
    init(parser: Parser, language: any): Promise<void>;
    parse(content: string, oldTree?: Parser.Tree): Parser.Tree;
    abstract extractSymbol(tree: Parser.Tree, symbolName: string, className?: string): string | null;
    abstract replaceSymbol(content: string, tree: Parser.Tree, symbolName: string, newContent: string, className?: string): string;
    abstract findSymbols(tree: Parser.Tree): SymbolInfo[];
    getName(): string;
}
