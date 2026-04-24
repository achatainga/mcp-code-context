/**
 * PHP Parser - v3.4.0
 * CLEANUP: replaceSymbol removed (inherited from BaseParser)
 */
import { Tree } from "web-tree-sitter";
import { BaseParser, SymbolInfo } from "./base.js";
export declare class PHPParser extends BaseParser {
    constructor();
    extractSymbol(tree: Tree, symbolName: string, className?: string): string | null;
    findSymbols(tree: Tree): SymbolInfo[];
    private findParentClass;
}
