/**
 * Dart Tree-sitter Parser - v3.0.0
 * 100% AST accuracy (requires tree-sitter-dart installed)
 */
import { Tree } from "web-tree-sitter";
import { BaseParser, SymbolInfo } from "./base.js";
export declare class DartTreeSitterParser extends BaseParser {
    constructor();
    extractSymbol(tree: Tree, symbolName: string, className?: string): string | null;
    replaceSymbol(content: string, tree: Tree, symbolName: string, newContent: string, className?: string): string;
    findSymbols(tree: Tree): SymbolInfo[];
    private findParentClass;
}
