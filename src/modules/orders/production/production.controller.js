import * as CommonModel from "#shared/models/common.model.js";
import { query, DB_PREFIX } from "#config/database.js";
import { successResponse, failureResponse } from "#shared/utils/apiResponse.js";
import { prepareFilterData } from "#shared/utils/filter.builder.js";
import { toMysqlDateTime } from "#shared/utils/dateTime.js";
// import { isSuperAdminRole as isSuperAdmin } from "#shared/utils/role.utils.js";
import { env } from "#config/env.js";

const MODULE_TABLE = "orders";
const ORDERS_LINE_TABLE = "order_items";
const PLANNING_TABLE = "order_item_planning";
const PRODUCTION_TABLE = "order_item_production";
const PRODUCTION_HISTORY_TABLE = "order_item_production_history";

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
  created_by: {
    table: "admin",
    alias: "ad",
    column: "name",
    key2: "adminID",
    select: "",
  },
  modified_by: {
    table: "admin",
    alias: "am",
    column: "name",
    key2: "adminID",
    select: "",
  },
};

const allowedProductionStatuses = ["not_started", "in_progress", "partially_ready", "ready", "hold", "completed"];
const allowedPriorities = ["low", "normal", "high", "urgent"];

const toNumber = (value, fallback = 0) => {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : fallback;
};

const normalizeEnum = (value, allowed, fallback) => {
  const normalized = String(value || "").toLowerCase().trim().replace(/\s+/g, "_");
  return allowed.includes(normalized) ? normalized : fallback;
};

const getPaginationMeta = ({ total, page, limit, start }) => {
  const totalPages = Math.ceil(total / limit);
  const end = Math.min(start + limit, total);
  return { total, page, limit, totalPages, start: total === 0 ? 0 : start + 1, end };
};

const buildProductionStatus = ({ orderQty, availableStockQty, producedQty, qcPassedQty, procuredQty, explicitStatus }) => {
  const safeExplicit = normalizeEnum(explicitStatus, allowedProductionStatuses, "");
  const readyQty = toNumber(availableStockQty) + toNumber(qcPassedQty) + toNumber(procuredQty);

  if (safeExplicit === "hold") return "hold";
  if (orderQty > 0 && readyQty >= orderQty) return "ready";
  if (readyQty > 0) return "partially_ready";
  if (toNumber(producedQty) > 0 || toNumber(qcPassedQty) > 0 || toNumber(procuredQty) > 0) return "in_progress";
  return "not_started";
};

const calculateReadyQty = ({ availableStockQty, qcPassedQty, procuredQty }) => {
  return toNumber(availableStockQty) + toNumber(qcPassedQty) + toNumber(procuredQty);
};

const calculatePendingQty = ({ orderQty, readyQty }) => Math.max(toNumber(orderQty) - toNumber(readyQty), 0);

const fetchProductionTargetItem = async ({ orderItemId, user }) => {
  const where = ["oi.order_item_id = ?", "oi.status <> 'delete'", "o.status <> 'delete'", "o.order_status IN ('planned','production')"];
  const values = [orderItemId];

  // if (!isSuperAdmin(user) && user?.company_id) {
  //   where.push("o.company_id = ?");
  //   values.push(user.company_id);
  // }

  const rows = await query(
    `SELECT oi.order_item_id, oi.order_id, oi.company_id, oi.order_qty, o.priority AS order_priority,
            COALESCE(pl.ready_qty, 0) AS available_stock_qty,
            COALESCE(pl.saipl_qty, 0) AS saipl_mfg_qty,
            COALESCE(pl.pmk_qty, 0) AS pmk_procure_qty,
            pl.expected_ready_date
     FROM ${DB_PREFIX}${ORDERS_LINE_TABLE} oi
     INNER JOIN ${DB_PREFIX}${MODULE_TABLE} o ON oi.order_id = o.order_id
     LEFT JOIN ${DB_PREFIX}${PLANNING_TABLE} pl ON oi.order_item_id = pl.order_item_id AND pl.status <> 'delete'
     WHERE ${where.join(" AND ")}`,
    values
  );

  return rows[0] || null;
};

