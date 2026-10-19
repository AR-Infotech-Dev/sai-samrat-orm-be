import { validateBody } from "#shared/utils/bodyValidator.js";
import { getExchangeRate, normalizeCurrencyCode } from "#modules/system/currency.service.js";
import { query, DB_PREFIX } from "#config/database.js";
const allowedStatuses = ["draft", "waiting", "confirmed", "planned", "production", "ready", "dispatch", "hold", "cancelled", "completed"];
const allowedPriorities = ["low", "normal", "high", "urgent"];
const ORDERS_TABLE = "production_notes";

const orderValidationRules = {
  production_note_id: { label: "Order ID", type: "number" },
  production_note_no: { label: "Order No" },
  production_code: { label: "Order Code" },
  company_id: { label: "Company Id", type: "number" },
  customer_id: { label: "Customer", type: "number", required: true },
  brand: { label: "Brand" },
  production_note_date: { label: "Order Date", required: true },
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


const toNumber = (value, fallback = 0) => {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : fallback;
};
const firstValidString = (...values) => {
  const value = values.find((item) => item !== undefined && item !== null && String(item).trim() !== "");
  return value === undefined ? null : String(value).trim();
};
const normalizeEnum = (value, allowedValues, fallback) => {
  const normalized = String(value || "").toLowerCase().trim().replace(/\s+/g, "_");
  return allowedValues.includes(normalized) ? normalized : fallback;
};
const hasNumericValue = (value) => value !== undefined && value !== null && value !== "" && Number.isFinite(Number(value));
const roundMoney = (value) => Math.round((Number(value) || 0) * 100) / 100;
const monthPrefixes = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEPT", "OCT", "NOV", "DEC"];
const parseOrderDate = (value) => {
  if (!value) return new Date();
  const raw = String(value).trim();
  const dmyMatch = raw.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (dmyMatch) {
    return new Date(Number(dmyMatch[3]), Number(dmyMatch[2]) - 1, Number(dmyMatch[1]));
  }
  return new Date(raw);
};
const getOrderDateParts = (value) => {
  const date = parseOrderDate(value);
  if (Number.isNaN(date.getTime())) return getOrderDateParts();
  return {
    monthPrefix: monthPrefixes[date.getMonth()] || "ORD",
    orderMonth: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`,
  };
};
const buildOrderNo = async (orderDate) => {
  const { monthPrefix, orderMonth } = getOrderDateParts(orderDate);
  const rows = await query(
    `SELECT production_note_no FROM ${DB_PREFIX}${ORDERS_TABLE}
     WHERE production_note_month = ?
       AND production_note_no LIKE ?
       AND status <> 'delete'`,
    [orderMonth, `${monthPrefix}-%`]
  );
  const nextNo = rows.reduce((maxNo, row) => {
    const match = String(row.production_note_no || "").match(new RegExp(`^${monthPrefix}-(\\d+)$`, "i"));
    return match ? Math.max(maxNo, Number(match[1]) || 0) : maxNo;
  }, 0) + 1;
  return `${monthPrefix}-${String(nextNo).padStart(2, "0")}`;
};
export const normalizePayload = async (body = {}, user = {}) => {
  const order = body.production_note && typeof body.production_note === "object"
    ? body.production_note
    : body.order && typeof body.order === "object" ? body.order : body;
  const items = Array.isArray(body.items) ? body.items : [];
  const summary = body.summary && typeof body.summary === "object" ? body.summary : {};
  const orderDate = firstValidString(order.production_note_date);
  const orderMonth = firstValidString(order.production_note_month) || getOrderDateParts(orderDate).orderMonth;
  const currency = normalizeCurrencyCode(firstValidString(order.currency) || "INR");
  const exchangeRate = await getExchangeRate(currency);

  const validItems = items
    .map((item) => {
      const qty = toNumber(item.production_note_qty ?? item.qty);
      const inrRateSource = item.unit_rate_in_inr ?? item.unitRateInInr ?? item.standard_rate_in_inr ?? item.standard_rate;
      const rate = hasNumericValue(inrRateSource)
        ? roundMoney(toNumber(inrRateSource) * exchangeRate)
        : roundMoney(toNumber(item.unit_rate ?? item.unitRate));
      const gst = toNumber(item.gst_rate ?? item.gst);
      const taxableValue = qty * rate;
      const lineValue = roundMoney(taxableValue + taxableValue * (gst / 100));
      const productId = toNumber(item.product_id ?? item.id, 0);

      return {
        product_id: productId,
        pi_item_id: item.pi_item_id ? Number(item.pi_item_id) : null,
        product_code_snapshot: firstValidString(item.product_code_snapshot, item.productCode, item.product_code),
        product_name_snapshot: firstValidString(item.product_name_snapshot, item.product, item.product_name, item.name),
        brand_snapshot: firstValidString(item.brand_snapshot, item.model, item.series, item.brand),
        production_note_qty: qty,
        unit_rate: rate,
        line_value: lineValue,
        line_gst: gst,
        item_status: normalizeEnum(item.item_status, ["active", "hold", "cancelled", "completed"], "active"),
        expected_delivery_date: firstValidString(item.expected_delivery_date, order.expected_delivery_date),
        remarks: firstValidString(item.remarks),
      };
    })
    .filter((item) => item.product_id > 0 && item.product_name_snapshot && item.production_note_qty > 0);

  const calculatedQty = validItems.reduce((total, item) => total + toNumber(item.production_note_qty), 0);
  const calculatedValue = roundMoney(validItems.reduce((total, item) => total + toNumber(item.line_value), 0));
  const subtotal = roundMoney(validItems.reduce((total, item) => total + toNumber(item.production_note_qty) * toNumber(item.unit_rate), 0));
  const grandTotal = calculatedValue;

  const normalizedOrder = {
    production_note_id: order.production_note_id || null,
    production_note_no: firstValidString(order.production_note_no) || await buildOrderNo(orderDate),
    production_code: firstValidString(order.production_code, order.production_note, order.productionNote),
    company_id: toNumber(order.company_id || user.company_id, 0),
    customer_id: toNumber(order.customer_id || order.client_id, 0),
    brand: firstValidString(order.brand),
    production_note_date: orderDate,
    order_type: order.order_type,
    pi_number: order.pi_number,
    pi_id: order.pi_id ? Number(order.pi_id) : null,
    production_note_month: orderMonth,
    production_note_week: firstValidString(order.production_note_week),
    expected_delivery_date: firstValidString(order.expected_delivery_date),
    production_note_status: normalizeEnum(order.production_note_status, allowedStatuses, "draft"),
    priority: normalizeEnum(order.priority || order.order_priority, allowedPriorities, "normal"),
    total_production_note_qty: toNumber(summary.totalQty ?? order.total_production_note_qty, calculatedQty),
    total_production_note_value: subtotal,
    gst_rate: order.gst_rate,
    currency,
    exchange_rate: exchangeRate,
    total_value_in_inr: roundMoney(currency === "INR" ? grandTotal : grandTotal / exchangeRate),
    source: firstValidString(order.source) || "manual",
    excel_row_no: order.excel_row_no || null,
    remarks: firstValidString(order.remarks, order.remark),
    status: firstValidString(order.status) || "active",
  };

  return { order: normalizedOrder, items: validItems };
};
export const validateOrderPayload = (order, items) => {
  const validation = validateBody(order, orderValidationRules);
  if (!validation.isValid) {
    return validation.message;
  }
  // if (!order.company_id) {
  //   return "Company is required";
  // }
  if (!Array.isArray(items) || items.length === 0) {
    return "At least one product line is required";
  }
  return "";
};

