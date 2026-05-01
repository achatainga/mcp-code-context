import { describe, it, expect, beforeAll } from 'vitest';
import { TypeScriptParser } from '@/parsers/typescript';
import { CodeContextEngine } from '@/core/engine';
import { readFileSync } from 'fs';
import path from 'path';

describe('TypeScriptParser', () => {
  let parser: TypeScriptParser;
  let sampleCode: string;

  beforeAll(async () => {
    const engine = new CodeContextEngine();
    await engine.init();
    await engine.loadLanguage('typescript');

    const lang = engine.getLanguage('typescript');
    if (!lang) throw new Error('Failed to load TypeScript language');

    parser = new TypeScriptParser();
    await parser.init(engine.createParser(), lang);

    sampleCode = readFileSync(
      path.join(process.cwd(), 'tests/fixtures/typescript/sample.ts'),
      'utf-8'
    );
  }, 30000); // WASM init can be slow

  describe('extractSymbol', () => {
    it('should extract interface declaration', () => {
      const tree = parser.parse(sampleCode);
      const result = parser.extractSymbol(tree, 'User');

      expect(result).toBeTruthy();
      expect(result).toContain('interface User');
      expect(result).toContain('id: number');
    });

    it('should extract class declaration', () => {
      const tree = parser.parse(sampleCode);
      const result = parser.extractSymbol(tree, 'UserService');

      expect(result).toBeTruthy();
      expect(result).toContain('class UserService');
      expect(result).toContain('addUser');
    });

    it('should extract function declaration', () => {
      const tree = parser.parse(sampleCode);
      const result = parser.extractSymbol(tree, 'validateEmail');

      expect(result).toBeTruthy();
      expect(result).toContain('function validateEmail');
    });

    it('should extract method from class', () => {
      const tree = parser.parse(sampleCode);
      const result = parser.extractSymbol(tree, 'addUser', 'UserService');

      expect(result).toBeTruthy();
      expect(result).toContain('addUser');
    });

    it('should return null for non-existent symbol', () => {
      const tree = parser.parse(sampleCode);
      const result = parser.extractSymbol(tree, 'nonExistent');

      expect(result).toBeNull();
    });
  });

  describe('findSymbols', () => {
    it('should find all symbols in file', () => {
      const tree = parser.parse(sampleCode);
      const symbols = parser.findSymbols(tree);

      expect(symbols.length).toBeGreaterThan(0);
      expect(symbols.some(s => s.name === 'User')).toBe(true);
      expect(symbols.some(s => s.name === 'UserService')).toBe(true);
      expect(symbols.some(s => s.name === 'validateEmail')).toBe(true);
    });
  });

  describe('findParentClass', () => {
    it('should find parent class for method', () => {
      const tree = parser.parse(sampleCode);
      const symbols = parser.findSymbols(tree);

      // addUser should have UserService as its className
      const addUser = symbols.find(s => s.name === 'addUser');
      expect(addUser).toBeDefined();
      expect(addUser?.className).toBe('UserService');
    });
  });
});
