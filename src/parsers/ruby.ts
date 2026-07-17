/**
 * Ruby Parser - v3.9.1
 * Tree-sitter based Ruby parser
 * v3.9.1: override getInsideStartIndex/getInsideEndIndex for end-based syntax
 */

import { Tree, Node } from "web-tree-sitter";
import { BaseParser, SymbolInfo } from "./base.js";

export class RubyParser extends BaseParser {
  constructor() {
    super("ruby");
  }

  /**
   * Extract a symbol from source content using AST byte offsets.
   * NOTE: uses content directly (not tree.rootNode.text) because web-tree-sitter
   * may strip leading whitespace/newlines from rootNode.text on Windows/WASM,
   * causing off-by-one drift against the original byte offsets.
   */
  extractSymbol(tree: Tree, symbolName: string, className?: string): string | null {
    const symbols = this.findSymbols(tree);
    const target = symbols.find(s =>
      s.name === symbolName && (!className || s.className === className)
    );
    if (!target) return null;
    // Reconstruct the original source from tree nodes — use the full text of the
    // root node's parent walk so we always have the unparsed original.
    // The safest approach: use tree.rootNode.text but correct the start offset.
    const src = tree.rootNode.text;
    const rootStart = tree.rootNode.startIndex;
    return src.substring(target.startIndex - rootStart, target.endIndex - rootStart);
  }

  search(tree: Tree, pattern: string): SymbolInfo[] {
    return this.findSymbols(tree).filter(s =>
      s.name.toLowerCase().includes(pattern.toLowerCase())
    );
  }

  /**
   * For Ruby's `end`-based blocks, inside_start = first byte after the header line.
   * The header line is the first line of the node (e.g. "def full_name\n" or "class User < ApplicationRecord\n").
   * We find the newline that terminates the first line of the symbol and insert after it.
   */
  getInsideStartIndex(content: string, symbolInfo: SymbolInfo): number {
    // Find the newline that ends the opening line (def/class header)
    const firstNewline = content.indexOf("\n", symbolInfo.startIndex);
    return firstNewline !== -1 ? firstNewline + 1 : symbolInfo.startIndex + 1;
  }

  /**
   * For Ruby's `end`-based blocks, inside_end = the byte index of the `end` keyword itself.
   * We search backwards from the symbol's endIndex for the last "end" token on its own line.
   */
  getInsideEndIndex(content: string, symbolInfo: SymbolInfo): number {
    // Walk backwards from the node end to find the `end` keyword line
    const slice = content.substring(0, symbolInfo.endIndex);
    const endMatch = slice.match(/\bend\b\s*$/);
    if (endMatch && endMatch.index !== undefined) {
      return endMatch.index;
    }
    // Fallback: insert just before the last character of the symbol
    return symbolInfo.endIndex - 1;
  }

  findSymbols(tree: Tree): SymbolInfo[] {
    const symbols: SymbolInfo[] = [];
    const cursor = tree.walk();
    const src = tree.rootNode.text;
    const offsetToLine = (offset: number) => src.substring(0, offset).split("\n").length;

    const visit = () => {
      const node = cursor.currentNode;

      // class Foo / module Foo
      if (node.type === "class" || node.type === "module") {
        const nameNode = node.childForFieldName("name");
        if (nameNode) {
          symbols.push({
            name: nameNode.text,
            type: node.type,
            startIndex: node.startIndex,
            endIndex: node.endIndex,
            startLine: offsetToLine(node.startIndex),
            endLine: offsetToLine(node.endIndex),
          });
        }
      }

      // def method_name / def self.method_name
      if (node.type === "method" || node.type === "singleton_method") {
        const nameNode = node.childForFieldName("name");
        if (nameNode) {
          const parentClass = this.findParentClass(node);
          symbols.push({
            name: nameNode.text,
            type: node.type,
            startIndex: node.startIndex,
            endIndex: node.endIndex,
            startLine: offsetToLine(node.startIndex),
            endLine: offsetToLine(node.endIndex),
            className: parentClass?.childForFieldName("name")?.text,
          });
        }
      }

      if (cursor.gotoFirstChild()) {
        do { visit(); } while (cursor.gotoNextSibling());
        cursor.gotoParent();
      }
    };

    visit();
    return symbols;
  }

  private findParentClass(node: Node): Node | null {
    let current = node.parent;
    while (current) {
      if (current.type === "class" || current.type === "module") return current;
      current = current.parent;
    }
    return null;
  }
}
