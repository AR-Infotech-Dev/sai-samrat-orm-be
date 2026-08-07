import * as CommonModel from "#shared/models/common.model.js";
import { query, DB_PREFIX } from "#config/database.js";
import { successResponse, failureResponse } from "#shared/utils/apiResponse.js";
import { prepareFilterData } from "#shared/utils/filter.builder.js";
import { toMysqlDateTime } from "#shared/utils/dateTime.js";
// import { isSuperAdminRole as isSuperAdmin } from "#shared/utils/role.utils.js";
import { env } from "#config/env.js";

const ORDERS_TABLE = "orders";
const ORDER_ITEMS_TABLE = "order_items";
const PLANNING_TABLE = "order_item_planning";
const PRODUCTION_TABLE = "order_item_production";
const DISPATCH_TABLE = "dispatches";
const DISPATCH_ITEMS_TABLE = "dispatch_items";
const DISPATCH_HISTORY_TABLE = "dispatch_history";

const default_columns = {};
const custom_columns = {
  order_id: { table: "orders", alias: "o", column: "order_no", key2: "order_id", select: "o.order_status AS order_status, o.priority AS priority, o.expected_delivery_date AS expected_delivery_date" },
  customer_id: { table: "customer", alias: "cu", column: "name", key2: "customer_id", select: "cu.mobile_no AS customer_mobile, cu.email AS customer_email" },
  dispatch_status: { table: "categories", alias: "cds", column: "categoryName", key2: "slug", select: "cds.cat_color as dispatch_status_color" },
};

const toNumber = (value, fallback = 0) => {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : fallback;
};

const normalizeStatus = (value, fallback = "dispatched") => {
  const normalized = String(value || "").toLowerCase().trim().replace(/\s+/g, "_");
  return ["draft", "partial", "dispatched", "cancelled"].includes(normalized) ? normalized : fallback;
};

const cleanData = (data = {}) => Object.fromEntries(
  Object.entries(data).map(([key, value]) => [key, value === undefined ? null : value])
);

const getPaginationMeta = ({ total, page, limit, start }) => ({
  total,
  page,
  limit,
  totalPages: Math.ceil(total / limit),
  start: total === 0 ? 0 : start + 1,
  end: Math.min(start + limit, total),
});

