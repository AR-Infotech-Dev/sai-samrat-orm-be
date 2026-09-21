import * as CommonModel from "#shared/models/common.model.js";
import { query, DB_PREFIX } from "#config/database.js";
import { successResponse, failureResponse } from "#shared/utils/apiResponse.js";
import { prepareFilterData } from "#shared/utils/filter.builder.js";
import { toMysqlDateTime } from "#shared/utils/dateTime.js";
import { renderTemplate } from "#shared/utils/templateMaker.js";
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
    `SELECT oi.*, p.product_code, p.product_name, p.brand, p.unit, p.standard_rate, p.gst_rate, p.weight
     FROM ${DB_PREFIX}${ORDERS_LINE_TABLE} oi
     LEFT JOIN ${DB_PREFIX}products p ON oi.product_id = p.product_id
     WHERE oi.order_id = ? AND oi.status <> 'delete'
     ORDER BY oi.order_item_id ASC`,
    [orderId]
  );
};

const toNumber = (value, fallback = 0) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};

const formatDate = (value) => {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString("en-GB").replace(/\//g, "-");
};

const formatNumber = (value, minimumFractionDigits = 0) =>
  new Intl.NumberFormat("en-IN", {
    minimumFractionDigits,
    maximumFractionDigits: minimumFractionDigits,
  }).format(toNumber(value));

const getCurrencySymbol = (currency = "INR") => {
  const normalized = String(currency || "INR").trim().toUpperCase();
  const map = { INR: "₹", USD: "$", EUR: "€", GBP: "£", JPY: "¥" };
  return map[normalized] || normalized;
};

const valueOrDash = (...values) => {
  const value = values.find((item) => item !== undefined && item !== null && String(item).trim() !== "");
  return value === undefined ? "-" : String(value).trim();
};

const buildAmountWords = (amount, currency = "INR") => {
  const rounded = Math.round(toNumber(amount));
  if (!rounded) return `${currency} ZERO ONLY`;
  return `${currency} ${formatNumber(rounded).replace(/,/g, " ")} ONLY`;
};

const getCompanyDetails = async (companyId) => {
  if (!companyId) return null;
  const rows = await query(`SELECT * FROM ${DB_PREFIX}company_master WHERE company_id = ? LIMIT 1`, [companyId]);
  return rows?.[0] || null;
};

const buildExporter = (company = null) => ({
  name: valueOrDash(company?.company_name),
  tagline: valueOrDash(company?.tagline, company?.company_description),
  address: valueOrDash(company?.company_address, company?.address),
  email: valueOrDash(company?.company_email, company?.email),
  phone: valueOrDash(company?.company_mobile, company?.mobile_no, company?.phone),
  iec_code: valueOrDash(company?.iec_code),
  pan: valueOrDash(company?.pan),
  gst: valueOrDash(company?.gst_no, company?.gst_number),
});

const getProformaInvoiceData = async (orderId) => {
  const orders = await query(
    `SELECT o.*,
            cu.name AS customer_name,
            cu.email AS customer_email,
            cu.mobile_no AS customer_mobile,
            cu.address AS customer_address,
            cu.company_name AS customer_company_name,
            cu.gst_number AS customer_gst_number
     FROM ${DB_PREFIX}${MODULE_TABLE} o
     LEFT JOIN ${DB_PREFIX}customer cu ON o.customer_id = cu.customer_id
     WHERE o.order_id = ? AND o.status <> 'delete'
     LIMIT 1`,
    [orderId]
  );

  if (!orders.length) return null;

  const order = orders[0];
  const items = await getOrderItems(orderId);
  const company = await getCompanyDetails(order.company_id);
  const currency = order.currency || "INR";
  const totalQty = items.reduce((total, item) => total + toNumber(item.order_qty), 0);
  const totalWeight = items.reduce((total, item) => total + (toNumber(item.order_qty) * toNumber(item.weight)), 0);
  const invoiceTotal = items.reduce((total, item) => total + toNumber(item.line_value), 0);
  const customerName = valueOrDash(order.customer_company_name, order.customer_name);
  const customerAddress = valueOrDash(order.customer_address);

  return {
    exporter: buildExporter(company),
    invoice: {
      pi_no: `PI/${order.order_no || order.order_id}`,
      pi_date: formatDate(order.order_date || order.created_date),
      currency,
      currency_symbol: getCurrencySymbol(currency),
      remarks: valueOrDash(order.remarks),
    },
    terms: {
      payment: "30% Advance along with PI & Balance against proof of BL",
      delivery: "Within 30 Days from the date of Advance along with PO",
      delivery_terms: "FOB Nhava Sheva (Freight Cost at Actual at the time of Supply)",
      packing: "-",
      validity: "7 Days from the date of Generation of this PI",
      other_term: "-",
    },
    customer: {
      name: customerName,
      address: customerAddress,
      country: valueOrDash(order.country),
      email: valueOrDash(order.customer_email),
      mobile: valueOrDash(order.customer_mobile),
      vat_no: valueOrDash(order.customer_gst_number),
    },
    consignee: {
      name: customerName,
      address: customerAddress,
      country: valueOrDash(order.country),
      email: valueOrDash(order.customer_email),
      mobile: valueOrDash(order.customer_mobile),
      vat_no: valueOrDash(order.customer_gst_number),
    },
    shipment: {
      country_of_origin: "INDIA",
      port_of_loading: "-",
      country_of_export: "INDIA",
      port_of_discharge: "-",
      final_destination: valueOrDash(order.country),
    },
    bank: {
      transfer_to: "-",
      account_no: "-",
      name: "-",
      bank_name: "-",
      swift_code: "-",
      correspondent_bank: "-",
    },
    items: items.map((item, index) => ({
      sr_no: index + 1,
      brand: valueOrDash(order.brand, item.brand_snapshot, item.brand),
      model_code: valueOrDash(item.product_code_snapshot, item.product_code),
      description: valueOrDash(item.product_name_snapshot, item.product_name),
      marking: valueOrDash(item.product_name_snapshot, item.product_name),
      hsn_code: valueOrDash(item.hsn_code, "85072000"),
      weight: formatNumber(item.weight),
      qty: formatNumber(item.order_qty),
      unit: valueOrDash(item.unit, "Nos"),
      rate: formatNumber(item.unit_rate, 2),
      line_value: formatNumber(item.line_value, 2),
    })),
    blankRows: Array.from({ length: Math.max(0, 5 - items.length) }),
    summary: {
      containers: "-",
      total_qty: formatNumber(totalQty),
      net_weight: formatNumber(totalWeight),
      gross_weight: formatNumber(totalWeight + totalQty * 2),
      invoice_total: formatNumber(invoiceTotal, 2),
      insurance: "-",
      freight: "at actual",
      advance_received: "-",
      pi_total: formatNumber(invoiceTotal, 2),
      amount_in_words: buildAmountWords(invoiceTotal, currency),
    },
  };
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
    other.searchColumns = ["t.order_no","t.order_code", "t.brand", "cu.name", "cu.mobile_no"];

    // if (!isSuperAdmin(req.user) && req.user.company_id) {
    //   where.push("t.company_id = ?");
    //   values.push(req.user.company_id);
    // }

    const total = await CommonModel.getCountsByParameter({ table: MODULE_TABLE, where, values, join, other, });

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
      select: "t.*, cu.name as customer_name, cu.email, cu.email as customer_email, cu.mobile_no as customer_mobile, cu.address as customer_address",
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

export const proformaInvoicePreview = async (req, res) => {
  try {
    const { id: orderId } = req.params;
    if (!orderId) {
      return failureResponse(res, {
        code: 2001,
        httpStatus: 400,
        message: "Order ID is required",
      });
    }

    const data = await getProformaInvoiceData(orderId);
    if (!data) {
      return failureResponse(res, {
        code: 2004,
        httpStatus: 404,
        message: "Order not found",
      });
    }

    const html = await renderTemplate("proformaInvoice", "preview", data);
    return successResponse(res, {
      code: 1004,
      httpStatus: 200,
      data: {
        data: {
          html,
          invoice: data.invoice,
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

export const details = getDetails;
export const confirm = (req, res) => updateOrderStatus({ req, res, action: "confirm", ids: [req.params.id], remarks: req.body?.remarks });
export const hold = (req, res) => updateOrderStatus({ req, res, action: "hold", ids: [req.params.id], remarks: req.body?.remarks });
export const sendBack = (req, res) => updateOrderStatus({ req, res, action: "send_back", ids: [req.params.id], remarks: req.body?.remarks });
