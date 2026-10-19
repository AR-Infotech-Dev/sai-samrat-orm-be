import * as CommonModel from "#shared/models/common.model.js";
import { query, DB_PREFIX } from "#config/database.js";
import { successResponse, failureResponse } from "#shared/utils/apiResponse.js";
import { prepareFilterData } from "#shared/utils/filter.builder.js";
import { toMysqlDateTime } from "#shared/utils/dateTime.js";
// import { isSuperAdminRole as isSuperAdmin } from "#shared/utils/role.utils.js";
import { env } from "#config/env.js";
import { normalizePayload, validateOrderPayload } from "../shared/order.helper.js";

const MODULE_TABLE = "production_notes";
const ORDERS_LINE_TABLE = "production_note_items";

import { buildProductionNoteNumber } from "../shared/production-note-number.js";
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
  company_id: {
    table: "company_master",
    alias: "dc",
    column: "company_name",
    key2: "company_id",
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
export const allowedStatuses = ["draft", "waiting", "confirmed", "planned", "production", "ready", "dispatch", "hold", "cancelled", "completed"];
export const allowedPriorities = ["low", "normal", "high", "urgent"];

export const orderValidationRules = {
  production_note_id: { label: "Order ID", type: "number" },
  production_note_no: { label: "Order No" },
  company_id: { label: "Company Id", type: "number" },
  customer_id: { label: "Customer", type: "number", required: true },
  brand: { label: "Brand" },
  pi_number: { label: "PI number" },
  pi_id: { label: "PI ID", type: "number" },
  production_note_date: { label: "Order Date", required: true },
  order_type: { label: "Order Type", required: true },
  production_note_month: { label: "Order Month" },
  production_note_week: { label: "Order Week" },
  expected_delivery_date: { label: "Expected Delivery Date" },
  production_note_status: { label: "Order Status" },
  priority: { label: "Priority" },
  total_production_note_qty: { label: "Total Order Qty", type: "number" },
  total_production_note_value: { label: "Total Order Value", type: "number" },
  currency: { label: "Currency" },
  exchange_rate: { label: "Exchange Rate", type: "number" },
  total_value_in_inr: { label: "Total Value In INR", type: "number" },
  source: { label: "Source" },
  excel_row_no: { label: "Excel Row No", type: "number" },
  remarks: { label: "Remarks" },
  status: { label: "Status" },
  created_by: { label: "Created By", type: "number" },
  modified_by: { label: "Modified By", type: "number" },
};

const saveOrderItems = async ({ orderId, companyId, userId, items }) => {
  await CommonModel.deleteMasterDetails({ table: ORDERS_LINE_TABLE, where: { production_note_id: orderId } });

  for (const item of items) {
    // update pi_item booked_qty
    if (item.pi_item_id) {
      await query(
        `UPDATE ${DB_PREFIX}proforma_invoice_items 
         SET booked_qty = (
           SELECT COALESCE(SUM(production_note_qty), 0) + ? 
           FROM ${DB_PREFIX}${ORDERS_LINE_TABLE} 
           WHERE pi_item_id = ? AND status <> 'delete' AND production_note_id <> ?
         ) 
         WHERE pi_item_id = ?`,
        [Number(item.production_note_qty || 0), item.pi_item_id, orderId, item.pi_item_id]
      );
    }
    await CommonModel.saveMasterDetails({
      table: ORDERS_LINE_TABLE,
      data: {
        company_id: companyId,
        production_note_id: orderId,
        ...item,
        created_by: userId,
        created_date: toMysqlDateTime(),
        status: "active",
      },
    });
  }
};

const validatePiItemAvailability = async ({ orderId = 0, items = [] }) => {
  const piItemTotals = new Map();
  items.forEach((item) => {
    if (!item.pi_item_id) return;
    const key = Number(item.pi_item_id);
    piItemTotals.set(key, (piItemTotals.get(key) || 0) + Number(item.production_note_qty || 0));
  });

  for (const [piItemId, requestedQty] of piItemTotals.entries()) {
    const rows = await query(
      `SELECT pii.qty,
              COALESCE((
                SELECT SUM(oi.production_note_qty)
                FROM ${DB_PREFIX}${ORDERS_LINE_TABLE} oi
                WHERE oi.pi_item_id = pii.pi_item_id
                  AND oi.status <> 'delete'
                  AND oi.production_note_id <> ?
              ), 0) AS other_booked_qty
       FROM ${DB_PREFIX}proforma_invoice_items pii
       WHERE pii.pi_item_id = ? AND pii.status <> 'delete'
       LIMIT 1`,
      [orderId || 0, piItemId]
    );

    if (!rows.length) {
      return "Selected PI item not found";
    }

    const availableQty = Number(rows[0].qty || 0) - Number(rows[0].other_booked_qty || 0);
    if (requestedQty > availableQty) {
      return `PI remaining qty is ${availableQty}. Please enter ${availableQty} or less.`;
    }
  }

  return "";
};

export const list = async (req, res) => {
  try {
    const { page = 1, searchText = "", getAll = "N", orderBy = "created_date", order = "DESC", filters = [], } = req.body;
    const limit = env.perPage;
    const currentPage = Number(page) || 1;
    const start = (currentPage - 1) * limit;
    const filterData = prepareFilterData({
      filters,
      searchText,
      other: {
        orderBy,
        order,
        searchColumns: [],
      },
      default_columns,
      custom_columns,
    });

    const { select, where, values, join, other } = filterData;
    where.push("t.status <> 'delete'");
    other.freeTextSearch = searchText;
    other.searchColumns = ["t.production_note_no","t.production_code", "t.brand",];
    
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

    const totalPages = Math.ceil(total / limit);
    const end = Math.min(start + limit, total);

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

    return successResponse(res, {
      code: 1004,
      httpStatus: 200,
      data: {
        data: orderList,
        pagination: {
          total,
          page: currentPage,
          limit,
          totalPages,
          start: total === 0 ? 0 : start + 1,
          end,
        },
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

export const getOrderDetails = async (req, res) => {
  try {
    const method = req.method.toUpperCase();
    const { id: production_note_id = null } = req.params;
    const userId = req.user.adminID;

    switch (method) {
      case "PUT": {
        const { order, items } = await normalizePayload(req.body, req.user);
        const payloadError = validateOrderPayload(order, items);
        if (payloadError) {
          return failureResponse(res, { code: 2001, httpStatus: 400, message: payloadError });
        }
        const piItemError = await validatePiItemAvailability({ orderId: 0, items });
        if (piItemError) {
          return failureResponse(res, { code: 2001, httpStatus: 400, message: piItemError });
        }

        const data = { ...order };
        delete data.production_note_id;
        data.created_by = userId;
        data.created_date = toMysqlDateTime();

        const result = await CommonModel.saveMasterDetails({ table: MODULE_TABLE, data });
        const productionNoteNo = buildProductionNoteNumber(result.insertId, data.created_date);
        await CommonModel.updateMasterDetails({
          table: MODULE_TABLE,
          data: { production_note_no: productionNoteNo },
          where: { production_note_id: result.insertId },
        });
        await saveOrderItems({ orderId: result.insertId, companyId: data.company_id, userId, items });

        return successResponse(res, {
          code: 1001,
          httpStatus: 201,
          data: { insertId: result.insertId, production_note_id: result.insertId },
          message: "Order created successfully",
        });
      }

      case "POST": {
        if (!production_note_id) {
          return failureResponse(res, { code: 2004, httpStatus: 404 });
        }

        const { order, items } = await normalizePayload(req.body, req.user);
        const payloadError = validateOrderPayload(order, items);
        if (payloadError) {
          return failureResponse(res, { code: 2001, httpStatus: 400, message: payloadError });
        }
        const piItemError = await validatePiItemAvailability({ orderId: production_note_id, items });
        if (piItemError) {
          return failureResponse(res, { code: 2001, httpStatus: 400, message: piItemError });
        }

        const where = { production_note_id };
        const existingNotes = await CommonModel.getMasterDetails(MODULE_TABLE, "production_note_no, created_date, production_note_date", where);
        if (!existingNotes.length) {
          return failureResponse(res, { code: 2004, httpStatus: 404 });
        }
        order.production_note_no = /^SAIPL\/PN\/\d{2}-\d{2}\/\d+$/.test(existingNotes[0].production_note_no || "")
          ? existingNotes[0].production_note_no
          : buildProductionNoteNumber(production_note_id, existingNotes[0].created_date || existingNotes[0].production_note_date);
        // if (!isSuperAdmin(req.user) && req.user.company_id) {
        //   where.company_id = req.user.company_id;
        // }

        const data = { ...order };
        delete data.production_note_id;
        delete data.company_id;
        delete data.created_by;
        delete data.created_date;
        data.modified_by = userId;
        data.modified_date = toMysqlDateTime();

        const result = await CommonModel.updateMasterDetails({ table: MODULE_TABLE, data, where });
        if (!result.affectedRows) {
          return failureResponse(res, { code: 2004, httpStatus: 404 });
        }

        await saveOrderItems({ orderId: production_note_id, companyId: order.company_id, userId, items });

        return successResponse(res, {
          code: 1002,
          httpStatus: 200,
          data: { production_note_id },
          message: "Order updated successfully",
        });
      }

      case "GET": {
        if (!production_note_id) {
          return failureResponse(res, { code: 2004, httpStatus: 404 });
        }

        const where = { production_note_id };
        // if (!isSuperAdmin(req.user) && req.user.company_id) {
        //   where.company_id = req.user.company_id;
        // }

        const details = await query(
          `SELECT oi.*, c.cat_color as production_note_status_color
           FROM ${DB_PREFIX}${MODULE_TABLE} oi
           LEFT JOIN ${DB_PREFIX}categories c ON oi.production_note_status = c.slug
           WHERE oi.production_note_id = ?`,
          [production_note_id]
        );
        if (!details.length) {
          return failureResponse(res, { code: 2004, httpStatus: 404 });
        }
        const items = await query(
          `SELECT oi.*, p.product_code, p.product_name, p.brand, p.standard_rate, p.gst_rate, p.weight
           FROM ${DB_PREFIX}${ORDERS_LINE_TABLE} oi
           LEFT JOIN ${DB_PREFIX}products p ON oi.product_id = p.product_id
           WHERE oi.production_note_id = ? AND oi.status <> 'delete'
           ORDER BY oi.production_note_item_id ASC`,
          [production_note_id]
        );

        return successResponse(res, {
          code: 1004,
          httpStatus: 200,
          data: { data: { ...details[0], items } },
        });
      }

      default:
        return failureResponse(res, { code: 2000, httpStatus: 405 });
    }
  } catch (error) {
    return failureResponse(res, {
      code: 2008,
      httpStatus: 500,
      message: error.message,
    });
  }
};

// **********************************************************

export const preview = async (req, res) => {
  try {
    const { id: production_note_id } = req.params;

    if (!production_note_id) {
      return failureResponse(res, {
        code: 2004,
        httpStatus: 404,
        message: "Order ID is required",
      });
    }

    // =========================
    // ORDER + COMPANY
    // =========================
    const preview = {
      orderDetails: {}
    };
    preview['orderDetails'] = await CommonModel.getMasterDetails('production_notes', '*', { production_note_id });

    if (!preview['orderDetails'].length) {
      return failureResponse(res, {
        code: 2004,
        httpStatus: 404,
        message: "Order not found",
      });
    }


const customerId = preview.orderDetails[0].customer_id;

if (customerId) {
  const customerDetails = await query(
    `
      SELECT
        customer_id,
        name,
        mobile_no,
        email
      FROM ${DB_PREFIX}customer
      WHERE customer_id = ?
      LIMIT 1
    `,
    [customerId]
  );

  if (customerDetails.length) {
    preview.orderDetails[0].customer_name = customerDetails[0].name;
    preview.orderDetails[0].customer_mobile = customerDetails[0].mobile_no;
    preview.orderDetails[0].customer_email = customerDetails[0].email;
  }
}


    // =========================
    // ORDER ITEMS
    // =========================

    const items = await query(
      `
        SELECT
          oi.*,
          p.product_code,
          p.product_name,
          p.brand,
          p.standard_rate,
          p.gst_rate,
          p.weight

        FROM ${DB_PREFIX}production_note_items oi

        LEFT JOIN ${DB_PREFIX}products p
          ON oi.product_id = p.product_id

        WHERE oi.production_note_id = ?
          AND oi.status <> 'delete'

        ORDER BY oi.production_note_item_id ASC
      `,
      [production_note_id]
    );

    // =========================
    // RESPONSE
    // =========================

    return successResponse(res, {
      code: 1004,
      httpStatus: 200,
      data: {
        data: {
          ...preview,
          items,
        },
      },
       
    });

  } catch (error) {
    console.error("Preview Order Error:", error);

    return failureResponse(res, {
      code: 2008,
      httpStatus: 500,
      message: error.message,
    });
  }
};



// *********************************************************

export const changeStatus = async (req, res) => {
  try {
    const { action = "", ids = [] } = req.body;

    if (action.trim().toLowerCase() !== "delete") {
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

    const where = { production_note_id: ids };
    // if (!isSuperAdmin(req.user) && req.user.company_id) {
    //   where.company_id = req.user.company_id;
    // }

    const placeholders = ids.map(() => "?").join(",");
    const orderParams = ["delete", req.user.adminID, toMysqlDateTime(), ...ids];
    let orderSql = `UPDATE ${DB_PREFIX}${MODULE_TABLE} SET status = ?, modified_by = ?, modified_date = ? WHERE production_note_id IN (${placeholders})`;

    // if (!isSuperAdmin(req.user) && req.user.company_id) {
    //   orderSql += " AND company_id = ?";
    //   orderParams.push(req.user.company_id);
    // }

    await query(orderSql, orderParams);

    await query(
      `UPDATE ${DB_PREFIX}${ORDERS_LINE_TABLE} SET status = ?, modified_by = ?, modified_date = ? WHERE production_note_id IN (${placeholders})`,
      ["delete", req.user.adminID, toMysqlDateTime(), ...ids]
    );

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






