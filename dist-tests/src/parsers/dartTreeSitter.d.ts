/**
 * Dart Tree-sitter Parser - v3.4.1
 * 100% AST accuracy via WASM
 * CLEANUP: replaceSymbol removed (inherited from BaseParser)
 */
import { Tree } from "web-tree-sitter";
import { BaseParser, SymbolInfo } from "./base.js";
export declare class DartTreeSitterParser extends BaseParser {
    constructor();
    extractSymbol(tree: Tree, symbolName: string, className?: string): string | null;
    findSymbols(tree: Tree): SymbolInfo[];
    private findParentClass;
}
