/**
 * TypeScript Parser - v3.7.0
 * Tree-sitter based TS/JS parser
 * CLEANUP: replaceSymbol removed (inherited from BaseParser)
 */

import { Parser, Tree, Node } from "web-tree-sitter";
import { BaseParser, SymbolInfo } from "./base.js";

export class TypeScriptParser extends BaseParser {
  constructor() {
    super("typescript");
  }

  extractSymbol(tree: Tree, symbolName: string, className?: string): string | null {
    const src = tree.rootNode.text;
    const symbols = this.findSymbols(tree);

    const target = symbols.find(s =>
      s.name === symbolName && (!className || s.className === className)
    );

    if (!target) return null;

    return src.substring(target.startIndex, target.endIndex);
  }

  findSymbols(tree: Tree): SymbolInfo[] {
    const symbols: SymbolInfo[] = [];
    const cursor = tree.walk();
    const src = tree.rootNode.text;

    const offsetToLine = (offset: number) => src.substring(0, offset).split('\n').length;

    const visit = () => {
      const node = cursor.currentNode;

      // Standard declarations: function, class, interface, type, method
      if (node.type === "function_declaration" ||
          node.type === "class_declaration" ||
          node.type === "interface_declaration" ||
          node.type === "type_alias_declaration" ||
          node.type === "method_definition") {
        const nameNode = node.childForFieldName("name");
        if (nameNode) {
          const parentClass = this.findParentClass(node);
          const exportParent = node.parent?.type === "export_statement" ? node.parent : null;
          const startIndex = exportParent ? exportParent.startIndex : node.startIndex;
          const endIndex = exportParent ? exportParent.endIndex : node.endIndex;
          symbols.push({
            name: nameNode.text,
            type: node.type,
            startIndex,
            endIndex,
            startLine: offsetToLine(startIndex),
            endLine: offsetToLine(endIndex),
            className: parentClass?.childForFieldName("name")?.text,
          });
        }
      }

      // Arrow functions and function expressions: const Foo = () => {} / const Foo = function() {}
      if (node.type === "variable_declarator") {
        const nameNode = node.childForFieldName("name");
        const valueNode = node.childForFieldName("value");
        if (nameNode && valueNode &&
            (valueNode.type === "arrow_function" || valueNode.type === "function_expression")) {
          // Walk up to lexical_declaration or variable_declaration to include const/let/var + export
          const declNode = node.parent; // lexical_declaration or variable_declaration
          const exportParent = declNode?.parent?.type === "export_statement" ? declNode.parent : null;
          const startIndex = exportParent ? exportParent.startIndex : (declNode?.startIndex ?? node.startIndex);
          const endIndex = exportParent ? exportParent.endIndex : (declNode?.endIndex ?? node.endIndex);
          symbols.push({
            name: nameNode.text,
            type: "variable_declarator",
            startIndex,
            endIndex,
            startLine: offsetToLine(startIndex),
            endLine: offsetToLine(endIndex),
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
