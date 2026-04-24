import { CodeContextEngine } from './dist/src/core/engine.js';
import { DartTreeSitterParser } from './dist/src/parsers/dartTreeSitter.js';

const dartCode = `
class MyWidget extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return Container();
  }
  
  void myMethod() {
    print('test');
  }
}
`;

async function test() {
  console.log('🧪 Testing WASM Dart Parser...\n');
  
  const engine = new CodeContextEngine();
  await engine.init();
  await engine.loadLanguage('dart');
  const dartLang = engine.getLanguage('dart');
  
  const parser = new DartTreeSitterParser();
  await parser.init(engine.createParser(), dartLang);
  console.log('✅ Parser loaded:', parser.constructor.name);
  
  const tree = parser.parse(dartCode);
  console.log('✅ Tree parsed');
  
  const symbols = parser.findSymbols(tree);
  console.log('✅ Symbols found:', symbols.length);
  symbols.forEach(s => console.log(`  - ${s.type}: ${s.name}`));
  
  const extracted = parser.extractSymbol(tree, 'build', 'MyWidget');
  console.log('\n✅ Extracted build method:', extracted ? 'SUCCESS' : 'FAIL');
}

test().catch(console.error);
