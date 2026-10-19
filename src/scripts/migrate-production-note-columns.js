import fs from "node:fs/promises";
import { query } from "../config/database.js";
const plan=JSON.parse(await fs.readFile("C:/Users/LOQ/Documents/ORM/production-note-migration-plan.json","utf8"));
const backupFile="C:/Users/LOQ/Documents/ORM/production-note-columns-backup.json";
const q=(name)=>{if(!/^[a-zA-Z0-9_]+$/.test(name))throw new Error("Invalid identifier");return `\`${name}\``;};
const physical=(table)=>plan.tables.find((entry)=>entry.table===table)?.target || table;
const views=plan.tables.map((entry)=>({view:entry.table,table:entry.target,source:entry.table}));
for(const source of [...new Set(plan.columns.map((entry)=>entry.table))])if(!plan.tables.some((entry)=>entry.table===source))views.push({view:source+"_legacy",table:source,source});
async function createViews(snapshot, migrated){
 for(const entry of views){
  const original=snapshot.find((row)=>row.source===entry.source);
  const select=original.columns.map((col)=>{const change=plan.columns.find((field)=>field.table===entry.source && field.from===col.Field);return `${q(migrated ? change?.to || col.Field : col.Field)} AS ${q(col.Field)}`;}).join(",");
  await query(`CREATE OR REPLACE ALGORITHM=MERGE VIEW ${q(entry.view)} AS SELECT ${select} FROM ${q(entry.table)}`);
 }
}
try{
 if(process.argv.includes("--rollback")){
  const snapshot=JSON.parse(await fs.readFile(backupFile,"utf8"));
  for(const entry of [...plan.columns].reverse())await query(`ALTER TABLE ${q(physical(entry.table))} RENAME COLUMN ${q(entry.to)} TO ${q(entry.from)}`);
  await createViews(snapshot,false);console.log("Column names restored; legacy views preserved");process.exit(0);
 }
 const snapshot=[];
 for(const source of [...new Set(plan.columns.map((entry)=>entry.table))]){
  const table=physical(source);snapshot.push({source,table,ddl:await query(`SHOW CREATE TABLE ${q(table)}`),columns:await query(`SHOW COLUMNS FROM ${q(table)}`),rows:await query(`SELECT * FROM ${q(table)}`)});
 }
 for(const entry of plan.columns){const cols=snapshot.find((row)=>row.source===entry.table).columns;if(!cols.some((col)=>col.Field===entry.from)||cols.some((col)=>col.Field===entry.to))throw new Error(`Column precheck failed ${entry.table}.${entry.from}`);}
 if(!process.argv.includes("--apply")){console.log("24 column renames checked. Dry run only.");process.exit(0);}
 await fs.writeFile(backupFile,JSON.stringify(snapshot,null,2),{flag:"wx"});
 const completed=[];
 try{
  for(const entry of plan.columns){await query(`ALTER TABLE ${q(physical(entry.table))} RENAME COLUMN ${q(entry.from)} TO ${q(entry.to)}`);completed.push(entry);}
  await createViews(snapshot,true);
  for(const before of snapshot){
   const after=await query(`SELECT * FROM ${q(before.table)}`);
   const reverse=Object.fromEntries(plan.columns.filter((entry)=>entry.table===before.source).map((entry)=>[entry.to,entry.from]));
   const canonical=(rows)=>rows.map((row)=>JSON.stringify(Object.fromEntries(Object.entries(row).map(([key,value])=>[reverse[key] || key,value]).sort(([a],[b])=>a.localeCompare(b))))).sort();
   if(JSON.stringify(canonical(before.rows))!==JSON.stringify(canonical(after)))throw new Error(`Data verification failed ${before.table}`);
  }
  console.log("24 columns migrated. Every row value verified; writable legacy views ready.");
 }catch(error){for(const entry of completed.reverse())await query(`ALTER TABLE ${q(physical(entry.table))} RENAME COLUMN ${q(entry.to)} TO ${q(entry.from)}`);await createViews(snapshot,false);throw error;}
 process.exit(0);
}catch(error){console.error(error.message);process.exit(1);}
