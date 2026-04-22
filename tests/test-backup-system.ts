/**
 * Tests for Centralized Backup System
 * - Backup creation in project root
 * - Folder structure preservation
 * - clean_backups functionality
 */

import * as fs from 'fs';
import * as path from 'path';
import { createBackup, cleanAllBackups } from '../src/utils/backupManager.js';
import { findProjectRoot } from '../src/utils/projectRoot.js';

const TEST_DIR = path.join(process.cwd(), 'tests', 'fixtures', 'backup-test-project');
const TEST_FILE = path.join(TEST_DIR, 'src', 'components', 'Button.tsx');

function setupTestProject() {
  // Create test project structure
  if (fs.existsSync(TEST_DIR)) {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  }
  
  fs.mkdirSync(path.join(TEST_DIR, 'src', 'components'), { recursive: true });
  fs.writeFileSync(TEST_FILE, 'export const Button = () => <button>Click</button>;');
  
  // Create package.json to mark as project root
  fs.writeFileSync(
    path.join(TEST_DIR, 'package.json'),
    JSON.stringify({ name: 'backup-test-project' })
  );
}

function cleanupTestProject() {
  if (fs.existsSync(TEST_DIR)) {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  }
}

function runTests() {
  console.log('\n🧪 Testing Centralized Backup System...\n');
  
  let passed = 0;
  let failed = 0;
  
  // Setup
  setupTestProject();
  
  try {
    // Test 1: Find project root
    console.log('Test 1: Find project root');
    const projectRoot = findProjectRoot(TEST_FILE);
    if (projectRoot === TEST_DIR) {
      console.log('✅ PASS: Project root found correctly');
      passed++;
    } else {
      console.log(`❌ FAIL: Expected ${TEST_DIR}, got ${projectRoot}`);
      failed++;
    }
    
    // Test 2: Create backup in centralized location
    console.log('\nTest 2: Create backup in centralized location');
    const backupPath = createBackup(TEST_FILE);
    
    const expectedBackupDir = path.join(TEST_DIR, '.mcp-backups', 'src', 'components');
    const backupExists = fs.existsSync(backupPath);
    const inCorrectLocation = backupPath.startsWith(expectedBackupDir);
    
    if (backupExists && inCorrectLocation) {
      console.log('✅ PASS: Backup created in centralized location');
      console.log(`   Location: ${backupPath}`);
      passed++;
    } else {
      console.log('❌ FAIL: Backup not in correct location');
      console.log(`   Expected dir: ${expectedBackupDir}`);
      console.log(`   Actual path: ${backupPath}`);
      failed++;
    }
    
    // Test 3: Backup preserves folder structure
    console.log('\nTest 3: Backup preserves folder structure');
    const relativePath = path.relative(TEST_DIR, TEST_FILE);
    const expectedStructure = path.join('.mcp-backups', relativePath);
    const actualStructure = path.relative(TEST_DIR, backupPath.replace(/\.\d+\.backup$/, ''));
    
    if (actualStructure.startsWith(expectedStructure)) {
      console.log('✅ PASS: Folder structure preserved');
      console.log(`   Structure: ${expectedStructure}`);
      passed++;
    } else {
      console.log('❌ FAIL: Folder structure not preserved');
      console.log(`   Expected: ${expectedStructure}`);
      console.log(`   Actual: ${actualStructure}`);
      failed++;
    }
    
    // Test 4: Multiple backups in same location
    console.log('\nTest 4: Multiple backups (rolling system)');
    const backup2 = createBackup(TEST_FILE);
    const backup3 = createBackup(TEST_FILE);
    
    const allBackups = fs.readdirSync(expectedBackupDir)
      .filter(f => f.startsWith('Button.tsx.') && f.endsWith('.backup'));
    
    if (allBackups.length === 3) {
      console.log('✅ PASS: Multiple backups created');
      console.log(`   Backups: ${allBackups.join(', ')}`);
      passed++;
    } else {
      console.log(`❌ FAIL: Expected 3 backups, found ${allBackups.length}`);
      failed++;
    }
    
    // Test 5: clean_backups removes all backups
    console.log('\nTest 5: clean_backups removes all backups');
    const result = cleanAllBackups(TEST_DIR);
    const backupDirExists = fs.existsSync(path.join(TEST_DIR, '.mcp-backups'));
    
    if (result && !backupDirExists) {
      console.log('✅ PASS: All backups cleaned');
      console.log(`   Backup directory removed successfully`);
      passed++;
    } else {
      console.log('❌ FAIL: Backups not cleaned properly');
      console.log(`   Result: ${result}, Dir exists: ${backupDirExists}`);
      failed++;
    }
    
    // Test 6: clean_backups on non-existent directory
    console.log('\nTest 6: clean_backups on non-existent directory');
    const result2 = cleanAllBackups(TEST_DIR);
    
    if (!result2) {
      console.log('✅ PASS: Returns false when backup directory not found');
      passed++;
    } else {
      console.log('❌ FAIL: Should return false when directory not found');
      failed++;
    }
    
    // Test 7: Backup in nested project structure
    console.log('\nTest 7: Backup in deeply nested file');
    const deepFile = path.join(TEST_DIR, 'src', 'features', 'auth', 'components', 'LoginForm.tsx');
    fs.mkdirSync(path.dirname(deepFile), { recursive: true });
    fs.writeFileSync(deepFile, 'export const LoginForm = () => <form />;');
    
    const deepBackup = createBackup(deepFile);
    const expectedDeepDir = path.join(TEST_DIR, '.mcp-backups', 'src', 'features', 'auth', 'components');
    
    if (deepBackup.startsWith(expectedDeepDir)) {
      console.log('✅ PASS: Deep nesting preserved');
      console.log(`   Path: ${path.relative(TEST_DIR, deepBackup)}`);
      passed++;
    } else {
      console.log('❌ FAIL: Deep nesting not preserved');
      failed++;
    }
    
  } catch (error) {
    console.log(`❌ FAIL: Unexpected error: ${error}`);
    failed++;
  } finally {
    // Cleanup
    cleanupTestProject();
  }
  
  console.log('\n══════════════════════════════════════════════════');
  console.log(`📊 Results: ${passed} passed, ${failed} failed (${passed + failed} total)`);
  console.log('══════════════════════════════════════════════════\n');
  
  if (failed > 0) {
    process.exit(1);
  }
}

runTests();
