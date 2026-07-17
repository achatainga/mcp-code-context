/**
 * Parser Registry - v3.9.0
 * Manages all language parsers
 */

import { BaseParser } from "./base.js";
import { TypeScriptParser } from "./typescript.js";
import { PythonParser } from "./python.js";
import { PHPParser } from "./php.js";
import { DartTreeSitterParser } from "./dartTreeSitter.js";
import { JavaParser } from "./java.js";
import { GoParser } from "./go.js";
import { CSharpParser } from "./csharp.js";
import { RubyParser } from "./ruby.js";
import { RustParser } from "./rust.js";
import { KotlinParser } from "./kotlin.js";
import { CodeContextEngine } from "../core/engine.js";

export class ParserRegistry {
  private parsers: Map<string, BaseParser> = new Map();
  private engine: CodeContextEngine;
  private extensionMap: Map<string, string> = new Map([
    [".ts", "typescript"],
    [".tsx", "typescript"],
    [".js", "typescript"],
    [".jsx", "typescript"],
    [".mts", "typescript"],
    [".mjs", "typescript"],
    [".py", "python"],
    [".pyi", "python"],
    [".php", "php"],
    [".dart", "dart"],
    [".java", "java"],
    [".go", "go"],
    [".cs", "c_sharp"],
    [".rb", "ruby"],
    [".rs", "rust"],
    [".kt", "kotlin"],
    [".kts", "kotlin"],
  ]);

  constructor(engine: CodeContextEngine) {
    this.engine = engine;
  }

  async init(): Promise<void> {
    // Load TypeScript
    await this.engine.loadLanguage("typescript");
    const tsLang = this.engine.getLanguage("typescript");
    if (!tsLang) throw new Error("Failed to load TypeScript language");
    const tsParser = new TypeScriptParser();
    await tsParser.init(this.engine.createParser(), tsLang);
    this.parsers.set("typescript", tsParser);

    // Load Python
    await this.engine.loadLanguage("python");
    const pyLang = this.engine.getLanguage("python");
    if (!pyLang) throw new Error("Failed to load Python language");
    const pyParser = new PythonParser();
    await pyParser.init(this.engine.createParser(), pyLang);
    this.parsers.set("python", pyParser);

    // Load PHP
    await this.engine.loadLanguage("php");
    const phpLang = this.engine.getLanguage("php");
    if (!phpLang) throw new Error("Failed to load PHP language");
    const phpParser = new PHPParser();
    await phpParser.init(this.engine.createParser(), phpLang);
    this.parsers.set("php", phpParser);

    // Load Dart (Tree-sitter WASM)
    await this.engine.loadLanguage("dart");
    const dartLang = this.engine.getLanguage("dart");
    if (!dartLang) throw new Error("Failed to load Dart language");
    const dartParser = new DartTreeSitterParser();
    await dartParser.init(this.engine.createParser(), dartLang);
    this.parsers.set("dart", dartParser);

    // Load Java
    await this.engine.loadLanguage("java");
    const javaLang = this.engine.getLanguage("java");
    if (!javaLang) throw new Error("Failed to load Java language");
    const javaParser = new JavaParser();
    await javaParser.init(this.engine.createParser(), javaLang);
    this.parsers.set("java", javaParser);

    // Load Go
    await this.engine.loadLanguage("go");
    const goLang = this.engine.getLanguage("go");
    if (!goLang) throw new Error("Failed to load Go language");
    const goParser = new GoParser();
    await goParser.init(this.engine.createParser(), goLang);
    this.parsers.set("go", goParser);

    // Load C#
    await this.engine.loadLanguage("c_sharp");
    const csharpLang = this.engine.getLanguage("c_sharp");
    if (!csharpLang) throw new Error("Failed to load C# language");
    const csharpParser = new CSharpParser();
    await csharpParser.init(this.engine.createParser(), csharpLang);
    this.parsers.set("c_sharp", csharpParser);

    // Load Ruby
    await this.engine.loadLanguage("ruby");
    const rubyLang = this.engine.getLanguage("ruby");
    if (!rubyLang) throw new Error("Failed to load Ruby language");
    const rubyParser = new RubyParser();
    await rubyParser.init(this.engine.createParser(), rubyLang);
    this.parsers.set("ruby", rubyParser);

    // Load Rust
    await this.engine.loadLanguage("rust");
    const rustLang = this.engine.getLanguage("rust");
    if (!rustLang) throw new Error("Failed to load Rust language");
    const rustParser = new RustParser();
    await rustParser.init(this.engine.createParser(), rustLang);
    this.parsers.set("rust", rustParser);

    // Load Kotlin
    await this.engine.loadLanguage("kotlin");
    const kotlinLang = this.engine.getLanguage("kotlin");
    if (!kotlinLang) throw new Error("Failed to load Kotlin language");
    const kotlinParser = new KotlinParser();
    await kotlinParser.init(this.engine.createParser(), kotlinLang);
    this.parsers.set("kotlin", kotlinParser);

    console.error("✅ Parsers loaded: TS/Python/PHP/Dart/Java/Go/C#/Ruby/Rust/Kotlin (WASM)");
  }

  getParser(fileExtension: string): BaseParser | undefined {
    const language = this.extensionMap.get(fileExtension);
    return language ? this.parsers.get(language) : undefined;
  }

  getSupportedExtensions(): string[] {
    return Array.from(this.extensionMap.keys());
  }
}
