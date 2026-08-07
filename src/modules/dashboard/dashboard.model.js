import * as CommonModel from "#shared/models/common.model.js";
import { query, DB_PREFIX } from "#config/database.js";
import { canViewAllByRole, getUserCompanyId, isAdminRole } from "#shared/utils/role.utils.js";

const ORDER_TABLE = "orders";
const ORDER_ITEMS_TABLE = "order_items";
const PLANNING_TABLE = "order_item_planning";
const PRODUCTION_TABLE = "order_item_production";
const DISPATCH_TABLE = "dispatches";
const DISPATCH_ITEMS_TABLE = "dispatch_items";

const toNumber = (value) => Number(value || 0);
const roundQty = (value) => Math.round(toNumber(value) * 100) / 100;
const safeQuery = (sql, params = []) => query(sql, params.map((value) => (value === undefined ? null : value)));

const unwrapFilterValue = (value, keys = []) => {
  if (value === undefined || value === null) return null;
  if (typeof value !== "object") return value;
  for (const key of keys) {
    if (value[key] !== undefined && value[key] !== null && String(value[key]).trim() !== "") return value[key];
  }
  if (value.value !== undefined && value.value !== null && String(value.value).trim() !== "") return value.value;
  if (value.id !== undefined && value.id !== null && String(value.id).trim() !== "") return value.id;
  return null;
};

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

const getFilterValue = (filter = {}, ...keys) => {
  for (const key of keys) {
    const value = unwrapFilterValue(filter[key], keys);
    if (value !== undefined && value !== null && String(value).trim() !== "") return value;
  }
  return null;
};


