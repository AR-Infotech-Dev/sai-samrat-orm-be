import { query, DB_PREFIX } from "#config/database.js";
import { getUserCompanyId, isAdminRole } from "#shared/utils/role.utils.js";

const ORDER_TABLE = "orders";
const ORDER_ITEMS_TABLE = "order_items";
const PLANNING_TABLE = "order_item_planning";
const PRODUCTION_TABLE = "order_item_production";
const DISPATCH_TABLE = "dispatches";
const DISPATCH_ITEMS_TABLE = "dispatch_items";

const toNumber = (value) => Number(value || 0);
const roundQty = (value) => Math.round(toNumber(value) * 100) / 100;
const formatShort = (value) => {
  const number = toNumber(value);
  if (Math.abs(number) >= 100000) return `${roundQty(number / 100000)}L`;
  if (Math.abs(number) >= 1000) return `${roundQty(number / 1000)}k`;
  return `${roundQty(number)}`;
};

const normalizeDateValue = (value) => {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return String(value).slice(0, 10);
};

const getDateFilter = (filter = {}) => ({
  fromDate: normalizeDateValue(filter.from_date || filter.fromDate),
  toDate: normalizeDateValue(filter.to_date || filter.toDate),
});

const addCompanyScope = (where, params, user = {}, alias = "o") => {
  const companyId = getUserCompanyId(user);
  if (companyId) {
    where.push(`${alias}.company_id = ?`);
    params.push(companyId);
  }
};

const addOrderDateScope = (where, params, filter = {}, alias = "o") => {
  const { fromDate, toDate } = getDateFilter(filter);
  if (fromDate) {
    where.push(`DATE(${alias}.order_date) >= ?`);
    params.push(fromDate);
  }
  if (toDate) {
    where.push(`DATE(${alias}.order_date) <= ?`);
    params.push(toDate);
  }
};

const getOrderScope = (user = {}, filter = {}) => {
  const where = [`o.status <> 'delete'`];
  const params = [];
  addCompanyScope(where, params, user, "o");
  addOrderDateScope(where, params, filter, "o");
  return { where, params, sql: `WHERE ${where.join(" AND ")}` };
};

const tableExistsCache = new Map();
const tableExists = async (tableName) => {
  const fullName = `${DB_PREFIX}${tableName}`;
  if (tableExistsCache.has(fullName)) return tableExistsCache.get(fullName);
  const rows = await query(
    `SELECT COUNT(*) AS total FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?`,
    [fullName]
  );
  const exists = Number(rows[0]?.total || 0) > 0;
  tableExistsCache.set(fullName, exists);
  return exists;
};

const getAvailableTables = async () => ({
  planning: await tableExists(PLANNING_TABLE),
  production: await tableExists(PRODUCTION_TABLE),
  dispatch: await tableExists(DISPATCH_TABLE) && await tableExists(DISPATCH_ITEMS_TABLE),
});

const getJoinSql = ({ planning, production, dispatch }) => {
  const planningJoin = planning ? `LEFT JOIN ${DB_PREFIX}${PLANNING_TABLE} pl ON oi.order_item_id = pl.order_item_id AND pl.status <> 'delete'` : "";
  const productionJoin = production ? `LEFT JOIN ${DB_PREFIX}${PRODUCTION_TABLE} pr ON oi.order_item_id = pr.order_item_id AND pr.status <> 'delete'` : "";
  const dispatchJoin = dispatch
    ? `LEFT JOIN (
        SELECT di.order_item_id, COALESCE(SUM(di.dispatch_qty), 0) AS dispatched_qty
        FROM ${DB_PREFIX}${DISPATCH_ITEMS_TABLE} di
        INNER JOIN ${DB_PREFIX}${DISPATCH_TABLE} d ON di.dispatch_id = d.dispatch_id
        WHERE di.status <> 'delete' AND d.status <> 'delete' AND d.dispatch_status <> 'cancelled'
        GROUP BY di.order_item_id
      ) dd ON oi.order_item_id = dd.order_item_id`
    : "";

  return { planningJoin, productionJoin, dispatchJoin };
};

