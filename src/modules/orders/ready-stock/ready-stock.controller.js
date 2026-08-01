import * as CommonModel from "#shared/models/common.model.js";
import { query, DB_PREFIX } from "#config/database.js";
import { successResponse, failureResponse } from "#shared/utils/apiResponse.js";
import { prepareFilterData } from "#shared/utils/filter.builder.js";
// import { isSuperAdminRole as isSuperAdmin } from "#shared/utils/role.utils.js";
import { env } from "#config/env.js";

const MODULE_TABLE = "orders";
const ORDERS_LINE_TABLE = "order_items";
const PLANNING_TABLE = "order_item_planning";
const PRODUCTION_TABLE = "order_item_production";
const DISPATCH_TABLE = "dispatches";
const DISPATCH_ITEMS_TABLE = "dispatch_items";

const default_columns = {};
const custom_columns = {
  customer_id: {
    table: "customer",
    alias: "cu",
    column: "name",
    key2: "customer_id",
    select: "cu.mobile_no AS customer_mobile, cu.email AS customer_email",
  },
  order_status: {
    table: "categories",
    alias: "ct",
    column: "categoryName",
    key2: "slug",
    select: "ct.cat_color as order_status_color",
  },
  priority: {
    table: "categories",
    alias: "cp",
    column: "categoryName",
    key2: "slug",
    select: "cp.cat_color as priority_color",
  },
  sales_person_id: {
    table: "admin",
    alias: "sp",
    column: "name",
    key2: "adminID",
    select: "",
  },
};

const toNumber = (value, fallback = 0) => {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : fallback;
};

const getPaginationMeta = ({ total, page, limit, start }) => {
  const totalPages = Math.ceil(total / limit);
  return { total, page, limit, totalPages, start: total === 0 ? 0 : start + 1, end: Math.min(start + limit, total) };
};

const getReadyStockAggregateByOrderIds = async (orderIds = []) => {
  if (!orderIds.length) return {};
  const placeholders = orderIds.map(() => "?").join(",");
  const rows = await query(
    `SELECT oi.order_id,
            COALESCE(COUNT(oi.order_item_id), 0) AS total_items,
            COALESCE(SUM(oi.order_qty), 0) AS order_qty,
            COALESCE(SUM(pl.ready_qty), 0) AS planning_ready_qty,
            COALESCE(SUM(pr.qc_passed_qty), 0) AS qc_passed_qty,
            COALESCE(SUM(pr.procured_qty), 0) AS procured_qty,
            COALESCE(SUM(COALESCE(pl.ready_qty, 0) + COALESCE(pr.qc_passed_qty, 0) + COALESCE(pr.procured_qty, 0)), 0) AS total_ready_qty,
            COALESCE(SUM(dd.dispatched_qty), 0) AS dispatched_qty,
            GREATEST(COALESCE(SUM(COALESCE(pl.ready_qty, 0) + COALESCE(pr.qc_passed_qty, 0) + COALESCE(pr.procured_qty, 0)), 0) - COALESCE(SUM(dd.dispatched_qty), 0), 0) AS available_dispatch_qty,
            GREATEST(COALESCE(SUM(oi.order_qty), 0) - COALESCE(SUM(COALESCE(pl.ready_qty, 0) + COALESCE(pr.qc_passed_qty, 0) + COALESCE(pr.procured_qty, 0)), 0), 0) AS pending_qty,
            CASE
              WHEN COALESCE(SUM(COALESCE(pl.ready_qty, 0) + COALESCE(pr.qc_passed_qty, 0) + COALESCE(pr.procured_qty, 0)), 0) >= COALESCE(SUM(oi.order_qty), 0) AND COALESCE(SUM(oi.order_qty), 0) > 0 THEN 'ready'
              WHEN COALESCE(SUM(COALESCE(pl.ready_qty, 0) + COALESCE(pr.qc_passed_qty, 0) + COALESCE(pr.procured_qty, 0)), 0) > 0 THEN 'partially_ready'
              ELSE 'not_ready'
            END AS ready_stock_status
     FROM ${DB_PREFIX}${ORDERS_LINE_TABLE} oi
     LEFT JOIN ${DB_PREFIX}${PLANNING_TABLE} pl ON oi.order_item_id = pl.order_item_id AND pl.status <> 'delete'
     LEFT JOIN ${DB_PREFIX}${PRODUCTION_TABLE} pr ON oi.order_item_id = pr.order_item_id AND pr.status <> 'delete'
     LEFT JOIN (SELECT di.order_item_id, COALESCE(SUM(di.dispatch_qty), 0) AS dispatched_qty FROM ${DB_PREFIX}${DISPATCH_ITEMS_TABLE} di INNER JOIN ${DB_PREFIX}${DISPATCH_TABLE} d ON di.dispatch_id = d.dispatch_id WHERE di.status <> 'delete' AND d.status <> 'delete' AND d.dispatch_status <> 'cancelled' GROUP BY di.order_item_id) dd ON oi.order_item_id = dd.order_item_id
     WHERE oi.status <> 'delete' AND oi.order_id IN (${placeholders})
     GROUP BY oi.order_id`,
    orderIds
  );

  return rows.reduce((acc, row) => {
    acc[row.order_id] = row;
    return acc;
  }, {});
};

