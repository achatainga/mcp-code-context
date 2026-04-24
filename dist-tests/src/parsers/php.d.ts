/**
 * PHP Parser - v3.0.0
 */
import { Tree } from "web-tree-sitter";
import { BaseParser, SymbolInfo } from "./base.js";
export declare class PHPParser extends BaseParser {
    constructor();
    extractSymbol(tree: Tree, symbolName: string, className?: string): string | null;
    replaceSymbol(content: string, tree: Tree, symbolName: string, newContent: string, className?: string): string;
    findSymbols(tree: Tree): SymbolInfo[];
    private findParentClass;
}
