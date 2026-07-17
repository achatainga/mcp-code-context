import fs from 'node:fs';
import path from 'node:path';

/**
 * Universal Version Replacer - v1.1.0
 * Usage: node scripts/replace-version.js <oldVersion> <newVersion>
 *
 * PROTECTED FILES — never modified by this script:
 *   - docs/ADR-*.md          (historical architecture decisions)
 *   - SECURITY.md            (CVE fix versions are historical facts)
 *   - docs/architecture/     (all architecture docs)
 *   - docs/plans/            (roadmap files)
 *   - CHANGELOG.md           (historical entries must not change — only new entry is added manually)
 */

const [,, oldVersion, newVersion] = process.argv;

if (!oldVersion || !newVersion) {
  console.error('Usage: node scripts/replace-version.js <oldVersion> <newVersion>');
  console.error('Example: node scripts/replace-version.js 3.8.1 3.9.0');
  process.exit(1);
}

const root = process.cwd();
const oldRegex = new RegExp(oldVersion.replace(/\./g, '\\.'), 'g');

// Files and directories that must NEVER be touched — historical documents
const PROTECTED_PATHS = [
  'SECURITY.md',
  'CHANGELOG.md',
  path.join('docs', 'ADR-'),
  path.join('docs', 'architecture'),
  path.join('docs', 'plans'),
];

function isProtected(fullPath) {
  const rel = path.relative(root, fullPath);
  return PROTECTED_PATHS.some(p => rel === p || rel.startsWith(p));
}

console.log(`🚀 Starting global replace: ${oldVersion} -> ${newVersion}`);
console.log(`🛡️  Protected (skipped): SECURITY.md, CHANGELOG.md, docs/ADR-*, docs/architecture/, docs/plans/`);

function walk(dir) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const fullPath = path.join(dir, file);

    // Safety boundaries
    if (fullPath.includes('.git') ||
        fullPath.includes('node_modules') ||
        fullPath.includes('scripts') ||
        file === 'stderr.txt' ||
        file === 'stdout.txt') continue;

    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      walk(fullPath);
    } else {
      // Skip protected historical files
      if (isProtected(fullPath)) {
        if (fs.readFileSync(fullPath, 'utf8').includes(oldVersion)) {
          console.log(`🛡️  Protected (skipped): ${path.relative(root, fullPath)}`);
        }
        continue;
      }

      const ext = path.extname(file).toLowerCase();
      const textExtensions = ['.ts', '.js', '.json', '.md', '.txt', '.d.ts', '.map'];

      if (textExtensions.includes(ext) || file.endsWith('.d.ts')) {
        try {
          const content = fs.readFileSync(fullPath, 'utf8');
          if (content.includes(oldVersion)) {
            const updated = content.replace(oldRegex, newVersion);
            fs.writeFileSync(fullPath, updated, 'utf8');
            console.log(`✅ Updated: ${path.relative(root, fullPath)}`);
          }
        } catch (err) {
          console.warn(`⚠️  Skipped ${fullPath}: ${err.message}`);
        }
      }
    }
  }
}

walk(root);
console.log('✨ Version update complete.');
console.log('');
console.log('📋 Manual steps required after this script:');
console.log('   1. Add new entry to CHANGELOG.md (top)');
console.log('   2. Update README.md "What\'s New" section');
console.log('   3. Update llms.txt "What\'s New" section');
console.log('   4. Verify SECURITY.md historical CVE versions unchanged');