const generateDispatchNo = () => {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  return `DSP-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
};

const getOrderScopeWhere = (user, alias = "o") => {
  const where = [`${alias}.status <> 'delete'`];
  const values = [];
  // if (!isSuperAdmin(user) && user?.company_id) {
  //   where.push(`${alias}.company_id = ?`);
  //   values.push(user.company_id);
  // }
  return { where, values };
};

const getDispatchedQtyByOrderItemIds = async (orderItemIds = []) => {
  if (!orderItemIds.length) return {};
  const placeholders = orderItemIds.map(() => "?").join(",");
  const rows = await query(
    `SELECT di.order_item_id, COALESCE(SUM(di.dispatch_qty), 0) AS dispatched_qty
     FROM ${DB_PREFIX}${DISPATCH_ITEMS_TABLE} di
     INNER JOIN ${DB_PREFIX}${DISPATCH_TABLE} d ON di.dispatch_id = d.dispatch_id
     WHERE di.status <> 'delete' AND d.status <> 'delete' AND d.dispatch_status <> 'cancelled'
       AND di.order_item_id IN (${placeholders})
     GROUP BY di.order_item_id`,
    orderItemIds
  );
  return rows.reduce((acc, row) => {
    acc[row.order_item_id] = toNumber(row.dispatched_qty);
    return acc;
  }, {});
};

const getReadyOrderItems = async ({ orderId, user }) => {
  const { where, values } = getOrderScopeWhere(user, "o");
  where.push("o.order_id = ?");
  where.push("o.order_status IN ('production','ready','dispatch')");
  values.push(orderId);

  const rows = await query(
    `SELECT oi.order_item_id, oi.order_id, oi.company_id, oi.product_id,
            COALESCE(oi.product_code_snapshot, p.product_code) AS product_code,
            COALESCE(oi.product_name_snapshot, p.product_name) AS product_name,
            COALESCE(oi.brand_snapshot, p.brand) AS series,
            p.weight, oi.order_qty, oi.unit_rate, oi.line_value,
            COALESCE(pl.ready_qty, 0) AS planning_ready_qty,
            COALESCE(pr.qc_passed_qty, 0) AS qc_passed_qty,
            COALESCE(pr.procured_qty, 0) AS procured_qty,
            COALESCE(COALESCE(pl.ready_qty, 0) + COALESCE(pr.qc_passed_qty, 0) + COALESCE(pr.procured_qty, 0), 0) AS total_ready_qty
     FROM ${DB_PREFIX}${ORDER_ITEMS_TABLE} oi
     INNER JOIN ${DB_PREFIX}${ORDERS_TABLE} o ON oi.order_id = o.order_id
     LEFT JOIN ${DB_PREFIX}products p ON oi.product_id = p.product_id
     LEFT JOIN ${DB_PREFIX}${PLANNING_TABLE} pl ON oi.order_item_id = pl.order_item_id AND pl.status <> 'delete'
     LEFT JOIN ${DB_PREFIX}${PRODUCTION_TABLE} pr ON oi.order_item_id = pr.order_item_id AND pr.status <> 'delete'
     WHERE oi.status <> 'delete' AND ${where.join(" AND ")}
     ORDER BY oi.order_item_id ASC`,
    values
  );

  const dispatchedMap = await getDispatchedQtyByOrderItemIds(rows.map((row) => row.order_item_id));
  return rows.map((row) => {
    const dispatchedQty = dispatchedMap[row.order_item_id] || 0;
    const availableQty = Math.max(toNumber(row.total_ready_qty) - dispatchedQty, 0);
    return {
      ...row,
      dispatched_qty: dispatchedQty,
      available_dispatch_qty: availableQty,
      pending_qty: Math.max(toNumber(row.order_qty) - toNumber(row.total_ready_qty), 0),
    };
  });
};

const updateOrderStatusAfterDispatch = async ({ orderId, user }) => {
  const { where, values } = getOrderScopeWhere(user, "o");
  where.push("o.order_id = ?");
  values.push(orderId);

  const rows = await query(
    `SELECT oi.order_qty, COALESCE(SUM(CASE WHEN d.dispatch_status <> 'cancelled' AND d.status <> 'delete' AND di.status <> 'delete' THEN di.dispatch_qty ELSE 0 END), 0) AS dispatched_qty
     FROM ${DB_PREFIX}${ORDER_ITEMS_TABLE} oi
     INNER JOIN ${DB_PREFIX}${ORDERS_TABLE} o ON oi.order_id = o.order_id
     LEFT JOIN ${DB_PREFIX}${DISPATCH_ITEMS_TABLE} di ON oi.order_item_id = di.order_item_id
     LEFT JOIN ${DB_PREFIX}${DISPATCH_TABLE} d ON di.dispatch_id = d.dispatch_id
     WHERE oi.status <> 'delete' AND ${where.join(" AND ")}
     GROUP BY oi.order_item_id, oi.order_qty`,
    values
  );

  if (!rows.length) return "ready";
  const totalOrderQty = rows.reduce((sum, row) => sum + toNumber(row.order_qty), 0);
  const totalDispatchedQty = rows.reduce((sum, row) => sum + toNumber(row.dispatched_qty), 0);
  const nextStatus = totalOrderQty > 0 && totalDispatchedQty >= totalOrderQty ? "completed" : totalDispatchedQty > 0 ? "dispatch" : "ready";

  const orderWhere = { order_id: orderId };
  // if (!isSuperAdmin(user) && user?.company_id) orderWhere.company_id = user.company_id;

  await CommonModel.updateMasterDetails({
    table: ORDERS_TABLE,
    data: cleanData({ order_status: nextStatus, modified_by: user.adminID || null, modified_date: toMysqlDateTime() }),
    where: orderWhere,
  });

  return nextStatus;
};

export const list = async (req, res) => {
  try {
    const { page = 1, searchText = "", getAll = "N", orderBy = "dispatch_date", order = "DESC", filters = [] } = req.body || {};
    const limit = env.perPage;
    const currentPage = Number(page) || 1;
    const start = (currentPage - 1) * limit;

    const filterData = prepareFilterData({
      filters,
      searchText,
      other: { orderBy, order, searchColumns: ["dispatch_no"] },
      default_columns,
      custom_columns,
    });

    const { select, where, values, join, other } = filterData;
    where.push("t.status <> 'delete'");
    other.freeTextSearch = searchText;
    other.searchColumns = ["t.dispatch_no", "o.order_no", "cu.name", "t.transporter_name", "t.vehicle_no", "t.invoice_no"];

    // if (!isSuperAdmin(req.user) && req.user.company_id) {
    //   where.push("t.company_id = ?");
    //   values.push(req.user.company_id);
    // }

    const total = await CommonModel.getCountsByParameter({ table: DISPATCH_TABLE, where, values, join, other });
    const dispatchList = await CommonModel.GetMasterListDetails({ select, table: DISPATCH_TABLE, where, values, limit: getAll === "Y" ? "" : limit, start, join, other });

    const dispatchIds = dispatchList.map((row) => row.dispatch_id).filter(Boolean);
    let itemTotals = {};
    if (dispatchIds.length) {
      const placeholders = dispatchIds.map(() => "?").join(",");
      const rows = await query(
        `SELECT dispatch_id, COALESCE(COUNT(dispatch_item_id),0) AS total_items, COALESCE(SUM(dispatch_qty),0) AS total_dispatch_qty
         FROM ${DB_PREFIX}${DISPATCH_ITEMS_TABLE}
         WHERE status <> 'delete' AND dispatch_id IN (${placeholders})
         GROUP BY dispatch_id`,
        dispatchIds
      );
      itemTotals = rows.reduce((acc, row) => {
        acc[row.dispatch_id] = row;
        return acc;
      }, {});
    }

    const rows = dispatchList.map((row) => ({
      ...row,
      total_items: itemTotals[row.dispatch_id]?.total_items || 0,
      total_dispatch_qty: itemTotals[row.dispatch_id]?.total_dispatch_qty || 0,
    }));

    return successResponse(res, { code: 1004, httpStatus: 200, data: { data: rows, pagination: getPaginationMeta({ total, page: currentPage, limit, start }) } });
  } catch (error) {
    return failureResponse(res, { code: 2008, httpStatus: 500, message: error.message });
  }
};

export const getReadyOrder = async (req, res) => {
  try {
    const { orderId } = req.params;
    const orderWhere = { order_id: orderId };
    // if (!isSuperAdmin(req.user) && req.user.company_id) orderWhere.company_id = req.user.company_id;
    const orderRows = await CommonModel.getMasterDetails(ORDERS_TABLE, "*", orderWhere);
    const orderDetails = orderRows.find((row) => row.status !== "delete" && ["production", "ready", "dispatch"].includes(row.order_status));
    if (!orderDetails) return failureResponse(res, { code: 2004, httpStatus: 404, message: "Ready order not found" });

    const customerRows = orderDetails.customer_id ? await CommonModel.getMasterDetails("customer", "name AS customer_name, mobile_no AS customer_mobile, email AS customer_email", { customer_id: orderDetails.customer_id }) : [];
    const items = await getReadyOrderItems({ orderId, user: req.user });
    return successResponse(res, { code: 1004, httpStatus: 200, data: { data: { ...orderDetails, ...(customerRows[0] || {}), items } } });
  } catch (error) {
    return failureResponse(res, { code: 2008, httpStatus: 500, message: error.message });
  }
};

export const details = async (req, res) => {
  try {
    const { dispatchId } = req.params;
    const where = { dispatch_id: dispatchId };
    // if (!isSuperAdmin(req.user) && req.user.company_id) where.company_id = req.user.company_id;
    const dispatchRows = await CommonModel.getMasterDetails(DISPATCH_TABLE, "*", where);
    const dispatchDetails = dispatchRows.find((row) => row.status !== "delete");
    if (!dispatchDetails) return failureResponse(res, { code: 2004, httpStatus: 404, message: "Dispatch not found" });

    const orderRows = await CommonModel.getMasterDetails(ORDERS_TABLE, "order_no, order_status, total_value_in_inr, expected_delivery_date", { order_id: dispatchDetails.order_id });
    const customerRows = dispatchDetails.customer_id ? await CommonModel.getMasterDetails("customer", "name AS customer_name, mobile_no AS customer_mobile, email AS customer_email", { customer_id: dispatchDetails.customer_id }) : [];
    const items = await query(
      `SELECT di.*, COALESCE(oi.product_name_snapshot, p.product_name) AS product_name,
              COALESCE(oi.product_code_snapshot, p.product_code) AS product_code,
              COALESCE(oi.brand_snapshot, p.brand) AS series,
              p.weight, oi.order_qty
       FROM ${DB_PREFIX}${DISPATCH_ITEMS_TABLE} di
       INNER JOIN ${DB_PREFIX}${ORDER_ITEMS_TABLE} oi ON di.order_item_id = oi.order_item_id
       LEFT JOIN ${DB_PREFIX}products p ON oi.product_id = p.product_id
       WHERE di.dispatch_id = ? AND di.status <> 'delete'
       ORDER BY di.dispatch_item_id ASC`,
      [dispatchId]
    );

    return successResponse(res, { code: 1004, httpStatus: 200, data: { data: { ...dispatchDetails, ...(orderRows[0] || {}), ...(customerRows[0] || {}), items } } });
  } catch (error) {
    return failureResponse(res, { code: 2008, httpStatus: 500, message: error.message });
  }
};

export const save = async (req, res) => {
  try {
    const dispatchId = req.params.dispatchId || null;
    const body = req.body || {};
    const orderId = body.order_id;
    const items = Array.isArray(body.items) ? body.items : [];
    if (!orderId) return failureResponse(res, { code: 2001, httpStatus: 400, message: "Order is required" });
    if (!items.length) return failureResponse(res, { code: 2001, httpStatus: 400, message: "At least one dispatch item is required" });

    const readyItems = await getReadyOrderItems({ orderId, user: req.user });
    const readyMap = readyItems.reduce((acc, item) => {
      acc[item.order_item_id] = item;
      return acc;
    }, {});

    const dispatchItems = [];
    let totalDispatchQty = 0;
    for (const row of items) {
      const readyItem = readyMap[row.order_item_id];
      if (!readyItem) return failureResponse(res, { code: 2004, httpStatus: 404, message: `Order item ${row.order_item_id} not found` });
      const dispatchQty = toNumber(row.dispatch_qty);
      if (dispatchQty < 0) return failureResponse(res, { code: 2001, httpStatus: 400, message: `${readyItem.product_name}: Dispatch qty negative.` });
      if (dispatchQty > toNumber(readyItem.available_dispatch_qty)) return failureResponse(res, { code: 2001, httpStatus: 400, message: `${readyItem.product_name}: Dispatch qty available qty .` });
      if (dispatchQty > 0) {
        totalDispatchQty += dispatchQty;
        dispatchItems.push({ readyItem, dispatchQty, remarks: row.remarks || null });
      }
    }

    if (totalDispatchQty <= 0) return failureResponse(res, { code: 2001, httpStatus: 400, message: "At least one dispatch qty should be greater than 0" });

    const dispatchStatus = normalizeStatus(body.dispatch_status, "dispatched");
    const now = toMysqlDateTime();
    const companyId = req.user.company_id || readyItems[0]?.company_id || body.company_id;
    const orderRows = await CommonModel.getMasterDetails(ORDERS_TABLE, "customer_id", { order_id: orderId });
    const customerId = body.customer_id || orderRows[0]?.customer_id;

    let savedDispatchId = dispatchId;
    const headerData = {
      company_id: companyId,
      order_id: orderId,
      customer_id: customerId,
      dispatch_no: body.dispatch_no || generateDispatchNo(),
      dispatch_date: body.dispatch_date || now.slice(0, 10),
      transporter_name: body.transporter_name || null,
      vehicle_no: body.vehicle_no || null,
      driver_name: body.driver_name || null,
      driver_mobile: body.driver_mobile || null,
      lr_no: body.lr_no || null,
      invoice_no: body.invoice_no || null,
      dispatch_status: dispatchStatus,
      remarks: body.remarks || null,
    };

    if (savedDispatchId) {
      const where = { dispatch_id: savedDispatchId };
      // if (!isSuperAdmin(req.user) && req.user.company_id) where.company_id = req.user.company_id;
      await CommonModel.updateMasterDetails({ table: DISPATCH_TABLE, data: cleanData({ ...headerData, modified_by: req.user.adminID || null, modified_date: now }), where });
      await CommonModel.deleteMasterDetails({ table: DISPATCH_ITEMS_TABLE, where: { dispatch_id: savedDispatchId } });
    } else {
      const result = await CommonModel.saveMasterDetails({ table: DISPATCH_TABLE, data: cleanData({ ...headerData, created_by: req.user.adminID || null, created_date: now, status: "active" }) });
      savedDispatchId = result.insertId;
    }

    for (const item of dispatchItems) {
      const pendingAfterDispatch = Math.max(toNumber(item.readyItem.available_dispatch_qty) - item.dispatchQty, 0);
      await CommonModel.saveMasterDetails({
        table: DISPATCH_ITEMS_TABLE,
        data: cleanData({
          company_id: companyId,
          dispatch_id: savedDispatchId,
          order_id: orderId,
          order_item_id: item.readyItem.order_item_id,
          product_id: item.readyItem.product_id,
          ready_qty: item.readyItem.total_ready_qty,
          already_dispatched_qty: item.readyItem.dispatched_qty,
          available_qty: item.readyItem.available_dispatch_qty,
          dispatch_qty: item.dispatchQty,
          pending_after_dispatch_qty: pendingAfterDispatch,
          remarks: item.remarks,
          created_by: req.user.adminID || null,
          created_date: now,
          status: "active",
        }),
      });
    }

    await CommonModel.saveMasterDetails({
      table: DISPATCH_HISTORY_TABLE,
      data: cleanData({ company_id: companyId, dispatch_id: savedDispatchId, order_id: orderId, old_status: null, new_status: dispatchStatus, changed_by: req.user.adminID || null, changed_at: now, note: body.remarks || null }),
    });

    const orderStatus = await updateOrderStatusAfterDispatch({ orderId, user: req.user });
    return successResponse(res, { code: 1002, httpStatus: 200, data: { dispatch_id: savedDispatchId, order_id: orderId, order_status: orderStatus }, message: "Dispatch saved successfully" });
  } catch (error) {
    return failureResponse(res, { code: 2008, httpStatus: 500, message: error.message });
  }
};