const getExpressions = ({ planning, production, dispatch }) => {
  const planningReady = planning ? "COALESCE(pl.ready_qty, 0)" : "0";
  const productionReady = production ? "COALESCE(pr.ready_qty, NULL)" : "NULL";
  const ready = production ? `COALESCE(${productionReady}, ${planningReady}, 0)` : planningReady;
  return {
    ready,
    dispatched: dispatch ? "COALESCE(dd.dispatched_qty, 0)" : "0",
    pmk: production && planning ? "COALESCE(pr.pmk_procure_qty, pl.pmk_qty, 0)" : production ? "COALESCE(pr.pmk_procure_qty, 0)" : planning ? "COALESCE(pl.pmk_qty, 0)" : "0",
    saipl: production && planning ? "COALESCE(pr.saipl_mfg_qty, pl.saipl_qty, 0)" : production ? "COALESCE(pr.saipl_mfg_qty, 0)" : planning ? "COALESCE(pl.saipl_qty, 0)" : "0",
  };
};

const pctDelta = (current, previous) => {
  const cur = toNumber(current);
  const prev = toNumber(previous);
  if (!prev) return cur ? "100%" : "0%";
  return `${roundQty(((cur - prev) / prev) * 100)}%`;
};

const getPreviousFilter = (filter = {}) => {
  const { fromDate, toDate } = getDateFilter(filter);
  if (!fromDate || !toDate) return null;
  const start = new Date(fromDate);
  const end = new Date(toDate);
  const days = Math.max(1, Math.round((end - start) / 86400000) + 1);
  const prevEnd = new Date(start);
  prevEnd.setDate(prevEnd.getDate() - 1);
  const prevStart = new Date(prevEnd);
  prevStart.setDate(prevStart.getDate() - days + 1);
  const toIso = (date) => date.toISOString().slice(0, 10);
  return { from_date: toIso(prevStart), to_date: toIso(prevEnd) };
};

const getTotals = async (user, filter, tables) => {
  const { where, params, sql } = getOrderScope(user, filter);
  const { planningJoin, productionJoin, dispatchJoin } = getJoinSql(tables);
  const expr = getExpressions(tables);
  const rows = await query(
    `SELECT
       COUNT(DISTINCT o.order_id) AS total_orders,
       COALESCE(SUM(oi.order_qty), 0) AS total_order_qty,
       COALESCE(SUM(oi.line_value), 0) AS total_order_value,
       COALESCE(SUM(${expr.ready}), 0) AS ready_qty,
       COALESCE(SUM(GREATEST(COALESCE(oi.order_qty, 0) - ${expr.ready}, 0)), 0) AS pending_qty,
       COALESCE(SUM(${expr.pmk}), 0) AS pmk_procure_qty,
       COALESCE(SUM(${expr.saipl}), 0) AS saipl_mfg_qty,
       COALESCE(SUM(${expr.dispatched}), 0) AS dispatched_qty
     FROM ${DB_PREFIX}${ORDER_TABLE} o
     LEFT JOIN ${DB_PREFIX}${ORDER_ITEMS_TABLE} oi ON o.order_id = oi.order_id AND oi.status <> 'delete'
     ${planningJoin}
     ${productionJoin}
     ${dispatchJoin}
     ${sql}`,
    params
  );
  return rows[0] || {};
};

const getSummary = async (user, filter, tables) => {
  const current = await getTotals(user, filter, tables);
  const previousFilter = getPreviousFilter(filter);
  const previous = previousFilter ? await getTotals(user, previousFilter, tables) : {};
  const hasPrevious = Boolean(previousFilter);

  const metric = (key, label, value, tone, previousValue = 0) => {
    const deltaRaw = hasPrevious ? pctDelta(value, previousValue) : "0%";
    const trend = String(deltaRaw).startsWith("-") ? "down" : "up";
    return { key, label, value: roundQty(value), displayValue: key === "total_orders" ? `${Math.round(toNumber(value))}` : formatShort(value), delta: deltaRaw.replace("-", ""), trend, tone };
  };

  return [
    metric("total_orders", "Total Orders", current.total_orders, "orange", previous.total_orders),
    metric("total_order_qty", "Total Order Qty", current.total_order_qty, "orange", previous.total_order_qty),
    metric("ready_qty", "Ready Qty", current.ready_qty, "green", previous.ready_qty),
    metric("pending_qty", "Pending Qty", current.pending_qty, "amber", previous.pending_qty),
    metric("pmk_procure_qty", "PMK Procure", current.pmk_procure_qty, "purple", previous.pmk_procure_qty),
    metric("saipl_mfg_qty", "SAIPL MFG", current.saipl_mfg_qty, "red", previous.saipl_mfg_qty),
  ];
};