const addCompanyScope = (where, params, user = {}, alias = "o") => {
  return;
  if (canViewAllByRole(user)) return;
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

const addDashboardFilterScope = (where, params, filter = {}, alias = "o") => {
  const orderId = getFilterValue(filter, "order_id", "orderId");
  const customerId = getFilterValue(filter, "customer_id", "customerId");
  const productId = getFilterValue(filter, "product_id", "productId");
  const orderStatus = getFilterValue(filter, "order_status", "status");
  const stage = getFilterValue(filter, "stage");
  const normalizedStage = String(stage || "").toLowerCase();
  const normalizedOrderStatus = String(orderStatus || "").toLowerCase();
  const statusFromStage = ["draft", "waiting", "confirmed", "planning", "planned", "production", "ready", "dispatch", "completed", "hold", "cancelled"].includes(normalizedStage)
    ? normalizedStage
    : "";

  if (orderId) {
    where.push(`${alias}.order_id = ?`);
    params.push(orderId);
  }
  if (customerId) {
    where.push(`${alias}.customer_id = ?`);
    params.push(customerId);
  }
  if (normalizedOrderStatus && normalizedOrderStatus !== "all") {
    where.push(`LOWER(COALESCE(${alias}.order_status, '')) = ?`);
    params.push(normalizedOrderStatus);
  } else if (statusFromStage) {
    where.push(`LOWER(COALESCE(${alias}.order_status, '')) = ?`);
    params.push(statusFromStage);
  }
  if (normalizedStage === "overdue") {
    where.push(`${alias}.expected_delivery_date IS NOT NULL`);
    where.push(`DATE(${alias}.expected_delivery_date) < CURDATE()`);
    where.push(`LOWER(COALESCE(${alias}.order_status, '')) NOT IN ('completed','cancelled')`);
  }
  if (productId) {
    where.push(`EXISTS (SELECT 1 FROM ${DB_PREFIX}${ORDER_ITEMS_TABLE} f_oi WHERE f_oi.order_id = ${alias}.order_id AND f_oi.status <> 'delete' AND f_oi.product_id = ?)`);
    params.push(productId);
  }
};


const getOrderScope = (user = {}, filter = {}) => {
  const where = ["o.status <> 'delete'"];
  const params = [];
  addCompanyScope(where, params, user, "o");
  addOrderDateScope(where, params, filter, "o");
  addDashboardFilterScope(where, params, filter, "o");
  return { where, params, sql: `WHERE ${where.join(" AND ")}` };
};

const getCommonOrderScope = (user = {}, filter = {}) => {
  const where = ["t.status <> 'delete'"];
  const values = [];
  addCompanyScope(where, values, user, "t");
  addOrderDateScope(where, values, filter, "t");
  addDashboardFilterScope(where, values, filter, "t");
  return { where, values };
};

const tableExistsCache = new Map();
const tableExists = async (tableName) => {
  const fullName = `${DB_PREFIX}${tableName}`;
  if (tableExistsCache.has(fullName)) return tableExistsCache.get(fullName);

  const rows = await safeQuery(
    "SELECT COUNT(*) AS total FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?",
    [fullName]
  );
  const exists = Number(rows[0]?.total || 0) > 0;
  tableExistsCache.set(fullName, exists);
  return exists;
};

const getAvailableTables = async () => ({
  planning: await tableExists(PLANNING_TABLE),
  production: await tableExists(PRODUCTION_TABLE),
  dispatch: (await tableExists(DISPATCH_TABLE)) && (await tableExists(DISPATCH_ITEMS_TABLE)),
});

const getJoinSql = ({ planning, production, dispatch }) => ({
  planningJoin: planning ? `LEFT JOIN ${DB_PREFIX}${PLANNING_TABLE} pl ON oi.order_item_id = pl.order_item_id AND pl.status <> 'delete'` : "",
  productionJoin: production ? `LEFT JOIN ${DB_PREFIX}${PRODUCTION_TABLE} pr ON oi.order_item_id = pr.order_item_id AND pr.status <> 'delete'` : "",
  dispatchJoin: dispatch
    ? `LEFT JOIN (
        SELECT di.order_item_id, COALESCE(SUM(di.dispatch_qty), 0) AS dispatched_qty
        FROM ${DB_PREFIX}${DISPATCH_ITEMS_TABLE} di
        INNER JOIN ${DB_PREFIX}${DISPATCH_TABLE} d ON di.dispatch_id = d.dispatch_id
        WHERE di.status <> 'delete' AND d.status <> 'delete' AND d.dispatch_status <> 'cancelled'
        GROUP BY di.order_item_id
      ) dd ON oi.order_item_id = dd.order_item_id`
    : "",
});

const getExpressions = ({ planning, production, dispatch }) => {
  const planningReady = planning ? "COALESCE(pl.ready_qty, 0)" : "0";
  const productionReady = production ? "COALESCE(pr.ready_qty, NULL)" : "NULL";
  const ready = production ? `COALESCE(${productionReady}, ${planningReady}, 0)` : planningReady;

  return {
    ready,
    dispatched: dispatch ? "COALESCE(dd.dispatched_qty, 0)" : "0",
    produced: production ? "COALESCE(pr.produced_qty, 0)" : "0",
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
  const { params, sql } = getOrderScope(user, filter);
  const { planningJoin, productionJoin, dispatchJoin } = getJoinSql(tables);
  const expr = getExpressions(tables);

  const rows = await safeQuery(
    `SELECT
       COUNT(DISTINCT o.order_id) AS total_orders,
       COALESCE(SUM(oi.order_qty), 0) AS total_order_qty,
       COALESCE(SUM(oi.line_value), 0) AS total_order_value,
       COALESCE(SUM(${expr.ready}), 0) AS ready_qty,
       COALESCE(SUM(${expr.dispatched}), 0) AS dispatched_qty,
       COALESCE(SUM(GREATEST(${expr.ready} - ${expr.dispatched}, 0)), 0) AS ready_pending_dispatch_qty,
       COALESCE(SUM(GREATEST(COALESCE(oi.order_qty, 0) - ${expr.ready}, 0)), 0) AS pending_qty,
       COALESCE(SUM(${expr.pmk}), 0) AS pmk_procure_qty,
       COALESCE(SUM(${expr.saipl}), 0) AS saipl_mfg_qty
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
    return {
      key,
      label,
      value: roundQty(value),
      displayValue: key === "total_orders" ? `${Math.round(toNumber(value))}` : formatShort(value),
      delta: deltaRaw.replace("-", ""),
      trend: String(deltaRaw).startsWith("-") ? "down" : "up",
      tone,
    };
  };

  return [
    metric("total_orders", "Total Orders", current.total_orders, "orange", previous.total_orders),
    metric("ready_qty", "Ready Qty", current.ready_qty, "green", previous.ready_qty),
    metric("dispatched_qty", "Dispatched Qty", current.dispatched_qty, "red", previous.dispatched_qty),
    metric("pmk_procure_qty", "PMK Procure", current.pmk_procure_qty, "purple", previous.pmk_procure_qty),

    metric("total_order_qty", "Total Order Qty", current.total_order_qty, "orange", previous.total_order_qty),
    metric("pending_qty", "Pending Qty", current.pending_qty, "amber", previous.pending_qty),
    metric("ready_pending_dispatch_qty", "Ready Pending Dispatch", current.ready_pending_dispatch_qty, "amber", previous.ready_pending_dispatch_qty),
    metric("saipl_mfg_qty", "SAIPL MFG", current.saipl_mfg_qty, "red", previous.saipl_mfg_qty),
    
  ];
};

const getPipeline = async (user, filter, tables) => {
  const { params, sql } = getOrderScope(user, filter);
  const { planningJoin, productionJoin, dispatchJoin } = getJoinSql(tables);
  const expr = getExpressions(tables);

  const rows = await safeQuery(
    `SELECT LOWER(COALESCE(o.order_status, 'draft')) AS status_name,
            COUNT(DISTINCT o.order_id) AS order_count,
            COALESCE(SUM(oi.order_qty), 0) AS order_qty,
            COALESCE(SUM(${expr.produced}), 0) AS produced_qty,
            COALESCE(SUM(${expr.ready}), 0) AS ready_qty,
            COALESCE(SUM(${expr.dispatched}), 0) AS dispatched_qty
     FROM ${DB_PREFIX}${ORDER_TABLE} o
     LEFT JOIN ${DB_PREFIX}${ORDER_ITEMS_TABLE} oi ON o.order_id = oi.order_id AND oi.status <> 'delete'
     ${planningJoin}
     ${productionJoin}
     ${dispatchJoin}
     ${sql}
     GROUP BY LOWER(COALESCE(o.order_status, 'draft'))`,
    params
  );

  const map = rows.reduce((acc, row) => ({ ...acc, [row.status_name]: row }), {});
  const totalOrders = rows.reduce((sum, row) => sum + toNumber(row.order_count), 0);
  const totalOrderQty = rows.reduce((sum, row) => sum + toNumber(row.order_qty), 0);
  const totalReadyQty = rows.reduce((sum, row) => sum + toNumber(row.ready_qty), 0);
  const totalDispatchedQty = rows.reduce((sum, row) => sum + toNumber(row.dispatched_qty), 0);
  const productionQty = rows.reduce((sum, row) => sum + (row.status_name === "production" ? toNumber(row.produced_qty) : 0), 0);
  const readyOrders = rows.reduce((sum, row) => sum + (toNumber(row.ready_qty) > 0 ? toNumber(row.order_count) : 0), 0);
  const dispatchedOrders = rows.reduce((sum, row) => sum + (toNumber(row.dispatched_qty) > 0 ? toNumber(row.order_count) : 0), 0);
  const statusQty = (...statuses) => statuses.reduce((sum, status) => sum + toNumber(map[status]?.order_qty), 0);
  const statusOrders = (...statuses) => statuses.reduce((sum, status) => sum + toNumber(map[status]?.order_count), 0);

  const step = (key, label, value, orderCount) => ({
    key,
    label,
    value: roundQty(value),
    displayValue: formatShort(value),
    orderCount: Math.round(toNumber(orderCount)),
    subLabel: `${Math.round(toNumber(orderCount)).toLocaleString("en-IN")} Orders`,
  });

  return [
    step("booked", "Booked", totalOrderQty, totalOrders),
    step("confirmed", "Confirmed", statusQty("confirmed"), statusOrders("confirmed")),
    step("planning", "Planning", statusQty("planning", "planned"), statusOrders("planning", "planned")),
    step("production", "Production", productionQty, statusOrders("production")),
    step("ready", "Ready", totalReadyQty, readyOrders),
    step("dispatch", "Dispatch", totalDispatchedQty, dispatchedOrders),
  ];
};

const getSeriesMix = async (user, filter) => {
  const { params, sql } = getOrderScope(user, filter);
  const rows = await safeQuery(
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
  return rows.map((row, index) => ({
    label: row.label,
    qty: roundQty(row.qty),
    displayQty: formatShort(row.qty),
    pct: total ? Math.round((toNumber(row.qty) / total) * 100) : 0,
    color: colors[index],
  }));
};

const getMonthlyOrders = async (user, filter = {}) => {
  const { fromDate, toDate } = getDateFilter(filter);
  const where = ["o.status <> 'delete'"];
  const params = [];
  addCompanyScope(where, params, user, "o");
  addDashboardFilterScope(where, params, filter, "o");
  if (fromDate || toDate) {
    addOrderDateScope(where, params, filter, "o");
  } else {
    where.push("o.order_date >= DATE_SUB(CURDATE(), INTERVAL 6 MONTH)");
  }

  const rows = await safeQuery(
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
  const { where, values } = getCommonOrderScope(user, filter);
  const rows = await CommonModel.GetMasterListDetails({
    select: `
      SUM(CASE WHEN LOWER(COALESCE(t.priority, '')) IN ('high','urgent') THEN 1 ELSE 0 END) AS priority_orders,
      SUM(CASE WHEN LOWER(COALESCE(t.order_status, '')) = 'hold' THEN 1 ELSE 0 END) AS hold_orders,
      SUM(CASE WHEN LOWER(COALESCE(t.order_status, '')) = 'waiting' THEN 1 ELSE 0 END) AS waiting_customer,
      SUM(CASE WHEN t.expected_delivery_date IS NOT NULL
                AND DATE(t.expected_delivery_date) BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 3 DAY)
                AND LOWER(COALESCE(t.order_status, '')) NOT IN ('completed','cancelled') THEN 1 ELSE 0 END) AS dispatch_due`,
    table: ORDER_TABLE,
    where,
    values,
  });

  const data = rows[0] || {};
  return [
    { key: "high_priority", label: "High Priority", value: toNumber(data.priority_orders), note: "Needs immediate action", tone: "red" },
    { key: "hold_orders", label: "Hold Orders", value: toNumber(data.hold_orders), note: "On hold by customer", tone: "orange" },
    { key: "waiting_customer", label: "Waiting Customer", value: toNumber(data.waiting_customer), note: "Awaiting confirmation", tone: "amber" },
    { key: "dispatch_due", label: "Dispatch Due", value: toNumber(data.dispatch_due), note: "Due within 3 days", tone: "red" },
  ];
};

const getRecentOrders = async (user, filter, tables) => {
  const { params, sql } = getOrderScope(user, filter);
  const { planningJoin, productionJoin } = getJoinSql({ ...tables, dispatch: false });
  const expr = getExpressions({ ...tables, dispatch: false });

  const rows = await safeQuery(
    `SELECT o.order_id, o.order_no, COALESCE(c.name, '-') AS customer_name,
            COALESCE(NULLIF(o.brand, ''), '-') AS series,
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
  const { params, sql } = getOrderScope(user, filter);
  const rows = await safeQuery(
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
  return rows.map((row, index) => ({
    rank: index + 1,
    name: row.product_name,
    qty: roundQty(row.qty),
    displayQty: formatShort(row.qty),
    pct: max ? Math.round((toNumber(row.qty) / max) * 100) : 0,
  }));
};


const getStatusCounts = async (user, filter) => {
  const { params, sql } = getOrderScope(user, filter);
  const rows = await safeQuery(
    `SELECT LOWER(COALESCE(o.order_status, 'draft')) AS status_name,
            COUNT(DISTINCT o.order_id) AS order_count,
            COALESCE(SUM(oi.order_qty), 0) AS order_qty
     FROM ${DB_PREFIX}${ORDER_TABLE} o
     LEFT JOIN ${DB_PREFIX}${ORDER_ITEMS_TABLE} oi ON o.order_id = oi.order_id AND oi.status <> 'delete'
     ${sql}
     GROUP BY LOWER(COALESCE(o.order_status, 'draft'))`,
    params
  );
  return rows.reduce((acc, row) => ({ ...acc, [row.status_name]: row }), {});
};

const getActionKpis = async (user, filter, tables) => {
  const totals = await getTotals(user, filter, tables);
  const statusMap = await getStatusCounts(user, filter);
  const val = (status, key = "order_count") => toNumber(statusMap[status]?.[key]);
  return [
    { key: "waiting_confirmation", label: "Waiting Confirmation", value: val("waiting"), subValue: `${formatShort(val("waiting", "order_qty"))} Qty`, tone: "amber" },
    { key: "planning_pending", label: "Planning Pending", value: val("confirmed") + val("planning"), subValue: `${formatShort(val("confirmed", "order_qty") + val("planning", "order_qty"))} Qty`, tone: "blue" },
    { key: "production_pending", label: "Production Pending", value: val("planned") + val("production"), subValue: `${formatShort(toNumber(totals.pending_qty))} Pending Qty`, tone: "purple" },
    { key: "ready_pending_dispatch", label: "Ready Pending Dispatch", value: roundQty(totals.ready_pending_dispatch_qty), subValue: "Qty ready, not dispatched", tone: "green" },
    { key: "pmk_pending", label: "PMK Pending", value: roundQty(Math.max(toNumber(totals.pmk_procure_qty) - toNumber(totals.dispatched_qty), 0)), subValue: "Approx pending", tone: "cyan" },
    { key: "overdue_orders", label: "Overdue Orders", value: await getOverdueOrdersCount(user, filter), subValue: "Need attention", tone: "red" },
  ];
};

const getOverdueOrdersCount = async (user, filter) => {
  const { params, sql } = getOrderScope(user, filter);
  const rows = await safeQuery(
    `SELECT COUNT(DISTINCT o.order_id) AS total
     FROM ${DB_PREFIX}${ORDER_TABLE} o
     ${sql} AND o.expected_delivery_date IS NOT NULL
       AND DATE(o.expected_delivery_date) < CURDATE()
       AND LOWER(COALESCE(o.order_status, '')) NOT IN ('completed','cancelled')`,
    params
  );
  return toNumber(rows[0]?.total);
};

const getBottleneckBoard = async (user, filter, tables) => {
  const totals = await getTotals(user, filter, tables);
  const statusMap = await getStatusCounts(user, filter);
  const { params, sql } = getOrderScope(user, filter);
  const overdue = await safeQuery(
    `SELECT COALESCE(SUM(oi.order_qty), 0) AS qty, COUNT(DISTINCT o.order_id) AS orders, MIN(o.expected_delivery_date) AS oldest_due
     FROM ${DB_PREFIX}${ORDER_TABLE} o
     LEFT JOIN ${DB_PREFIX}${ORDER_ITEMS_TABLE} oi ON o.order_id = oi.order_id AND oi.status <> 'delete'
     ${sql} AND o.expected_delivery_date IS NOT NULL AND DATE(o.expected_delivery_date) < CURDATE()
       AND LOWER(COALESCE(o.order_status, '')) NOT IN ('completed','cancelled')`,
    params
  );
  const row = (stage, qty, orders, tone, action, oldestDue = null) => ({ stage, qty: roundQty(qty), displayQty: formatShort(qty), orders: Math.round(toNumber(orders)), oldestDue, tone, action });
  return [
    row("Waiting Confirmation", toNumber(statusMap.waiting?.order_qty), toNumber(statusMap.waiting?.order_count), "amber", "Confirm"),
    row("Planning Pending", toNumber(statusMap.confirmed?.order_qty) + toNumber(statusMap.planning?.order_qty), toNumber(statusMap.confirmed?.order_count) + toNumber(statusMap.planning?.order_count), "blue", "Plan"),
    row("Production Pending", totals.pending_qty, toNumber(statusMap.planned?.order_count) + toNumber(statusMap.production?.order_count), "purple", "Produce"),
    row("Ready Pending Dispatch", totals.ready_pending_dispatch_qty, toNumber(statusMap.ready?.order_count) + toNumber(statusMap.dispatch?.order_count), "green", "Dispatch"),
    row("PMK Pending", Math.max(toNumber(totals.pmk_procure_qty) - toNumber(totals.dispatched_qty), 0), 0, "cyan", "View PMK"),
    row("Overdue Orders", overdue[0]?.qty, overdue[0]?.orders, "red", "View", overdue[0]?.oldest_due),
  ];
};

const getProductLoad = async (user, filter, tables) => {
  const { params, sql } = getOrderScope(user, filter);
  const { planningJoin, productionJoin, dispatchJoin } = getJoinSql(tables);
  const expr = getExpressions(tables);
  const rows = await safeQuery(
    `SELECT COALESCE(NULLIF(oi.product_name_snapshot, ''), p.product_name, 'Unknown') AS product_name,
            COALESCE(NULLIF(oi.product_code_snapshot, ''), p.product_code, '') AS product_code,
            COALESCE(SUM(oi.order_qty), 0) AS order_qty,
            COALESCE(SUM(${expr.ready}), 0) AS ready_qty,
            COALESCE(SUM(GREATEST(oi.order_qty - ${expr.ready}, 0)), 0) AS pending_qty,
            COALESCE(SUM(${expr.saipl}), 0) AS saipl_qty,
            COALESCE(SUM(${expr.pmk}), 0) AS pmk_qty
     FROM ${DB_PREFIX}${ORDER_TABLE} o
     INNER JOIN ${DB_PREFIX}${ORDER_ITEMS_TABLE} oi ON o.order_id = oi.order_id AND oi.status <> 'delete'
     LEFT JOIN ${DB_PREFIX}products p ON oi.product_id = p.product_id
     ${planningJoin}
     ${productionJoin}
     ${dispatchJoin}
     ${sql}
     GROUP BY COALESCE(NULLIF(oi.product_name_snapshot, ''), p.product_name, 'Unknown'), COALESCE(NULLIF(oi.product_code_snapshot, ''), p.product_code, '')
     ORDER BY order_qty DESC
     LIMIT 7`,
    params
  );
  return rows.map((row) => ({
    product: row.product_name,
    productCode: row.product_code,
    orderQty: roundQty(row.order_qty),
    readyQty: roundQty(row.ready_qty),
    pendingQty: roundQty(row.pending_qty),
    saiplQty: roundQty(row.saipl_qty),
    pmkQty: roundQty(row.pmk_qty),
  }));
};

const getCriticalAlerts = async (user, filter, tables) => {
  const totals = await getTotals(user, filter, tables);
  const overdue = await getOverdueOrdersCount(user, filter);
  const statusMap = await getStatusCounts(user, filter);
  return [
    { key: "overdue", title: "Overdue Orders", value: overdue, description: "Orders crossed expected delivery date.", action: "View Overdue", tone: "red" },
    { key: "planning_delay", title: "Planning Delays", value: toNumber(statusMap.confirmed?.order_count), description: "Confirmed orders waiting for planning.", action: "Plan Now", tone: "blue" },
    { key: "pmk_pending", title: "PMK Pending", value: roundQty(Math.max(toNumber(totals.pmk_procure_qty) - toNumber(totals.dispatched_qty), 0)), description: "Procurement quantity needs follow-up.", action: "View PMK", tone: "amber" },
    { key: "dispatch_due", title: "Dispatch Due", value: roundQty(totals.ready_pending_dispatch_qty), description: "Ready quantity waiting for dispatch.", action: "Dispatch List", tone: "green" },
  ];
};

const getProductionReadyTrend = async (user, filter = {}) => {
  const { fromDate, toDate } = getDateFilter(filter);
  const where = ["o.status <> 'delete'"];
  const params = [];
  addCompanyScope(where, params, user, "o");
  addDashboardFilterScope(where, params, filter, "o");
  if (fromDate || toDate) {
    addOrderDateScope(where, params, filter, "o");
  } else {
    where.push("o.order_date >= DATE_SUB(CURDATE(), INTERVAL 13 DAY)");
  }
  const rows = await safeQuery(
    `SELECT DATE_FORMAT(o.order_date, '%d %b') AS label,
            DATE(o.order_date) AS trend_date,
            COALESCE(SUM(pr.produced_qty), 0) AS produced_qty,
            COALESCE(SUM(COALESCE(pr.ready_qty, pl.ready_qty, 0)), 0) AS ready_qty
     FROM ${DB_PREFIX}${ORDER_TABLE} o
     INNER JOIN ${DB_PREFIX}${ORDER_ITEMS_TABLE} oi ON o.order_id = oi.order_id AND oi.status <> 'delete'
     LEFT JOIN ${DB_PREFIX}${PLANNING_TABLE} pl ON oi.order_item_id = pl.order_item_id AND pl.status <> 'delete'
     LEFT JOIN ${DB_PREFIX}${PRODUCTION_TABLE} pr ON oi.order_item_id = pr.order_item_id AND pr.status <> 'delete'
     WHERE ${where.join(" AND ")}
     GROUP BY trend_date, label
     ORDER BY trend_date ASC`,
    params
  );
  return rows.map((row) => ({ label: row.label, producedQty: roundQty(row.produced_qty), readyQty: roundQty(row.ready_qty) }));
};

const getPmkPending = async (user, filter) => {
  const { params, sql } = getOrderScope(user, filter);
  const rows = await safeQuery(
    `SELECT COALESCE(NULLIF(oi.product_name_snapshot, ''), p.product_name, 'Unknown') AS name,
            COALESCE(SUM(GREATEST(COALESCE(pl.pmk_qty, 0) - COALESCE(pr.procured_qty, 0), 0)), 0) AS qty
     FROM ${DB_PREFIX}${ORDER_TABLE} o
     INNER JOIN ${DB_PREFIX}${ORDER_ITEMS_TABLE} oi ON o.order_id = oi.order_id AND oi.status <> 'delete'
     LEFT JOIN ${DB_PREFIX}products p ON oi.product_id = p.product_id
     LEFT JOIN ${DB_PREFIX}${PLANNING_TABLE} pl ON oi.order_item_id = pl.order_item_id AND pl.status <> 'delete'
     LEFT JOIN ${DB_PREFIX}${PRODUCTION_TABLE} pr ON oi.order_item_id = pr.order_item_id AND pr.status <> 'delete'
     ${sql}
     GROUP BY COALESCE(NULLIF(oi.product_name_snapshot, ''), p.product_name, 'Unknown')
     HAVING qty > 0
     ORDER BY qty DESC
     LIMIT 6`,
    params
  );
  return rows.map((row) => ({ name: row.name, qty: roundQty(row.qty), displayQty: formatShort(row.qty) }));
};

const getDispatchDue = async (user, filter, tables) => {
  const { params, sql } = getOrderScope(user, filter);
  const { planningJoin, productionJoin, dispatchJoin } = getJoinSql(tables);
  const expr = getExpressions(tables);
  const rows = await safeQuery(
    `SELECT o.order_id, o.order_no, COALESCE(c.name, '-') AS customer_name,
            o.expected_delivery_date,
            COALESCE(SUM(GREATEST(${expr.ready} - ${expr.dispatched}, 0)), 0) AS due_qty,
            o.order_status
     FROM ${DB_PREFIX}${ORDER_TABLE} o
     LEFT JOIN ${DB_PREFIX}customer c ON o.customer_id = c.customer_id
     INNER JOIN ${DB_PREFIX}${ORDER_ITEMS_TABLE} oi ON o.order_id = oi.order_id AND oi.status <> 'delete'
     ${planningJoin}
     ${productionJoin}
     ${dispatchJoin}
     ${sql}
     GROUP BY o.order_id, o.order_no, c.name, o.expected_delivery_date, o.order_status
     HAVING due_qty > 0
     ORDER BY o.expected_delivery_date ASC, o.order_id DESC
     LIMIT 5`,
    params
  );
  return rows.map((row) => ({
    orderId: row.order_id,
    orderNo: row.order_no,
    customer: row.customer_name,
    dueDate: row.expected_delivery_date,
    qty: roundQty(row.due_qty),
    status: row.order_status,
  }));
};

export const getDashboardOverview = async (user = {}, filter = {}) => {
  const tables = await getAvailableTables();
  const [summary, pipeline, seriesMix, monthlyOrders, alerts, recentOrders, topProducts, actionKpis, bottleneckBoard, productLoad, criticalAlerts, productionReadyTrend, pmkPending, dispatchDue] = await Promise.all([
    getSummary(user, filter, tables),
    getPipeline(user, filter, tables),
    getSeriesMix(user, filter),
    getMonthlyOrders(user, filter),
    getAlerts(user, filter),
    getRecentOrders(user, filter, tables),
    getTopProducts(user, filter),
    getActionKpis(user, filter, tables),
    getBottleneckBoard(user, filter, tables),
    getProductLoad(user, filter, tables),
    getCriticalAlerts(user, filter, tables),
    getProductionReadyTrend(user, filter),
    getPmkPending(user, filter),
    getDispatchDue(user, filter, tables),
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
    actionKpis,
    bottleneckBoard,
    productLoad,
    criticalAlerts,
    productionReadyTrend,
    pmkPending,
    dispatchDue,
    meta: {
      usesPlanningTable: tables.planning,
      usesProductionTable: tables.production,
      usesDispatchTables: tables.dispatch,
      generatedAt: new Date().toISOString(),
    },
  };
};