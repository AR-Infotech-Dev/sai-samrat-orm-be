import * as CommonModel from "#shared/models/common.model.js";
import { query, DB_PREFIX } from "#config/database.js";
import { successResponse, failureResponse } from "#shared/utils/apiResponse.js";
import { prepareFilterData } from "#shared/utils/filter.builder.js";
import { toMysqlDateTime } from "#shared/utils/dateTime.js";
// import { isSuperAdminRole as isSuperAdmin } from "#shared/utils/role.utils.js";
import { env } from "#config/env.js";
import { normalizePayload, validateOrderPayload } from "../shared/order.helper.js";

const MODULE_TABLE = "orders";
const ORDERS_LINE_TABLE = "order_items";
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
export const allowedStatuses = ["draft", "waiting", "confirmed", "planned", "production", "ready", "dispatch", "hold", "cancelled", "completed"];
export const allowedPriorities = ["low", "normal", "high", "urgent"];

export const orderValidationRules = {
  order_id: { label: "Order ID", type: "number" },
  order_no: { label: "Order No" },
  company_id: { label: "Company Id", type: "number" },
  customer_id: { label: "Customer", type: "number", required: true },
  brand: { label: "Brand" },
  order_date: { label: "Order Date", required: true },
  order_month: { label: "Order Month" },
  order_week: { label: "Order Week" },
  sales_person_id: { label: "Sales Person", type: "number" },
  expected_delivery_date: { label: "Expected Delivery Date" },
  order_status: { label: "Order Status" },
  priority: { label: "Priority" },
  total_order_qty: { label: "Total Order Qty", type: "number" },
  total_order_value: { label: "Total Order Value", type: "number" },
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
  await CommonModel.deleteMasterDetails({ table: ORDERS_LINE_TABLE, where: { order_id: orderId } });

  for (const item of items) {
    await CommonModel.saveMasterDetails({
      table: ORDERS_LINE_TABLE,
      data: {
        company_id: companyId,
        order_id: orderId,
        ...item,
        created_by: userId,
        created_date: toMysqlDateTime(),
        status: "active",
      },
    });
  }
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
        searchColumns: ["order_no"],
      },
      default_columns,
      custom_columns,
    });

    const { select, where, values, join, other } = filterData;
    where.push("t.status <> 'delete'");
    other.freeTextSearch = searchText;
    other.searchColumns = ["t.order_no", "t.brand", "cu.name"];
    console.log(join);
    
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
    const { id: order_id = null } = req.params;
    const userId = req.user.adminID;

    switch (method) {
      case "PUT": {
        const { order, items } = normalizePayload(req.body, req.user);
        const payloadError = validateOrderPayload(order, items);
        if (payloadError) {
          return failureResponse(res, { code: 2001, httpStatus: 400, message: payloadError });
        }

        const data = { ...order };
        delete data.order_id;
        data.created_by = userId;
        data.created_date = toMysqlDateTime();

        const result = await CommonModel.saveMasterDetails({ table: MODULE_TABLE, data });
        await saveOrderItems({ orderId: result.insertId, companyId: data.company_id, userId, items });

        return successResponse(res, {
          code: 1001,
          httpStatus: 201,
          data: { insertId: result.insertId, order_id: result.insertId },
          message: "Order created successfully",
        });
      }

      case "POST": {
        if (!order_id) {
          return failureResponse(res, { code: 2004, httpStatus: 404 });
        }

        const { order, items } = normalizePayload(req.body, req.user);
        const payloadError = validateOrderPayload(order, items);
        if (payloadError) {
          return failureResponse(res, { code: 2001, httpStatus: 400, message: payloadError });
        }

        const where = { order_id };
        // if (!isSuperAdmin(req.user) && req.user.company_id) {
        //   where.company_id = req.user.company_id;
        // }

        const data = { ...order };
        delete data.order_id;
        delete data.company_id;
        delete data.created_by;
        delete data.created_date;
        data.modified_by = userId;
        data.modified_date = toMysqlDateTime();

        const result = await CommonModel.updateMasterDetails({ table: MODULE_TABLE, data, where });
        if (!result.affectedRows) {
          return failureResponse(res, { code: 2004, httpStatus: 404 });
        }

        await saveOrderItems({ orderId: order_id, companyId: order.company_id, userId, items });

        return successResponse(res, {
          code: 1002,
          httpStatus: 200,
          data: { order_id },
          message: "Order updated successfully",
        });
      }

      case "GET": {
        if (!order_id) {
          return failureResponse(res, { code: 2004, httpStatus: 404 });
        }

        const where = { order_id };
        // if (!isSuperAdmin(req.user) && req.user.company_id) {
        //   where.company_id = req.user.company_id;
        // }

        const details = await CommonModel.getMasterDetails(MODULE_TABLE, "*", where);
        if (!details.length) {
          return failureResponse(res, { code: 2004, httpStatus: 404 });
        }

        const items = await query(
          `SELECT oi.*, p.product_code, p.product_name, p.brand, p.standard_rate, p.gst_rate, p.weight
           FROM ${DB_PREFIX}${ORDERS_LINE_TABLE} oi
           LEFT JOIN ${DB_PREFIX}products p ON oi.product_id = p.product_id
           WHERE oi.order_id = ? AND oi.status <> 'delete'
           ORDER BY oi.order_item_id ASC`,
          [order_id]
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
    const { id: order_id } = req.params;

    if (!order_id) {
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
    preview['orderDetails'] = await CommonModel.getMasterDetails('orders', '*', { order_id });

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

        FROM ${DB_PREFIX}order_items oi

        LEFT JOIN ${DB_PREFIX}products p
          ON oi.product_id = p.product_id

        WHERE oi.order_id = ?
          AND oi.status <> 'delete'

        ORDER BY oi.order_item_id ASC
      `,
      [order_id]
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

    const where = { order_id: ids };
    // if (!isSuperAdmin(req.user) && req.user.company_id) {
    //   where.company_id = req.user.company_id;
    // }

    const placeholders = ids.map(() => "?").join(",");
    const orderParams = ["delete", req.user.adminID, toMysqlDateTime(), ...ids];
    let orderSql = `UPDATE ${DB_PREFIX}${MODULE_TABLE} SET status = ?, modified_by = ?, modified_date = ? WHERE order_id IN (${placeholders})`;

    // if (!isSuperAdmin(req.user) && req.user.company_id) {
    //   orderSql += " AND company_id = ?";
    //   orderParams.push(req.user.company_id);
    // }

    await query(orderSql, orderParams);

    await query(
      `UPDATE ${DB_PREFIX}${ORDERS_LINE_TABLE} SET status = ?, modified_by = ?, modified_date = ? WHERE order_id IN (${placeholders})`,
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