const getPipeline = async (user, filter) => {
  const { sql, params } = getOrderScope(user, filter);
  const rows = await query(
    `SELECT LOWER(COALESCE(o.order_status, 'draft')) AS status, COUNT(*) AS total
     FROM ${DB_PREFIX}${ORDER_TABLE} o
     ${sql}
     GROUP BY LOWER(COALESCE(o.order_status, 'draft'))`,
    params
  );
  const map = rows.reduce((acc, row) => ({ ...acc, [row.status]: toNumber(row.total) }), {});
  return [
    { key: "booked", label: "Booked", value: Object.values(map).reduce((sum, value) => sum + toNumber(value), 0) },
    { key: "confirmed", label: "Confirmed", value: map.confirmed || 0 },
    { key: "planning", label: "Planning", value: map.planning || 0 },
    { key: "production", label: "Production", value: map.production || 0 },
    { key: "ready", label: "Ready", value: map.ready || 0 },
    { key: "dispatch", label: "Dispatch", value: (map.dispatch || 0) + (map.completed || 0) },
  ];
};

const getSeriesMix = async (user, filter) => {
  const { sql, params } = getOrderScope(user, filter);
  const rows = await query(
    `SELECT COALESCE(NULLIF(oi.brand_snapshot, ''), NULLIF(o.brand, ''), 'Unknown') AS label,
            COALESCE(SUM(oi.order_qty), 0) AS qty
     FROM ${DB_PREFIX}${ORDER_TABLE} o
     INNER JOIN ${DB_PREFIX}${ORDER_ITEMS_TABLE} oi ON o.order_id = oi.order_id AND oi.status <> 'delete'
     ${sql}
     GROUP BY COALESCE(NULLIF(oi.brand_snapshot, ''), NULLIF(o.brand, ''), 'Unknown')
     ORDER BY qty DESC
     LIMIT 4`,
    params
  );
  const colors = ["#fb5a13", "#ff8d4b", "#f7b84b", "#ffd9bf"];
  const total = rows.reduce((sum, row) => sum + toNumber(row.qty), 0);
  return rows.map((row, index) => ({ label: row.label, qty: roundQty(row.qty), displayQty: formatShort(row.qty), pct: total ? Math.round((toNumber(row.qty) / total) * 100) : 0, color: colors[index] }));
};

const getMonthlyOrders = async (user, filter) => {
  const where = ["o.status <> 'delete'", "o.order_date >= DATE_SUB(CURDATE(), INTERVAL 6 MONTH)"];
  const params = [];
  addCompanyScope(where, params, user, "o");
  const rows = await query(
    `SELECT DATE_FORMAT(o.order_date, '%b') AS month, DATE_FORMAT(o.order_date, '%Y-%m') AS month_key,
            COALESCE(SUM(oi.order_qty), 0) AS qty
     FROM ${DB_PREFIX}${ORDER_TABLE} o
     INNER JOIN ${DB_PREFIX}${ORDER_ITEMS_TABLE} oi ON o.order_id = oi.order_id AND oi.status <> 'delete'
     WHERE ${where.join(" AND ")}
     GROUP BY month_key, month
     ORDER BY month_key ASC`,
    params
  );
  return rows.map((row) => ({ month: row.month, qty: roundQty(row.qty), displayQty: formatShort(row.qty) }));
};

const getAlerts = async (user, filter) => {
  const { sql, params } = getOrderScope(user, filter);
  const rows = await query(
    `SELECT
       SUM(CASE WHEN LOWER(COALESCE(o.priority, '')) IN ('high','urgent') THEN 1 ELSE 0 END) AS priority_orders,
       SUM(CASE WHEN LOWER(COALESCE(o.order_status, '')) = 'hold' THEN 1 ELSE 0 END) AS hold_orders,
       SUM(CASE WHEN LOWER(COALESCE(o.order_status, '')) = 'waiting' THEN 1 ELSE 0 END) AS waiting_customer,
       SUM(CASE WHEN o.expected_delivery_date IS NOT NULL
                  AND DATE(o.expected_delivery_date) BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 3 DAY)
                  AND LOWER(COALESCE(o.order_status, '')) NOT IN ('completed','cancelled') THEN 1 ELSE 0 END) AS dispatch_due
     FROM ${DB_PREFIX}${ORDER_TABLE} o
     ${sql}`,
    params
  );
  const data = rows[0] || {};
  return [
    { key: "high_priority", label: "High Priority", value: toNumber(data.priority_orders), note: "Needs immediate action", tone: "red" },
    { key: "hold_orders", label: "Hold Orders", value: toNumber(data.hold_orders), note: "On hold by customer", tone: "orange" },
    { key: "waiting_customer", label: "Waiting Customer", value: toNumber(data.waiting_customer), note: "Awaiting confirmation", tone: "amber" },
    { key: "dispatch_due", label: "Dispatch Due", value: toNumber(data.dispatch_due), note: "Due within 3 days", tone: "red" },
  ];
};