export const list = async (req, res) => {
  try {
    const { page = 1, searchText = "", getAll = "N", orderBy = "expected_delivery_date", order = "ASC", filters = [] } = req.body || {};
    const limit = env.perPage;
    const currentPage = Number(page) || 1;
    const start = (currentPage - 1) * limit;

    const filterData = prepareFilterData({
      filters,
      searchText,
      other: { orderBy, order, searchColumns: ["order_no"] },
      default_columns,
      custom_columns,
    });

    const { select, where, values, join, other } = filterData;
    where.push("t.status <> 'delete'");
    where.push("t.order_status IN ('production','ready','dispatch')");
    other.freeTextSearch = searchText;
    other.searchColumns = ["t.order_no", "t.brand", "cu.name", "sp.name"];

    // if (!isSuperAdmin(req.user) && req.user.company_id) {
    //   where.push("t.company_id = ?");
    //   values.push(req.user.company_id);
    // }

    const total = await CommonModel.getCountsByParameter({ table: MODULE_TABLE, where, values, join, other });
    const orderList = await CommonModel.GetMasterListDetails({ select, table: MODULE_TABLE, where, values, limit: getAll === "Y" ? "" : limit, start, join, other });
    const aggregateMap = await getReadyStockAggregateByOrderIds(orderList.map((row) => row.order_id).filter(Boolean));

    const rows = orderList.map((row) => ({
      ...row,
      total_items: aggregateMap[row.order_id]?.total_items || 0,
      item_total_qty: aggregateMap[row.order_id]?.order_qty || 0,
      planning_ready_qty: aggregateMap[row.order_id]?.planning_ready_qty || 0,
      qc_passed_qty: aggregateMap[row.order_id]?.qc_passed_qty || 0,
      procured_qty: aggregateMap[row.order_id]?.procured_qty || 0,
      total_ready_qty: aggregateMap[row.order_id]?.total_ready_qty || 0,
      dispatched_qty: aggregateMap[row.order_id]?.dispatched_qty || 0,
      available_dispatch_qty: aggregateMap[row.order_id]?.available_dispatch_qty || 0,
      pending_qty: aggregateMap[row.order_id]?.pending_qty || row.total_order_qty || 0,
      ready_stock_status: aggregateMap[row.order_id]?.ready_stock_status || "not_ready",
    }));

    return successResponse(res, {
      code: 1004,
      httpStatus: 200,
      data: { data: rows, pagination: getPaginationMeta({ total, page: currentPage, limit, start }) },
    });
  } catch (error) {
    return failureResponse(res, { code: 2008, httpStatus: 500, message: error.message });
  }
};

