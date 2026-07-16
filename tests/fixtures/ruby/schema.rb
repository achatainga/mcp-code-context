# Minimal Rails schema fixture for railsSchema parser tests
# Deliberately includes t.index do...end blocks to test depth-tracking parser

ActiveRecord::Schema[7.1].define(version: 2024_01_01_000001) do
  enable_extension "plpgsql"

  create_table "users", force: :cascade do |t|
    t.string "email", null: false
    t.string "password_digest"
    t.string "first_name"
    t.string "last_name"
    t.boolean "active", default: true, null: false
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.index ["email"], name: "index_users_on_email", unique: true
  end

  create_table "admin_users", force: :cascade do |t|
    t.string "username", null: false
    t.integer "role_id"
    t.string "last_login_ip"
    t.index ["username", "role_id"] do |i|
      i.name = "compound_admin_index"
      i.unique = true
    end
    t.string "department"
    t.timestamps
  end

  create_table "order_items", force: :cascade do |t|
    t.integer "order_id", null: false
    t.integer "product_id", null: false
    t.decimal "quantity", precision: 10, scale: 2
    t.decimal "unit_price", precision: 10, scale: 2
    t.datetime "created_at", null: false
    t.index ["order_id"], name: "index_order_items_on_order_id"
  end
end
