/**
 * TypeScript Parser - v3.0.0
 * Tree-sitter based TS/JS parser
 */
import Parser from "tree-sitter";
import { BaseParser, SymbolInfo } from "./base.js";
export declare class TypeScriptParser extends BaseParser {
    constructor();
    extractSymbol(tree: Parser.Tree, symbolName: string, className?: string): string | null;
    replaceSymbol(content: string, tree: Parser.Tree, symbolName: string, newContent: string, className?: string): string;
    findSymbols(tree: Parser.Tree): SymbolInfo[];
    private findParentClass;
}
