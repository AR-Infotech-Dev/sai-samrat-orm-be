import { validateBody } from "#shared/utils/bodyValidator.js";
const allowedStatuses = ["draft", "waiting", "confirmed", "planned", "production", "ready", "dispatch", "hold", "cancelled", "completed"];
const allowedPriorities = ["low", "normal", "high", "urgent"];

const orderValidationRules = {
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
const buildOrderNo = () => {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const hh = String(now.getHours()).padStart(2, "0");
  const mi = String(now.getMinutes()).padStart(2, "0");
  const ss = String(now.getSeconds()).padStart(2, "0");
  return `SSO-${yyyy}${mm}${dd}-${hh}${mi}${ss}`;
};
export const normalizePayload = (body = {}, user = {}) => {
  const order = body.order && typeof body.order === "object" ? body.order : body;
  const items = Array.isArray(body.items) ? body.items : [];
  const summary = body.summary && typeof body.summary === "object" ? body.summary : {};
  const orderDate = firstValidString(order.order_date);
  const orderMonth = firstValidString(order.order_month) || (orderDate ? orderDate.slice(0, 7) : null);

  const validItems = items
    .map((item) => {
      const qty = toNumber(item.order_qty ?? item.qty);
      const rate = toNumber(item.unit_rate ?? item.unitRate);
      const gst = toNumber(item.gst_rate ?? item.gst);
      const taxableValue = qty * rate;
      const lineValue = toNumber(item.line_value, taxableValue + taxableValue * (gst / 100));
      const productId = toNumber(item.product_id ?? item.id, 0);

      return {
        product_id: productId,
        product_code_snapshot: firstValidString(item.product_code_snapshot, item.productCode, item.product_code),
        product_name_snapshot: firstValidString(item.product_name_snapshot, item.product, item.product_name, item.name),
        brand_snapshot: firstValidString(item.brand_snapshot, item.model, item.series, item.brand),
        order_qty: qty,
        unit_rate: rate,
        line_value: lineValue,
        item_status: normalizeEnum(item.item_status, ["active", "hold", "cancelled", "completed"], "active"),
        expected_delivery_date: firstValidString(item.expected_delivery_date, order.expected_delivery_date),
        remarks: firstValidString(item.remarks),
      };
    })
    .filter((item) => item.product_id > 0 && item.product_name_snapshot && item.order_qty > 0);

  const calculatedQty = validItems.reduce((total, item) => total + toNumber(item.order_qty), 0);
  const calculatedValue = validItems.reduce((total, item) => total + toNumber(item.line_value), 0);
  const subtotal = toNumber(summary.subtotal, validItems.reduce((total, item) => total + toNumber(item.order_qty) * toNumber(item.unit_rate), 0));
  const grandTotal = toNumber(summary.grandTotal, calculatedValue);

  const normalizedOrder = {
    order_id: order.order_id || null,
    order_no: firstValidString(order.order_no) || buildOrderNo(),
    company_id: toNumber(order.company_id || user.company_id, 0),
    customer_id: toNumber(order.customer_id || order.client_id, 0),
    brand: firstValidString(order.brand),
    order_date: orderDate,
    order_month: orderMonth,
    order_week: firstValidString(order.order_week),
    sales_person_id: toNumber(order.sales_person_id, 0) || null,
    expected_delivery_date: firstValidString(order.expected_delivery_date),
    order_status: normalizeEnum(order.order_status, allowedStatuses, "draft"),
    priority: normalizeEnum(order.priority || order.order_priority, allowedPriorities, "normal"),
    total_order_qty: toNumber(summary.totalQty ?? order.total_order_qty, calculatedQty),
    total_order_value: toNumber(order.total_order_value ?? summary.subtotal, subtotal),
    currency: firstValidString(order.currency) || "INR",
    exchange_rate: toNumber(order.exchange_rate, 1),
    total_value_in_inr: toNumber(order.total_value_in_inr ?? summary.grandTotal, grandTotal),
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




