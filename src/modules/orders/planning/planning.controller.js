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
const PLANNING_HISTORY_TABLE = "order_item_planning_history";

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
  company_id: {
    table: "company_master",
    alias: "dc",
    column: "company_name",
    key2: "company_id",
    select: "",
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

export const allowedPlanningStatuses = ["not_planned", "planned", "in_progress", "partially_ready", "ready", "completed", "hold"];
export const allowedPriorities = ["low", "normal", "high", "urgent"];

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
  return {
    total,
    page,
    limit,
    totalPages,
    start: total === 0 ? 0 : start + 1,
    end,
  };
};

const buildPlanningStatus = ({ orderQty, saiplQty, pmkQty, readyQty, explicitStatus }) => {
  const safeExplicit = normalizeEnum(explicitStatus, allowedPlanningStatuses, "");
  const plannedQty = toNumber(saiplQty) + toNumber(pmkQty) + toNumber(readyQty);

  if (safeExplicit === "hold") return "hold";
  if (orderQty > 0 && readyQty >= orderQty) return "ready";
  if (readyQty > 0) return "partially_ready";
  if (orderQty > 0 && plannedQty >= orderQty) return "planned";
  if (saiplQty > 0 || pmkQty > 0) return "in_progress";
  return "not_planned";
};

const calculatePlanningPendingQty = ({ orderQty, saiplQty, pmkQty, readyQty }) => {
  const plannedQty = toNumber(saiplQty) + toNumber(pmkQty) + toNumber(readyQty);
  return Math.max(toNumber(orderQty) - plannedQty, 0);
};

const fetchPlanningTargetItem = async ({ orderItemId, user }) => {
  const where = ["oi.order_item_id = ?", "oi.status <> 'delete'", "o.status <> 'delete'", "o.order_status IN ('confirmed','planned')"];
  const values = [orderItemId];

  // if (!isSuperAdmin(user) && user?.company_id) {
  //   where.push("o.company_id = ?");
  //   values.push(user.company_id);
  // }

  const itemRows = await query(
    `SELECT oi.order_item_id, oi.order_id, oi.company_id, oi.order_qty, o.priority AS order_priority
     FROM ${DB_PREFIX}${ORDERS_LINE_TABLE} oi
     INNER JOIN ${DB_PREFIX}${MODULE_TABLE} o ON oi.order_id = o.order_id
     WHERE ${where.join(" AND ")}`,
    values
  );
  return itemRows[0] || null;
};

const getPlanningAggregateByOrderIds = async (orderIds = []) => {
  if (!orderIds.length) return {};

  const placeholders = orderIds.map(() => "?").join(",");
  const rows = await query(
    `SELECT oi.order_id,
            COALESCE(COUNT(oi.order_item_id), 0) AS total_items,
            COALESCE(SUM(oi.order_qty), 0) AS item_total_qty,
            COALESCE(SUM(pl.saipl_qty), 0) AS saipl_qty,
            COALESCE(SUM(pl.pmk_qty), 0) AS pmk_qty,
            COALESCE(SUM(pl.ready_qty), 0) AS ready_qty,
            COALESCE(SUM(pl.dispatched_qty), 0) AS dispatched_qty,
            COALESCE(SUM(COALESCE(pl.pending_qty, oi.order_qty)), 0) AS pending_qty,
            SUM(CASE WHEN pl.planning_id IS NULL OR pl.planning_status = 'not_planned' THEN 1 ELSE 0 END) AS unplanned_items,
            CASE
              WHEN SUM(CASE WHEN pl.planning_id IS NULL OR pl.planning_status = 'not_planned' THEN 1 ELSE 0 END) > 0 THEN 'pending_planning'
              WHEN COALESCE(SUM(pl.ready_qty), 0) >= COALESCE(SUM(oi.order_qty), 0) AND COALESCE(SUM(oi.order_qty), 0) > 0 THEN 'ready'
              WHEN COALESCE(SUM(pl.ready_qty), 0) > 0 THEN 'partially_ready'
              ELSE 'planned'
            END AS planning_status
     FROM ${DB_PREFIX}${ORDERS_LINE_TABLE} oi
     LEFT JOIN ${DB_PREFIX}${PLANNING_TABLE} pl ON oi.order_item_id = pl.order_item_id AND pl.status <> 'delete'
     WHERE oi.status <> 'delete' AND oi.order_id IN (${placeholders})
     GROUP BY oi.order_id`,
    orderIds
  );

  return rows.reduce((acc, row) => {
    acc[row.order_id] = row;
    return acc;
  }, {});
};

