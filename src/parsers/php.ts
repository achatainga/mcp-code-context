/**
 * PHP Parser - v3.5.0
 * CLEANUP: replaceSymbol removed (inherited from BaseParser)
 */

import { Parser, Tree, Node } from "web-tree-sitter";
import { BaseParser, SymbolInfo } from "./base.js";

export class PHPParser extends BaseParser {
  constructor() {
    super("php");
  }

  extractSymbol(tree: Tree, symbolName: string, className?: string): string | null {
    const cursor = tree.walk();

    const search = (): string | null => {
      const node = cursor.currentNode;

      if (node.type === "function_definition" || node.type === "class_declaration" || node.type === "method_declaration") {
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

    const visit = () => {
      const node = cursor.currentNode;

      if (node.type === "function_definition" || node.type === "class_declaration" || node.type === "method_declaration") {
        const nameNode = node.childForFieldName("name");
        if (nameNode) {
          const parentClass = this.findParentClass(node);
          symbols.push({
            name: nameNode.text,
            type: node.type,
            startIndex: node.startIndex,
            endIndex: node.endIndex,
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
      if (current.type === "class_declaration") return current;
      current = current.parent;
    }
    return null;
  }
}
