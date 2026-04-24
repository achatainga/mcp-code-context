import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();

function walk(dir) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const fullPath = path.join(dir, file);
    if (fullPath.includes('.git') || fullPath.includes('node_modules')) continue;
    
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      walk(fullPath);
    } else {
      // Only process text-like files
      if (file.endsWith('.ts') || file.endsWith('.js') || file.endsWith('.json') || file.endsWith('.md') || file.endsWith('.txt') || file.endsWith('.d.ts') || file.endsWith('.map')) {
        const content = fs.readFileSync(fullPath, 'utf8');
        if (content.includes('3.4.1')) {
          console.log(`Updating ${fullPath}`);
          const updated = content.replace(/3\.4\.0/g, '3.4.1');
          fs.writeFileSync(fullPath, updated, 'utf8');
        }
      }
    }
  }
}

walk(root);
console.log('Global version update complete.');
