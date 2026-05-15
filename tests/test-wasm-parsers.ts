/**
 * Unit Tests for WASM Parsers - v3.0.0
 * Tests all parsers: TypeScript, Python, PHP, Dart
 */

import { CodeContextEngine } from '../src/core/engine.js';
import { TypeScriptParser } from '../src/parsers/typescript.js';
import { PythonParser } from '../src/parsers/python.js';
import { PHPParser } from '../src/parsers/php.js';
import { DartTreeSitterParser } from '../src/parsers/dartTreeSitter.js';
import { JavaParser } from '../src/parsers/java.js';
import { GoParser } from '../src/parsers/go.js';
import { CSharpParser } from '../src/parsers/csharp.js';
import { RubyParser } from '../src/parsers/ruby.js';
import { RustParser } from '../src/parsers/rust.js';
import { KotlinParser } from '../src/parsers/kotlin.js';

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

const MyComponent = () => {
  return null;
};

const MyForm = function() {
  return null;
};

export const ExportedWidget = ({ name }: { name: string }) => {
  return name;
};
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
`,

  java: `
public class Calculator {
  private int value;

  public Calculator(int value) {
    this.value = value;
  }

  public int add(int n) {
    return this.value + n;
  }

  public int multiply(int n) {
    return this.value * n;
  }

  public static int factorial(int n) {
    if (n <= 1) return 1;
    return n * factorial(n - 1);
  }
}
`,

  go: `
package main

type Calculator struct {
  Value int
}

func Add(a, b int) int {
  return a + b
}

func Multiply(a, b int) int {
  return a * b
}

func Factorial(n int) int {
  if n <= 1 { return 1 }
  return n * Factorial(n-1)
}
`,

  csharp: `
using System;

public class Calculator {
  private int value;

  public Calculator(int value) {
    this.value = value;
  }

  public int Add(int n) {
    return this.value + n;
  }

  public int Multiply(int n) {
    return this.value * n;
  }

  public static int Factorial(int n) {
    if (n <= 1) return 1;
    return n * Factorial(n - 1);
  }
}
`,

  ruby: `
class Calculator
  def initialize(value)
    @value = value
  end

  def add(n)
    @value + n
  end

  def multiply(n)
    @value * n
  end
end

def factorial(n)
  return 1 if n <= 1
  n * factorial(n - 1)
end
`,

  rust: `
struct Calculator {
  value: i32,
}

impl Calculator {
  fn add(&self, n: i32) -> i32 {
    self.value + n
  }

  fn multiply(&self, n: i32) -> i32 {
    self.value * n
  }
}

fn factorial(n: i32) -> i32 {
  if n <= 1 { return 1; }
  n * factorial(n - 1)
}
`,

  kotlin: `
class Calculator(private val value: Int) {
  fun add(n: Int): Int {
    return value + n
  }

  fun multiply(n: Int): Int {
    return value * n
  }
}

fun factorial(n: Int): Int {
  if (n <= 1) return 1
  return n * factorial(n - 1)
}
`
};

// Test results tracker
interface TestResult {
  status: string;
  message: string;
}

const results: {
  passed: number;
  failed: number;
  tests: TestResult[];
} = {
  passed: 0,
  failed: 0,
  tests: []
};

function assert(condition: boolean, message: string): void {
  if (condition) {
    results.passed++;
    results.tests.push({ status: '✅', message });
    console.log(`✅ ${message}`);
  } else {
    results.failed++;
    results.tests.push({ status: '❌', message });
    console.error(`❌ ${message}`);
  }
}

async function testParser(language: string, parser: any, code: string, expectedSymbols: any[]): Promise<void> {
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
      const found = symbols.find((s: any) => s.name === expected.name && s.type.includes(expected.type));
      assert(found !== undefined, `${language}: Found ${expected.type} "${expected.name}"`);
    }
    
    // Test 4: Extract specific symbol
    const firstSymbol = expectedSymbols[0];
    const extracted = parser.extractSymbol(tree, firstSymbol.name, firstSymbol.className);
    assert(extracted !== null, `${language}: Extracted "${firstSymbol.name}"`);
    assert(extracted.includes(firstSymbol.name), `${language}: Extracted code contains symbol name`);
    
    // Test 5: Extract with className scope (if applicable)
    if (expectedSymbols.some((s: any) => s.className)) {
      const methodSymbol = expectedSymbols.find((s: any) => s.className);
      const extractedMethod = parser.extractSymbol(tree, methodSymbol.name, methodSymbol.className);
      assert(extractedMethod !== null, `${language}: Extracted method "${methodSymbol.name}" from class "${methodSymbol.className}"`);
    }
    
    // Test 6: Replace symbol
    const replaceTarget = expectedSymbols.find((s: any) => !s.className) || expectedSymbols[0];
    const newContent = `// Replaced\n${replaceTarget.type} ${replaceTarget.name}() { return 42; }`;
    const replaced = parser.replaceSymbol(code, tree, replaceTarget.name, newContent, replaceTarget.className);
    assert(replaced.includes('// Replaced'), `${language}: Replace symbol successful`);
    assert(replaced.includes(replaceTarget.name), `${language}: Replaced code contains symbol name`);
    
  } catch (error: any) {
    assert(false, `${language}: EXCEPTION - ${error.message}`);
    console.error(error.stack);
  }
}

