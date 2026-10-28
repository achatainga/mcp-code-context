import { describe, it, expect } from "vitest";
import {
  parseLaravelMigration,
  parseDjangoModels,
  formatUnifiedSchemaAnnotation,
  type ProjectDbSchema,
} from "../../../src/utils/virtualSchema.js";

describe("VirtualSchema (Laravel Eloquent & Django)", () => {
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

  it("should format unified schema annotations for Eloquent and Django", () => {
    const annotation = formatUnifiedSchemaAnnotation("Eloquent", "orders", {
      id: "bigint",
      total: "decimal",
    });

    expect(annotation).toContain("<!-- Eloquent Virtual Schema: orders");
    expect(annotation).toContain('<column name="id" type="bigint" />');
    expect(annotation).toContain('<column name="total" type="decimal" />');
  });
});
