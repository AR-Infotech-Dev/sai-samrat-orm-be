import fs from "node:fs/promises";
import { query } from "../config/database.js";

const plan = JSON.parse(await fs.readFile("C:/Users/LOQ/Documents/ORM/production-note-migration-plan.json", "utf8"));
const tablesOnly = process.argv.includes("--tables-only");
if (tablesOnly) plan.columns = [];
const backupFile = tablesOnly ? "C:/Users/LOQ/Documents/ORM/production-note-tables-backup.json" : "C:/Users/LOQ/Documents/ORM/production-note-schema-backup.json";
const q = (identifier) => {
  if (!/^[a-zA-Z0-9_]+$/.test(identifier)) throw new Error("Invalid identifier");
  return `\`${identifier}\``;
};
const targetOf = (table) => plan.tables.find((entry) => entry.table === table)?.target || table;
try {
  if (!process.argv.includes("--apply")) {
    console.log(JSON.stringify(plan, null, 2));
    process.exit(0);
  }
  if (!tablesOnly) throw new Error("Column migration is gated until all module-specific callers are verified. Use table stage first.");
  const inventory = await query("SELECT TABLE_NAME,TABLE_TYPE FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE()");
  for (const entry of plan.tables) {
    if (!inventory.some((table) => table.TABLE_NAME === entry.table && table.TABLE_TYPE === "BASE TABLE")) throw new Error(`Missing source ${entry.table}`);
    if (inventory.some((table) => table.TABLE_NAME === entry.target)) throw new Error(`Target exists ${entry.target}`);
  }
  const fks = await query("SELECT TABLE_NAME,REFERENCED_TABLE_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA=DATABASE() AND REFERENCED_TABLE_NAME IS NOT NULL");
  const affected = new Set([...plan.tables.map((entry) => entry.table), ...plan.columns.map((entry) => entry.table)]);
  if (fks.some((fk) => affected.has(fk.TABLE_NAME) || affected.has(fk.REFERENCED_TABLE_NAME))) throw new Error("Foreign keys require a dedicated migration; no changes made");
  const snapshot = [];
  for (const table of affected) snapshot.push({ table, ddl: await query(`SHOW CREATE TABLE ${q(table)}`), columns: await query(`SHOW COLUMNS FROM ${q(table)}`), rows: await query(`SELECT * FROM ${q(table)}`) });
  await fs.writeFile(backupFile, JSON.stringify({plan,snapshot},null,2), {flag:"wx"});
  const completed = [];
  try {
    await query("RENAME TABLE " + plan.tables.map((entry)=>`${q(entry.table)} TO ${q(entry.target)}`).join(", "));
    completed.push({type:"tables"});
    for (const entry of plan.columns) {
      await query(`ALTER TABLE ${q(targetOf(entry.table))} RENAME COLUMN ${q(entry.from)} TO ${q(entry.to)}`);
      completed.push({type:"column",...entry});
    }
    for (const entry of plan.tables) {
      const original = snapshot.find((row)=>row.table===entry.table);
      const select = original.columns.map((column)=>{
        const renamed = plan.columns.find((change)=>change.table===entry.table && change.from===column.Field);
        return `${q(renamed?.to || column.Field)} AS ${q(column.Field)}`;
      }).join(", ");
      await query(`CREATE ALGORITHM=MERGE VIEW ${q(entry.table)} AS SELECT ${select} FROM ${q(entry.target)}`);
      completed.push({type:"view",table:entry.table});
    }
    for (const original of snapshot) {
      const current = await query(`SELECT * FROM ${q(targetOf(original.table))}`);
      const reverse = Object.fromEntries(plan.columns.filter((entry)=>entry.table===original.table).map((entry)=>[entry.to,entry.from]));
      const normalize = (row) => Object.fromEntries(Object.entries(row).map(([key,value])=>[reverse[key] || key,value]).sort(([a],[b])=>a.localeCompare(b)));
      const canonical = (rows)=>rows.map(normalize).map((row)=>JSON.stringify(row)).sort();
      if(JSON.stringify(canonical(current))!==JSON.stringify(canonical(original.rows))) throw new Error(`Data mismatch ${original.table}`);
    }
    await fs.writeFile("C:/Users/LOQ/Documents/ORM/production-note-schema-result.json",JSON.stringify({tables:plan.tables.length,columns:plan.columns.length,verifiedRows:snapshot.map((row)=>({table:targetOf(row.table),rows:row.rows.length})),compatibilityViews:plan.tables.map((entry)=>entry.table)},null,2));
    console.log(`${plan.tables.length} tables / ${plan.columns.length} columns migrated. All row values verified against backup.`);
  } catch(error) {
    for(const step of completed.reverse()){
      if(step.type==="view")await query(`DROP VIEW ${q(step.table)}`);
      if(step.type==="column")await query(`ALTER TABLE ${q(targetOf(step.table))} RENAME COLUMN ${q(step.to)} TO ${q(step.from)}`);
      if(step.type==="tables")await query("RENAME TABLE "+plan.tables.map((entry)=>`${q(entry.target)} TO ${q(entry.table)}`).join(", "));
    }
    throw error;
  }
  process.exit(0);
} catch(error){console.error(error.message);process.exit(1);}
