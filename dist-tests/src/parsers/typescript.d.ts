/**
 * TypeScript Parser - v3.5.3
 * Tree-sitter based TS/JS parser
 * CLEANUP: replaceSymbol removed (inherited from BaseParser)
 */
import { Tree } from "web-tree-sitter";
import { BaseParser, SymbolInfo } from "./base.js";
export declare class TypeScriptParser extends BaseParser {
    constructor();
    extractSymbol(tree: Tree, symbolName: string, className?: string): string | null;
    findSymbols(tree: Tree): SymbolInfo[];
    private findParentClass;
}