const getRecentOrders = async (user, filter, tables) => {
  const { sql, params } = getOrderScope(user, filter);
  const { planningJoin, productionJoin } = getJoinSql({ ...tables, dispatch: false });
  const expr = getExpressions({ ...tables, dispatch: false });
  const rows = await query(
    `SELECT o.order_id, o.order_no, COALESCE(c.name, '-') AS customer_name, COALESCE(NULLIF(o.brand, ''), '-') AS series,
            o.order_status, o.expected_delivery_date,
            COALESCE(SUM(oi.order_qty), 0) AS order_qty,
            COALESCE(SUM(${expr.ready}), 0) AS ready_qty,
            COALESCE(SUM(GREATEST(COALESCE(oi.order_qty, 0) - ${expr.ready}, 0)), 0) AS pending_qty
     FROM ${DB_PREFIX}${ORDER_TABLE} o
     LEFT JOIN ${DB_PREFIX}customer c ON o.customer_id = c.customer_id
     LEFT JOIN ${DB_PREFIX}${ORDER_ITEMS_TABLE} oi ON o.order_id = oi.order_id AND oi.status <> 'delete'
     ${planningJoin}
     ${productionJoin}
     ${sql}
     GROUP BY o.order_id, o.order_no, c.name, o.brand, o.order_status, o.expected_delivery_date
     ORDER BY COALESCE(o.modified_date, o.created_date) DESC, o.order_id DESC
     LIMIT 5`,
    params
  );
  return rows.map((row) => ({
    order_id: row.order_id,
    order_no: row.order_no,
    customer: row.customer_name,
    series: row.series,
    orderQty: roundQty(row.order_qty),
    ready: roundQty(row.ready_qty),
    pending: roundQty(row.pending_qty),
    status: row.order_status,
    expectedDate: row.expected_delivery_date,
  }));
};

const getTopProducts = async (user, filter) => {
  const { sql, params } = getOrderScope(user, filter);
  const rows = await query(
    `SELECT COALESCE(NULLIF(oi.product_name_snapshot, ''), p.product_name, 'Unknown') AS product_name,
            COALESCE(SUM(oi.order_qty), 0) AS qty
     FROM ${DB_PREFIX}${ORDER_TABLE} o
     INNER JOIN ${DB_PREFIX}${ORDER_ITEMS_TABLE} oi ON o.order_id = oi.order_id AND oi.status <> 'delete'
     LEFT JOIN ${DB_PREFIX}products p ON oi.product_id = p.product_id
     ${sql}
     GROUP BY COALESCE(NULLIF(oi.product_name_snapshot, ''), p.product_name, 'Unknown')
     ORDER BY qty DESC
     LIMIT 4`,
    params
  );
  const max = Math.max(...rows.map((row) => toNumber(row.qty)), 0);
  return rows.map((row, index) => ({ rank: index + 1, name: row.product_name, qty: roundQty(row.qty), displayQty: formatShort(row.qty), pct: max ? Math.round((toNumber(row.qty) / max) * 100) : 0 }));
};

export const getDashboardOverview = async (user = {}, filter = {}) => {
  const tables = await getAvailableTables();
  const [summary, pipeline, seriesMix, monthlyOrders, alerts, recentOrders, topProducts] = await Promise.all([
    getSummary(user, filter, tables),
    getPipeline(user, filter),
    getSeriesMix(user, filter),
    getMonthlyOrders(user, filter),
    getAlerts(user, filter),
    getRecentOrders(user, filter, tables),
    getTopProducts(user, filter),
  ]);

  return {
    role: user?.role_slug || "user",
    scope: isAdminRole(user?.role_slug) ? "admin" : "user",
    dashboardType: "order_management",
    summary,
    pipeline,
    seriesMix,
    monthlyOrders,
    alerts,
    recentOrders,
    topProducts,
    meta: {
      usesDispatchTables: tables.dispatch,
      generatedAt: new Date().toISOString(),
    },
  };
};
