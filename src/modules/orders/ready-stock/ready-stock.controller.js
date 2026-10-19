// import * as CommonModel from "#shared/models/common.model.js";
// import { query, DB_PREFIX } from "#config/database.js";
// import { successResponse, failureResponse } from "#shared/utils/apiResponse.js";
// import { prepareFilterData } from "#shared/utils/filter.builder.js";
// // import { isSuperAdminRole as isSuperAdmin } from "#shared/utils/role.utils.js";
// import { env } from "#config/env.js";

// const MODULE_TABLE = "production_notes";
// const ORDERS_LINE_TABLE = "production_note_items";
// const PLANNING_TABLE = "production_note_item_planning";
// const PRODUCTION_TABLE = "production_note_item_production";
// const DISPATCH_TABLE = "dispatches";
// const DISPATCH_ITEMS_TABLE = "dispatch_items";

// const default_columns = {};
// const custom_columns = {
//   customer_id: {
//     table: "customer",
//     alias: "cu",
//     column: "name",
//     key2: "customer_id",
//     select: "cu.mobile_no AS customer_mobile, cu.email AS customer_email",
//   },
//   production_note_status: {
//     table: "categories",
//     alias: "ct",
//     column: "categoryName",
//     key2: "slug",
//     select: "ct.cat_color as production_note_status_color",
//   },
//   priority: {
//     table: "categories",
//     alias: "cp",
//     column: "categoryName",
//     key2: "slug",
//     select: "cp.cat_color as priority_color",
//   },
// };

// const toNumber = (value, fallback = 0) => {
//   const numericValue = Number(value);
//   return Number.isFinite(numericValue) ? numericValue : fallback;
// };

// const getPaginationMeta = ({ total, page, limit, start }) => {
//   const totalPages = Math.ceil(total / limit);
//   return { total, page, limit, totalPages, start: total === 0 ? 0 : start + 1, end: Math.min(start + limit, total) };
// };

// const getReadyStockAggregateByOrderIds = async (orderIds = []) => {
//   if (!orderIds.length) return {};
//   const placeholders = orderIds.map(() => "?").join(",");
//   const rows = await query(
//     `SELECT oi.production_note_id,
//             COALESCE(COUNT(oi.production_note_item_id), 0) AS total_items,
//             COALESCE(SUM(oi.production_note_qty), 0) AS production_note_qty,
//             COALESCE(SUM(pl.ready_qty), 0) AS planning_ready_qty,
//             COALESCE(SUM(pr.qc_passed_qty), 0) AS qc_passed_qty,
//             COALESCE(SUM(pr.procured_qty), 0) AS procured_qty,
//             COALESCE(SUM(COALESCE(pl.ready_qty, 0) + COALESCE(pr.qc_passed_qty, 0) + COALESCE(pr.procured_qty, 0)), 0) AS total_ready_qty,
//             COALESCE(SUM(dd.dispatched_qty), 0) AS dispatched_qty,
//             GREATEST(COALESCE(SUM(COALESCE(pl.ready_qty, 0) + COALESCE(pr.qc_passed_qty, 0) + COALESCE(pr.procured_qty, 0)), 0) - COALESCE(SUM(dd.dispatched_qty), 0), 0) AS available_dispatch_qty,
//             GREATEST(COALESCE(SUM(oi.production_note_qty), 0) - COALESCE(SUM(COALESCE(pl.ready_qty, 0) + COALESCE(pr.qc_passed_qty, 0) + COALESCE(pr.procured_qty, 0)), 0), 0) AS pending_qty,
//             CASE
//               WHEN COALESCE(SUM(COALESCE(pl.ready_qty, 0) + COALESCE(pr.qc_passed_qty, 0) + COALESCE(pr.procured_qty, 0)), 0) >= COALESCE(SUM(oi.production_note_qty), 0) AND COALESCE(SUM(oi.production_note_qty), 0) > 0 THEN 'ready'
//               WHEN COALESCE(SUM(COALESCE(pl.ready_qty, 0) + COALESCE(pr.qc_passed_qty, 0) + COALESCE(pr.procured_qty, 0)), 0) > 0 THEN 'partially_ready'
//               ELSE 'not_ready'
//             END AS ready_stock_status
//      FROM ${DB_PREFIX}${ORDERS_LINE_TABLE} oi
//      LEFT JOIN ${DB_PREFIX}${PLANNING_TABLE} pl ON oi.production_note_item_id = pl.production_note_item_id AND pl.status <> 'delete'
//      LEFT JOIN ${DB_PREFIX}${PRODUCTION_TABLE} pr ON oi.production_note_item_id = pr.production_note_item_id AND pr.status <> 'delete'
//      LEFT JOIN (SELECT di.production_note_item_id, COALESCE(SUM(di.dispatch_qty), 0) AS dispatched_qty FROM ${DB_PREFIX}${DISPATCH_ITEMS_TABLE} di INNER JOIN ${DB_PREFIX}${DISPATCH_TABLE} d ON di.dispatch_id = d.dispatch_id WHERE di.status <> 'delete' AND d.status <> 'delete' AND d.dispatch_status <> 'cancelled' GROUP BY di.production_note_item_id) dd ON oi.production_note_item_id = dd.production_note_item_id
//      WHERE oi.status <> 'delete' AND oi.production_note_id IN (${placeholders})
//      GROUP BY oi.production_note_id`,
//     orderIds
//   );

