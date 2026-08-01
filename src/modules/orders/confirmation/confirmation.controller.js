import * as CommonModel from "#shared/models/common.model.js";
import { query, DB_PREFIX } from "#config/database.js";
import { successResponse, failureResponse } from "#shared/utils/apiResponse.js";
import { prepareFilterData } from "#shared/utils/filter.builder.js";
import { toMysqlDateTime } from "#shared/utils/dateTime.js";
// import { isSuperAdminRole as isSuperAdmin } from "#shared/utils/role.utils.js";
import { env } from "#config/env.js";

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

export const allowedConfirmationStatuses = ["waiting", "hold"];
export const allowedConfirmationActions = ["confirm", "hold", "send_back", "send-back"];

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

const getActionConfig = (action = "") => {
  const normalizedAction = String(action || "").trim().toLowerCase().replace(/-/g, "_");

  const actionMap = {
    confirm: {
      nextStatus: "confirmed",
      message: "Order confirmed successfully",
      requireReason: false,
    },
    hold: {
      nextStatus: "hold",
      message: "Order put on hold",
      requireReason: true,
    },
    send_back: {
      nextStatus: "draft",
      message: "Order sent back to sales",
      requireReason: true,
    },
  };

  return actionMap[normalizedAction] || null;
};

const buildActionRemarks = ({ currentRemarks = "", nextStatus, remarks = "" }) => {
  const note = String(remarks || "").trim();
  if (!note) return currentRemarks || "";
  return `${currentRemarks || ""}\n[${String(nextStatus).toUpperCase()} ${toMysqlDateTime()}] ${note}`.trim();
};

const getOrderItems = async (orderId) => {
  return query(
    `SELECT oi.*, p.product_code, p.product_name, p.brand, p.standard_rate, p.gst_rate, p.weight
     FROM ${DB_PREFIX}${ORDERS_LINE_TABLE} oi
     LEFT JOIN ${DB_PREFIX}products p ON oi.product_id = p.product_id
     WHERE oi.order_id = ? AND oi.status <> 'delete'
     ORDER BY oi.order_item_id ASC`,
    [orderId]
  );
};

const updateOrderStatus = async ({ req, res, action, ids, remarks }) => {

  const actionConfig = getActionConfig(action);

  if (!actionConfig) {
    return failureResponse(res, {
      code: 2000,
      httpStatus: 400,
      message: "Invalid action",
    });
  }

  const orderIds = Array.isArray(ids) && ids.length ? ids : req.params?.id ? [req.params.id] : [];
  if (!orderIds.length) {
    return failureResponse(res, {
      code: 2001,
      httpStatus: 400,
      message: "ids are required",
    });
  }

  if (actionConfig.requireReason && !String(remarks || "").trim()) {
    return failureResponse(res, {
      code: 2001,
      httpStatus: 400,
      message: "Reason is required",
    });
  }

  const where = { order_id: orderIds[0] };
  const existingOrders = await CommonModel.getMasterDetails(MODULE_TABLE, "order_id, order_status, remarks", where);
  if (!existingOrders.length) {
    return failureResponse(res, { code: 2004, httpStatus: 404 });
  }

  const invalidOrder = existingOrders.find((order) => !allowedConfirmationStatuses.includes(order.order_status));
  if (invalidOrder) {
    return failureResponse(res, {
      code: 2001,
      httpStatus: 400,
      message: "Only waiting/hold orders can be processed from confirmation",
    });
  }

  for (const order of existingOrders) {
    const data = {
      order_status: actionConfig.nextStatus,
      remarks: buildActionRemarks({
        currentRemarks: order.remarks,
        nextStatus: actionConfig.nextStatus,
        remarks,
      }),
      modified_by: req.user.adminID,
      modified_date: toMysqlDateTime(),
    };

    const updateWhere = { order_id: order.order_id };
    // if (!isSuperAdmin(req.user) && req.user.company_id) {
    //   updateWhere.company_id = req.user.company_id;
    // }

    await CommonModel.updateMasterDetails({ table: MODULE_TABLE, data, where: updateWhere });
  }

  return successResponse(res, {
    code: 1002,
    httpStatus: 200,
    data: { ids: existingOrders.map((order) => order.order_id), order_status: actionConfig.nextStatus },
    message: actionConfig.message,
  });
};