const applyPlanningStatusFilter = (rows = [], status = "all") => {
  if (!status || status === "all") return rows;
  if (status === "pending" || status === "pending_planning") {
    return rows.filter((row) => Number(row.unplanned_items || 0) > 0);
  }
  return rows.filter((row) => row.planning_status === status);
};

const updateOrderPlanningStatus = async ({ orderId, user }) => {
  const where = ["oi.order_id = ?", "oi.status <> 'delete'", "o.status <> 'delete'", "o.order_status IN ('confirmed','planned')"];
  const values = [orderId];

  // if (!isSuperAdmin(user) && user?.company_id) {
  //   where.push("o.company_id = ?");
  //   values.push(user.company_id);
  // }

  const rows = await query(
    `SELECT oi.order_item_id, oi.order_qty,
            COALESCE(pl.saipl_qty, 0) AS saipl_qty,
            COALESCE(pl.pmk_qty, 0) AS pmk_qty,
            COALESCE(pl.ready_qty, 0) AS ready_qty
     FROM ${DB_PREFIX}${ORDERS_LINE_TABLE} oi
     INNER JOIN ${DB_PREFIX}${MODULE_TABLE} o ON oi.order_id = o.order_id
     LEFT JOIN ${DB_PREFIX}${PLANNING_TABLE} pl ON oi.order_item_id = pl.order_item_id AND pl.status <> 'delete'
     WHERE ${where.join(" AND ")}`,
    values
  );

  if (!rows.length) return "confirmed";

  const isFullyPlanned = rows.every((row) => {
    const orderQty = toNumber(row.order_qty);
    const plannedQty = toNumber(row.saipl_qty) + toNumber(row.pmk_qty) + toNumber(row.ready_qty);
    return orderQty > 0 && plannedQty === orderQty;
  });

  const nextOrderStatus = isFullyPlanned ? "planned" : "confirmed";
  const orderWhere = { order_id: orderId };
  // if (!isSuperAdmin(user) && user?.company_id) {
  //   orderWhere.company_id = user.company_id;
  // }

  await CommonModel.updateMasterDetails({
    table: MODULE_TABLE,
    data: {
      order_status: nextOrderStatus,
      modified_by: user.adminID,
      modified_date: toMysqlDateTime(),
    },
    where: orderWhere,
  });

  return nextOrderStatus;
};

