import fs from 'node:fs';
import path from 'node:path';

/**
 * Universal Version Replacer - v1.0.0
 * Usage: node scripts/replace-version.js <oldVersion> <newVersion>
 */

const [,, oldVersion, newVersion] = process.argv;

if (!oldVersion || !newVersion) {
  console.error('Usage: node scripts/replace-version.js <oldVersion> <newVersion>');
  console.error('Example: node scripts/replace-version.js 3.4.0 3.4.1');
  process.exit(1);
}

const root = process.cwd();
const oldRegex = new RegExp(oldVersion.replace(/\./g, '\\.'), 'g');

console.log(`🚀 Starting global replace: ${oldVersion} -> ${newVersion}`);

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
      // Process only relevant text files
      const ext = path.extname(file).toLowerCase();
      const textExtensions = ['.ts', '.js', '.json', '.md', '.txt', '.d.ts', '.map'];
      
      if (textExtensions.includes(ext) || file.endsWith('.d.ts')) {
        try {
          const content = fs.readFileSync(fullPath, 'utf8');
          if (content.includes(oldVersion)) {
            const updated = content.replace(oldRegex, newVersion);
            fs.writeFileSync(fullPath, updated, 'utf8');
            console.log(`✅ Updated: ${fullPath}`);
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
