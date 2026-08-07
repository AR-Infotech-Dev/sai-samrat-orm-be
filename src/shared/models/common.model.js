import { query, DB_PREFIX } from "#config/database.js";

// =====================================
// LAST INSERT ID
// =====================================
const printSql = (sql, params) => {
    let fullSql = sql;
    params.forEach(param => {
        const formattedParam = typeof param === 'string' ? `'${param.replace(/'/g, "''")}'` : param;
        fullSql = fullSql.replace('?', formattedParam);
    });
    console.log('{');
    console.log('Sql :', fullSql);
    console.log('}');
}
export const getLastInsertedID = (result) => {
    return result?.insertId || 0;
};
export const getNextID = async (table = "", primary_key = "") => {
    let sql = `SELECT IFNULL(MAX(${primary_key}), 0) + 1 AS next_id FROM ${DB_PREFIX}${table};`;
    const result = await query(sql);
    return result[0].next_id;
};

const isDateLikeColumn = (key = "") => {
    const normalizedKey = String(key).toLowerCase();
    return (
        normalizedKey === "date" ||
        normalizedKey.endsWith("date") ||
        normalizedKey.endsWith("_at") ||
        normalizedKey.endsWith("_time")
    );
};

const normalizeWriteData = (data = {}) =>
    Object.entries(data).reduce((accumulator, [key, value]) => {
        accumulator[key] = value === "" && isDateLikeColumn(key) ? null : value;
        return accumulator;
    }, {});

// =====================================
// GET MASTER DETAILS
// =====================================
export const getMasterDetails = async (table = "", select = "*", where = {}) => {
    let sql = ` SELECT ${select} FROM ${DB_PREFIX}${table}`;

    const values = [];
    const conditions = [];

    Object.entries(where).forEach(([key, value]) => {
        conditions.push(`${key} = ?`);
        values.push(value);
    });

    if (conditions.length) {
        sql += ` WHERE ${conditions.join(" AND ")}`;
    }

    return await query(sql, values);
};
export const getSpecificDetails = async (table = "", select = "*", where = {}) => {
    let sql = ` SELECT ${select} FROM ${DB_PREFIX}${table}`;

    const values = [];
    const conditions = [];

    Object.entries(where).forEach(([key, value]) => {
        conditions.push(`${key} = ?`);
        values.push(value);
    });

    if (conditions.length) {
        sql += ` WHERE ${conditions.join(" AND ")}`;
    }

    const result = await query(sql, values);
    return result ? result[0] : null;
};

// =====================================
// GET COUNTS BY PARAMETER
// =====================================
export const getCountsByParameter = async ({ table = "", where = [], values = [], join = [], other = {} } = {}) => {

    let sql = `SELECT COUNT(*) AS total FROM ${DB_PREFIX}${table} t`;

    const params = [...values];

    // JOIN
    if (join.length) {
        join.forEach(({ type = "LEFT", table, alias, key1, key2, key1Alias = "t" }) => {
            sql += ` ${type} ${DB_PREFIX}${table} ${alias} ON ${key1Alias}.${key1} = ${alias}.${key2} `;
        });
    }

    // WHERE
    const whereParts = [];

    if (where.length) {
        whereParts.push(...where);
    }

    // WHERE IN
    if (other.whereIn && other.whereData?.length) {
        const placeholders = other.whereData.map(() => "?").join(",");
        whereParts.push(`${other.whereIn} IN (${placeholders})`);
        params.push(...other.whereData);
    }

    // FREE TEXT SEARCH
    if (other.freeTextSearch && other.searchColumns?.length) {
        const searchParts = other.searchColumns.map((col) => `${col} LIKE ?`);
        whereParts.push(`(${searchParts.join(" OR ")})`);

        other.searchColumns.forEach(() => {
            params.push(`%${other.freeTextSearch}%`);
        });
    }

    if (whereParts.length) {
        sql += ` WHERE ${whereParts.join(" AND ")}`;
    }

    const rows = await query(sql, params);
    return rows[0]?.total || 0;
};
export const GetMasterListDetails = async ({ select = "*", table = "", where = [], values = [], limit = "", start = "", join = [], other = {} } = {}) => {
    let sql = `SELECT ${select} FROM ${DB_PREFIX}${table} t`;
    const params = [...values];
    // JOIN
    if (join.length) {
        join.forEach(({ type = "LEFT", table, alias, key1, key2, key1Alias = "t" }) => {
            sql += ` ${type} ${DB_PREFIX}${table} ${alias} ON ${key1Alias}.${key1} = ${alias}.${key2} `;
        });
    }
    // WHERE
    const whereParts = [];
    if (where.length) {
        whereParts.push(...where);
    }
    // WHERE IN
    if (other.whereIn && other.whereData?.length) {
        const placeholders = other.whereData.map(() => "?").join(",");
        whereParts.push(`${other.whereIn} IN (${placeholders})`);
        params.push(...other.whereData);
    }
    // FREE TEXT SEARCH
    if (other.freeTextSearch && other.searchColumns?.length) {
        const searchParts = other.searchColumns.map((col) => `${col} LIKE ?`);
        whereParts.push(`(${searchParts.join(" OR ")})`);
        other.searchColumns.forEach(() => {
            params.push(`%${other.freeTextSearch}%`);
        });
    }
    if (whereParts.length) {
        sql += ` WHERE ${whereParts.join(" AND ")}`;
    }
    // GROUP BY
    if (other.groupBy) {
        sql += ` GROUP BY ${other.groupBy}`;
    }
    // ORDER BY
    if (other.orderBy) {
        sql += ` ORDER BY ${other.orderBy} ${other.order || "ASC"}`;
    }

    // LIMIT
    if (limit !== "") {
        const safeLimit = Number(limit) || 10;
        const safeStart = Number(start) || 0;
        sql += ` LIMIT ${safeLimit} OFFSET ${safeStart}`;
    }
    printSql(sql, params)
    const rows = await query(sql, params);
    return rows;
};

