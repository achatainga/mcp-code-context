# 🔴 CRITICAL ISSUES - Must Fix Before Production

**Análisis por**: Gemini Flash  
**Fecha**: 2026-04-23  
**Scores actuales**: Por debajo de 9 en 3 de 4 métricas

---

## 📊 SCORES REALES

| Métrica | Score | Target | Gap |
|---------|-------|--------|-----|
| Calidad | 6/10 | 9+ | -3 ❌ |
| Seguridad | 5/10 | 9+ | -4 ❌ |
| Mantenibilidad | 8/10 | 9+ | -1 ⚠️ |
| Escalabilidad | 3/10 | 9+ | -6 ❌ |

---

## 🔴 STOPPERS IDENTIFICADOS

### 1. Refactorización Ciega por Regex ❌

**Problema**: `renameReferencesInFile` usa regex global que reemplaza en:
- Strings
- Comments
- Docstrings
- Variables en diferentes scopes

**Ubicación**: `src/handlers/writeHandlers.ts:280`

**Impacto**: Corrupción silenciosa del código del usuario

**Solución requerida**: AST-aware rename para todos los lenguajes

---

### 2. Arquitectura Síncrona Bloqueante ❌

**Problema**: 
- `walkDirectory` usa `fs.readdirSync`
- `readFileSync` bloquea event loop
- Repos >1000 archivos causan timeout

**Ubicación**: 
- `src/utils/ignoreManager.ts`
- `src/handlers/readHandlers.ts`

**Impacto**: Servidor MCP se cuelga, cliente termina conexión

**Solución requerida**: Migrar a `fs.promises` con batching

---

### 3. Falta de Transacciones ❌

**Problema**: `handleRenameSymbol` escribe archivos uno a uno sin rollback automático

**Ubicación**: `src/handlers/writeHandlers.ts:280-320`

**Impacto**: Estado inconsistente si falla a mitad de operación

**Solución requerida**: Sistema de staging + commit atómico

---

## 🟡 WARNINGS

1. **Falsos positivos en Impact Analysis** - Regex no detecta imports dinámicos
2. **Fragilidad Python/Dart** - Conteo de indentación/llaves frágil
3. **Consumo de memoria** - ts-morph Project sin límites

---

## 🎯 PLAN DE CORRECCIÓN

### FASE 1: Seguridad (Crítico)
- [ ] Deshabilitar `rename_symbol` hasta implementar AST-aware
- [ ] Agregar warning en `remove_symbol` sobre regex
- [ ] Implementar validación post-edición (syntax check)

### FASE 2: Escalabilidad (Crítico)
- [ ] Migrar `ignoreManager` a async
- [ ] Implementar batching en `walkDirectory`
- [ ] Agregar AbortController para cancelación

### FASE 3: Transacciones (Crítico)
- [ ] Implementar staging area para multi-file edits
- [ ] Rollback automático en caso de fallo
- [ ] Validación de integridad post-operación

---

## 🚨 DECISIÓN INMEDIATA

**NO HACER PUSH** hasta corregir al menos los 3 STOPPERS.

**Opciones:**

**A) Fix rápido (2-3 horas)**:
- Deshabilitar herramientas peligrosas
- Agregar warnings explícitos
- Documentar limitaciones

**B) Fix completo (1-2 días)**:
- Implementar AST-aware rename
- Migrar a async I/O
- Sistema de transacciones

**C) Release parcial**:
- v2.3.0 solo con mejoras de arquitectura
- Marcar rename/remove como "experimental"
- Roadmap para v2.4.0 con fixes

---

## 💡 RECOMENDACIÓN

**Opción C**: Release v2.3.0 con disclaimer + roadmap v2.4.0

**Razón**: Las mejoras arquitectónicas son valiosas, pero las herramientas de escritura necesitan más trabajo.

**Cambios necesarios**:
1. Agregar warnings en documentación
2. Marcar tools como "beta"
3. Crear issues en GitHub
4. Planificar v2.4.0

---

**Status**: ⏸️ HOLD - Esperando decisión
