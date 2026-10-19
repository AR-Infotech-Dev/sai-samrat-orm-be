import { query, DB_PREFIX } from "../config/database.js";

try {
  const columns = await query(`SHOW COLUMNS FROM ${DB_PREFIX}proforma_invoices`);
  const status = columns.find((column) => column.Field === "pi_status");
  if (status.Type.startsWith("enum(")) {
    const values = [...status.Type.matchAll(/'([^']+)'/g)].map((match) => match[1]);
    const updated = [...new Set([...values, "waiting", "approved"])];
    await query(`ALTER TABLE ${DB_PREFIX}proforma_invoices MODIFY pi_status ENUM(${updated.map((value) => `'${value.replace(/'/g, "''")}'`).join(",")}) NOT NULL DEFAULT 'draft'`);
  }
  for (const [name, type] of [["approved_by", "INT NULL"], ["approved_at", "DATETIME NULL"]]) {
    if (!columns.some((column) => column.Field === name)) await query(`ALTER TABLE ${DB_PREFIX}proforma_invoices ADD COLUMN ${name} ${type}`);
  }
  console.log("PI lifecycle migration complete");
  process.exit(0);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
