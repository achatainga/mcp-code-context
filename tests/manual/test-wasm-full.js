import { CodeContextEngine } from './dist/src/core/engine.js';
import { DartTreeSitterParser } from './dist/src/parsers/dartTreeSitter.js';
import { TypeScriptParser } from './dist/src/parsers/typescript.js';

const dartCode = `
class MyWidget extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return Container(
      child: Text('Hello'),
    );
  }
  
  void myMethod() {
    print('test');
  }
}

void globalFunction() {
  print('global');
}
`;

const tsCode = `
class MyClass {
  constructor(private name: string) {}
  
  greet(): string {
    return \`Hello \${this.name}\`;
  }
}

function myFunction() {
  return 42;
}
`;

async function test() {
  console.log('🚀 Starting WASM Migration Validation...\n');
  
  try {
    // 1. Engine Init
    const engine = new CodeContextEngine();
    await engine.init();
    console.log('✅ Engine initialized');
    
    // 2. Dart Test
    await engine.loadLanguage('dart');
    console.log('✅ Dart language loaded');
    
    const dartParser = new DartTreeSitterParser();
    await dartParser.init(engine.createParser(), engine.getLanguage('dart'));
    console.log('✅ Dart Parser initialized');
    
    const dartTree = dartParser.parse(dartCode);
    const dartSymbols = dartParser.findSymbols(dartTree);
    console.log(`✅ Dart parsed: ${dartSymbols.length} symbols found`);
    dartSymbols.forEach(s => console.log(`   - ${s.type}: ${s.name}`));
    
    const buildMethod = dartParser.extractSymbol(dartTree, 'build', 'MyWidget');
    console.log(`✅ Extracted build method: ${buildMethod ? 'SUCCESS' : 'FAIL'}`);
    
    // 3. TypeScript Test
    await engine.loadLanguage('typescript');
    console.log('\n✅ TypeScript language loaded');
    
    const tsParser = new TypeScriptParser();
    await tsParser.init(engine.createParser(), engine.getLanguage('typescript'));
    console.log('✅ TypeScript Parser initialized');
    
    const tsTree = tsParser.parse(tsCode);
    const tsSymbols = tsParser.findSymbols(tsTree);
    console.log(`✅ TypeScript parsed: ${tsSymbols.length} symbols found`);
    tsSymbols.forEach(s => console.log(`   - ${s.type}: ${s.name}`));
    
    console.log('\n🎉 SUCCESS: WASM Parsing works!');
    
  } catch (error) {
    console.error('❌ FAILED:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

test();