const savePlanningForItem = async ({ item, body, user }) => {
  const orderQty = toNumber(item.order_qty);
  const saiplQty = toNumber(body.saipl_qty);
  const pmkQty = toNumber(body.pmk_qty);
  const readyQty = toNumber(body.ready_qty);
  const dispatchedQty = toNumber(body.dispatched_qty);
  const plannedQty = saiplQty + pmkQty + readyQty;
  const pendingQty = calculatePlanningPendingQty({ orderQty, saiplQty, pmkQty, readyQty });

  if (plannedQty > orderQty) {
    throw new Error(`SAIPL + PMK + Ready qty cannot be greater than order qty for item ${item.order_item_id}`);
  }

  const planningStatus = buildPlanningStatus({
    orderQty,
    saiplQty,
    pmkQty,
    readyQty,
    explicitStatus: body.planning_status,
  });
  const priority = normalizeEnum(body.priority || item.order_priority, allowedPriorities, "normal");
  const expectedReadyDate = body.expected_ready_date || null;
  const planningNote = body.planning_note || null;

  const existingRows = await CommonModel.getMasterDetails(PLANNING_TABLE, "*", {
    order_item_id: item.order_item_id,
  });
  const existing = existingRows.find((row) => row.status !== "delete");

  let planningId = existing?.planning_id || null;
  const planningData = {
    saipl_qty: saiplQty,
    pmk_qty: pmkQty,
    planned_qty: plannedQty,
    ready_qty: readyQty,
    dispatched_qty: dispatchedQty,
    pending_qty: pendingQty,
    planning_status: planningStatus,
    expected_ready_date: expectedReadyDate,
    priority,
    planning_note: planningNote,
  };

  if (planningId) {
    await CommonModel.updateMasterDetails({
      table: PLANNING_TABLE,
      data: {
        ...planningData,
        modified_by: user.adminID,
        modified_date: toMysqlDateTime(),
      },
      where: { planning_id: planningId },
    });
  } else {
    const result = await CommonModel.saveMasterDetails({
      table: PLANNING_TABLE,
      data: {
        company_id: item.company_id,
        order_id: item.order_id,
        order_item_id: item.order_item_id,
        ...planningData,
        planned_date: toMysqlDateTime().slice(0, 10),
        created_by: user.adminID,
        created_date: toMysqlDateTime(),
        status: "active",
      },
    });
    planningId = result.insertId;
  }

  if (existing) {
    await CommonModel.saveMasterDetails({
      table: PLANNING_HISTORY_TABLE,
      data: {
        company_id: item.company_id,
        planning_id: planningId,
        order_item_id: item.order_item_id,
        old_saipl_qty: existing.saipl_qty,
        new_saipl_qty: saiplQty,
        old_pmk_qty: existing.pmk_qty,
        new_pmk_qty: pmkQty,
        old_ready_qty: existing.ready_qty,
        new_ready_qty: readyQty,
        old_planning_status: existing.planning_status,
        new_planning_status: planningStatus,
        changed_by: user.adminID,
        changed_at: toMysqlDateTime(),
        note: planningNote,
      },
    });
  }

  return {
    planning_id: planningId,
    order_item_id: item.order_item_id,
    planning_status: planningStatus,
    pending_qty: pendingQty,
  };
};

export const list = async (req, res) => {
  try {
    const { page = 1, searchText = "", getAll = "N", orderBy = "expected_delivery_date", order = "ASC", filters = [], status = "all" } = req.body || {};
    const limit = env.perPage;
    const currentPage = Number(page) || 1;
    const start = (currentPage - 1) * limit;

    const filterData = prepareFilterData({
      filters,
      searchText,
      other: {
        orderBy,
        order,
        searchColumns: ["order_no"],
      },
      default_columns,
      custom_columns,
    });

    const { select, where, values, join, other } = filterData;
    where.push("t.status <> 'delete'");
    where.push("t.order_status IN ('confirmed')");
    other.freeTextSearch = searchText;
    other.searchColumns = ["t.order_no", "t.brand", "cu.name", "sp.name"];

    // if (!isSuperAdmin(req.user) && req.user.company_id) {
    //   where.push("t.company_id = ?");
    //   values.push(req.user.company_id);
    // }

    const total = await CommonModel.getCountsByParameter({
      table: MODULE_TABLE,
      where,
      values,
      join,
      other,
    });

    const orderList = await CommonModel.GetMasterListDetails({
      select,
      table: MODULE_TABLE,
      where,
      values,
      limit: getAll === "Y" ? "" : limit,
      start,
      join,
      other,
    });

    const orderIds = orderList.map((row) => row.order_id).filter(Boolean);
    const aggregateMap = await getPlanningAggregateByOrderIds(orderIds);
    const enrichedList = orderList.map((row) => ({
      ...row,
      total_items: aggregateMap[row.order_id]?.total_items || 0,
      item_total_qty: aggregateMap[row.order_id]?.item_total_qty || 0,
      saipl_qty: aggregateMap[row.order_id]?.saipl_qty || 0,
      pmk_qty: aggregateMap[row.order_id]?.pmk_qty || 0,
      ready_qty: aggregateMap[row.order_id]?.ready_qty || 0,
      dispatched_qty: aggregateMap[row.order_id]?.dispatched_qty || 0,
      pending_qty: aggregateMap[row.order_id]?.pending_qty || row.total_order_qty || 0,
      unplanned_items: aggregateMap[row.order_id]?.unplanned_items || 0,
      planning_status: aggregateMap[row.order_id]?.planning_status || "pending_planning",
    }));

    const filteredList = applyPlanningStatusFilter(enrichedList, status);

    return successResponse(res, {
      code: 1004,
      httpStatus: 200,
      data: {
        data: filteredList,
        pagination: getPaginationMeta({ total, page: currentPage, limit, start }),
      },
    });
  } catch (error) {
    return failureResponse(res, {
      code: 2008,
      httpStatus: 500,
      message: error.message,
    });
  }
};

