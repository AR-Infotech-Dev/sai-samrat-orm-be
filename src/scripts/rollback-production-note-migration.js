import fs from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { query } from "../config/database.js";
try {
  const backup=JSON.parse(await fs.readFile("C:/Users/LOQ/Documents/ORM/production-note-tables-backup.json","utf8"));
  const q=(name)=>{if(!/^[a-zA-Z0-9_]+$/.test(name))throw new Error("Invalid identifier");return `\`${name}\``;};
  // First restore columns, preserving the dispatch compatibility views.
  execFileSync(process.execPath,[fileURLToPath(new URL("./migrate-production-note-columns.js",import.meta.url)),"--rollback"],{stdio:"inherit"});
  for(const entry of backup.plan.tables)await query(`DROP VIEW ${q(entry.table)}`);
  await query("RENAME TABLE "+backup.plan.tables.map((entry)=>`${q(entry.target)} TO ${q(entry.table)}`).join(", "));
  console.log("Original table/column names restored. IDs and records preserved.");process.exit(0);
} catch(error){console.error(error.message);process.exit(1);}