//   return rows.reduce((acc, row) => {
//     acc[row.production_note_id] = row;
//     return acc;
//   }, {});
// };

// export const list = async (req, res) => {
//   try {
//     const { page = 1, searchText = "", getAll = "N", orderBy = "expected_delivery_date", order = "ASC", filters = [] } = req.body || {};
//     const limit = env.perPage;
//     const currentPage = Number(page) || 1;
//     const start = (currentPage - 1) * limit;

//     const filterData = prepareFilterData({
//       filters,
//       searchText,
//       other: { orderBy, order, searchColumns: ["production_note_no"] },
//       default_columns,
//       custom_columns,
//     });

//     const { select, where, values, join, other } = filterData;
//     where.push("t.status <> 'delete'");
//     where.push("t.production_note_status IN ('production','ready','dispatch')");
//     other.freeTextSearch = searchText;
//     other.searchColumns = ["t.production_note_no", "t.brand", "cu.name", "sp.name"];

//     // if (!isSuperAdmin(req.user) && req.user.company_id) {
//     //   where.push("t.company_id = ?");
//     //   values.push(req.user.company_id);
//     // }

//     const total = await CommonModel.getCountsByParameter({ table: MODULE_TABLE, where, values, join, other });
//     const orderList = await CommonModel.GetMasterListDetails({ select, table: MODULE_TABLE, where, values, limit: getAll === "Y" ? "" : limit, start, join, other });
//     const aggregateMap = await getReadyStockAggregateByOrderIds(orderList.map((row) => row.production_note_id).filter(Boolean));

//     const rows = orderList.map((row) => ({
//       ...row,
//       total_items: aggregateMap[row.production_note_id]?.total_items || 0,
//       item_total_qty: aggregateMap[row.production_note_id]?.production_note_qty || 0,
//       planning_ready_qty: aggregateMap[row.production_note_id]?.planning_ready_qty || 0,
//       qc_passed_qty: aggregateMap[row.production_note_id]?.qc_passed_qty || 0,
//       procured_qty: aggregateMap[row.production_note_id]?.procured_qty || 0,
//       total_ready_qty: aggregateMap[row.production_note_id]?.total_ready_qty || 0,
//       dispatched_qty: aggregateMap[row.production_note_id]?.dispatched_qty || 0,
//       available_dispatch_qty: aggregateMap[row.production_note_id]?.available_dispatch_qty || 0,
//       pending_qty: aggregateMap[row.production_note_id]?.pending_qty || row.total_production_note_qty || 0,
//       ready_stock_status: aggregateMap[row.production_note_id]?.ready_stock_status || "not_ready",
//     }));

