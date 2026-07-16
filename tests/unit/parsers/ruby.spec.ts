import { describe, it, expect, beforeAll } from "vitest";
import { RubyParser } from "@/parsers/ruby";
import { CodeContextEngine } from "@/core/engine";
import { parseSchemaRb, modelToTable } from "@/utils/railsSchema";

const RUBY_FIXTURE = `
class User < ApplicationRecord
  def full_name
    "\#{first_name} \#{last_name}"
  end

  def self.active
    where(active: true)
  end
end

module Authenticatable
  def authenticate(password)
    BCrypt::Password.new(password_digest) == password
  end
end
`;

const SCHEMA_FIXTURE = `
ActiveRecord::Schema[7.1].define(version: 2024_01_01) do
  create_table "users", force: :cascade do |t|
    t.string "email", null: false
    t.string "password_digest"
    t.boolean "active", default: true
    t.datetime "created_at", null: false
    t.index ["email"], name: "index_users_on_email", unique: true
  end

  create_table "admin_users", force: :cascade do |t|
    t.string "username"
    t.integer "role_id"
    t.index ["username", "role_id"] do |i|
      i.name = "compound_admin_index"
      i.unique = true
    end
    t.string "last_login_ip"
  end
end
`;

describe("RubyParser", () => {
  let parser: RubyParser;

  beforeAll(async () => {
    const engine = new CodeContextEngine();
    await engine.init();
    await engine.loadLanguage("ruby");
    parser = new RubyParser();
    await parser.init(engine.createParser(), engine.getLanguage("ruby")!);
  }, 30000);

  it("finds classes, singleton methods, and modules", () => {
    const tree = parser.parse(RUBY_FIXTURE);
    const symbols = parser.findSymbols(tree);

    expect(symbols.some(s => s.name === "User" && s.type === "class")).toBe(true);
    expect(symbols.some(s => s.name === "full_name" && s.className === "User")).toBe(true);
    expect(symbols.some(s => s.name === "active")).toBe(true); // singleton_method
    expect(symbols.some(s => s.name === "Authenticatable" && s.type === "module")).toBe(true);
  });

  it("surgically replaces a method without corrupting end hierarchy", () => {
    const tree = parser.parse(RUBY_FIXTURE);
    const replacement = `def full_name\n    "replaced"\n  end`;
    const result = parser.replaceSymbol(RUBY_FIXTURE, tree, "full_name", replacement, "User");

    expect(result).toContain('"replaced"');
    expect(result).toContain("class User");
    // The outer class `end` must survive
    const bareEnds = (result.match(/^end$/gm) ?? []).length;
    expect(bareEnds).toBeGreaterThanOrEqual(1);
  });

  it("extracts a symbol scoped to a className", () => {
    const tree = parser.parse(RUBY_FIXTURE);
    const extracted = parser.extractSymbol(tree, "full_name", "User");

    expect(extracted).not.toBeNull();
    expect(extracted).toContain("def full_name");
    expect(extracted).toContain("end");
  });
});

describe("railsSchema", () => {
  it("parses create_table blocks and maps column types", () => {
    const schema = parseSchemaRb(SCHEMA_FIXTURE);

    expect(schema["users"]).toBeDefined();
    expect(schema["users"]["email"]).toBe("string");
    expect(schema["users"]["active"]).toBe("boolean");
    expect(schema["users"]["created_at"]).toBe("datetime");
    expect(schema["admin_users"]["role_id"]).toBe("integer");
  });

  it("does NOT stop at t.index do...end blocks — captures columns after nested end", () => {
    const schema = parseSchemaRb(SCHEMA_FIXTURE);

    // admin_users has a t.index do...end block — last_login_ip comes AFTER it
    expect(schema["admin_users"]).toBeDefined();
    expect(schema["admin_users"]["username"]).toBe("string");
    expect(schema["admin_users"]["role_id"]).toBe("integer");
    // This is the critical regression test — would fail with the naive single-end parser
    expect(schema["admin_users"]["last_login_ip"]).toBe("string");
  });

  it("maps model class names to table names via Rails CoC", () => {
    expect(modelToTable("User")).toBe("users");
    expect(modelToTable("AdminUser")).toBe("admin_users");
    expect(modelToTable("Category")).toBe("categories");
    expect(modelToTable("OrderItem")).toBe("order_items");
    // Namespaced models
    expect(modelToTable("Billing::Invoice")).toBe("billing_invoices");
    expect(modelToTable("Api::V1::Request")).toBe("api_v1_requests");
  });
});
