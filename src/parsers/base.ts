/**
 * Base Parser - v3.7.1
 * Abstract base for all language parsers
 * IMPROVEMENT: replaceSymbol moved here using AST indices (eliminates indexOf fragility)
 */

import { Parser, Tree, Language, Node } from "web-tree-sitter";

export interface ParseResult {
  tree: Tree;
  language: string;
}

export interface SymbolInfo {
  name: string;
  type: string;
  startIndex: number;
  endIndex: number;
  startLine?: number;
  endLine?: number;
  className?: string;
}

export abstract class BaseParser {
  protected parser!: Parser;
  protected language!: Language;
  protected languageName: string;

  constructor(languageName: string) {
    this.languageName = languageName;
  }

  async init(parser: Parser, language: Language): Promise<void> {
    this.parser = parser;
    this.language = language;
    this.parser.setLanguage(language);
  }

  parse(content: string, oldTree?: Tree): Tree {
    const tree = this.parser.parse(content, oldTree);
    if (!tree) throw new Error(`${this.languageName} parsing failed`);
    return tree;
  }

  abstract extractSymbol(
    tree: Tree,
    symbolName: string,
    className?: string
  ): string | null;

  /**
   * Replace a symbol using AST startIndex/endIndex (no indexOf fragility)
   * Concrete implementation — subclasses inherit this.
   */
  replaceSymbol(
    content: string,
    tree: Tree,
    symbolName: string,
    newContent: string,
    className?: string
  ): string {
    // Find symbol via AST
    const symbols = this.findSymbols(tree);
    const target = symbols.find(s =>
      s.name === symbolName && (!className || s.className === className)
    );

    if (!target) {
      throw new Error(`Symbol "${symbolName}" not found`);
    }

    // Use AST indices for precise replacement (no indexOf false-match)
    return content.substring(0, target.startIndex) +
      newContent +
      content.substring(target.endIndex);
  }

  abstract findSymbols(tree: Tree): SymbolInfo[];

  getName(): string {
    return this.languageName;
  }
}