//     return successResponse(res, {
//       code: 1004,
//       httpStatus: 200,
//       data: { data: rows, pagination: getPaginationMeta({ total, page: currentPage, limit, start }) },
//     });
//   } catch (error) {
//     return failureResponse(res, { code: 2008, httpStatus: 500, message: error.message });
//   }
// };

// export const getDetails = async (req, res) => {
//   try {
//     const { orderId } = req.params;
//     if (!orderId) return failureResponse(res, { code: 2004, httpStatus: 404 });

//     const where = { production_note_id: orderId };
//     // if (!isSuperAdmin(req.user) && req.user.company_id) where.company_id = req.user.company_id;
//     const orderRows = await CommonModel.getMasterDetails(MODULE_TABLE, "*", where);
//     const orderDetails = orderRows.find((row) => row.status !== "delete" && ["production", "ready", "dispatch"].includes(row.production_note_status));
//     if (!orderDetails) return failureResponse(res, { code: 2004, httpStatus: 404 });

//     const customerRows = orderDetails.customer_id ? await CommonModel.getMasterDetails("customer", "name AS customer_name, mobile_no AS customer_mobile, email AS customer_email", { customer_id: orderDetails.customer_id }) : [];

//     const items = await query(
//       `SELECT oi.production_note_item_id, oi.production_note_id, oi.company_id, oi.product_id,
//               COALESCE(oi.product_code_snapshot, p.product_code) AS product_code,
//               COALESCE(oi.product_name_snapshot, p.product_name) AS product_name,
//               COALESCE(oi.brand_snapshot, p.brand) AS series,
//               p.weight, oi.production_note_qty, oi.unit_rate, oi.line_value,
//               COALESCE(pl.ready_qty, 0) AS planning_ready_qty,
//               COALESCE(pr.qc_passed_qty, 0) AS qc_passed_qty,
//               COALESCE(pr.procured_qty, 0) AS procured_qty,
//               COALESCE(COALESCE(pl.ready_qty, 0) + COALESCE(pr.qc_passed_qty, 0) + COALESCE(pr.procured_qty, 0), 0) AS total_ready_qty,
//               COALESCE(dd.dispatched_qty, 0) AS dispatched_qty,
//               GREATEST(COALESCE(COALESCE(pl.ready_qty, 0) + COALESCE(pr.qc_passed_qty, 0) + COALESCE(pr.procured_qty, 0), 0) - COALESCE(dd.dispatched_qty, 0), 0) AS available_dispatch_qty,
//               GREATEST(COALESCE(oi.production_note_qty, 0) - COALESCE(COALESCE(pl.ready_qty, 0) + COALESCE(pr.qc_passed_qty, 0) + COALESCE(pr.procured_qty, 0), 0), 0) AS pending_qty,
//               CASE
//                 WHEN COALESCE(COALESCE(pl.ready_qty, 0) + COALESCE(pr.qc_passed_qty, 0) + COALESCE(pr.procured_qty, 0), 0) >= COALESCE(oi.production_note_qty, 0) AND COALESCE(oi.production_note_qty, 0) > 0 THEN 'ready'
//                 WHEN COALESCE(COALESCE(pl.ready_qty, 0) + COALESCE(pr.qc_passed_qty, 0) + COALESCE(pr.procured_qty, 0), 0) > 0 THEN 'partially_ready'
//                 ELSE 'not_ready'
//               END AS ready_stock_status,
//               COALESCE(pr.expected_ready_date, pl.expected_ready_date, oi.expected_delivery_date) AS ready_date,
//               COALESCE(pr.priority, pl.priority, o.priority, 'normal') AS priority
//        FROM ${DB_PREFIX}${ORDERS_LINE_TABLE} oi
//        INNER JOIN ${DB_PREFIX}${MODULE_TABLE} o ON oi.production_note_id = o.production_note_id
//        LEFT JOIN ${DB_PREFIX}products p ON oi.product_id = p.product_id
//        LEFT JOIN ${DB_PREFIX}${PLANNING_TABLE} pl ON oi.production_note_item_id = pl.production_note_item_id AND pl.status <> 'delete'
//        LEFT JOIN ${DB_PREFIX}${PRODUCTION_TABLE} pr ON oi.production_note_item_id = pr.production_note_item_id AND pr.status <> 'delete'
//        LEFT JOIN (SELECT di.production_note_item_id, COALESCE(SUM(di.dispatch_qty), 0) AS dispatched_qty FROM ${DB_PREFIX}${DISPATCH_ITEMS_TABLE} di INNER JOIN ${DB_PREFIX}${DISPATCH_TABLE} d ON di.dispatch_id = d.dispatch_id WHERE di.status <> 'delete' AND d.status <> 'delete' AND d.dispatch_status <> 'cancelled' GROUP BY di.production_note_item_id) dd ON oi.production_note_item_id = dd.production_note_item_id
//        WHERE oi.production_note_id = ? AND oi.status <> 'delete'
//        ORDER BY oi.production_note_item_id ASC`,
//       [orderId]
//     );

