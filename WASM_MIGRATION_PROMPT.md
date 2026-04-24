# 🔧 PROMPT PARA MIGRACIÓN WASM TREE-SITTER

## CONTEXTO
Proyecto: **Antigravity MCP Context** (C:\code\antigravity-mcp-context)
Objetivo: Migrar de tree-sitter nativo (requiere Visual Studio) a **web-tree-sitter (WASM)** para portabilidad total.

## PROBLEMA ACTUAL
1. ✅ `web-tree-sitter@0.20.8` instalado
2. ✅ `tree-sitter-wasms@0.1.13` instalado (contiene WASM de lenguajes)
3. ❌ **VERSION MISMATCH**: `tree-sitter-dart.wasm` es v15, pero `web-tree-sitter@0.20.8` soporta v13-14
4. ❌ `web-tree-sitter@0.26.8` tiene API completamente diferente (breaking changes)

## ESTADO DEL CÓDIGO

### Archivos clave:
- `src/core/engine.ts` - Engine WASM (necesita actualización)
- `src/parsers/base.ts` - Parser base
- `src/parsers/typescript.ts` - Parser TS (usa `cursor.currentNode()` - función)
- `src/parsers/python.ts` - Parser Python
- `src/parsers/php.ts` - Parser PHP
- `src/parsers/dartTreeSitter.ts` - Parser Dart WASM
- `src/parsers/dart.ts` - Parser Dart Regex (fallback NO DESEADO)
- `src/parsers/registry.ts` - Registry de parsers

### API Differences:
**web-tree-sitter@0.20.8** (actual):
```typescript
const node = cursor.currentNode; // Propiedad, retorna función
const actualNode = cursor.currentNode(); // Llamar función
```

**web-tree-sitter@0.26.8** (nuevo):
```typescript
const node = cursor.currentNode; // Getter directo, retorna Node
// NO es función, es propiedad
```

## TU MISIÓN

### OPCIÓN 1: Actualizar a web-tree-sitter@0.26.8 (RECOMENDADO)
1. **Instalar**: `npm install web-tree-sitter@latest`
2. **Actualizar imports**: Cambiar `import Parser from "web-tree-sitter"` a usar tipos correctos
3. **Actualizar API calls**:
   - `cursor.currentNode()` → `cursor.currentNode` (getter)
   - `Parser.init()` es estático
   - `new Parser()` funciona igual
   - `Language.load()` es estático
4. **Actualizar engine.ts**:
   ```typescript
   import Parser from "web-tree-sitter";
   
   async init(): Promise<void> {
     await Parser.init({
       locateFile: (file: string) => {
         // Core WASM
         if (file.includes("tree-sitter.wasm") || file.includes("web-tree-sitter.wasm")) {
           return path.join(process.cwd(), "node_modules", "web-tree-sitter", file);
         }
         // Language WASM
         return path.join(process.cwd(), "node_modules", "tree-sitter-wasms", "out", file);
       },
     });
     this.parser = new Parser();
     this.initialized = true;
   }
   
   async loadLanguage(name: string): Promise<void> {
     const wasmPath = path.join(process.cwd(), "node_modules", "tree-sitter-wasms", "out", `tree-sitter-${name}.wasm`);
     const language = await Parser.Language.load(wasmPath);
     this.languages.set(name, language);
   }
   ```

5. **Fix parsers**: Cambiar TODOS los `cursor.currentNode()` a `cursor.currentNode`
6. **Fix types**: Importar `SyntaxNode` de `web-tree-sitter` correctamente

### OPCIÓN 2: Downgrade tree-sitter-wasms (ALTERNATIVA)
1. Buscar versión de `tree-sitter-wasms` con WASM v13-14
2. `npm install tree-sitter-wasms@<version-compatible>`
3. Mantener `web-tree-sitter@0.20.8`

### OPCIÓN 3: Compilar WASM custom (AVANZADO)
1. Clonar repos oficiales de grammars
2. Compilar con tree-sitter-cli v0.20.x para generar WASM v13-14
3. Reemplazar WASM en `node_modules/tree-sitter-wasms/out/`

## ARCHIVOS A MODIFICAR

### 1. src/core/engine.ts
- Actualizar `Parser.init()` con `locateFile` correcto
- Usar `Parser.Language.load()` estático

### 2. src/parsers/base.ts
- Actualizar tipos de `Parser` y `Language`
- Cambiar `Parser.Tree` a `Tree` importado

### 3. src/parsers/*.ts (typescript, python, php, dartTreeSitter)
- Cambiar `cursor.currentNode()` → `cursor.currentNode`
- Actualizar imports de tipos

### 4. src/parsers/registry.ts
- Asegurar `await this.engine.init()` antes de `loadLanguage()`
- Cargar Dart con WASM (NO regex)

## CRITERIOS DE ÉXITO

✅ `npm run build` sin errores TypeScript
✅ Test ejecuta sin crashes:
```javascript
const engine = new CodeContextEngine();
await engine.init();
await engine.loadLanguage('dart');
const parser = new DartTreeSitterParser();
await parser.init(engine.createParser(), engine.getLanguage('dart'));
const tree = parser.parse('class MyClass {}');
console.log(tree.rootNode.type); // Debe imprimir tipo de nodo
```

## RESTRICCIONES
- ❌ NO usar Regex fallback para Dart
- ❌ NO instalar tree-sitter nativo (node-gyp)
- ✅ SOLO WASM (web-tree-sitter)
- ✅ Debe funcionar en Windows sin Visual Studio

## INFORMACIÓN ADICIONAL

### Estructura actual:
```
node_modules/
├── web-tree-sitter/
│   ├── tree-sitter.wasm (v0.20) o web-tree-sitter.wasm (v0.26)
│   └── tree-sitter.js
└── tree-sitter-wasms/
    └── out/
        ├── tree-sitter-typescript.wasm (v14)
        ├── tree-sitter-python.wasm (v14)
        ├── tree-sitter-php.wasm (v14)
        └── tree-sitter-dart.wasm (v15) ← PROBLEMA
```

### Versiones instaladas:
- `web-tree-sitter@0.20.8` (actual)
- `tree-sitter-wasms@0.1.13`
- Node.js v24.8.0
- TypeScript (ver tsconfig.json)

## ENTREGABLES

1. **Código actualizado** en todos los archivos mencionados
2. **Comando de test** que valide funcionamiento
3. **Documentación** de cambios realizados
4. **Troubleshooting** si hay edge cases

## PRIORIDAD
🔴 **CRÍTICA** - Proyecto bloqueado sin esto

---

**NOTA FINAL**: Si encuentras que `tree-sitter-dart.wasm` v15 es incompatible con TODAS las versiones de `web-tree-sitter`, entonces:
1. Busca un fork/alternativa de tree-sitter-dart compatible
2. O compila manualmente desde source con CLI v0.20.x
3. Documenta el proceso para reproducibilidad

**NO USES REGEX FALLBACK** - El cliente lo rechazó explícitamente.