export const getDetails = async (req, res) => {
  try {
    const { orderId } = req.params;
    if (!orderId) return failureResponse(res, { code: 2004, httpStatus: 404 });

    const where = { order_id: orderId };
    // if (!isSuperAdmin(req.user) && req.user.company_id) {
    //   where.company_id = req.user.company_id;
    // }

    const orderRows = await CommonModel.getMasterDetails(MODULE_TABLE, "*", where);
    const orderDetails = orderRows.find((row) => row.status !== "delete" && ["confirmed", "planned"].includes(row.order_status));
    if (!orderDetails) return failureResponse(res, { code: 2004, httpStatus: 404 });

    const customerRows = orderDetails.customer_id
      ? await CommonModel.getMasterDetails("customer", "name AS customer_name, mobile_no AS customer_mobile, email AS customer_email", { customer_id: orderDetails.customer_id })
      : [];
    const salesPersonRows = orderDetails.sales_person_id
      ? await CommonModel.getMasterDetails("admin", "name AS sales_person_name", { adminID: orderDetails.sales_person_id })
      : [];

    const items = await query(
      `SELECT oi.order_item_id, oi.order_id, oi.company_id, oi.product_id,
              COALESCE(oi.product_code_snapshot, p.product_code) AS product_code,
              COALESCE(oi.product_name_snapshot, p.product_name) AS product_name,
              COALESCE(oi.brand_snapshot, p.brand) AS series,
              p.weight,
              oi.order_qty, oi.unit_rate, oi.line_value,
              COALESCE(p.gst_rate, 18) AS gst_rate,
              COALESCE(pl.saipl_qty, 0) AS saipl_qty,
              COALESCE(pl.pmk_qty, 0) AS pmk_qty,
              COALESCE(pl.planned_qty, 0) AS planned_qty,
              COALESCE(pl.ready_qty, 0) AS ready_qty,
              COALESCE(pl.dispatched_qty, 0) AS dispatched_qty,
              COALESCE(pl.pending_qty, oi.order_qty) AS pending_qty,
              COALESCE(pl.planning_status, 'not_planned') AS planning_status,
              pl.expected_ready_date,
              COALESCE(pl.priority, ?, 'normal') AS priority,
              pl.planning_note
       FROM ${DB_PREFIX}${ORDERS_LINE_TABLE} oi
       LEFT JOIN ${DB_PREFIX}products p ON oi.product_id = p.product_id
       LEFT JOIN ${DB_PREFIX}${PLANNING_TABLE} pl ON oi.order_item_id = pl.order_item_id AND pl.status <> 'delete'
       WHERE oi.order_id = ? AND oi.status <> 'delete'
       ORDER BY oi.order_item_id ASC`,
      [orderDetails.priority, orderId]
    );

    return successResponse(res, {
      code: 1004,
      httpStatus: 200,
      data: {
        data: {
          ...orderDetails,
          ...(customerRows[0] || {}),
          ...(salesPersonRows[0] || {}),
          items,
        },
      },
    });
  } catch (error) {
    return failureResponse(res, { code: 2008, httpStatus: 500, message: error.message });
  }
};

export const getItemDetails = async (req, res) => {
  try {
    const { orderItemId } = req.params;
    if (!orderItemId) return failureResponse(res, { code: 2004, httpStatus: 404 });

    const item = await fetchPlanningTargetItem({ orderItemId, user: req.user });
    if (!item) return failureResponse(res, { code: 2004, httpStatus: 404 });

    const rows = await query(
      `SELECT oi.*, o.order_no, o.order_date, o.expected_delivery_date, o.priority AS order_priority,
              c.name AS customer_name, c.mobile_no AS customer_mobile, c.email AS customer_email,
              p.product_code, p.product_name, p.brand, p.weight, p.standard_rate, p.gst_rate,
              pl.*
       FROM ${DB_PREFIX}${ORDERS_LINE_TABLE} oi
       INNER JOIN ${DB_PREFIX}${MODULE_TABLE} o ON oi.order_id = o.order_id
       LEFT JOIN ${DB_PREFIX}customer c ON o.customer_id = c.customer_id
       LEFT JOIN ${DB_PREFIX}products p ON oi.product_id = p.product_id
       LEFT JOIN ${DB_PREFIX}${PLANNING_TABLE} pl ON oi.order_item_id = pl.order_item_id AND pl.status <> 'delete'
       WHERE oi.order_item_id = ? AND oi.status <> 'delete' AND o.order_status IN ('confirmed','planned')`,
      [orderItemId]
    );

    return successResponse(res, { code: 1004, httpStatus: 200, data: { data: rows[0] } });
  } catch (error) {
    return failureResponse(res, { code: 2008, httpStatus: 500, message: error.message });
  }
};

