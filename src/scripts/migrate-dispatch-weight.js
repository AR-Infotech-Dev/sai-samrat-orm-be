import { query, DB_PREFIX } from "../config/database.js";

try {
  const columns = await query(`SHOW COLUMNS FROM ${DB_PREFIX}dispatches`);
  for (const name of ["vehicle_capacity_kg", "total_consignment_weight_kg"]) {
    if (!columns.some((column) => column.Field === name)) {
      await query(`ALTER TABLE ${DB_PREFIX}dispatches ADD COLUMN ${name} DECIMAL(14,2) NULL`);
    }
  }
  console.log("Dispatch weight columns ready; existing records unchanged.");
  process.exit(0);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
