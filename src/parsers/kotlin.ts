/**
 * Kotlin Parser - v3.7.0
 * Tree-sitter based Kotlin parser
 */

import { Tree, Node } from "web-tree-sitter";
import { BaseParser, SymbolInfo } from "./base.js";

export class KotlinParser extends BaseParser {
  constructor() {
    super("kotlin");
  }

  extractSymbol(tree: Tree, symbolName: string, className?: string): string | null {
    const src = tree.rootNode.text;
    const symbols = this.findSymbols(tree);
    const target = symbols.find(s =>
      s.name === symbolName && (!className || s.className === className)
    );
    return target ? src.substring(target.startIndex, target.endIndex) : null;
  }

  findSymbols(tree: Tree): SymbolInfo[] {
    const symbols: SymbolInfo[] = [];
    const cursor = tree.walk();
    const src = tree.rootNode.text;
    const offsetToLine = (offset: number) => src.substring(0, offset).split("\n").length;

    const visit = () => {
      const node = cursor.currentNode;

      if (node.type === "class_declaration" ||
          node.type === "object_declaration" ||
          node.type === "interface_declaration") {
        const nameNode = node.children.find(c => c !== null && c.type === "type_identifier");
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

      if (node.type === "function_declaration") {
        const nameNode = node.children.find(c => c !== null && c.type === "simple_identifier");
        if (nameNode) {
          const parentClass = this.findParentClass(node);
          const classNameNode = parentClass?.children.find(c => c !== null && c.type === "type_identifier");
          symbols.push({
            name: nameNode.text,
            type: node.type,
            startIndex: node.startIndex,
            endIndex: node.endIndex,
            startLine: offsetToLine(node.startIndex),
            endLine: offsetToLine(node.endIndex),
            className: classNameNode?.text,
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
      if (current.type === "class_declaration" ||
          current.type === "object_declaration") return current;
      current = current.parent;
    }
    return null;
  }
}
