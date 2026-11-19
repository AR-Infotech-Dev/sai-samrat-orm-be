import { query, DB_PREFIX } from "../config/database.js";
import fs from "node:fs/promises";

const tables = {
  orders: "production_notes", order_items: "production_note_items", order_history: "production_note_history",
  order_item_planning: "production_note_item_planning", order_item_planning_history: "production_note_item_planning_history",
  order_item_production: "production_note_item_production", order_item_production_history: "production_note_item_production_history",
};
const fields = {
  order_id: "production_note_id", order_item_id: "production_note_item_id", order_no: "production_note_no",
  order_code: "production_code", order_date: "production_note_date", order_month: "production_note_month",
  order_week: "production_note_week", order_status: "production_note_status", order_qty: "production_note_qty",
  total_order_qty: "total_production_note_qty", total_order_value: "total_production_note_value",
};
try {
  const columns = await query("SELECT TABLE_NAME,COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE()");
  const plan = [];
  for (const [old, next] of Object.entries(tables)) {
    if (!columns.some((column) => column.TABLE_NAME === DB_PREFIX + old)) continue;
    const rows = await query(`SELECT COUNT(*) AS count FROM ${DB_PREFIX}${old}`);
    plan.push({ table: DB_PREFIX + old, target: DB_PREFIX + next, rows: rows[0].count });
  }
  const renames = columns.filter((column) => fields[column.COLUMN_NAME]).map((column) => ({
    table: column.TABLE_NAME, from: column.COLUMN_NAME, to: fields[column.COLUMN_NAME],
  }));
  const menus = await query(`SELECT menu_id,menu_name,label,menu_link,table_name FROM ${DB_PREFIX}menu_master WHERE table_name IN (?,?) OR menu_link LIKE ?`, ["orders", "order_items", "%order%"]);
  const report = { mode: "READ_ONLY_PLAN", tables: plan, columns: renames, menus,
    prerequisites: ["Backup all affected tables and menu/permission metadata", "Update and verify all frontend/backend consumers together", "Stop writes during migration", "Validate row counts and PI/planning/production/dispatch links", "Preserve original IDs and provide reverse migration"],
  };
  await fs.writeFile("C:/Users/LOQ/Documents/ORM/production-note-migration-plan.json", JSON.stringify(report, null, 2));
  console.log(`${plan.length} tables, ${renames.length} column references, ${menus.length} menus mapped. No DB changes applied.`);
  process.exit(0);
} catch (error) { console.error(error.message); process.exit(1); }