async function runTests() {
  console.log('🚀 Starting WASM Parser Unit Tests\n');
  console.log('=' .repeat(60));
  
  try {
    // Initialize engine
    const engine = new CodeContextEngine();
    await engine.init();
    console.log('✅ Engine initialized\n');
    
    // Test TypeScript
    await engine.loadLanguage('typescript');
    const tsParser = new TypeScriptParser();
    await tsParser.init(engine.createParser(), engine.getLanguage('typescript')!);
    await testParser('TypeScript', tsParser, fixtures.typescript, [
      { name: 'Calculator', type: 'class' },
      { name: 'add', type: 'method', className: 'Calculator' },
      { name: 'multiply', type: 'method', className: 'Calculator' },
      { name: 'factorial', type: 'function' },
      { name: 'User', type: 'interface' },
      { name: 'MyComponent', type: 'variable_declarator' },
      { name: 'MyForm', type: 'variable_declarator' },
      { name: 'ExportedWidget', type: 'variable_declarator' },
    ]);
    
    // Test Python
    await engine.loadLanguage('python');
    const pyParser = new PythonParser();
    await pyParser.init(engine.createParser(), engine.getLanguage('python')!);
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
    await phpParser.init(engine.createParser(), engine.getLanguage('php')!);
    await testParser('PHP', phpParser, fixtures.php, [
      { name: 'Calculator', type: 'class' },
      { name: 'add', type: 'method', className: 'Calculator' },
      { name: 'multiply', type: 'method', className: 'Calculator' },
      { name: 'factorial', type: 'function' }
    ]);
    
    // Test Dart
    await engine.loadLanguage('dart');
    const dartParser = new DartTreeSitterParser();
    await dartParser.init(engine.createParser(), engine.getLanguage('dart')!);
    await testParser('Dart', dartParser, fixtures.dart, [
      { name: 'Calculator', type: 'class' },
      { name: 'add', type: 'function', className: 'Calculator' },
      { name: 'multiply', type: 'function', className: 'Calculator' },
      { name: 'factorial', type: 'function' },
      { name: '_privateHelper', type: 'function' }
    ]);

    // Test Java
    await engine.loadLanguage('java');
    const javaParser = new JavaParser();
    await javaParser.init(engine.createParser(), engine.getLanguage('java')!);
    await testParser('Java', javaParser, fixtures.java, [
      { name: 'Calculator', type: 'class' },
      { name: 'add', type: 'method', className: 'Calculator' },
      { name: 'multiply', type: 'method', className: 'Calculator' },
      { name: 'factorial', type: 'method' },
    ]);

    // Test Go
    await engine.loadLanguage('go');
    const goParser = new GoParser();
    await goParser.init(engine.createParser(), engine.getLanguage('go')!);
    await testParser('Go', goParser, fixtures.go, [
      { name: 'Add', type: 'function' },
      { name: 'Multiply', type: 'function' },
      { name: 'Factorial', type: 'function' },
      { name: 'Calculator', type: 'struct_type' },
    ]);

    // Test C#
    await engine.loadLanguage('c_sharp');
    const csharpParser = new CSharpParser();
    await csharpParser.init(engine.createParser(), engine.getLanguage('c_sharp')!);
    await testParser('C#', csharpParser, fixtures.csharp, [
      { name: 'Calculator', type: 'class' },
      { name: 'Add', type: 'method', className: 'Calculator' },
      { name: 'Multiply', type: 'method', className: 'Calculator' },
      { name: 'Factorial', type: 'method' },
    ]);

    // Test Ruby
    await engine.loadLanguage('ruby');
    const rubyParser = new RubyParser();
    await rubyParser.init(engine.createParser(), engine.getLanguage('ruby')!);
    await testParser('Ruby', rubyParser, fixtures.ruby, [
      { name: 'Calculator', type: 'class' },
      { name: 'add', type: 'method', className: 'Calculator' },
      { name: 'multiply', type: 'method', className: 'Calculator' },
      { name: 'factorial', type: 'method' },
    ]);

    // Test Rust
    await engine.loadLanguage('rust');
    const rustParser = new RustParser();
    await rustParser.init(engine.createParser(), engine.getLanguage('rust')!);
    await testParser('Rust', rustParser, fixtures.rust, [
      { name: 'Calculator', type: 'struct' },
      { name: 'add', type: 'function', className: 'Calculator' },
      { name: 'multiply', type: 'function', className: 'Calculator' },
      { name: 'factorial', type: 'function' },
    ]);

    // Test Kotlin
    await engine.loadLanguage('kotlin');
    const kotlinParser = new KotlinParser();
    await kotlinParser.init(engine.createParser(), engine.getLanguage('kotlin')!);
    await testParser('Kotlin', kotlinParser, fixtures.kotlin, [
      { name: 'Calculator', type: 'class' },
      { name: 'add', type: 'function', className: 'Calculator' },
      { name: 'multiply', type: 'function', className: 'Calculator' },
      { name: 'factorial', type: 'function' },
    ]);

  } catch (error: any) {
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
  } else {
    console.log('\n🎉 ALL TESTS PASSED!');
    process.exit(0);
  }
}

runTests();
