import * as fs from 'node:fs';
import * as path from 'node:path';
import { handleWriteFileSurgical, handleRollbackFile } from '../dist/index.js';

async function testWorkflow() {
  const testFile = path.resolve('test-artifact.ts');
  const initialContent = 'export class Old { build() { return 1; } }';
  fs.writeFileSync(testFile, initialContent, 'utf-8');

  console.log('--- Step 1: Preview (Dry-Run) ---');
  const previewArgs = {
    filePath: testFile,
    symbolName: 'build',
    newContent: '  build() { return "new value"; }',
    className: 'Old'
  };
  
  const p1 = await handleWriteFileSurgical(previewArgs);
  const p1Text = p1.content[0].text;
  console.log('Preview Result:', p1Text.split('\n')[0]);
  
  const tokenMatch = p1Text.match(/confirmationToken: "([^"]+)"/);
  if (!tokenMatch) throw new Error('No token found');
  const token = tokenMatch[1];
  console.log('Token found:', token);

  console.log('\n--- Step 2: Confirm ---');
  const confirmArgs = {
    ...previewArgs,
    confirmationToken: token,
    confirm: true
  };
  const p2 = await handleWriteFileSurgical(confirmArgs);
  console.log('Confirm Result:', p2.content[0].text.split('\n')[0]);
  console.log('File Content:', fs.readFileSync(testFile, 'utf-8'));

  console.log('\n--- Step 3: Rollback ---');
  await handleRollbackFile({ filePath: testFile, steps: 1 });
  console.log('After Rollback:', fs.readFileSync(testFile, 'utf-8'));

  // Clean up
  fs.unlinkSync(testFile);
  const backupDir = path.join(path.dirname(testFile), '.mcp-backups');
  if (fs.existsSync(backupDir)) {
    fs.rmSync(backupDir, { recursive: true, force: true });
  }
}

testWorkflow().catch(console.error);
