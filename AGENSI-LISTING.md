# 📦 AGENSI.IO COMMERCIAL PRODUCT LISTING DOSSIER
**Marketplace URL**: [https://www.agensi.io/sell](https://www.agensi.io/sell)  
**Product**: CodeContext Pro (v4.0.0 Enterprise)  
**Target Audience**: 65,000+ Monthly Active Developers & AI Engineers (Claude Code, Cursor, Windsurf)  
**Creator**: Alejandro Chataing  

---

## 🏷️ 1. LISTING METADATA & HERO COPY

### Product Title
> **CodeContext Pro v4.0.0 — Enterprise AST Code Intelligence & Token Optimizer for Claude, Cursor & Windsurf**

### High-Impact Tagline
> *"Cut your LLM token bills by 85% and eliminate hallucinated code edits with Tree-sitter WASM surgical refactoring and zero-DB virtual ORM schemas."*

### Category
- Primary: **Developer Tools & Infrastructure**
- Secondary: **Context Optimization & Token Compression**

### Badges / Tags
`#TreeSitter` `#TokenOptimizer` `#ModelContextProtocol` `#ClaudeCode` `#Cursor` `#Windsurf` `#ActiveRecord` `#Eloquent` `#Django`

---

## 💰 2. PRICING STRATEGY & REVENUE MODEL (70/30 REVENUE SPLIT)

| Pricing Tier | Retail Price (USD) | Creator Share (70%) | Agensi.io Share (30%) | Target Conversion Volume |
| :--- | :--- | :--- | :--- | :--- |
| **Individual Pro (Perpetual)** | **$29.00** | **$20.30** | **$8.70** | ~350 units / month |
| **Team License (5 Seats)** | **$99.00** | **$69.30** | **$29.70** | ~60 teams / month |

### 📈 Monthly Financial Projection (Conservative 0.6% Marketplace Penetration):
- **350 Individual Licenses** $\times \$20.30 = \$7,105.00$
- **60 Team Licenses** $\times \$69.30 = \$4,158.00$
- **Estimated Net Monthly Creator Revenue**: **$11,263.00 USD / month**

---

## 📊 3. THE VALUE PROPOSITION & BENCHMARKS (THE "HOOK")

### Why Developers Buy in the First 30 Seconds:
Standard AI coding tools suffer from **The Context Bloat Trap**:
1. When you ask Claude or Cursor to inspect a bug in a 1,200-line service, standard tools dump the entire file into the prompt (`cat`, `read_file`), burning **15,000 to 45,000 tokens**.
2. Context windows fill up, latency spikes to 8+ seconds, and the model starts hallucinating imports and syntax.
3. Monthly API bills skyrocket past $150-$300.

### The CodeContext Pro Breakthrough:
CodeContext Pro operates at the **AST (Abstract Syntax Tree)** layer using embedded WebAssembly parsers. Instead of reading whole files, it extracts only the exact class, method, or dependency chain needed.

```text
┌────────────────────────────────────────────────────────────────────────┐
│               EMPIRICAL TOKEN COMPRESSION BENCHMARKS                   │
├────────────────────────────────────────────────────────────────────────┤
│ Benchmark Task              │ Raw Code (cat) │ CodeContext Pro │ Ahorro │
├─────────────────────────────┼────────────────┼─────────────────┼────────┤
│ Full Monolith Onboarding    │ 54,200 tokens  │ 6,400 tokens    │ 88.2%  │
│ Surgical Method Refactoring │ 4,100 tokens   │ 410 tokens      │ 90.0%  │
│ Cross-File Impact Analysis  │ 38,000 tokens  │ 1,350 tokens    │ 96.4%  │
│ Rails/Laravel Schema Audit  │ 18,500 tokens  │ 820 tokens      │ 95.5%  │
└─────────────────────────────┴────────────────┴─────────────────┴────────┘
```
> **Net Value Delivered**: Pays for itself within the first 48 hours of heavy coding.

---

## 🌟 4. KEY DIFFERENTIATORS (COMPETITIVE ADVANTAGE)

1. **Dual Transport Architecture (v4.0.0)**:
   - Native `stdio` for Claude Code CLI and Claude Desktop.
   - High-throughput **Streamable HTTP / SSE** for Cursor, Windsurf, remote containers, and Docker.
2. **Zero Native C++ Dependencies**:
   - Compiles 100% on pure WebAssembly (`web-tree-sitter`). Zero `node-gyp`, zero Python build toolchains required on the user's machine. Works instantly on macOS, Linux, and Windows.
3. **The Virtual ORM Triad (Zero DB Connection Required)**:
   - Static schema extraction for **Ruby on Rails** (`db/schema.rb`), **Laravel Eloquent** (`database/migrations/*.php`), and **Django Models** (`models.py`). Injects column types directly into LLM prompts without exposing production database credentials!
4. **Two-Phase Atomic Mutation Ledger**:
   - Preview git diff with a cryptographic `confirmationToken` before any file write.
   - Built-in SQLite rollback engine: `rollback_file` reverts any unwanted change instantly.

---

## 🚀 5. STEP-BY-STEP BUYER ONBOARDING GUIDE

### Step 1: Install via NPX (Zero Build Required)
Run anywhere Node.js (>= 18) is installed:
```bash
npx -y mcp-code-context@latest
```

### Step 2: Configure Your Client

#### For Claude Desktop / Claude Code:
Add to `claude_desktop_config.json`:
```json
{
  "mcpServers": {
    "code-context": {
      "command": "npx",
      "args": ["-y", "mcp-code-context@latest"]
    }
  }
}
```

#### For Cursor / Windsurf:
Start the server in background:
```bash
npx -y mcp-code-context@latest --http --port=3000
```
Add an MCP server in Cursor settings:
- **Name**: `code-context-pro`
- **Type**: `Streamable HTTP / SSE`
- **URL**: `http://127.0.0.1:3000/sse`

### Step 3: Install the Prompt Brain
Copy `skills/code-context-pro/SKILL.md` into your `.claude/skills/` or `.cursor/skills/` folder. Your agent is now supercharged!

---

## 🛡️ 6. REFUND POLICY & GUARANTEE
- **14-Day Zero-Friction Money-Back Guarantee**: If CodeContext Pro doesn't save you at least 50% on your monthly token usage, 100% refund processed through Agensi.io with zero questions asked.
