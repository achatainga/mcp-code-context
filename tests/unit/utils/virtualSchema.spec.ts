import { describe, it, expect } from "vitest";
import {
  parseLaravelMigration,
  parseDjangoModels,
  parsePrismaSchema,
  parseDrizzleSchema,
  formatUnifiedSchemaAnnotation,
  type ProjectDbSchema,
} from "../../../src/utils/virtualSchema.js";

describe("VirtualSchema (Laravel, Django, Prisma & Drizzle)", () => {
  it("should extract Laravel migration schema accurately without database", () => {
    const migrationCode = `
    <?php
    use Illuminate\\Database\\Migrations\\Migration;
    use Illuminate\\Database\\Schema\\Blueprint;
    use Illuminate\\Support\\Facades\\Schema;

    return new class extends Migration {
        public function up(): void {
            Schema::create('orders', function (Blueprint $table) {
                $table->id();
                $table->string('reference_code')->unique();
                $table->foreignId('customer_id')->constrained();
                $table->decimal('total_amount', 12, 2);
                $table->string('status')->default('pending');
                $table->timestamps();
                $table->softDeletes();
            });
        }
    };
    `;

    const schema: ProjectDbSchema = {};
    parseLaravelMigration(migrationCode, schema);

    expect(schema["orders"]).toBeDefined();
    expect(schema["orders"]["id"]).toBe("bigint primary key");
    expect(schema["orders"]["reference_code"]).toBe("string");
    expect(schema["orders"]["customer_id"]).toBe("foreignId");
    expect(schema["orders"]["total_amount"]).toBe("decimal");
    expect(schema["orders"]["status"]).toBe("string");
    expect(schema["orders"]["created_at"]).toBe("timestamp");
    expect(schema["orders"]["updated_at"]).toBe("timestamp");
    expect(schema["orders"]["deleted_at"]).toBe("timestamp nullable");
  });

  it("should extract Django models schema accurately without database", () => {
    const djangoModelCode = `
from django.db import models
from django.contrib.auth.models import User

class Invoice(models.Model):
    user = models.ForeignKey(User, on_delete=models.CASCADE)
    invoice_number = models.CharField(max_length=50, unique=True)
    amount = models.DecimalField(max_digits=10, decimal_places=2)
    is_paid = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return self.invoice_number
    `;

    const schema: ProjectDbSchema = {};
    parseDjangoModels(djangoModelCode, schema);

    expect(schema["invoices"]).toBeDefined();
    expect(schema["invoices"]["user"]).toBe("ForeignKey");
    expect(schema["invoices"]["invoice_number"]).toBe("CharField");
    expect(schema["invoices"]["amount"]).toBe("DecimalField");
    expect(schema["invoices"]["is_paid"]).toBe("BooleanField");
    expect(schema["invoices"]["created_at"]).toBe("DateTimeField");
  });

  it("should extract Prisma model schema accurately without database", () => {
    const prismaCode = `
    datasource db {
      provider = "postgresql"
      url      = env("DATABASE_URL")
    }

    model User {
      id        String   @id @default(cuid())
      email     String   @unique
      name      String?
      role      String   @default("USER")
      createdAt DateTime @default(now())
      posts     Post[]

      @@map("users")
    }

    model Post {
      id        Int      @id @default(autoincrement())
      title     String
      content   String?
      published Boolean  @default(false)
      authorId  String
      author    User     @relation(fields: [authorId], references: [id])
    }
    `;

    const schema: ProjectDbSchema = {};
    parsePrismaSchema(prismaCode, schema);

    expect(schema["users"]).toBeDefined();
    expect(schema["users"]["id"]).toContain("String @id @default(cuid())");
    expect(schema["users"]["email"]).toContain("String @unique");
    expect(schema["users"]["role"]).toContain('String @default("USER")');

    expect(schema["posts"]).toBeDefined();
    expect(schema["posts"]["id"]).toContain("Int @id @default(autoincrement())");
    expect(schema["posts"]["title"]).toBe("String");
    expect(schema["posts"]["published"]).toContain("Boolean @default(false)");
  });

  it("should extract Drizzle ORM schema accurately without database", () => {
    const drizzleCode = `
    import { pgTable, serial, text, varchar, timestamp, boolean } from 'drizzle-orm/pg-core';

    export const customers = pgTable('customers', {
      id: serial('id').primaryKey(),
      fullName: text('full_name').notNull(),
      email: varchar('email', { length: 256 }).unique(),
      isActive: boolean('is_active').default(true),
      createdAt: timestamp('created_at').defaultNow(),
    });
    `;

    const schema: ProjectDbSchema = {};
    parseDrizzleSchema(drizzleCode, schema);

    expect(schema["customers"]).toBeDefined();
    expect(schema["customers"]["id"]).toContain("serial.primaryKey()");
    expect(schema["customers"]["fullName"]).toContain("text.notNull()");
    expect(schema["customers"]["email"]).toContain("varchar.unique()");
    expect(schema["customers"]["isActive"]).toContain("boolean.default(true)");
    expect(schema["customers"]["createdAt"]).toContain("timestamp.defaultNow()");
  });

  it("should format unified schema annotations for Eloquent, Django, Prisma & Drizzle", () => {
    const annotation = formatUnifiedSchemaAnnotation("Prisma", "users", {
      id: "String @id",
      email: "String @unique",
    });

    expect(annotation).toContain("<!-- Prisma Virtual Schema: users");
    expect(annotation).toContain('<column name="id" type="String @id" />');
    expect(annotation).toContain('<column name="email" type="String @unique" />');
  });
});