const getProductionAggregateByOrderIds = async (orderIds = []) => {
  if (!orderIds.length) return {};
  const placeholders = orderIds.map(() => "?").join(",");
  const rows = await query(
    `SELECT oi.order_id,
            COALESCE(COUNT(oi.order_item_id), 0) AS total_items,
            COALESCE(SUM(oi.order_qty), 0) AS item_total_qty,
            COALESCE(SUM(pl.ready_qty), 0) AS available_stock_qty,
            COALESCE(SUM(pl.saipl_qty), 0) AS saipl_mfg_qty,
            COALESCE(SUM(pl.pmk_qty), 0) AS pmk_procure_qty,
            COALESCE(SUM(pr.produced_qty), 0) AS produced_qty,
            COALESCE(SUM(pr.procured_qty), 0) AS procured_qty,
            COALESCE(SUM(pr.qc_passed_qty), 0) AS qc_passed_qty,
            COALESCE(SUM(pr.rework_qty), 0) AS rework_qty,
            COALESCE(SUM(COALESCE(pr.ready_qty, pl.ready_qty, 0)), 0) AS production_ready_qty,
            COALESCE(SUM(COALESCE(pr.pending_qty, oi.order_qty)), 0) AS production_pending_qty,
            CASE
              WHEN COALESCE(SUM(COALESCE(pr.ready_qty, pl.ready_qty, 0)), 0) >= COALESCE(SUM(oi.order_qty), 0) AND COALESCE(SUM(oi.order_qty), 0) > 0 THEN 'ready'
              WHEN COALESCE(SUM(COALESCE(pr.ready_qty, pl.ready_qty, 0)), 0) > 0 THEN 'partially_ready'
              WHEN COUNT(pr.production_id) > 0 THEN 'in_progress'
              ELSE 'not_started'
            END AS production_status
     FROM ${DB_PREFIX}${ORDERS_LINE_TABLE} oi
     LEFT JOIN ${DB_PREFIX}${PLANNING_TABLE} pl ON oi.order_item_id = pl.order_item_id AND pl.status <> 'delete'
     LEFT JOIN ${DB_PREFIX}${PRODUCTION_TABLE} pr ON oi.order_item_id = pr.order_item_id AND pr.status <> 'delete'
     WHERE oi.status <> 'delete' AND oi.order_id IN (${placeholders})
     GROUP BY oi.order_id`,
    orderIds
  );

  return rows.reduce((acc, row) => {
    acc[row.order_id] = row;
    return acc;
  }, {});
};

const updateOrderProductionStatus = async ({ orderId, user }) => {
  const where = ["oi.order_id = ?", "oi.status <> 'delete'", "o.status <> 'delete'", "o.order_status IN ('planned','production')"];
  const values = [orderId];
  // if (!isSuperAdmin(user) && user?.company_id) {
  //   where.push("o.company_id = ?");
  //   values.push(user.company_id);
  // }

  const rows = await query(
    `SELECT oi.order_item_id, oi.order_qty,
            COALESCE(pl.ready_qty, 0) AS available_stock_qty,
            COALESCE(pr.qc_passed_qty, 0) AS qc_passed_qty,
            COALESCE(pr.procured_qty, 0) AS procured_qty,
            pr.production_id
     FROM ${DB_PREFIX}${ORDERS_LINE_TABLE} oi
     INNER JOIN ${DB_PREFIX}${MODULE_TABLE} o ON oi.order_id = o.order_id
     LEFT JOIN ${DB_PREFIX}${PLANNING_TABLE} pl ON oi.order_item_id = pl.order_item_id AND pl.status <> 'delete'
     LEFT JOIN ${DB_PREFIX}${PRODUCTION_TABLE} pr ON oi.order_item_id = pr.order_item_id AND pr.status <> 'delete'
     WHERE ${where.join(" AND ")}`,
    values
  );

  if (!rows.length) return "planned";

  const isFullyReady = rows.every((row) => {
    const readyQty = calculateReadyQty({
      availableStockQty: row.available_stock_qty,
      qcPassedQty: row.qc_passed_qty,
      procuredQty: row.procured_qty,
    });
    return toNumber(row.order_qty) > 0 && readyQty >= toNumber(row.order_qty);
  });

  const hasProduction = rows.some((row) => row.production_id);
  const nextOrderStatus = isFullyReady ? "ready" : hasProduction ? "production" : "planned";
  const orderWhere = { order_id: orderId };
  // if (!isSuperAdmin(user) && user?.company_id) orderWhere.company_id = user.company_id;

  await CommonModel.updateMasterDetails({
    table: MODULE_TABLE,
    data: { order_status: nextOrderStatus, modified_by: user.adminID, modified_date: toMysqlDateTime() },
    where: orderWhere,
  });

  return nextOrderStatus;
};

