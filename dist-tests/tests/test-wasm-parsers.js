/**
 * Unit Tests for WASM Parsers - v3.0.0
 * Tests all parsers: TypeScript, Python, PHP, Dart
 */
import { CodeContextEngine } from '../src/core/engine.js';
import { TypeScriptParser } from '../src/parsers/typescript.js';
import { PythonParser } from '../src/parsers/python.js';
import { PHPParser } from '../src/parsers/php.js';
import { DartTreeSitterParser } from '../src/parsers/dartTreeSitter.js';
// Test fixtures
const fixtures = {
    typescript: `
class Calculator {
  constructor(private value: number) {}
  
  add(n: number): number {
    return this.value + n;
  }
  
  multiply(n: number): number {
    return this.value * n;
  }
}

function factorial(n: number): number {
  if (n <= 1) return 1;
  return n * factorial(n - 1);
}

interface User {
  name: string;
  age: number;
}
`,
    python: `
class Calculator:
    def __init__(self, value):
        self.value = value
    
    def add(self, n):
        return self.value + n
    
    def multiply(self, n):
        return self.value * n

def factorial(n):
    if n <= 1:
        return 1
    return n * factorial(n - 1)

def _private_helper():
    pass
`,
    php: `<?php
namespace App\\Math;

class Calculator {
    private $value;
    
    public function __construct($value) {
        $this->value = $value;
    }
    
    public function add($n) {
        return $this->value + $n;
    }
    
    public function multiply($n) {
        return $this->value * $n;
    }
}

function factorial($n) {
    if ($n <= 1) return 1;
    return $n * factorial($n - 1);
}
?>`,
    dart: `
class Calculator {
  final int value;
  
  Calculator(this.value);
  
  int add(int n) {
    return value + n;
  }
  
  int multiply(int n) {
    return value * n;
  }
}

int factorial(int n) {
  if (n <= 1) return 1;
  return n * factorial(n - 1);
}

void _privateHelper() {
  print('private');
}
`
};
const results = {
    passed: 0,
    failed: 0,
    tests: []
};
function assert(condition, message) {
    if (condition) {
        results.passed++;
        results.tests.push({ status: '✅', message });
        console.log(`✅ ${message}`);
    }
    else {
        results.failed++;
        results.tests.push({ status: '❌', message });
        console.error(`❌ ${message}`);
    }
}
async function testParser(language, parser, code, expectedSymbols) {
    console.log(`\n🧪 Testing ${language} Parser...`);
    try {
        // Test 1: Parse
        const tree = parser.parse(code);
        assert(tree !== null, `${language}: Parse successful`);
        // Test 2: Find symbols
        const symbols = parser.findSymbols(tree);
        assert(symbols.length > 0, `${language}: Found ${symbols.length} symbols`);
        // Test 3: Verify expected symbols
        for (const expected of expectedSymbols) {
            const found = symbols.find((s) => s.name === expected.name && s.type.includes(expected.type));
            assert(found !== undefined, `${language}: Found ${expected.type} "${expected.name}"`);
        }
        // Test 4: Extract specific symbol
        const firstSymbol = expectedSymbols[0];
        const extracted = parser.extractSymbol(tree, firstSymbol.name, firstSymbol.className);
        assert(extracted !== null, `${language}: Extracted "${firstSymbol.name}"`);
        assert(extracted.includes(firstSymbol.name), `${language}: Extracted code contains symbol name`);
        // Test 5: Extract with className scope (if applicable)
        if (expectedSymbols.some((s) => s.className)) {
            const methodSymbol = expectedSymbols.find((s) => s.className);
            const extractedMethod = parser.extractSymbol(tree, methodSymbol.name, methodSymbol.className);
            assert(extractedMethod !== null, `${language}: Extracted method "${methodSymbol.name}" from class "${methodSymbol.className}"`);
        }
        // Test 6: Replace symbol
        const replaceTarget = expectedSymbols.find((s) => !s.className) || expectedSymbols[0];
        const newContent = `// Replaced\n${replaceTarget.type} ${replaceTarget.name}() { return 42; }`;
        const replaced = parser.replaceSymbol(code, tree, replaceTarget.name, newContent, replaceTarget.className);
        assert(replaced.includes('// Replaced'), `${language}: Replace symbol successful`);
        assert(replaced.includes(replaceTarget.name), `${language}: Replaced code contains symbol name`);
    }
    catch (error) {
        assert(false, `${language}: EXCEPTION - ${error.message}`);
        console.error(error.stack);
    }
}
async function runTests() {
    console.log('🚀 Starting WASM Parser Unit Tests\n');
    console.log('='.repeat(60));
    try {
        // Initialize engine
        const engine = new CodeContextEngine();
        await engine.init();
        console.log('✅ Engine initialized\n');
        // Test TypeScript
        await engine.loadLanguage('typescript');
        const tsParser = new TypeScriptParser();
        await tsParser.init(engine.createParser(), engine.getLanguage('typescript'));
        await testParser('TypeScript', tsParser, fixtures.typescript, [
            { name: 'Calculator', type: 'class' },
            { name: 'add', type: 'method', className: 'Calculator' },
            { name: 'multiply', type: 'method', className: 'Calculator' },
            { name: 'factorial', type: 'function' },
            { name: 'User', type: 'interface' }
        ]);
        // Test Python
        await engine.loadLanguage('python');
        const pyParser = new PythonParser();
        await pyParser.init(engine.createParser(), engine.getLanguage('python'));
        await testParser('Python', pyParser, fixtures.python, [
            { name: 'Calculator', type: 'class' },
            { name: 'add', type: 'function', className: 'Calculator' },
            { name: 'multiply', type: 'function', className: 'Calculator' },
            { name: 'factorial', type: 'function' },
            { name: '_private_helper', type: 'function' }
        ]);
        // Test PHP
        await engine.loadLanguage('php');
        const phpParser = new PHPParser();
        await phpParser.init(engine.createParser(), engine.getLanguage('php'));
        await testParser('PHP', phpParser, fixtures.php, [
            { name: 'Calculator', type: 'class' },
            { name: 'add', type: 'method', className: 'Calculator' },
            { name: 'multiply', type: 'method', className: 'Calculator' },
            { name: 'factorial', type: 'function' }
        ]);
        // Test Dart
        await engine.loadLanguage('dart');
        const dartParser = new DartTreeSitterParser();
        await dartParser.init(engine.createParser(), engine.getLanguage('dart'));
        await testParser('Dart', dartParser, fixtures.dart, [
            { name: 'Calculator', type: 'class' },
            { name: 'add', type: 'function', className: 'Calculator' },
            { name: 'multiply', type: 'function', className: 'Calculator' },
            { name: 'factorial', type: 'function' },
            { name: '_privateHelper', type: 'function' }
        ]);
    }
    catch (error) {
        console.error('\n❌ FATAL ERROR:', error.message);
        console.error(error.stack);
        process.exit(1);
    }
    // Summary
    console.log('\n' + '='.repeat(60));
    console.log('\n📊 TEST SUMMARY\n');
    console.log(`Total Tests: ${results.passed + results.failed}`);
    console.log(`✅ Passed: ${results.passed}`);
    console.log(`❌ Failed: ${results.failed}`);
    console.log(`Success Rate: ${((results.passed / (results.passed + results.failed)) * 100).toFixed(1)}%`);
    if (results.failed > 0) {
        console.log('\n❌ FAILED TESTS:');
        results.tests.filter(t => t.status === '❌').forEach(t => {
            console.log(`  ${t.status} ${t.message}`);
        });
        process.exit(1);
    }
    else {
        console.log('\n🎉 ALL TESTS PASSED!');
        process.exit(0);
    }
}
runTests();
//# sourceMappingURL=test-wasm-parsers.js.map