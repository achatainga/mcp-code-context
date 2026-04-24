# 🎯 PLAN MAESTRO v2.5.0 - Quick Wins

**Estado:** EN PROGRESO  
**Inicio:** 2024-01-15  
**Estimado:** 1-2 semanas (30h)  
**Versión Base:** v2.4.1

---

## ✅ FASE 1: SYNTAX VALIDATION (COMPLETADA)

**Tiempo:** 2h  
**Archivos creados:**
- `src/utils/syntaxValidator.ts` ✅
- `tests/test-syntax-validation.ts` ✅

**Archivos modificados:**
- `src/utils/transactionManager.ts` ✅ (agregado Phase 2: Syntax validation)

**Tests:** 8/8 pasando ✅

**Funcionalidad:**
- Valida sintaxis antes de commit
- Rollback automático si hay errores
- Soporta: TS, JS, PHP, Dart, Python

---

## 🔄 FASE 2: CACHE MEMORY LIMITS (PENDIENTE)

**Tiempo estimado:** 6h  
**Objetivo:** Límite real en bytes, no solo entries

### Archivos a modificar:
1. `src/cache/astCache.ts`

### Cambios necesarios:

```typescript
// ANTES (línea 25-30)
export class LRUCache<K, V> {
  private cache: Map<K, CacheEntry<V>>;
  private maxSize: number;
  private currentSize: number;

  constructor(maxSize: number = 100) {
    this.cache = new Map();
    this.maxSize = maxSize;
    this.currentSize = 0;
  }
}

// DESPUÉS
export class LRUCache<K, V> {
  private cache: Map<K, CacheEntry<V>>;
  private maxEntries: number;
  private maxBytes: number;
  private currentEntries: number;
  private currentBytes: number;

  constructor(maxEntries: number = 100, maxBytes: number = 100 * 1024 * 1024) {
    this.cache = new Map();
    this.maxEntries = maxEntries;
    this.maxBytes = maxBytes; // 100MB default
    this.currentEntries = 0;
    this.currentBytes = 0;
  }

  set(key: K, value: V, filePath?: string, estimatedSize: number = 1000): void {
    // Evict if over byte limit
    while (this.currentBytes + estimatedSize > this.maxBytes && this.cache.size > 0) {
      const oldestKey = this.cache.keys().next().value as K;
      const oldEntry = this.cache.get(oldestKey);
      if (oldEntry) {
        this.currentBytes -= oldEntry.size;
        this.cache.delete(oldestKey);
        this.currentEntries--;
      }
    }
    
    // Evict if over entry limit
    while (this.currentEntries >= this.maxEntries && this.cache.size > 0) {
      const oldestKey = this.cache.keys().next().value as K;
      const oldEntry = this.cache.get(oldestKey);
      if (oldEntry) {
        this.currentBytes -= oldEntry.size;
        this.cache.delete(oldestKey);
        this.currentEntries--;
      }
    }

    this.cache.set(key, { value, mtime, size: estimatedSize });
    this.currentEntries++;
    this.currentBytes += estimatedSize;
  }
}
```

### Test a crear:
- `tests/test-cache-memory-limits.ts`

---

## 🔄 FASE 3: ABORTCONTROLLER SUPPORT (PENDIENTE)

**Tiempo estimado:** 4h  
**Objetivo:** Cancelación de operaciones largas

### Archivos a modificar:
1. `src/handlers/readHandlers.ts` - handleGetSemanticRepoMap
2. `src/utils/ignoreManager.ts` - walkDirectoryAsync

### Cambios necesarios:

```typescript
// En handleGetSemanticRepoMap (línea 47)
export async function handleGetSemanticRepoMap(
  args: Record<string, unknown>,
  signal?: AbortSignal // ✅ Nuevo parámetro
) {
  // Crear timeout de 60s
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60000);
  
  try {
    const files = await ignoreManager.walkDirectoryAsync(resolvedPath, controller.signal);
    
    // Check abort
    if (signal?.aborted || controller.signal.aborted) {
      throw new Error("Operation cancelled");
    }
    
    // ... resto del código
  } finally {
    clearTimeout(timeout);
  }
}

// En ignoreManager.ts walkDirectoryAsync
private async walkAsync(
  currentDir: string, 
  collected: string[],
  signal?: AbortSignal // ✅ Nuevo parámetro
): Promise<void> {
  // Check abort
  if (signal?.aborted) {
    throw new Error("Operation cancelled");
  }
  
  // ... resto del código
}
```

### Test a crear:
- `tests/test-abort-controller.ts`

---

## 🔄 FASE 4: AST-AWARE DEPENDENCY CHECK (PENDIENTE)

**Tiempo estimado:** 12h  
**Objetivo:** Eliminar falsos positivos en remove_symbol

### Archivos a modificar:
1. `src/handlers/writeHandlers.ts` - handleRemoveSymbol (línea 480-510)

### Cambios necesarios:

```typescript
// ANTES (línea 493-510) - Regex check
const escaped = symbolName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const regex = new RegExp(`(?<=^|[^a-zA-Z0-9_$])(${escaped})(?=[^a-zA-Z0-9_$]|$)`);

if (regex.test(fContent)) {
  return errorResponse(`Symbol "${symbolName}" used in ${path.relative(projectRoot, f)}. Use force: true to delete.`);
}

// DESPUÉS - AST check
import { checkSymbolUsage } from "../utils/dependencyChecker.js";

const isUsed = await checkSymbolUsage(f, fContent, symbolName);
if (isUsed) {
  return errorResponse(`Symbol "${symbolName}" used in ${path.relative(projectRoot, f)}. Use force: true to delete.`);
}
```

