/**
 * Python Parser - v3.8.1
 * CLEANUP: replaceSymbol removed (inherited from BaseParser)
 * v3.8.1: override getInsideStartIndex/getInsideEndIndex for indentation-based syntax
 */

import { Parser, Tree, Node } from "web-tree-sitter";
import { BaseParser, SymbolInfo } from "./base.js";

export class PythonParser extends BaseParser {
  constructor() {
    super("python");
  }

  /**
   * For Python's indentation-based blocks, inside_start = first byte after the `:` + newline
   * that opens the block body (e.g. after `def foo():\n`).
   */
  getInsideStartIndex(content: string, symbolInfo: SymbolInfo): number {
    // Find the colon that opens the block
    const colon = content.indexOf(":", symbolInfo.startIndex);
    if (colon === -1) return symbolInfo.startIndex + 1;
    const newline = content.indexOf("\n", colon);
    return newline !== -1 ? newline + 1 : colon + 1;
  }

  /**
   * For Python's indentation-based blocks, inside_end = last byte of the last statement
   * in the body — i.e. just before the symbol's endIndex, excluding trailing newlines.
   */
  getInsideEndIndex(content: string, symbolInfo: SymbolInfo): number {
    // Walk back from endIndex past any trailing whitespace/newlines
    let idx = symbolInfo.endIndex - 1;
    while (idx > symbolInfo.startIndex && (content[idx] === "\n" || content[idx] === "\r" || content[idx] === " " || content[idx] === "\t")) {
      idx--;
    }
    return idx + 1;
  }

  extractSymbol(tree: Tree, symbolName: string, className?: string): string | null {
    const cursor = tree.walk();

    const search = (): string | null => {
      const node = cursor.currentNode;

      if (node.type === "function_definition" || node.type === "class_definition") {
        const nameNode = node.childForFieldName("name");
        if (nameNode && nameNode.text === symbolName) {
          if (className) {
            const classNode = this.findParentClass(node);
            if (!classNode || classNode.childForFieldName("name")?.text !== className) {
              // Continue searching
            } else {
              return tree.rootNode.text.substring(node.startIndex, node.endIndex);
            }
          } else {
            return tree.rootNode.text.substring(node.startIndex, node.endIndex);
          }
        }
      }

      if (cursor.gotoFirstChild()) {
        do {
          const result = search();
          if (result) return result;
        } while (cursor.gotoNextSibling());
        cursor.gotoParent();
      }

      return null;
    };

    return search();
  }

  findSymbols(tree: Tree): SymbolInfo[] {
    const symbols: SymbolInfo[] = [];
    const cursor = tree.walk();
    const src = tree.rootNode.text;

    const offsetToLine = (offset: number) => src.substring(0, offset).split('\n').length;

    const visit = () => {
      const node = cursor.currentNode;

      if (node.type === "function_definition" || node.type === "class_definition") {
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
        do {
          visit();
        } while (cursor.gotoNextSibling());
        cursor.gotoParent();
      }
    };

    visit();
    return symbols;
  }

  private findParentClass(node: Node): Node | null {
    let current = node.parent;
    while (current) {
      if (current.type === "class_definition") return current;
      current = current.parent;
    }
    return null;
  }
}
