# CodeContext Pro — Cognitive Routing & Decision Tree

When solving software engineering tasks, AI agents waste tokens and introduce hallucinations by reading entire files or grepping blindly. Follow this deterministic decision matrix.

---

## 🚦 ROUTING MATRIX

| User / Task Goal | Preferred Tool | Why AST Outperforms Brute Force |
|:---|:---|:---|
| Explore repository structure | `get_semantic_repo_map(format="xml")` | Delivers complete class, method, and DB schema skeleton with 82% token reduction. |
| Visual architecture review | `get_semantic_repo_map(format="html")` | Standalone, interactive HTML dashboard for browser/iframe visualization. |
| Read class / function / method | `read_file_surgical(filePath, symbolName)` | Reads only the target node; prevents prompt attention blowout. |
| Extract type contract / interface | `explain_symbol(filePath, symbolName)` | Inverted LSP extracts inferred type skeleton + callers without heavy daemon. |
| Run targeted tests after edit | `get_impacted_tests(filePath, symbolName)` | Maps changed symbol to test suites and provides minimal test command. |
| Trace callers & callees (3 hops) | `get_call_hierarchy(filePath, symbolName)` | Multi-hop AST graph traversal with interactive Mermaid diagram export. |
| Validate frontend vs backend API | `validate_wire_contract(frontendFile, backendFile)` | Cross-language schema validator catches casing drift and missing fields. |
| Pre-merge conflict prediction | `predict_semantic_conflicts(baseBranch, targetBranch)` | AST divergence detection across Git branches flags breaking symbol changes. |
| Search symbols by name | `search_symbols(query, fuzzy=true)` | Indexed SQLite search returns exact coordinates in < 5 ms. |
| Find files affected by a change | `analyze_impact(filePath)` | Dependency graph traversal identifies imports and call sites. |
| Modify a function or class | `write_file_surgical(newContent)` | 2-phase atomic write: pre-commit syntax validation + unified diff + rollback token. |
| Textual pattern / regex search | `search_code_pattern(pattern)` | Bounded streaming regex search with ReDoS timeout protection. |
| Read arbitrary lines (e.g. config) | `read_file_lines(startLine, endLine)` | Precision line range slicing without reading massive files. |

---

## 🛑 NEGATIVE PROMPT GUARDS (WHAT NOT TO DO)

1. **NEVER call `read_file` or `cat` on files > 100 lines** when you only need to modify or inspect one function.
2. **NEVER apply edits without previewing the diff** in Phase 1 dry-run.
3. **NEVER guess database schema columns**: Call `read_file_surgical` on the model file — virtual ORM auto-injects columns from Prisma (`schema.prisma`), Drizzle (`schema.ts`), Rails (`db/schema.rb`), Laravel migrations, or Django (`models.py`).
4. **NEVER run full test suites blindly**: Call `get_impacted_tests` to run only the tests exercising your changed symbols.