export const savePlanning = async (req, res) => {
  try {
    const { orderItemId } = req.params;
    if (!orderItemId) return failureResponse(res, { code: 2004, httpStatus: 404 });

    const item = await fetchPlanningTargetItem({ orderItemId, user: req.user });
    if (!item) return failureResponse(res, { code: 2004, httpStatus: 404 });

    const saved = await savePlanningForItem({ item, body: req.body || {}, user: req.user });
    const orderStatus = await updateOrderPlanningStatus({ orderId: item.order_id, user: req.user });
    return successResponse(res, {
      code: 1002,
      httpStatus: 200,
      data: { ...saved, order_status: orderStatus },
      message: "Planning saved successfully",
    });
  } catch (error) {
    return failureResponse(res, {
      code: 2008,
      httpStatus: error.message.includes("cannot be greater") ? 400 : 500,
      message: error.message,
    });
  }
};

export const saveOrderPlanning = async (req, res) => {
  try {
    const { orderId } = req.params;
    const items = Array.isArray(req.body?.items) ? req.body.items : [];

    if (!orderId) return failureResponse(res, { code: 2004, httpStatus: 404 });

    if (!items.length) {
      return failureResponse(res, {
        code: 2001,
        httpStatus: 400,
        message: "At least one planning row is required",
      });
    }

    const savedItems = [];
    let row_index = 0;
    for (const row of items) {
      row_index++;
      const orderItemId = row.order_item_id;
      const item = await fetchPlanningTargetItem({ orderItemId, user: req.user });
      if (!item || Number(item.order_id) !== Number(orderId)) {
        return failureResponse(res, {
          code: 2004,
          httpStatus: 404,
          message: `Order item ${orderItemId} not found for this order at row ${row_index}`,
        });
      }
      savedItems.push(await savePlanningForItem({ item, body: row, user: req.user }));
    }

    const orderStatus = await updateOrderPlanningStatus({ orderId, user: req.user });

    return successResponse(res, {
      code: 1002,
      httpStatus: 200,
      data: { order_id: orderId, order_status: orderStatus, items: savedItems },
      message: "Order planning saved successfully",
    });
  } catch (error) {
    return failureResponse(res, {
      code: 2008,
      httpStatus: error.message.includes("cannot be greater") ? 400 : 500,
      message: error.message,
    });
  }
};

export const changeStatus = async (req, res) => {
  try {
    const { action = "", ids = [] } = req.body || {};

    if (String(action || "").trim().toLowerCase() !== "delete") {
      return failureResponse(res, {
        code: 2000,
        httpStatus: 400,
        message: "Invalid action",
      });
    }

    if (!Array.isArray(ids) || !ids.length) {
      return failureResponse(res, {
        code: 2001,
        httpStatus: 400,
        message: "ids are required",
      });
    }

    const where = { planning_id: ids };
    // if (!isSuperAdmin(req.user) && req.user.company_id) {
    //   where.company_id = req.user.company_id;
    // }

    await CommonModel.updateMasterDetails({
      table: PLANNING_TABLE,
      data: {
        status: "delete",
        modified_by: req.user.adminID,
        modified_date: toMysqlDateTime(),
      },
      where,
    });

    return successResponse(res, {
      code: 1003,
      httpStatus: 200,
      data: [],
    });
  } catch (error) {
    return failureResponse(res, {
      code: 2008,
      httpStatus: 500,
      message: error.message,
    });
  }
};

export const orderDetails = getDetails;
export const details = getItemDetails;


