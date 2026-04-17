/**
 * Test script for Dart compression.
 */
import { compressDart, extractDartSymbol } from "../src/ast/dartCompressor.js";
import * as fs from "node:fs";

function log(label: string, value: string | number) {
  console.log(`\n${"─".repeat(60)}`);
  console.log(`✅ ${label}`);
  console.log(`${"─".repeat(60)}`);
  console.log(typeof value === "number" ? String(value) : value);
}

function fail(label: string, reason: string) {
  console.log(`\n${"─".repeat(60)}`);
  console.log(`❌ FAIL: ${label}`);
  console.log(`${"─".repeat(60)}`);
  console.log(reason);
  process.exitCode = 1;
}

async function main() {
  let passed = 0;
  let failed = 0;

  // ─── Test 1: Real class (HomeRepository) ──────────────────────────
  console.log("\n\n🧪 TEST 1: Compress HomeRepository.dart (Classes, getters, Future methods, docstrings)");

  const repoPath = "c:/code/detodo24_mobile/lib/features/home/data/repositories/home_repository.dart";
  if (fs.existsSync(repoPath)) {
    const content = fs.readFileSync(repoPath, "utf-8");
    const compressed = compressDart(content);
    const originalLines = content.split("\n").length;
    const compressedLines = compressed.split("\n").length;
    const ratio = ((1 - compressedLines / originalLines) * 100).toFixed(1);

    log(
      `HomeRepository: ${originalLines} → ${compressedLines} lines (${ratio}% reduction)`,
      compressed,
    );

    const checks = [
      ["import block", /import 'dart:convert';/],
      ["class declaration", /class HomeRepository/],
      ["final field", /final http\.Client _httpClient;/],
      ["static const field", /static const String _authHomeApiUrl/],
      ["constructor", /HomeRepository\(/],
      ["async method", /Future<List<Map<String, dynamic>>> fetchSections/],
      ["private async method", /Future<List<Map<String, dynamic>>> _fetchSectionsAuth/],
      ["doc comment", /Obtiene recomendaciones por misión Amazon-style/],
      ["body stripped", /\{ \/\* \.\.\. \*\/ \}/]
    ] as const;

    for (const [name, pattern] of checks) {
      if (pattern.test(compressed)) {
        console.log(`  ✓ Found: ${name}`);
        passed++;
      } else {
        fail(`Missing: ${name}`, `Pattern ${pattern} not found`);
        failed++;
      }
    }
  }

  // ─── Test 2: Real Widget (DT24Loading) ────────────────────────────
  console.log("\n\n🧪 TEST 2: Compress dt24_loading.dart (StatefulWidget, CustomPainter, @override)");

  const widgetPath = "c:/code/detodo24_mobile/lib/widgets/dt24_loading.dart";
  if (fs.existsSync(widgetPath)) {
    const content = fs.readFileSync(widgetPath, "utf-8");
    const compressed = compressDart(content);
    
    log("DT24Loading compressed:", compressed);

    const checks = [
      ["StatefulWidget", /class DT24Loading extends StatefulWidget/],
      ["doc comment", /Widget de carga personalizado/],
      ["const constructor", /const DT24Loading/],
      ["@override", /@override/],
      ["State class", /class _DT24LoadingState extends State<DT24Loading>/],
      ["mixin", /with SingleTickerProviderStateMixin/],
      ["CustomPainter", /class _DT24LoadingPainter extends CustomPainter/],
      ["method with complex generic", /State<DT24Loading> createState\(\) => \/\* \.\.\. \*\/;/]
    ] as const;

    for (const [name, pattern] of checks) {
      if (pattern.test(compressed)) {
        console.log(`  ✓ Found: ${name}`);
        passed++;
      } else {
        fail(`Missing: ${name}`, `Pattern ${pattern} not found`);
        failed++;
      }
    }
  }

  // ─── Test 3: Symbol Extraction ────────────────────────────────────
  console.log("\n\n🧪 TEST 3: Surgical Symbol Extraction (Dart)");

  if (fs.existsSync(repoPath)) {
    const content = fs.readFileSync(repoPath, "utf-8");
    
    // Extract class
    const repoClass = extractDartSymbol(content, "HomeRepository");
    if (repoClass && repoClass.includes("class HomeRepository")) {
      console.log(`  ✓ Successfully extracted class HomeRepository (${repoClass.split("\n").length} lines)`);
      passed++;
    } else {
      fail("Extract class", "Failed to extract HomeRepository");
      failed++;
    }

    // Extract method
    const fetchMethod = extractDartSymbol(content, "fetchSections");
    if (fetchMethod && fetchMethod.includes("Future<List<Map<String, dynamic>>> fetchSections")) {
      console.log(`  ✓ Successfully extracted method fetchSections (${fetchMethod.split("\n").length} lines)`);
      passed++;
    } else {
      fail("Extract method", "Failed to extract fetchSections");
      failed++;
    }
  }

  // ─── Test 4: Synthetic Dart with all patterns ─────────────────────
  console.log("\n\n🧪 TEST 4: Synthetic Dart with mixins, enums, extensions, types");

  const syntheticDart = `
import 'dart:async';
import 'package:flutter/material.dart';

part 'model.g.dart';

/// Top level typedef
typedef JsonMap = Map<String, dynamic>;

/// User State enum
enum UserState {
  loggedOut,
  loggedIn,
  loading;

  bool get isActive => this == UserState.loggedIn;
}

/// Logger mixin
mixin Logger on Object {
  void log(String message) {
    print('[\${runtimeType}] \$message');
  }
}

/// Extension on String
extension StringUtils on String {
  bool get isBlank => trim().isEmpty;
  
  String capitalize() {
    if (isBlank) return this;
    return '\${this[0].toUpperCase()}\${substring(1)}';
  }
}

/// Base user model
sealed class UserModel with Logger {
  final String id;
  
  const UserModel({required this.id});
  
  factory UserModel.fromJson(JsonMap json) {
    return NormalUser(id: json['id']);
  }
}

class NormalUser extends UserModel {
  final String name;
  late final String uppercaseName;
  
  NormalUser({
    required String id,
    this.name = '',
  }) : super(id: id) {
    uppercaseName = name.toUpperCase();
  }
  
  @override
  String toString() => 'User(\$id, \$name)';
  
  Future<void> save() async {
    await Future.delayed(const Duration(seconds: 1));
    log('Saved \$name');
  }
}
`;

  const compressedSyntax = compressDart(syntheticDart);
  log("Synthetic compressed", compressedSyntax);

  const synthChecks = [
    ["part statement", /part 'model.g.dart';/],
    ["typedef", /typedef JsonMap = Map<String, dynamic>;/],
    ["enum", /enum UserState {/],
    ["enum cases", /loggedOut,\s+loggedIn,\s+loading;/],
    ["enum method", /bool get isActive => \/\* \.\.\. \*\/;/],
    ["mixin", /mixin Logger on Object {/],
    ["extension", /extension StringUtils on String {/],
    ["extension getter", /bool get isBlank => \/\* \.\.\. \*\/;/],
    ["sealed class", /sealed class UserModel with Logger {/],
    ["const constructor", /const UserModel\({required this.id}\);/],
    ["factory constructor", /factory UserModel.fromJson\(JsonMap json\) { \/\* \.\.\. \*\/ }/],
    ["late final field", /late final String uppercaseName;/],
    ["initializer list constructor", /NormalUser\([\s\S]*?\) : super\(id: id\) { \/\* \.\.\. \*\/ }/],
    ["arrow function override", /@override\s+String toString\(\) => \/\* \.\.\. \*\/;/]
  ] as const;

  for (const [name, pattern] of synthChecks) {
    if (pattern.test(compressedSyntax)) {
      console.log(`  ✓ Found: ${name}`);
      passed++;
    } else {
      fail(`Missing: ${name}`, `Pattern ${pattern} not found in compressed output`);
      failed++;
    }
  }

  // ─── Test 5: ClassName Extraction Disambiguation ─────────────
  console.log("\n\n🧪 TEST 5: ClassName Extraction Disambiguation");

  const multiClassDart = `
class ClassA {
  void build() {
    print('A');
  }
}

class ClassB {
  void build() {
    print('B');
  }
}
  `;

  const extractedBuildA = extractDartSymbol(multiClassDart, "build", "ClassA");
  if (extractedBuildA && extractedBuildA.includes("print('A');")) {
    console.log(`  ✓ Successfully extracted build from ClassA`);
    passed++;
  } else {
    fail("Extract ClassA build", "Failed to properly extract build from ClassA");
    failed++;
  }

  const extractedBuildB = extractDartSymbol(multiClassDart, "build", "ClassB");
  if (extractedBuildB && extractedBuildB.includes("print('B');")) {
    console.log(`  ✓ Successfully extracted build from ClassB`);
    passed++;
  } else {
    fail("Extract ClassB build", "Failed to properly extract build from ClassB");
    failed++;
  }

  // ─── Summary ─────────────────────────────────────────────────
  console.log(`\n\n${"═".repeat(60)}`);
  console.log(`📊 RESULTS: ${passed} passed, ${failed} failed`);
  console.log(`${"═".repeat(60)}\n`);
}

main().catch(console.error);
