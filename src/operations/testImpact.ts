import * as fs from "node:fs/promises";
import * as path from "node:path";
import { walkDir } from "../utils/fileWalker.js";

export interface ImpactedTest {
  testFile: string;
  reason: string;
  matchedCases?: string[];
}

export interface TestRunnerInfo {
  framework: string;
  command: string;
}

export interface TestImpactResult {
  target: {
    filePath: string;
    symbolName?: string;
  };
  testRunner: TestRunnerInfo;
  impactedTests: ImpactedTest[];
  totalImpactedTests: number;
  tokenSavingsEstimate: string;
}

const TEST_EXTENSIONS = [
  ".spec.ts", ".test.ts", ".spec.tsx", ".test.tsx",
  ".spec.js", ".test.js", ".spec.jsx", ".test.jsx",
  "_spec.rb", "_test.py", "_spec.py",
  "_test.go", "Test.java", "Test.php",
];

/**
 * Detect project's primary test runner and base command
 */
export async function detectTestRunner(projectRoot: string): Promise<TestRunnerInfo> {
  // 1. Vitest
  const hasVitestConfig = await fileExists(path.join(projectRoot, "vitest.config.ts")) ||
                          await fileExists(path.join(projectRoot, "vitest.config.js")) ||
                          await fileExists(path.join(projectRoot, "vitest.config.mts"));
  if (hasVitestConfig) {
    return { framework: "Vitest", command: "npx vitest run" };
  }

  // 2. Package.json check for Vitest / Jest
  try {
    const pkgContent = await fs.readFile(path.join(projectRoot, "package.json"), "utf-8");
    const pkg = JSON.parse(pkgContent);
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    if (deps["vitest"]) {
      return { framework: "Vitest", command: "npx vitest run" };
    }
    if (deps["jest"] || await fileExists(path.join(projectRoot, "jest.config.js")) || await fileExists(path.join(projectRoot, "jest.config.ts"))) {
      return { framework: "Jest", command: "npx jest" };
    }
  } catch {
    // ignore
  }

  // 3. Pytest
  if (
    await fileExists(path.join(projectRoot, "pytest.ini")) ||
    await fileExists(path.join(projectRoot, "pyproject.toml")) ||
    await fileExists(path.join(projectRoot, "setup.cfg"))
  ) {
    return { framework: "Pytest", command: "pytest" };
  }

  // 4. PHPUnit
  if (
    await fileExists(path.join(projectRoot, "phpunit.xml")) ||
    await fileExists(path.join(projectRoot, "phpunit.xml.dist"))
  ) {
    return { framework: "PHPUnit", command: "./vendor/bin/phpunit" };
  }

  // 5. RSpec
  if (await fileExists(path.join(projectRoot, ".rspec"))) {
    return { framework: "RSpec", command: "bundle exec rspec" };
  }

  // 6. Go test
  if (await fileExists(path.join(projectRoot, "go.mod"))) {
    return { framework: "Go", command: "go test" };
  }

  // 7. Cargo
  if (await fileExists(path.join(projectRoot, "Cargo.toml"))) {
    return { framework: "Cargo", command: "cargo test" };
  }

  return { framework: "Generic / npm", command: "npm test --" };
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Perform Test Impact Analysis for a source file and optional symbol
 */
export async function getImpactedTests(params: {
  filePath: string;
  symbolName?: string;
  projectRoot: string;
}): Promise<TestImpactResult> {
  const runner = await detectTestRunner(params.projectRoot);
  const impactedTests: ImpactedTest[] = [];

  const sourceFileName = path.basename(params.filePath);
  const sourceNameWithoutExt = sourceFileName.replace(/\.[^.]+$/, "");

  // Collect test files
  const candidateTestFiles: string[] = [];

  await walkDir(params.projectRoot, {
    extensions: [".ts", ".tsx", ".js", ".jsx", ".rb", ".py", ".go", ".php", ".java"],
    excludeDirs: ["node_modules", ".git", "dist", "build", "vendor", ".venv", "coverage"],
    onFile: async (fullPath: string) => {
      const lower = fullPath.toLowerCase();
      const isTestDir = lower.includes("/tests/") || lower.includes("\\tests\\") ||
                        lower.includes("/test/") || lower.includes("\\test\\") ||
                        lower.includes("/spec/") || lower.includes("\\spec\\") ||
                        lower.includes("/__tests__/") || lower.includes("\\__tests__\\");

      const hasTestExt = TEST_EXTENSIONS.some(ext => fullPath.endsWith(ext)) ||
                         path.basename(fullPath).startsWith("test_");

      if (isTestDir || hasTestExt) {
        if (fullPath !== params.filePath) {
          candidateTestFiles.push(fullPath);
        }
      }
    },
  });

  // Evaluate each candidate test file
  for (const testFilePath of candidateTestFiles) {
    try {
      const content = await fs.readFile(testFilePath, "utf-8");
      const relativeTestPath = path.relative(params.projectRoot, testFilePath).replace(/\\/g, "/");

      let isMatch = false;
      const reasons: string[] = [];
      const matchedCases: string[] = [];

      // 1. Filename correlation (e.g. userService.ts -> userService.spec.ts)
      const testBaseName = path.basename(testFilePath);
      if (testBaseName.includes(sourceNameWithoutExt)) {
        isMatch = true;
        reasons.push(`Direct naming match with source file (${sourceNameWithoutExt})`);
      }

      // 2. Direct import check
      if (
        content.includes(sourceFileName) ||
        content.includes(`/${sourceNameWithoutExt}`) ||
        content.includes(`'../${sourceNameWithoutExt}`) ||
        content.includes(`"./${sourceNameWithoutExt}`) ||
        content.includes(`'${sourceNameWithoutExt}'`) ||
        content.includes(`"${sourceNameWithoutExt}"`)
      ) {
        isMatch = true;
        reasons.push(`Imports source file '${sourceFileName}'`);
      }

      // 3. Symbol mention check
      if (params.symbolName && content.includes(params.symbolName)) {
        isMatch = true;
        reasons.push(`References target symbol '${params.symbolName}'`);

        // Extract specific test cases mentioning the symbol
        const testCaseRe = /(?:it|test|specify)\s*\(\s*["']([^"']+)["']/g;
        let tMatch: RegExpExecArray | null;
        while ((tMatch = testCaseRe.exec(content)) !== null) {
          const title = tMatch[1];
          // Check if test block or title mentions symbol
          if (title.toLowerCase().includes(params.symbolName.toLowerCase())) {
            matchedCases.push(title);
          }
        }

        // Also check Python def test_*()
        const pyTestRe = /def\s+(test_\w+)\s*\(/g;
        let pyMatch: RegExpExecArray | null;
        while ((pyMatch = pyTestRe.exec(content)) !== null) {
          if (pyMatch[1].toLowerCase().includes(params.symbolName.toLowerCase())) {
            matchedCases.push(pyMatch[1]);
          }
        }
      }

      if (isMatch) {
        impactedTests.push({
          testFile: relativeTestPath,
          reason: reasons.join("; "),
          matchedCases: matchedCases.length > 0 ? matchedCases.slice(0, 10) : undefined,
        });
      }
    } catch {
      // skip unreadable
    }
  }

  // Construct minimal test runner command
  const testFileList = impactedTests.map(t => t.testFile).join(" ");
  const runnerCommand = testFileList.length > 0
    ? `${runner.command} ${testFileList}`
    : `${runner.command}`;

  const savingsPct = impactedTests.length > 0 && candidateTestFiles.length > impactedTests.length
    ? Math.round(((candidateTestFiles.length - impactedTests.length) / candidateTestFiles.length) * 100)
    : 80;

  return {
    target: {
      filePath: path.relative(params.projectRoot, params.filePath).replace(/\\/g, "/"),
      symbolName: params.symbolName,
    },
    testRunner: {
      framework: runner.framework,
      command: runnerCommand,
    },
    impactedTests,
    totalImpactedTests: impactedTests.length,
    tokenSavingsEstimate: `${savingsPct}% test execution & LLM diagnostic time saved (${impactedTests.length} impacted vs ${candidateTestFiles.length} total test files)`,
  };
}
