import fs from 'node:fs';
import path from 'node:path';

/**
 * Universal Version Replacer - v2.0.0 (Targeted & Context-Aware)
 * Usage: node scripts/replace-version.js <oldVersion> <newVersion>
 *
 * Designed with strict safety boundaries to prevent false-positive replacements:
 * - Never modifies historical documents (CHANGELOG.md, SECURITY.md, docs/*)
 * - Never modifies build output (dist/*, dist-tests/*)
 * - Never modifies test files (tests/*) — test files test specific historical behaviors
 * - Never blindly replaces versions in comments or comparison tables
 * - Modifies ONLY explicit version declarations in target files:
 *     1. package.json ("version": "...")
 *     2. package-lock.json (root package version declarations)
 *     3. src/index.ts (SERVER_VERSION and top header)
 *     4. src/ file header docblocks (lines 1-5 only)
 *     5. llms.txt & INSTRUCTIONS.md (title and version metadata badges)
 */

const [,, oldVersion, newVersion] = process.argv;

if (!oldVersion || !newVersion) {
  console.error('Usage: node scripts/replace-version.js <oldVersion> <newVersion>');
  console.error('Example: node scripts/replace-version.js 3.9.2 3.9.3');
  process.exit(1);
}

const semverRegex = /^\d+\.\d+\.\d+$/;
if (!semverRegex.test(oldVersion) || !semverRegex.test(newVersion)) {
  console.error(`❌ Both oldVersion (${oldVersion}) and newVersion (${newVersion}) must follow semantic versioning (X.Y.Z).`);
  process.exit(1);
}

const root = process.cwd();

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

let modifiedFiles = 0;

function updateFile(relPath, replacer) {
  const fullPath = path.join(root, relPath);
  if (!fs.existsSync(fullPath)) {
    console.warn(`⚠️  File not found: ${relPath}`);
    return;
  }
  const content = fs.readFileSync(fullPath, 'utf8');
  const updated = replacer(content);
  if (content !== updated) {
    fs.writeFileSync(fullPath, updated, 'utf8');
    console.log(`✅ Updated: ${relPath}`);
    modifiedFiles++;
  } else {
    console.log(`ℹ️  No changes needed in: ${relPath}`);
  }
}

console.log(`🚀 Starting targeted version update: ${oldVersion} -> ${newVersion}`);

// 1. package.json
updateFile('package.json', (content) => {
  return content.replace(
    new RegExp(`("version":\\s*")${escapeRegex(oldVersion)}(")`, 'g'),
    `$1${newVersion}$2`
  );
});

// 2. package-lock.json (root and package root only)
updateFile('package-lock.json', (content) => {
  return content.replace(
    new RegExp(`("version":\\s*")${escapeRegex(oldVersion)}(")`, 'g'),
    `$1${newVersion}$2`
  );
});

// 3. src/index.ts
updateFile('src/index.ts', (content) => {
  let res = content.replace(
    new RegExp(`(const SERVER_VERSION = ")${escapeRegex(oldVersion)}(";)`),
    `$1${newVersion}$2`
  );
  res = res.replace(
    new RegExp(`(mcp-code-context v)${escapeRegex(oldVersion)}`),
    `$1${newVersion}`
  );
  return res;
});

// 4. Update file headers in src/ (lines 1-5 only, matching header comment format)
function updateSrcHeaders(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      updateSrcHeaders(fullPath);
    } else if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.js'))) {
      const relPath = path.relative(root, fullPath);
      const content = fs.readFileSync(fullPath, 'utf8');
      const lines = content.split('\n');
      let changed = false;

      // Only check the first 5 lines for module header: ` * ... - vX.Y.Z` or ` * vX.Y.Z`
      const maxLines = Math.min(lines.length, 5);
      const headerRegex = new RegExp(`( \\* .*?\\bv)${escapeRegex(oldVersion)}(\\b)`);

      for (let i = 0; i < maxLines; i++) {
        if (headerRegex.test(lines[i])) {
          lines[i] = lines[i].replace(headerRegex, `$1${newVersion}$2`);
          changed = true;
        }
      }

      if (changed) {
        fs.writeFileSync(fullPath, lines.join('\n'), 'utf8');
        console.log(`✅ Updated header: ${relPath}`);
        modifiedFiles++;
      }
    }
  }
}

updateSrcHeaders(path.join(root, 'src'));

// 5. llms.txt (Title and Version metadata)
updateFile('llms.txt', (content) => {
  let res = content.replace(
    new RegExp(`(# mcp-code-context v)${escapeRegex(oldVersion)}`),
    `$1${newVersion}`
  );
  res = res.replace(
    new RegExp(`(\\*\\*Version\\*\\*:\\s*)${escapeRegex(oldVersion)}`),
    `$1${newVersion}`
  );
  return res;
});

// 6. INSTRUCTIONS.md (Version metadata)
updateFile('INSTRUCTIONS.md', (content) => {
  return content.replace(
    new RegExp(`(\\*\\*Version\\*\\*:\\s*)${escapeRegex(oldVersion)}`),
    `$1${newVersion}`
  );
});

console.log('');
console.log(`✨ Version bump complete: ${modifiedFiles} files updated.`);
console.log('');
console.log('🛡️  Protected boundaries maintained:');
console.log('   - tests/ (historical test suites untouched)');
console.log('   - dist/ & dist-tests/ (must be rebuilt via npm run rebuild)');
console.log('   - CHANGELOG.md (must add new version section manually)');
console.log('   - SECURITY.md (historical CVE versions preserved)');
console.log('   - docs/ (historical documentation preserved)');
console.log('');
console.log('📋 Next steps:');
console.log('   1. Add new release notes to CHANGELOG.md');
console.log('   2. Update README.md "What\'s New" section');
console.log('   3. Run: npm run rebuild && npm run build:tests && npm test');
console.log('   4. Verify package: npm pack --dry-run');
