# Contributing to mcp-code-context

Thank you for your interest in contributing! This document provides guidelines and instructions for contributing to this project.

## 🌟 Ways to Contribute

- **Bug Reports**: Found a bug? Open an issue with detailed reproduction steps
- **Feature Requests**: Have an idea? Describe the use case and expected behavior
- **Code Contributions**: Submit pull requests for bug fixes or new features
- **Documentation**: Improve README, add examples, fix typos
- **Testing**: Add test cases, report edge cases

## 🚀 Getting Started

### Prerequisites

- Node.js >= 18
- npm or yarn
- Git

### Setup Development Environment

```bash
# Clone the repository
git clone https://github.com/achatainga/mcp-code-context.git
cd mcp-code-context

# Install dependencies
npm install

# Build the project
npm run build

# Run tests
npm test
```

## 📝 Development Workflow

### 1. Create a Branch

```bash
git checkout -b feature/your-feature-name
# or
git checkout -b fix/your-bug-fix
```

### 2. Make Changes

- Write clean, readable code
- Follow existing code style
- Add comments for complex logic
- Update documentation if needed

### 3. Test Your Changes

```bash
# Build
npm run build

# Run existing tests
npm test

# Test manually with MCP client
node dist/src/index.js
```

### 4. Commit Your Changes

Use conventional commit messages:

```bash
git commit -m "feat: add new feature"
git commit -m "fix: resolve bug in symbol extraction"
git commit -m "docs: update README with examples"
git commit -m "test: add tests for new tool"
```

**Commit Types:**
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation changes
- `test`: Adding or updating tests
- `refactor`: Code refactoring
- `perf`: Performance improvements
- `chore`: Maintenance tasks

### 5. Push and Create Pull Request

```bash
git push origin feature/your-feature-name
```

Then create a Pull Request on GitHub with:
- Clear title and description
- Reference any related issues
- Screenshots/examples if applicable

## 🧪 Testing Guidelines

### Writing Tests

Add tests in the `tests/` directory:

```typescript
// tests/test-your-feature.ts
import { yourFunction } from "../src/your-module.js";

console.log("🧪 Testing your feature...\n");

const result = yourFunction({ /* test input */ });

if (result.success) {
  console.log("✅ PASS: Test description");
} else {
  console.error("❌ FAIL: Test description");
}
```

### Running Tests

```bash
# Run all tests
npm test

# Run specific test
npm run build && node dist/tests/test-your-feature.js
```

## 📚 Code Style

### TypeScript

- Use TypeScript for all new code
- Define interfaces for complex types
- Use `const` over `let` when possible
- Prefer explicit return types

### Naming Conventions

- **Files**: `camelCase.ts` or `kebab-case.ts`
- **Functions**: `camelCase`
- **Classes**: `PascalCase`
- **Constants**: `UPPER_SNAKE_CASE`
- **Interfaces**: `PascalCase` (no `I` prefix)

### Comments

```typescript
/**
 * Brief description of function
 * 
 * @param param1 - Description
 * @param param2 - Description
 * @returns Description of return value
 */
export function myFunction(param1: string, param2: number): Result {
  // Implementation
}
```

## 🏗️ Project Structure

```
mcp-code-context/
├── src/
│   ├── index.ts              # Main MCP server
│   ├── ast/                  # AST parsers and compressors
│   │   ├── semanticCompressor.ts
│   │   ├── dartCompressor.ts
│   │   ├── phpCompressor.ts
│   │   └── writers/          # Write tools
│   ├── tools/                # New tools (read_file_lines, etc.)
│   └── utils/                # Utilities
├── tests/                    # Test files
├── dist/                     # Compiled output (gitignored)
└── docs/                     # Documentation
```

## 🐛 Reporting Bugs

When reporting bugs, include:

1. **Description**: Clear description of the issue
2. **Steps to Reproduce**: Minimal steps to reproduce
3. **Expected Behavior**: What should happen
4. **Actual Behavior**: What actually happens
5. **Environment**:
   - OS (Windows/macOS/Linux)
   - Node.js version
   - mcp-code-context version
6. **Code Sample**: Minimal reproducible example
7. **Error Messages**: Full error output

## 💡 Feature Requests

When requesting features, include:

1. **Use Case**: Why is this feature needed?
2. **Proposed Solution**: How should it work?
3. **Alternatives**: Other approaches considered
4. **Examples**: Code examples of desired behavior

## 🔍 Code Review Process

All contributions go through code review:

1. **Automated Checks**: Tests must pass
2. **Code Quality**: Follows style guidelines
3. **Documentation**: Updated if needed
4. **Testing**: Adequate test coverage
5. **Approval**: At least one maintainer approval

## 📄 License

By contributing, you agree that your contributions will be licensed under the MIT License.

## 🙏 Recognition

Contributors will be recognized in:
- GitHub contributors page
- Release notes (for significant contributions)
- CHANGELOG.md

## 📞 Questions?

- Open a GitHub Discussion
- Comment on related issues
- Reach out to maintainers

## 🎯 Priority Areas

Current priority areas for contributions:

1. **Language Support**: Add support for more languages (Ruby, Go, Rust, etc.)
2. **Performance**: Optimize large repository scanning
3. **Testing**: Increase test coverage
4. **Documentation**: More examples and use cases
5. **Error Handling**: Improve error messages

---

Thank you for contributing to mcp-code-context! 🚀
