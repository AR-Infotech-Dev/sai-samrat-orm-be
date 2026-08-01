import { query, DB_PREFIX } from "#config/database.js";

const tableColumnsCache = new Map();

export const getTableColumns = async (table = "") => {
  if (!table) {
    return [];
  }

  if (tableColumnsCache.has(table)) {
    return tableColumnsCache.get(table);
  }

  const rows = await query(`SHOW COLUMNS FROM ${DB_PREFIX}${table}`);
  const columns = rows.map((row) => row.Field);
  tableColumnsCache.set(table, columns);
  return columns;
};

export const buildTablePayload = async (table = "", source = {}) => {
  const allowedColumns = await getTableColumns(table);
  const data = {};
  
  for (const column of allowedColumns) {
    if (Object.prototype.hasOwnProperty.call(source, column) && source[column] !== undefined) {
      data[column] = source[column];
    }
  }

  return data;
};

export const pickValue = (value) => {
    if (value === undefined) {
        return null;
    }
    return value;
};