### Archivo a crear:
- `src/utils/dependencyChecker.ts`

```typescript
/**
 * AST-aware dependency checker
 * Checks if a symbol is actually used in code (not in comments/strings)
 */

import * as ts from "typescript";
import * as path from "node:path";

export async function checkSymbolUsage(
  filePath: string,
  content: string,
  symbolName: string
): Promise<boolean> {
  const ext = path.extname(filePath).toLowerCase();

  switch (ext) {
    case ".ts":
    case ".tsx":
    case ".js":
    case ".jsx":
      return checkTSSymbolUsage(content, symbolName);
    
    case ".php":
      return checkPHPSymbolUsage(content, symbolName);
    
    default:
      // Fallback to regex for unsupported languages
      const escaped = symbolName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const regex = new RegExp(`(?<=^|[^a-zA-Z0-9_$])(${escaped})(?=[^a-zA-Z0-9_$]|$)`);
      return regex.test(content);
  }
}

function checkTSSymbolUsage(content: string, symbolName: string): boolean {
  const sourceFile = ts.createSourceFile(
    "temp.ts",
    content,
    ts.ScriptTarget.Latest,
    true
  );

  let found = false;

  function visit(node: ts.Node) {
    // Check identifiers (skip string literals and comments)
    if (ts.isIdentifier(node) && node.text === symbolName) {
      found = true;
    }
    
    if (!found) {
      ts.forEachChild(node, visit);
    }
  }

  visit(sourceFile);
  return found;
}

async function checkPHPSymbolUsage(content: string, symbolName: string): Promise<boolean> {
  try {
    const phpParserModule = await import("php-parser");
    const phpParser = phpParserModule.default || phpParserModule;
    const parser = new phpParser.Engine();
    const ast = parser.parseCode(content, "temp.php");

    let found = false;

    function visit(node: any) {
      if (node.kind === "identifier" && node.name === symbolName) {
        found = true;
      }
      
      if (!found && node.children) {
        for (const child of node.children) {
          visit(child);
        }
      }
    }

    visit(ast);
    return found;
  } catch {
    // Fallback to regex
    const escaped = symbolName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(`(?<=^|[^a-zA-Z0-9_$])(${escaped})(?=[^a-zA-Z0-9_$]|$)`);
    return regex.test(content);
  }
}
```

### Test a crear:
- `tests/test-dependency-checker.ts`

---

## 📦 RELEASE v2.5.0

### Checklist final:

- [ ] Todas las fases completadas
- [ ] Todos los tests pasando
- [ ] Actualizar versiones:
  - [ ] `package.json` → 2.5.0
  - [ ] `src/utils/constants.ts` → SERVER_VERSION = "2.5.0"
  - [ ] `README.md` → badge 2.5.0
  - [ ] `llms.txt` → v2.5.0
  - [ ] `CHANGELOG.md` → entrada 2.5.0

### CHANGELOG.md template:

```markdown
## [2.5.0] - 2024-01-XX

### 🚀 Performance & Reliability

- **Syntax Validation**: Automatic syntax checking before commit
  - Validates TS, JS, PHP, Dart, Python
  - Automatic rollback on syntax errors
  - Prevents broken code from being written

- **Cache Memory Limits**: Real byte-based cache limits
  - Prevents OOM on large repositories
  - 100MB default limit (configurable)
  - Evicts oldest entries when limit reached

- **AbortController Support**: Cancellable operations
  - 60s timeout on get_semantic_repo_map
  - Graceful cancellation of long operations
  - Prevents hanging on large repos

- **AST-aware Dependency Check**: Eliminates false positives
  - Uses AST parsing instead of regex
  - Ignores symbols in comments and strings
  - More accurate dependency detection in remove_symbol

### 📊 Metrics Improvement
- Reliability: 8.5 → 9.5 (+1.0)
- Safety: 8.0 → 9.5 (+1.5)
- User Experience: 8.0 → 9.0 (+1.0)

### Technical
- All tests passing (160+ tests)
- Zero breaking changes
- Backward compatible
```

### Comandos de release:

```bash
# 1. Build y test
npm run build
npm test

# 2. Git
git add .
git commit -m "v2.5.0: Syntax validation, cache limits, abort support, AST dependency check"
git push origin main

# 3. Tag
git tag -a v2.5.0 -m "v2.5.0: Quick Wins - Reliability & Safety"
git push origin v2.5.0

# 4. Publish
npm publish
```

---

## 🎯 ESTADO ACTUAL

**Última actualización:** 2024-01-15  
**Fase actual:** FASE 1 COMPLETADA ✅  
**Próxima fase:** FASE 2 - Cache Memory Limits  
**Progreso:** 25% (1/4 fases)

---

## 📝 NOTAS DE RECUPERACIÓN

Si la memoria se resetea:

1. Leer este archivo: `PLAN_v2.5.0.md`
2. Verificar fase actual en sección "ESTADO ACTUAL"
3. Ejecutar: `git log --oneline -5` para ver últimos commits
4. Ejecutar: `npm test` para verificar estado
5. Continuar con la fase marcada como PENDIENTE

**Para Dios, no para los hombres** - Colosenses 3:23
