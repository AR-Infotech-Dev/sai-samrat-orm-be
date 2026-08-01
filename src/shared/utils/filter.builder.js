const getDateRangeValues = (value) => {
    if (value && typeof value === "object") {
        return {
            fromDate: value.from_date || value.fromDate || "",
            toDate: value.to_date || value.toDate || "",
        };
    }

    const [fromDate = "", toDate = ""] = String(value || "").split("/");
    return { fromDate, toDate };
};

export const prepareFilterData = ({ filters = [], searchText = "", other = { orderBy: 'created_by', order: 'ASC', searchColumns: [] }, default_columns = {}, custom_columns = {}, isDefault = "no" } = {}) => {

    const where = [];
    const values = [];
    const join = [];
    const today = new Date().toISOString().slice(0, 10);
    let select = "t.*";

    // =====================================
    // DEFAULT COLUMNS AUTO JOIN
    // =====================================
    Object.entries(default_columns).forEach(([columnName, columnData]) => {
        join.push({
            type: "LEFT JOIN",
            table: columnData.table,
            alias: columnData.alias,
            key1: columnName,
            key2: columnData.key2,
            column: columnData.column
        });

        if (isDefault === "no") {
            select += `, ${columnData.alias}.${columnData.column} as ${columnName}`;

            if (columnData.select) {
                select += `, ${columnData.select}`;
            }
        }
    });

    // =====================================
    // CUSTOM COLUMNS AUTO JOIN
    // =====================================
    Object.entries(custom_columns).forEach(([columnName, columnData]) => {
        join.push({
            type: "LEFT JOIN",
            table: columnData.table,
            alias: columnData.alias,
            key1: columnName,
            key2: columnData.key2,
            column: columnData.column
        });

        if (isDefault === "no") {
            select += `, ${columnData.alias}.${columnData.column} as ${columnName}`;

            if (columnData.select) {
                select += `, ${columnData.select}`;
            }
        }
    });

    select = select.replace(/^,/, "");

    // ===============================
    // FILTER CONDITIONS
    // ===============================
    filters.forEach(({ field, condition, value, type }) => {
        const allColumns = { ...default_columns, ...custom_columns };
        const isJoinedOptionFilter =
            allColumns[field] &&
            ["select", "enum"].includes(String(type || "").toLowerCase()) &&
            value !== "" &&
            value !== null &&
            value !== undefined &&
            !Number.isNaN(Number(value));

        const column = isJoinedOptionFilter
            ? `t.${field}`
            : allColumns[field]
            ? `${allColumns[field].alias}.${allColumns[field].column}`
            : `t.${field}`;


        switch (condition) {
            case "equal_to":
                where.push(`${column} = ?`);
                values.push(value);
                break;

            case "not_equal_to":
                where.push(`${column} != ?`);
                values.push(value);
                break;

            case "is_empty":
                where.push(`(${column} IS NULL OR ${column} = '')`);
                break;

            case "is_not_empty":
                where.push(`(${column} IS NOT NULL AND ${column} != '')`);
                break;

            case "greater_than":
                where.push(`${column} > ?`);
                values.push(value);
                break;

            case "less_than":
                where.push(`${column} < ?`);
                values.push(value);
                break;

            case "start_with":
                where.push(`${column} LIKE ?`);
                values.push(`${value}%`);
                break;

            case "end_with":
                where.push(`${column} LIKE ?`);
                values.push(`%${value}`);
                break;

            case "contains":
            case "is_in":
                where.push(`${column} LIKE ?`);
                values.push(`%${value}%`);
                break;

            case "range":
                const range = String(value).split("-");
                if (range.length === 2) {
                    where.push(`${column} BETWEEN ? AND ?`);
                    values.push(range[0], range[1]);
                }
                break;

            case "date_range":
                const { fromDate, toDate } = getDateRangeValues(value);
                if (fromDate && toDate) {
                    where.push(`DATE(${column}) BETWEEN ? AND ?`);
                    values.push(fromDate, toDate);
                }
                break;

            case "exact_date":
                if (value) {
                    where.push(`(${column} >= ? AND ${column} < DATE_ADD(?, INTERVAL 1 DAY))`);
                    values.push(value, value);
                }
                break;

            case "today":
                where.push(`DATE(${column}) = ?`);
                values.push(today);
                break;

            case "yesterday":
                const y = new Date();
                y.setDate(y.getDate() - 1);
                where.push(`DATE(${column}) = ?`);
                values.push(y.toISOString().slice(0, 10));
                break;

            case "tomorrow":
                const t = new Date();
                t.setDate(t.getDate() + 1);
                where.push(`DATE(${column}) = ?`);
                values.push(t.toISOString().slice(0, 10));
                break;

            case "this_month":
                where.push(`MONTH(${column}) = MONTH(CURDATE())`);
                where.push(`YEAR(${column}) = YEAR(CURDATE())`);
                break;

            case "this_week":
                where.push(`YEARWEEK(${column},1) = YEARWEEK(CURDATE(),1)`);
                break;

            default:
                break;
        }
    });

    // // ===============================
    // // FREE TEXT SEARCH
    // // ===============================
    if (searchText) {
        const searchCols = other.searchColumns || [];

        if (searchCols.length) {
            const conditions = searchCols.map((col) => `${col} LIKE ?`);
            where.push(`(${conditions.join(" OR ")})`);
            searchCols.forEach(() => {
                values.push(`%${searchText}%`);
            });
        }
    }

    return {
        select,
        where,
        values,
        join,
        other: {
            orderBy: `t.${other.orderBy}`,
            order: `${other.order}`,
        },
    };
};
