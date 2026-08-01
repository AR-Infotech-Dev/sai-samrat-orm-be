import mysql from "mysql2/promise";
import { env } from "./env.js";

let pool;

export function getDbPool() {
  if (!pool) {
    pool = mysql.createPool({
      host: env.dbHost,
      port: env.dbPort,
      user: env.dbUser,
      password: env.dbPassword,
      database: env.dbName,
      waitForConnections: true,
      connectionLimit: 10,
      namedPlaceholders: true,
      timezone: '+05:30',
      dateStrings: true
    });
  }

  return pool;
}

export async function query(sql, params = []) {
  const [rows] = await getDbPool().execute(sql, params);
  return rows;
}

export const DB_PREFIX = env.dbPrefix;