const saveProductionForItem = async ({ item, body, user }) => {
  const orderQty = toNumber(item.order_qty);
  const availableStockQty = toNumber(item.available_stock_qty);
  const saiplMfgQty = toNumber(item.saipl_mfg_qty);
  const pmkProcureQty = toNumber(item.pmk_procure_qty);
  const producedQty = toNumber(body.produced_qty);
  const procuredQty = toNumber(body.procured_qty);
  const qcPassedQty = toNumber(body.qc_passed_qty);
  const reworkQty = toNumber(body.rework_qty);
  const readyQty = calculateReadyQty({ availableStockQty, qcPassedQty, procuredQty });
  const pendingQty = calculatePendingQty({ orderQty, readyQty });

  if (producedQty > saiplMfgQty) throw new Error(`Produced qty cannot be greater than SAIPL MFG qty for item ${item.order_item_id}`);
  if (qcPassedQty + reworkQty > producedQty) throw new Error(`QC Passed + Rework qty cannot be greater than Produced qty for item ${item.order_item_id}`);
  if (procuredQty > pmkProcureQty) throw new Error(`Procured qty cannot be greater than PMK Procure qty for item ${item.order_item_id}`);
  if (readyQty > orderQty) throw new Error(`Ready qty cannot be greater than Order qty for item ${item.order_item_id}`);

  const productionStatus = buildProductionStatus({ orderQty, availableStockQty, producedQty, qcPassedQty, procuredQty, explicitStatus: body.production_status });
  const priority = normalizeEnum(body.priority || item.order_priority, allowedPriorities, "normal");
  const remarks = body.remarks || null;

  const existingRows = await CommonModel.getMasterDetails(PRODUCTION_TABLE, "*", { order_item_id: item.order_item_id });
  const existing = existingRows.find((row) => row.status !== "delete");
  let productionId = existing?.production_id || null;

  const data = {
    available_stock_qty: availableStockQty,
    saipl_mfg_qty: saiplMfgQty,
    pmk_procure_qty: pmkProcureQty,
    produced_qty: producedQty,
    procured_qty: procuredQty,
    qc_passed_qty: qcPassedQty,
    rework_qty: reworkQty,
    ready_qty: readyQty,
    pending_qty: pendingQty,
    production_status: productionStatus,
    expected_ready_date: body.expected_ready_date || item.expected_ready_date || null,
    priority,
    remarks,
  };

  if (productionId) {
    await CommonModel.updateMasterDetails({
      table: PRODUCTION_TABLE,
      data: { ...data, modified_by: user.adminID, modified_date: toMysqlDateTime() },
      where: { production_id: productionId },
    });
  } else {
    const result = await CommonModel.saveMasterDetails({
      table: PRODUCTION_TABLE,
      data: {
        company_id: item.company_id,
        order_id: item.order_id,
        order_item_id: item.order_item_id,
        ...data,
        start_date: toMysqlDateTime().slice(0, 10),
        created_by: user.adminID,
        created_date: toMysqlDateTime(),
        status: "active",
      },
    });
    productionId = result.insertId;
  }

  if (existing) {
    await CommonModel.saveMasterDetails({
      table: PRODUCTION_HISTORY_TABLE,
      data: {
        company_id: item.company_id,
        production_id: productionId,
        order_item_id: item.order_item_id,
        old_ready_qty: existing.ready_qty,
        new_ready_qty: readyQty,
        old_production_status: existing.production_status,
        new_production_status: productionStatus,
        changed_by: user.adminID,
        changed_at: toMysqlDateTime(),
        note: remarks,
      },
    });
  }

  return { production_id: productionId, order_item_id: item.order_item_id, production_status: productionStatus, ready_qty: readyQty, pending_qty: pendingQty };
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
    where.push("t.order_status IN ('planned','production')");
    other.freeTextSearch = searchText;
    other.searchColumns = ["t.order_no", "t.brand", "cu.name", "sp.name"];

    // if (!isSuperAdmin(req.user) && req.user.company_id) {
    //   where.push("t.company_id = ?");
    //   values.push(req.user.company_id);
    // }

    const total = await CommonModel.getCountsByParameter({ table: MODULE_TABLE, where, values, join, other });
    const orderList = await CommonModel.GetMasterListDetails({ select, table: MODULE_TABLE, where, values, limit: getAll === "Y" ? "" : limit, start, join, other });
    const aggregateMap = await getProductionAggregateByOrderIds(orderList.map((row) => row.order_id).filter(Boolean));

    const rows = orderList.map((row) => ({
      ...row,
      total_items: aggregateMap[row.order_id]?.total_items || 0,
      item_total_qty: aggregateMap[row.order_id]?.item_total_qty || 0,
      available_stock_qty: aggregateMap[row.order_id]?.available_stock_qty || 0,
      saipl_mfg_qty: aggregateMap[row.order_id]?.saipl_mfg_qty || 0,
      pmk_procure_qty: aggregateMap[row.order_id]?.pmk_procure_qty || 0,
      produced_qty: aggregateMap[row.order_id]?.produced_qty || 0,
      procured_qty: aggregateMap[row.order_id]?.procured_qty || 0,
      qc_passed_qty: aggregateMap[row.order_id]?.qc_passed_qty || 0,
      rework_qty: aggregateMap[row.order_id]?.rework_qty || 0,
      production_ready_qty: aggregateMap[row.order_id]?.production_ready_qty || 0,
      production_pending_qty: aggregateMap[row.order_id]?.production_pending_qty || row.total_order_qty || 0,
      production_status: aggregateMap[row.order_id]?.production_status || "not_started",
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
    const orderDetails = orderRows.find((row) => row.status !== "delete" && ["planned", "production"].includes(row.order_status));
    if (!orderDetails) return failureResponse(res, { code: 2004, httpStatus: 404 });

    const customerRows = orderDetails.customer_id ? await CommonModel.getMasterDetails("customer", "name AS customer_name, mobile_no AS customer_mobile, email AS customer_email", { customer_id: orderDetails.customer_id }) : [];
    const salesPersonRows = orderDetails.sales_person_id ? await CommonModel.getMasterDetails("admin", "name AS sales_person_name", { adminID: orderDetails.sales_person_id }) : [];

    const items = await query(
      `SELECT oi.order_item_id, oi.order_id, oi.company_id, oi.product_id,
              COALESCE(oi.product_code_snapshot, p.product_code) AS product_code,
              COALESCE(oi.product_name_snapshot, p.product_name) AS product_name,
              COALESCE(oi.brand_snapshot, p.brand) AS series,
              p.weight, oi.order_qty, oi.unit_rate, oi.line_value,
              COALESCE(pl.ready_qty, 0) AS available_stock_qty,
              COALESCE(pl.saipl_qty, 0) AS saipl_mfg_qty,
              COALESCE(pl.pmk_qty, 0) AS pmk_procure_qty,
              COALESCE(pr.produced_qty, 0) AS produced_qty,
              COALESCE(pr.procured_qty, 0) AS procured_qty,
              COALESCE(pr.qc_passed_qty, 0) AS qc_passed_qty,
              COALESCE(pr.rework_qty, 0) AS rework_qty,
              COALESCE(pr.ready_qty, pl.ready_qty, 0) AS ready_qty,
              COALESCE(pr.pending_qty, oi.order_qty) AS pending_qty,
              COALESCE(pr.production_status, 'not_started') AS production_status,
              COALESCE(pr.priority, pl.priority, o.priority, 'normal') AS priority,
              COALESCE(pr.expected_ready_date, pl.expected_ready_date) AS expected_ready_date,
              pr.remarks
       FROM ${DB_PREFIX}${ORDERS_LINE_TABLE} oi
       INNER JOIN ${DB_PREFIX}${MODULE_TABLE} o ON oi.order_id = o.order_id
       LEFT JOIN ${DB_PREFIX}products p ON oi.product_id = p.product_id
       LEFT JOIN ${DB_PREFIX}${PLANNING_TABLE} pl ON oi.order_item_id = pl.order_item_id AND pl.status <> 'delete'
       LEFT JOIN ${DB_PREFIX}${PRODUCTION_TABLE} pr ON oi.order_item_id = pr.order_item_id AND pr.status <> 'delete'
       WHERE oi.order_id = ? AND oi.status <> 'delete'
       ORDER BY oi.order_item_id ASC`,
      [orderId]
    );

    return successResponse(res, { code: 1004, httpStatus: 200, data: { data: { ...orderDetails, ...(customerRows[0] || {}), ...(salesPersonRows[0] || {}), items } } });
  } catch (error) {
    return failureResponse(res, { code: 2008, httpStatus: 500, message: error.message });
  }
};

export const startProduction = async (req, res) => {
  try {
    const { orderId } = req.params;
    const where = { order_id: orderId };
    // if (!isSuperAdmin(req.user) && req.user.company_id) where.company_id = req.user.company_id;
    const result = await CommonModel.updateMasterDetails({
      table: MODULE_TABLE,
      data: { order_status: "production", modified_by: req.user.adminID, modified_date: toMysqlDateTime() },
      where,
    });
    console.log('result :',result);
    if (!result.affectedRows) return failureResponse(res, { code: 2004, httpStatus: 404 });
    return successResponse(res, { code: 1002, httpStatus: 200, data: { order_id: orderId, order_status: "production" }, message: "Production started successfully" });
  } catch (error) {
    console.log(error);
    
    return failureResponse(res, { code: 2008, httpStatus: 500, message: error.message });
  }
};

export const saveOrderProduction = async (req, res) => {
  try {
    const { orderId } = req.params;
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    if (!orderId) return failureResponse(res, { code: 2004, httpStatus: 404 });
    if (!items.length) return failureResponse(res, { code: 2001, httpStatus: 400, message: "At least one production row is required" });

    const savedItems = [];
    let rowIndex = 0;
    for (const row of items) {
      rowIndex++;
      const item = await fetchProductionTargetItem({ orderItemId: row.order_item_id, user: req.user });
      if (!item || Number(item.order_id) !== Number(orderId)) {
        return failureResponse(res, { code: 2004, httpStatus: 404, message: `Order item ${row.order_item_id} not found for this order at row ${rowIndex}` });
      }
      savedItems.push(await saveProductionForItem({ item, body: row, user: req.user }));
    }

    const orderStatus = await updateOrderProductionStatus({ orderId, user: req.user });
    return successResponse(res, { code: 1002, httpStatus: 200, data: { order_id: orderId, order_status: orderStatus, items: savedItems }, message: "Production updated successfully" });
  } catch (error) {
    const isValidation = /cannot be greater/i.test(error.message);
    return failureResponse(res, { code: 2008, httpStatus: isValidation ? 400 : 500, message: error.message });
  }
};

export const orderDetails = getDetails;
