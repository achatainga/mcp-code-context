import { describe, it, expect, beforeAll } from 'vitest';
import { TypeScriptParser } from '@/parsers/typescript';
import { CodeContextEngine } from '@/core/engine';
import { readFileSync } from 'fs';
import path from 'path';

describe('TypeScriptParser', () => {
  let parser: TypeScriptParser;
  let engine: CodeContextEngine;
  let sampleCode: string;

  beforeAll(async () => {
    engine = new CodeContextEngine({ wasmPath: path.join(process.cwd(), 'wasm') });
    await engine.init();
    parser = new TypeScriptParser(engine);
    await parser.init();
    
    sampleCode = readFileSync(
      path.join(process.cwd(), 'tests/fixtures/typescript/sample.ts'),
      'utf-8'
    );
  });

  describe('extractSymbol', () => {
    it('should extract interface declaration', async () => {
      const tree = parser.parse(sampleCode);
      const result = parser.extractSymbol(tree, 'User');
      
      expect(result).toBeTruthy();
      expect(result).toContain('interface User');
      expect(result).toContain('id: number');
    });

    it('should extract class declaration', async () => {
      const tree = parser.parse(sampleCode);
      const result = parser.extractSymbol(tree, 'UserService');
      
      expect(result).toBeTruthy();
      expect(result).toContain('class UserService');
      expect(result).toContain('addUser');
    });

    it('should extract function declaration', async () => {
      const tree = parser.parse(sampleCode);
      const result = parser.extractSymbol(tree, 'validateEmail');
      
      expect(result).toBeTruthy();
      expect(result).toContain('function validateEmail');
    });

    it('should extract method from class', async () => {
      const tree = parser.parse(sampleCode);
      const result = parser.extractSymbol(tree, 'addUser', 'UserService');
      
      expect(result).toBeTruthy();
      expect(result).toContain('addUser(user: User)');
    });

    it('should return null for non-existent symbol', async () => {
      const tree = parser.parse(sampleCode);
      const result = parser.extractSymbol(tree, 'nonExistent');
      
      expect(result).toBeNull();
    });
  });

  describe('findSymbols', () => {
    it('should find all symbols in file', async () => {
      const tree = parser.parse(sampleCode);
      const symbols = parser.findSymbols(tree);
      
      expect(symbols.length).toBeGreaterThan(0);
      expect(symbols.some(s => s.name === 'User')).toBe(true);
      expect(symbols.some(s => s.name === 'UserService')).toBe(true);
      expect(symbols.some(s => s.name === 'validateEmail')).toBe(true);
    });
  });

  describe('findParentClass', () => {
    it('should find parent class for method', async () => {
      const tree = parser.parse(sampleCode);
      const cursor = tree.walk();
      
      // Navigate to addUser method
      let methodNode = null;
      const search = (): boolean => {
        const node = cursor.currentNode;
        if (node.type === 'method_definition') {
          const nameNode = node.childForFieldName('name');
          if (nameNode?.text === 'addUser') {
            methodNode = node;
            return true;
          }
        }
        if (cursor.gotoFirstChild()) {
          do {
            if (search()) return true;
          } while (cursor.gotoNextSibling());
          cursor.gotoParent();
        }
        return false;
      };
      search();
      
      expect(methodNode).toBeTruthy();
      const parentClass = parser.findParentClass(methodNode!);
      expect(parentClass).toBeTruthy();
      expect(parentClass?.childForFieldName('name')?.text).toBe('UserService');
    });
  });
});