export const list = async (req, res) => {
  try {
    const { page = 1, searchText = "", getAll = "N", orderBy = "created_date", order = "DESC", filters = [], status = "waiting" } = req.body || {};
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

    // if (status && status !== "all") {
    //   where.push("t.order_status = ?");
    //   values.push(status);
    // } else {
    // }
    where.push("t.order_status IN ('waiting','hold')");

    other.freeTextSearch = searchText;
    other.searchColumns = ["t.order_no", "t.brand", "cu.name", "cu.mobile_no", "sp.name"];

    // if (!isSuperAdmin(req.user) && req.user.company_id) {
    //   where.push("t.company_id = ?");
    //   values.push(req.user.company_id);
    // }

    const total = await CommonModel.getCountsByParameter({ table: MODULE_TABLE, where, values, join, other, });
    // console.log(join);

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
    const { id: order_id = null } = req.params;
    if (!order_id) {
      return failureResponse(res, { code: 2004, httpStatus: 404 });
    }

    const where = { order_id };
    // if (!isSuperAdmin(req.user) && req.user.company_id) {
    //   where.company_id = req.user.company_id;
    // }

    // const details = await CommonModel.getMasterDetails(MODULE_TABLE, "*", where);
    // if (!details.length || details[0].status === "delete") {
    //   return failureResponse(res, { code: 2004, httpStatus: 404 });
    // }
    const orderDetails = await CommonModel.GetMasterListDetails({
      select: "t.*, cu.name as customer_name, cu.email, cu.email as customer_email, cu.mobile_no as customer_mobile, cu.address as customer_address, sp.name as sales_person_name",
      table: MODULE_TABLE,
      where: [
        `order_id = ${order_id}`
      ],
      values: [],
      limit: 1,
      join: [
        {
          type: 'LEFT JOIN',
          table: 'customer',
          alias: 'cu',
          key1: 'customer_id',
          key2: 'customer_id',
          column: 'name'
        },
        // {
        //   type: 'LEFT JOIN',
        //   table: 'categories',
        //   alias: 'ct',
        //   key1: 'order_status',
        //   key2: 'slug',
        //   column: 'categoryName'
        // },
        // {
        //   type: 'LEFT JOIN',
        //   table: 'categories',
        //   alias: 'cp',
        //   key1: 'priority',
        //   key2: 'slug',
        //   column: 'categoryName'
        // },
        // {
        //   type: 'LEFT JOIN',
        //   table: 'company_master',
        //   alias: 'dc',
        //   key1: 'company_id',
        //   key2: 'company_id',
        //   column: 'company_name'
        // },
        {
          type: 'LEFT JOIN',
          table: 'admin',
          alias: 'sp',
          key1: 'sales_person_id',
          key2: 'adminID',
          column: 'name'
        },
        // {
        //   type: 'LEFT JOIN',
        //   table: 'admin',
        //   alias: 'ad',
        //   key1: 'created_by',
        //   key2: 'adminID',
        //   column: 'name'
        // },
        // {
        //   type: 'LEFT JOIN',
        //   table: 'admin',
        //   alias: 'am',
        //   key1: 'modified_by',
        //   key2: 'adminID',
        //   column: 'name'
        // }
      ],
    });
    if (!orderDetails.length || orderDetails[0].status === "delete") {
      return failureResponse(res, { code: 2004, httpStatus: 404 });
    }
    const items = await getOrderItems(order_id);
    return successResponse(res, {
      code: 1004,
      httpStatus: 200,
      data: { data: { ...orderDetails[0], items } },
    });
  } catch (error) {
    return failureResponse(res, {
      code: 2008,
      httpStatus: 500,
      message: error.message,
    });
  }
};

export const changeStatus = async (req, res) => {
  try {
    const { action = "", ids = [], remarks = "" } = req.body || {};
    return updateOrderStatus({ req, res, action, ids, remarks });
  } catch (error) {
    return failureResponse(res, {
      code: 2008,
      httpStatus: 500,
      message: error.message,
    });
  }
};

export const details = getDetails;
export const confirm = (req, res) => updateOrderStatus({ req, res, action: "confirm", ids: [req.params.id], remarks: req.body?.remarks });
export const hold = (req, res) => updateOrderStatus({ req, res, action: "hold", ids: [req.params.id], remarks: req.body?.remarks });
export const sendBack = (req, res) => updateOrderStatus({ req, res, action: "send_back", ids: [req.params.id], remarks: req.body?.remarks });
