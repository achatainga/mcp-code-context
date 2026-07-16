/**
 * Dart Tree-sitter Parser - v3.8.1
 * 100% AST accuracy via WASM
 * CLEANUP: replaceSymbol removed (inherited from BaseParser)
 */

import { Parser, Tree, Node } from "web-tree-sitter";
import { BaseParser, SymbolInfo } from "./base.js";

export class DartTreeSitterParser extends BaseParser {
  constructor() {
    super("dart");
  }

  extractSymbol(tree: Tree, symbolName: string, className?: string): string | null {
    const cursor = tree.walk();

    const search = (): string | null => {
      const node = cursor.currentNode;

      if (node.type === "function_signature" ||
          node.type === "class_definition" ||
          node.type === "method_signature") {
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

      if (node.type === "function_signature" ||
          node.type === "class_definition" ||
          node.type === "method_signature") {
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