//     return successResponse(res, { code: 1004, httpStatus: 200, data: { data: { ...orderDetails, ...(customerRows[0] || {}), items } } });
//   } catch (error) {
//     return failureResponse(res, { code: 2008, httpStatus: 500, message: error.message });
//   }
// };

// export const orderDetails = getDetails;
import * as CommonModel from "#shared/models/common.model.js";
import { query, DB_PREFIX } from "#config/database.js";
import { successResponse, failureResponse } from "#shared/utils/apiResponse.js";
import { prepareFilterData } from "#shared/utils/filter.builder.js";
// import { isSuperAdminRole as isSuperAdmin } from "#shared/utils/role.utils.js";
import { env } from "#config/env.js";

const MODULE_TABLE = "production_notes";
const ORDERS_LINE_TABLE = "production_note_items";
const PLANNING_TABLE = "production_note_item_planning";
const PRODUCTION_TABLE = "production_note_item_production";
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
  production_note_status: {
    table: "categories",
    alias: "ct",
    column: "categoryName",
    key2: "slug",
    select: "ct.cat_color as production_note_status_color",
  },
  priority: {
    table: "categories",
    alias: "cp",
    column: "categoryName",
    key2: "slug",
    select: "cp.cat_color as priority_color",
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
    `SELECT oi.production_note_id,
            COALESCE(COUNT(oi.production_note_item_id), 0) AS total_items,
            COALESCE(SUM(oi.production_note_qty), 0) AS production_note_qty,
            COALESCE(SUM(pl.ready_qty), 0) AS planning_ready_qty,
            COALESCE(SUM(pr.produced_qty), 0) AS produced_qty,
            COALESCE(SUM(pr.procured_qty), 0) AS procured_qty,
            COALESCE(SUM(COALESCE(pl.ready_qty, 0) + COALESCE(pr.produced_qty, 0) + COALESCE(pr.procured_qty, 0)), 0) AS total_ready_qty,
            COALESCE(SUM(dd.dispatched_qty), 0) AS dispatched_qty,
            GREATEST(COALESCE(SUM(COALESCE(pl.ready_qty, 0) + COALESCE(pr.produced_qty, 0) + COALESCE(pr.procured_qty, 0)), 0) - COALESCE(SUM(dd.dispatched_qty), 0), 0) AS available_dispatch_qty,
            GREATEST(COALESCE(SUM(oi.production_note_qty), 0) - COALESCE(SUM(COALESCE(pl.ready_qty, 0) + COALESCE(pr.produced_qty, 0) + COALESCE(pr.procured_qty, 0)), 0), 0) AS pending_qty,
            CASE
              WHEN COALESCE(SUM(COALESCE(pl.ready_qty, 0) + COALESCE(pr.produced_qty, 0) + COALESCE(pr.procured_qty, 0)), 0) >= COALESCE(SUM(oi.production_note_qty), 0) AND COALESCE(SUM(oi.production_note_qty), 0) > 0 THEN 'ready'
              WHEN COALESCE(SUM(COALESCE(pl.ready_qty, 0) + COALESCE(pr.produced_qty, 0) + COALESCE(pr.procured_qty, 0)), 0) > 0 THEN 'partially_ready'
              ELSE 'not_ready'
            END AS ready_stock_status
     FROM ${DB_PREFIX}${ORDERS_LINE_TABLE} oi
     LEFT JOIN ${DB_PREFIX}${PLANNING_TABLE} pl ON oi.production_note_item_id = pl.production_note_item_id AND pl.status <> 'delete'
     LEFT JOIN ${DB_PREFIX}${PRODUCTION_TABLE} pr ON oi.production_note_item_id = pr.production_note_item_id AND pr.status <> 'delete'
     LEFT JOIN (SELECT di.production_note_item_id, COALESCE(SUM(di.dispatch_qty), 0) AS dispatched_qty FROM ${DB_PREFIX}${DISPATCH_ITEMS_TABLE} di INNER JOIN ${DB_PREFIX}${DISPATCH_TABLE} d ON di.dispatch_id = d.dispatch_id WHERE di.status <> 'delete' AND d.status <> 'delete' AND d.dispatch_status <> 'cancelled' GROUP BY di.production_note_item_id) dd ON oi.production_note_item_id = dd.production_note_item_id
     WHERE oi.status <> 'delete' AND oi.production_note_id IN (${placeholders})
     GROUP BY oi.production_note_id`,
    orderIds
  );

  return rows.reduce((acc, row) => {
    acc[row.production_note_id] = row;
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
      other: { orderBy, order, searchColumns: ["production_note_no"] },
      default_columns,
      custom_columns,
    });

    const { select, where, values, join, other } = filterData;
    where.push("t.status <> 'delete'");
    where.push("t.production_note_status IN ('production','ready','dispatch')");
    other.freeTextSearch = searchText;
    other.searchColumns = ["t.production_note_no", "t.brand", "cu.name", "sp.name"];

    // if (!isSuperAdmin(req.user) && req.user.company_id) {
    //   where.push("t.company_id = ?");
    //   values.push(req.user.company_id);
    // }

    const total = await CommonModel.getCountsByParameter({ table: MODULE_TABLE, where, values, join, other });
    const orderList = await CommonModel.GetMasterListDetails({ select, table: MODULE_TABLE, where, values, limit: getAll === "Y" ? "" : limit, start, join, other });
    const aggregateMap = await getReadyStockAggregateByOrderIds(orderList.map((row) => row.production_note_id).filter(Boolean));

    const rows = orderList.map((row) => ({
      ...row,
      total_items: aggregateMap[row.production_note_id]?.total_items || 0,
      item_total_qty: aggregateMap[row.production_note_id]?.production_note_qty || 0,
      planning_ready_qty: aggregateMap[row.production_note_id]?.planning_ready_qty || 0,
      produced_qty: aggregateMap[row.production_note_id]?.produced_qty || 0,
      procured_qty: aggregateMap[row.production_note_id]?.procured_qty || 0,
      total_ready_qty: aggregateMap[row.production_note_id]?.total_ready_qty || 0,
      dispatched_qty: aggregateMap[row.production_note_id]?.dispatched_qty || 0,
      available_dispatch_qty: aggregateMap[row.production_note_id]?.available_dispatch_qty || 0,
      pending_qty: aggregateMap[row.production_note_id]?.pending_qty || row.total_production_note_qty || 0,
      ready_stock_status: aggregateMap[row.production_note_id]?.ready_stock_status || "not_ready",
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

    const where = { production_note_id: orderId };
    // if (!isSuperAdmin(req.user) && req.user.company_id) where.company_id = req.user.company_id;
    const orderRows = await CommonModel.getMasterDetails(MODULE_TABLE, "*", where);
    const orderDetails = orderRows.find((row) => row.status !== "delete" && ["production", "ready", "dispatch"].includes(row.production_note_status));
    if (!orderDetails) return failureResponse(res, { code: 2004, httpStatus: 404 });

    const customerRows = orderDetails.customer_id ? await CommonModel.getMasterDetails("customer", "name AS customer_name, mobile_no AS customer_mobile, email AS customer_email", { customer_id: orderDetails.customer_id }) : [];

    const items = await query(
      `SELECT oi.production_note_item_id, oi.production_note_id, oi.company_id, oi.product_id,
              COALESCE(oi.product_code_snapshot, p.product_code) AS product_code,
              COALESCE(oi.product_name_snapshot, p.product_name) AS product_name,
              COALESCE(oi.brand_snapshot, p.brand) AS series,
              p.weight, oi.production_note_qty, oi.unit_rate, oi.line_value,
              COALESCE(pl.ready_qty, 0) AS planning_ready_qty,
              COALESCE(pr.produced_qty, 0) AS produced_qty,
              COALESCE(pr.procured_qty, 0) AS procured_qty,
              COALESCE(COALESCE(pl.ready_qty, 0) + COALESCE(pr.produced_qty, 0) + COALESCE(pr.procured_qty, 0), 0) AS total_ready_qty,
              COALESCE(dd.dispatched_qty, 0) AS dispatched_qty,
              GREATEST(COALESCE(COALESCE(pl.ready_qty, 0) + COALESCE(pr.produced_qty, 0) + COALESCE(pr.procured_qty, 0), 0) - COALESCE(dd.dispatched_qty, 0), 0) AS available_dispatch_qty,
              GREATEST(COALESCE(oi.production_note_qty, 0) - COALESCE(COALESCE(pl.ready_qty, 0) + COALESCE(pr.produced_qty, 0) + COALESCE(pr.procured_qty, 0), 0), 0) AS pending_qty,
              CASE
                WHEN COALESCE(COALESCE(pl.ready_qty, 0) + COALESCE(pr.produced_qty, 0) + COALESCE(pr.procured_qty, 0), 0) >= COALESCE(oi.production_note_qty, 0) AND COALESCE(oi.production_note_qty, 0) > 0 THEN 'ready'
                WHEN COALESCE(COALESCE(pl.ready_qty, 0) + COALESCE(pr.produced_qty, 0) + COALESCE(pr.procured_qty, 0), 0) > 0 THEN 'partially_ready'
                ELSE 'not_ready'
              END AS ready_stock_status,
              COALESCE(pr.expected_ready_date, pl.expected_ready_date, oi.expected_delivery_date) AS ready_date,
              COALESCE(pr.priority, pl.priority, o.priority, 'normal') AS priority
       FROM ${DB_PREFIX}${ORDERS_LINE_TABLE} oi
       INNER JOIN ${DB_PREFIX}${MODULE_TABLE} o ON oi.production_note_id = o.production_note_id
       LEFT JOIN ${DB_PREFIX}products p ON oi.product_id = p.product_id
       LEFT JOIN ${DB_PREFIX}${PLANNING_TABLE} pl ON oi.production_note_item_id = pl.production_note_item_id AND pl.status <> 'delete'
       LEFT JOIN ${DB_PREFIX}${PRODUCTION_TABLE} pr ON oi.production_note_item_id = pr.production_note_item_id AND pr.status <> 'delete'
       LEFT JOIN (SELECT di.production_note_item_id, COALESCE(SUM(di.dispatch_qty), 0) AS dispatched_qty FROM ${DB_PREFIX}${DISPATCH_ITEMS_TABLE} di INNER JOIN ${DB_PREFIX}${DISPATCH_TABLE} d ON di.dispatch_id = d.dispatch_id WHERE di.status <> 'delete' AND d.status <> 'delete' AND d.dispatch_status <> 'cancelled' GROUP BY di.production_note_item_id) dd ON oi.production_note_item_id = dd.production_note_item_id
       WHERE oi.production_note_id = ? AND oi.status <> 'delete'
       ORDER BY oi.production_note_item_id ASC`,
      [orderId]
    );

    return successResponse(res, { code: 1004, httpStatus: 200, data: { data: { ...orderDetails, ...(customerRows[0] || {}), items } } });
  } catch (error) {
    return failureResponse(res, { code: 2008, httpStatus: 500, message: error.message });
  }
};

export const orderDetails = getDetails;
