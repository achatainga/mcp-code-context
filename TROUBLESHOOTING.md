# Troubleshooting Guide: Surgical Editing Edge Cases

This document covers known edge cases and behaviors for the Antigravity MCP surgical tools. These insights are derived from real-world usage scenarios.

## 1. `write_file_surgical` - False Brace Imbalance
**Problem:** The server rejects a code change, claiming the resulting file has unbalanced braces, even if the code provided is syntactically valid.
**Cause:** 
- Discrepancies between character counting and line endings (CRLF vs LF).
- Braces found inside string literals or comments being counted as structural braces.
**Solution (Internal):** The server now uses state-aware brace counting (as of v2.1.2) that ignores literals and comments.
**Workaround:** If you still encounter this, ensure your code snippet is self-contained and try normalizing your file to LF line endings.

## 2. `rename_symbol` - Dependents Not Updating
**Problem:** The symbol is renamed in the definition file, but imports and references in other files are unchanged.
**Cause:** The tool was previously looking for the *definition* of the symbol in every file.
**Solution (Internal):** The tool now separates definition renaming from reference updating. It will update any whole-word match of the symbol in files that are detected as dependents.
**Workaround:** Run `analyze_impact` first to verify the server detects the dependencies. If missed, perform a manual surgical replace on the import line.

## 3. `insert_symbol` - Ambiguous Positioning
**Problem:** Using `position: "after"` on a method sometimes inserts the new code *inside* the closing brace of that method.
**Cause:** Ambiguity in block-end detection when the closing brace is on a line with other content or when braces are presence in strings inside the body.
**Solution (Internal):** Improved block detection in v2.1.2.
**Best Practice:** For inserting new members inside a class, prefer using `position: "inside_end"` with the `className` as the anchor, rather than `after` on the last method.

## 4. `remove_symbol` - False Positive Dependency Check
**Problem:** The tool refuses to remove a symbol because it "might be used" in another file, but the reference is actually a comment or a different symbol with the same name.
**Cause:** To stay fast, the dependency check uses a whole-word regex search rather than a full cross-file AST index.
**Solution:**
1. Run `analyze_impact` to verify the actual blast radius.
2. If you confirm the "matches" are false positives, use the `force: true` parameter to bypass the check.

---

> [!TIP]
> **Always use the Two-Phase Workflow.** Review the `diff` provided in the first response carefully before providing the `confirmationToken`. This is your strongest guard against edge-case misbehavior.