// =====================================
// FILTERED COUNT
// =====================================
export const getFilteredCount = async ({ table = "", where = {}, join = [], other = {} } = {}) => {
    const rows = await GetMasterListDetails({
        select: "COUNT(*) as total",
        table,
        where,
        join,
        other,
    });

    return rows[0]?.total || 0;
};

// =====================================
// INSERT
// =====================================
export const saveMasterDetails = async ({ table = "", data = {} } = {}) => {
    console.log({ table, data });

    const normalizedData = normalizeWriteData(data);
    const columns = Object.keys(normalizedData);
    const values = Object.values(normalizedData);

    const placeholders = columns.map(() => "?").join(",");

    const sql = `
    INSERT INTO ${DB_PREFIX}${table}
    (${columns.join(",")})
    VALUES (${placeholders})
  `;

    const result = await query(sql, values);
    return result;
};

// =====================================
// UPDATE
// =====================================
export const updateMasterDetails = async ({ table = "", data = {}, where = {} } = {}) => {
    const normalizedData = normalizeWriteData(data);
    const setParts = [];
    const values = [];

    Object.keys(normalizedData).forEach((key) => {
        setParts.push(`${key} = ?`);
        values.push(normalizedData[key]);
    });

    const whereParts = [];

    Object.keys(where).forEach((key) => {
        whereParts.push(`${key} = ?`);
        values.push(where[key]);
    });

    const sql = `UPDATE ${DB_PREFIX}${table} SET ${setParts.join(", ")} WHERE ${whereParts.join(" AND ")}`;

    const result = await query(sql, values);
    return result;
};

// =====================================
// DELETE
// =====================================
export const deleteMasterDetails = async ({ table = "", where = {} } = {}) => {
    const whereParts = [];
    const values = [];

    Object.keys(where).forEach((key) => {
        const val = where[key];

        if (Array.isArray(val)) {
            const placeholders = val.map(() => "?").join(",");
            whereParts.push(`${key} IN (${placeholders})`);
            values.push(...val);
        } else {
            whereParts.push(`${key} = ?`);
            values.push(val);
        }
    });

    const sql = `DELETE FROM ${DB_PREFIX}${table} WHERE ${whereParts.join(" AND ")}`;

    const result = await query(sql, values);
    return result;
};

// =====================================
// CHANGE STATUS
// =====================================
export const changeMasterStatus = async ({ table = "", status = "Y", ids = [], key = "adminID" } = {}) => {
    const placeholders = ids.map(() => "?").join(",");

    const sql = `
    UPDATE ${DB_PREFIX}${table}
    SET status = ?
    WHERE ${key} IN (${placeholders})
  `;

    const [result] = await query(sql, [status, ...ids]);
    return result;
};

export const updateMenuPositions = async ({ table = "", positions = [] }) => {
    const cases = positions.map(item => `WHEN ${item.menu_id} THEN ${item.menu_index}`).join(" ");
    const ids = positions.map(item => item.menu_id).join(",");
    const sql = `UPDATE ${DB_PREFIX}${table}
        SET menu_index = CASE menu_id
            ${cases}
        END
        WHERE menu_id IN (${ids})
    `;
    const result = await query(sql);
    return result;
}