export const getDetails = async (req, res) => {
  try {
    const { orderId } = req.params;
    if (!orderId) return failureResponse(res, { code: 2004, httpStatus: 404 });

    const where = { order_id: orderId };
    // if (!isSuperAdmin(req.user) && req.user.company_id) where.company_id = req.user.company_id;
    const orderRows = await CommonModel.getMasterDetails(MODULE_TABLE, "*", where);
    const orderDetails = orderRows.find((row) => row.status !== "delete" && ["production", "ready", "dispatch"].includes(row.order_status));
    if (!orderDetails) return failureResponse(res, { code: 2004, httpStatus: 404 });

    const customerRows = orderDetails.customer_id ? await CommonModel.getMasterDetails("customer", "name AS customer_name, mobile_no AS customer_mobile, email AS customer_email", { customer_id: orderDetails.customer_id }) : [];
    const salesPersonRows = orderDetails.sales_person_id ? await CommonModel.getMasterDetails("admin", "name AS sales_person_name", { adminID: orderDetails.sales_person_id }) : [];

    const items = await query(
      `SELECT oi.order_item_id, oi.order_id, oi.company_id, oi.product_id,
              COALESCE(oi.product_code_snapshot, p.product_code) AS product_code,
              COALESCE(oi.product_name_snapshot, p.product_name) AS product_name,
              COALESCE(oi.brand_snapshot, p.brand) AS series,
              p.weight, oi.order_qty, oi.unit_rate, oi.line_value,
              COALESCE(pl.ready_qty, 0) AS planning_ready_qty,
              COALESCE(pr.qc_passed_qty, 0) AS qc_passed_qty,
              COALESCE(pr.procured_qty, 0) AS procured_qty,
              COALESCE(COALESCE(pl.ready_qty, 0) + COALESCE(pr.qc_passed_qty, 0) + COALESCE(pr.procured_qty, 0), 0) AS total_ready_qty,
              COALESCE(dd.dispatched_qty, 0) AS dispatched_qty,
              GREATEST(COALESCE(COALESCE(pl.ready_qty, 0) + COALESCE(pr.qc_passed_qty, 0) + COALESCE(pr.procured_qty, 0), 0) - COALESCE(dd.dispatched_qty, 0), 0) AS available_dispatch_qty,
              GREATEST(COALESCE(oi.order_qty, 0) - COALESCE(COALESCE(pl.ready_qty, 0) + COALESCE(pr.qc_passed_qty, 0) + COALESCE(pr.procured_qty, 0), 0), 0) AS pending_qty,
              CASE
                WHEN COALESCE(COALESCE(pl.ready_qty, 0) + COALESCE(pr.qc_passed_qty, 0) + COALESCE(pr.procured_qty, 0), 0) >= COALESCE(oi.order_qty, 0) AND COALESCE(oi.order_qty, 0) > 0 THEN 'ready'
                WHEN COALESCE(COALESCE(pl.ready_qty, 0) + COALESCE(pr.qc_passed_qty, 0) + COALESCE(pr.procured_qty, 0), 0) > 0 THEN 'partially_ready'
                ELSE 'not_ready'
              END AS ready_stock_status,
              COALESCE(pr.expected_ready_date, pl.expected_ready_date, oi.expected_delivery_date) AS ready_date,
              COALESCE(pr.priority, pl.priority, o.priority, 'normal') AS priority
       FROM ${DB_PREFIX}${ORDERS_LINE_TABLE} oi
       INNER JOIN ${DB_PREFIX}${MODULE_TABLE} o ON oi.order_id = o.order_id
       LEFT JOIN ${DB_PREFIX}products p ON oi.product_id = p.product_id
       LEFT JOIN ${DB_PREFIX}${PLANNING_TABLE} pl ON oi.order_item_id = pl.order_item_id AND pl.status <> 'delete'
       LEFT JOIN ${DB_PREFIX}${PRODUCTION_TABLE} pr ON oi.order_item_id = pr.order_item_id AND pr.status <> 'delete'
       LEFT JOIN (SELECT di.order_item_id, COALESCE(SUM(di.dispatch_qty), 0) AS dispatched_qty FROM ${DB_PREFIX}${DISPATCH_ITEMS_TABLE} di INNER JOIN ${DB_PREFIX}${DISPATCH_TABLE} d ON di.dispatch_id = d.dispatch_id WHERE di.status <> 'delete' AND d.status <> 'delete' AND d.dispatch_status <> 'cancelled' GROUP BY di.order_item_id) dd ON oi.order_item_id = dd.order_item_id
       WHERE oi.order_id = ? AND oi.status <> 'delete'
       ORDER BY oi.order_item_id ASC`,
      [orderId]
    );

    return successResponse(res, { code: 1004, httpStatus: 200, data: { data: { ...orderDetails, ...(customerRows[0] || {}), ...(salesPersonRows[0] || {}), items } } });
  } catch (error) {
    return failureResponse(res, { code: 2008, httpStatus: 500, message: error.message });
  }
};

export const orderDetails = getDetails;