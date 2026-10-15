import * as CommonModel from "#shared/models/common.model.js";
import { query, DB_PREFIX } from "#config/database.js";
import { successResponse, failureResponse } from "#shared/utils/apiResponse.js";
import { prepareFilterData } from "#shared/utils/filter.builder.js";
import { toMysqlDateTime } from "#shared/utils/dateTime.js";
import { env } from "#config/env.js";
import { renderTemplate } from "#shared/utils/templateMaker.js";
import { renderProformaPdf } from "./proforma-pdf.service.js";

const MODULE_TABLE = "proforma_invoices";
const PI_ITEMS_TABLE = "proforma_invoice_items";

const toNumber = (value, fallback = 0) => {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : fallback;
};

const roundNumber = (value) => Math.round(toNumber(value));

const emptyText = "-";
const pickText = (...values) => {
  for (const value of values) {
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return String(value).trim();
    }
  }
  return emptyText;
};

const validatePiItems = (items = []) => {
  if (!Array.isArray(items) || !items.length) return "At least one item is required";
  const missingBrandIndex = items.findIndex((item) => !String(item.brand || "").trim());
  if (missingBrandIndex >= 0) return `Brand is required for PI item ${missingBrandIndex + 1}`;
  return "";
};

const formatDate = (value) => {
  if (!value) return emptyText;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 10);
  return date.toLocaleDateString("en-GB").replace(/\//g, "-");
};

const formatQty = (value, digits = 0) => roundNumber(value).toLocaleString("en-IN", {
  minimumFractionDigits: digits,
  maximumFractionDigits: digits,
});

const formatMoney = (value) => roundNumber(value).toLocaleString("en-IN", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const ones = ["", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const tens = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];

const wordsBelowThousand = (num) => {
  let n = Math.floor(Number(num) || 0);
  const parts = [];
  if (n >= 100) {
    parts.push(`${ones[Math.floor(n / 100)]} hundred`);
    n %= 100;
  }
  if (n >= 20) {
    parts.push(tens[Math.floor(n / 10)]);
    n %= 10;
  }
  if (n > 0) parts.push(ones[n]);
  return parts.join(" ");
};

const amountToWords = (amount, currency = "USD") => {
  let n = Math.round(toNumber(amount));
  if (!n) return `${currency} zero only`.toUpperCase();
  const units = [
    { value: 10000000, label: "crore" },
    { value: 100000, label: "lakh" },
    { value: 1000, label: "thousand" },
    { value: 1, label: "" },
  ];
  const words = [];
  for (const unit of units) {
    const count = Math.floor(n / unit.value);
    if (!count) continue;
    words.push(`${wordsBelowThousand(count)} ${unit.label}`.trim());
    n %= unit.value;
  }
  return `${currency} ${words.join(" ")} only`.replace(/\s+/g, " ").toUpperCase();
};

const default_columns = {};
const custom_columns = {
  customer_id: {
    table: "customer",
    alias: "cu",
    column: "name",
    key2: "customer_id",
    select: "cu.mobile_no AS customer_mobile, cu.email AS customer_email, cu.address AS customer_address, cu.gst_number AS customer_gst",
  },
  pi_status: {
    table: "categories",
    alias: "ct",
    column: "categoryName",
    key2: "slug",
    select: "ct.cat_color as pi_status_color",
  },
  priority: {
    table: "categories",
    alias: "cp",
    column: "categoryName",
    key2: "slug",
    select: "cp.cat_color as priority_color",
  },
};

const buildPiNo = async (piDate) => {
  const date = piDate ? new Date(piDate) : new Date();
  const year = date.getFullYear();
  const fyStart = date.getMonth() >= 3 ? year : year - 1;
  const fyEnd = (fyStart + 1).toString().slice(-2);
  const fyPrefix = `SAIPL/PI/${fyStart.toString().slice(-2)}-${fyEnd}`;

  const rows = await query(
    `SELECT pi_no FROM ${DB_PREFIX}${MODULE_TABLE} WHERE pi_no LIKE ? AND status <> 'delete'`,
    [`${fyPrefix}/%`]
  );

  let maxNo = 0;
  for (const row of rows) {
    const match = String(row.pi_no || "").match(new RegExp(`^${fyPrefix.replace(/\//g, "\\/")}/(\\d+)$`, "i"));
    if (match) {
      maxNo = Math.max(maxNo, Number(match[1]) || 0);
    }
  }

  const nextSeq = String(maxNo + 1).padStart(3, "0");
  return `${fyPrefix}/${nextSeq}`;
};

export const list = async (req, res) => {
  try {
    const { page = 1, searchText = "", getAll = "N", orderBy = "created_date", order = "DESC", filters = [] } = req.body;
    const limit = env.perPage;
    const currentPage = Number(page) || 1;
    const start = (currentPage - 1) * limit;

    const filterData = prepareFilterData({
      filters,
      searchText,
      other: { orderBy, order, searchColumns: [] },
      default_columns,
      custom_columns,
    });

    const { select, where, values, join, other } = filterData;
    where.push("t.status <> 'delete'");
    other.freeTextSearch = searchText;
    other.searchColumns = ["t.pi_no", "t.brand"];

    const total = await CommonModel.getCountsByParameter({
      table: MODULE_TABLE,
      where,
      values,
      join,
      other,
    });

    const totalPages = Math.ceil(total / limit);
    const end = Math.min(start + limit, total);

    const piList = await CommonModel.GetMasterListDetails({
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
        data: piList,
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
    return failureResponse(res, { code: 2008, httpStatus: 500, message: error.message });
  }
};

export const activeList = async (req, res) => {
  try {
    const { customer_id = null, text = "", searchText = "", require_customer = false } = req.body || {};
    const keyword = String(text || searchText || "").trim();
    if (require_customer && !customer_id) {
      return successResponse(res, { code: 1004, httpStatus: 200, data: [] });
    }

    let sql = `
      SELECT pi.pi_id, pi.pi_no, pi.customer_id, cu.name AS customer_name,
             pi.brand, pi.order_type, pi.pi_date, pi.currency, pi.exchange_rate,
             pi.total_qty, pi.total_value, pi.gst_rate, pi.pi_status
      FROM ${DB_PREFIX}${MODULE_TABLE} pi
      LEFT JOIN ${DB_PREFIX}customer cu ON pi.customer_id = cu.customer_id
      WHERE pi.status <> 'delete' AND pi.pi_status NOT IN ('cancelled', 'converted')
        AND EXISTS (
          SELECT 1 FROM ${DB_PREFIX}${PI_ITEMS_TABLE} pii
          WHERE pii.pi_id = pi.pi_id AND pii.status <> 'delete' AND pii.qty > pii.booked_qty
        )
    `;
    const params = [];

    if (customer_id) {
      sql += " AND pi.customer_id = ?";
      params.push(Number(customer_id));
    }

    if (keyword) {
      sql += " AND (pi.pi_no LIKE ? OR cu.name LIKE ?)";
      params.push(`%${keyword}%`, `%${keyword}%`);
    }

    sql += " ORDER BY pi.pi_id DESC";
    const rows = await query(sql, params);

    return successResponse(res, { code: 1004, httpStatus: 200, data: rows });
  } catch (error) {
    return failureResponse(res, { code: 2008, httpStatus: 500, message: error.message });
  }
};

export const getItems = async (req, res) => {
  try {
    const { id: pi_id } = req.params;
    if (!pi_id) {
      return failureResponse(res, { code: 2004, httpStatus: 400, message: "PI ID is required" });
    }

    const items = await query(
      `SELECT pii.*,
              GREATEST(0, pii.qty - pii.booked_qty) AS available_qty,
              p.product_code, p.product_name
       FROM ${DB_PREFIX}${PI_ITEMS_TABLE} pii
       LEFT JOIN ${DB_PREFIX}products p ON pii.product_id = p.product_id
       WHERE pii.pi_id = ? AND pii.status <> 'delete'
       ORDER BY pii.pi_item_id ASC`,
      [pi_id]
    );

    return successResponse(res, { code: 1004, httpStatus: 200, data: { data: items } });
  } catch (error) {
    return failureResponse(res, { code: 2008, httpStatus: 500, message: error.message });
  }
};

export const getDetails = async (req, res) => {
  try {
    const method = req.method.toUpperCase();
    const { id: pi_id = null } = req.params;
    const userId = req.user?.adminID || 1;

    switch (method) {
      case "PUT": {
        const payload = req.body || {};
        const piData = payload.proforma || payload.pi || payload;
        const items = Array.isArray(payload.items) ? payload.items : [];

        if (!piData.customer_id) {
          return failureResponse(res, { code: 2001, httpStatus: 400, message: "Customer is required" });
        }
        if (!items.length) {
          return failureResponse(res, { code: 2001, httpStatus: 400, message: "At least one item is required" });
        }
        const itemValidationError = validatePiItems(items);
        if (itemValidationError) {
          return failureResponse(res, { code: 2001, httpStatus: 400, message: itemValidationError });
        }

        const pi_no = piData.pi_no?.trim() || await buildPiNo(piData.pi_date);

        const gstRate = toNumber(piData.gst_rate, 18);
        const exchangeRate = Number(piData.exchange_rate || 1) || 1;
        const roundedItems = items.map((item) => {
          const qty = roundNumber(item.qty);
          const unitRate = roundNumber(item.unit_rate || item.unitRate);
          const weight = roundNumber(item.weight);
          const unitRateInInr = roundNumber(item.unit_rate_in_inr || item.unitRateInInr || (exchangeRate ? unitRate / exchangeRate : unitRate));
          const lineGst = toNumber(item.gst ?? item.gst_rate, gstRate);
          const taxable = qty * unitRate;
          const lineVal = roundNumber(taxable + (taxable * (lineGst / 100)));
          return { ...item, qty, unitRate, weight, unitRateInInr, lineGst, lineVal };
        });
        const totalQty = roundedItems.reduce((sum, it) => sum + it.qty, 0);
        const totalValue = roundedItems.reduce((sum, it) => sum + it.lineVal, 0);
        const totalValueInInr = roundNumber(piData.currency === "INR" ? totalValue : totalValue / exchangeRate);

        const data = {
          pi_no,
          company_id: piData.company_id || req.user?.company_id || 0,
          customer_id: Number(piData.customer_id),
          brand: piData.brand || null,
          pi_date: piData.pi_date || toMysqlDateTime().slice(0, 10),
          valid_until: piData.valid_until || null,
          order_type: piData.order_type || "domestic",
          pi_status: piData.pi_status || "draft",
          priority: piData.priority || "normal",
          total_qty: totalQty,
          total_value: totalValue,
          gst_rate: gstRate,
          currency: piData.currency || "INR",
          exchange_rate: exchangeRate,
          total_value_in_inr: totalValueInInr,
          payment_terms: piData.payment_terms || null,
          delivery_terms: piData.delivery_terms || null,
          packing: piData.packing || null,
          validity_of_offer: piData.validity_of_offer || null,
          other_term: piData.other_term || null,
          country_of_origin: piData.country_of_origin || null,
          port_of_loading: piData.port_of_loading || null,
          country_of_export: piData.country_of_export || null,
          port_of_discharge: piData.port_of_discharge || null,
          final_destination: piData.final_destination || null,
          remarks: piData.remarks || null,
          created_by: userId,
          created_date: toMysqlDateTime(),
          status: "active",
        };

        const result = await CommonModel.saveMasterDetails({ table: MODULE_TABLE, data });
        const insertedPiId = result.insertId;

        for (const item of roundedItems) {
          await CommonModel.saveMasterDetails({
            table: PI_ITEMS_TABLE,
            data: {
              pi_id: insertedPiId,
              company_id: data.company_id,
              product_id: Number(item.product_id),
              product_code_snapshot: item.product_code || item.productCode || null,
              product_name_snapshot: item.product_name || item.product || null,
              product_marking: item.product_marking || item.product_marking_snapshot || null,
              brand_snapshot: item.brand || null,
              model: item.model || null,
              weight: item.weight,
              qty: item.qty,
              booked_qty: 0,
              unit_rate: item.unitRate,
              unit_rate_in_inr: item.unitRateInInr,
              line_value: item.lineVal,
              line_gst: item.lineGst,
              gst_rate: item.lineGst,
              created_by: userId,
              created_date: toMysqlDateTime(),
              status: "active",
            },
          });
        }

        return successResponse(res, {
          code: 1001,
          httpStatus: 201,
          data: { pi_id: insertedPiId, pi_no },
          message: "Proforma Invoice created successfully",
        });
      }

      case "POST": {
        if (!pi_id) {
          return failureResponse(res, { code: 2004, httpStatus: 404, message: "PI ID not found" });
        }

        const payload = req.body || {};
        const piData = payload.proforma || payload.pi || payload;
        const items = Array.isArray(payload.items) ? payload.items : [];
        if (items.length > 0) {
          const itemValidationError = validatePiItems(items);
          if (itemValidationError) {
            return failureResponse(res, { code: 2001, httpStatus: 400, message: itemValidationError });
          }
        }

        const gstRate = toNumber(piData.gst_rate, 18);
        const exchangeRate = Number(piData.exchange_rate || 1) || 1;
        const roundedItems = items.map((item) => {
          const qty = roundNumber(item.qty);
          const unitRate = roundNumber(item.unit_rate || item.unitRate);
          const weight = roundNumber(item.weight);
          const bookedQty = roundNumber(item.booked_qty);
          const unitRateInInr = roundNumber(item.unit_rate_in_inr || item.unitRateInInr || (exchangeRate ? unitRate / exchangeRate : unitRate));
          const lineGst = toNumber(item.gst ?? item.gst_rate, gstRate);
          const taxable = qty * unitRate;
          const lineVal = roundNumber(taxable + (taxable * (lineGst / 100)));
          return { ...item, qty, bookedQty, unitRate, weight, unitRateInInr, lineGst, lineVal };
        });
        const totalQty = roundedItems.reduce((sum, it) => sum + it.qty, 0);
        const totalValue = roundedItems.reduce((sum, it) => sum + it.lineVal, 0);
        const totalValueInInr = roundNumber(piData.currency === "INR" ? totalValue : totalValue / exchangeRate);

        const updateData = {
          customer_id: Number(piData.customer_id),
          brand: piData.brand || null,
          pi_date: piData.pi_date,
          valid_until: piData.valid_until || null,
          order_type: piData.order_type || "domestic",
          pi_status: piData.pi_status || "draft",
          priority: piData.priority || "normal",
          total_qty: totalQty,
          total_value: totalValue,
          gst_rate: gstRate,
          currency: piData.currency || "INR",
          exchange_rate: exchangeRate,
          total_value_in_inr: totalValueInInr,
          payment_terms: piData.payment_terms || null,
          delivery_terms: piData.delivery_terms || null,
          packing: piData.packing || null,
          validity_of_offer: piData.validity_of_offer || null,
          other_term: piData.other_term || null,
          country_of_origin: piData.country_of_origin || null,
          port_of_loading: piData.port_of_loading || null,
          country_of_export: piData.country_of_export || null,
          port_of_discharge: piData.port_of_discharge || null,
          final_destination: piData.final_destination || null,
          remarks: piData.remarks || null,
          modified_by: userId,
          modified_date: toMysqlDateTime(),
        };

        if (piData.pi_no) updateData.pi_no = piData.pi_no;

        await CommonModel.updateMasterDetails({
          table: MODULE_TABLE,
          data: updateData,
          where: { pi_id },
        });

        if (items.length > 0) {
          await CommonModel.deleteMasterDetails({ table: PI_ITEMS_TABLE, where: { pi_id } });

          for (const item of roundedItems) {
            await CommonModel.saveMasterDetails({
              table: PI_ITEMS_TABLE,
              data: {
                pi_id,
                company_id: piData.company_id || 0,
                product_id: Number(item.product_id),
                product_code_snapshot: item.product_code || item.productCode || null,
                product_name_snapshot: item.product_name || item.product || null,
                product_marking: item.product_marking || item.product_marking_snapshot || null,
                brand_snapshot: item.brand || null,
                model: item.model || null,
                weight: item.weight,
                qty: item.qty,
                booked_qty: item.bookedQty,
                unit_rate: item.unitRate,
                unit_rate_in_inr: item.unitRateInInr,
                line_value: item.lineVal,
                line_gst: item.lineGst,
                gst_rate: item.lineGst,
                created_by: userId,
                created_date: toMysqlDateTime(),
                status: "active",
              },
            });
          }
        }

        return successResponse(res, {
          code: 1002,
          httpStatus: 200,
          data: { pi_id },
          message: "Proforma Invoice updated successfully",
        });
      }

      case "GET":
      default: {
        if (!pi_id) {
          return failureResponse(res, { code: 2004, httpStatus: 404, message: "PI ID not found" });
        }

        const piRows = await query(
          `SELECT pi.*,
                  cu.name AS customer_name,
                  cu.email AS customer_email,
                  cu.mobile_no AS customer_mobile,
                  cu.address AS customer_address,
                  cu.gst_number AS customer_gst,
                  cu.country AS customer_country,
                  cu.postal_code AS customer_postal_code,
                  cu.vat_no AS customer_vat_no
           FROM ${DB_PREFIX}${MODULE_TABLE} pi
           LEFT JOIN ${DB_PREFIX}customer cu ON pi.customer_id = cu.customer_id
           WHERE pi.pi_id = ? AND pi.status <> 'delete'`,
          [pi_id]
        );

        if (!piRows.length) {
          return failureResponse(res, { code: 2004, httpStatus: 404, message: "PI not found" });
        }

        const items = await query(
          `SELECT pii.*,
                  GREATEST(0, pii.qty - pii.booked_qty) AS available_qty
           FROM ${DB_PREFIX}${PI_ITEMS_TABLE} pii
           WHERE pii.pi_id = ? AND pii.status <> 'delete'
           ORDER BY pii.pi_item_id ASC`,
          [pi_id]
        );

        return successResponse(res, {
          code: 1004,
          httpStatus: 200,
          data: { data: { ...piRows[0], items } },
        });
      }
    }
  } catch (error) {
    return failureResponse(res, { code: 2008, httpStatus: 500, message: error.message });
  }
};

export const changeStatus = async (req, res) => {
  try {
    const { action = "delete", ids = [] } = req.body;
    if (!Array.isArray(ids) || !ids.length) {
      return failureResponse(res, { code: 2001, httpStatus: 400, message: "No IDs provided" });
    }

    if (action === "delete") {
      const placeholders = ids.map(() => "?").join(",");
      await query(`UPDATE ${DB_PREFIX}${MODULE_TABLE} SET status = 'delete' WHERE pi_id IN (${placeholders})`, ids);
      await query(`UPDATE ${DB_PREFIX}${PI_ITEMS_TABLE} SET status = 'delete' WHERE pi_id IN (${placeholders})`, ids);
    }

    return successResponse(res, { code: 1003, httpStatus: 200, message: "PI updated successfully" });
  } catch (error) {
    return failureResponse(res, { code: 2008, httpStatus: 500, message: error.message });
  }
};

export const preview = async (req, res) => {
  try {
    const { id: pi_id } = req.params;
    const piRows = await query(
      `SELECT pi.*,
              cu.name AS customer_name,
              cu.email AS customer_email,
              cu.mobile_no AS customer_mobile,
              cu.address AS customer_address,
              cu.gst_number AS customer_gst_number,
              cu.country AS customer_country,
              cu.postal_code AS customer_postal_code,
              cu.vat_no AS customer_vat_no
       FROM ${DB_PREFIX}${MODULE_TABLE} pi
       LEFT JOIN ${DB_PREFIX}customer cu ON pi.customer_id = cu.customer_id
       WHERE pi.pi_id = ? AND pi.status <> 'delete'`,
      [pi_id]
    );

    if (!piRows.length) {
      return failureResponse(res, { code: 2004, httpStatus: 404, message: "PI not found" });
    }

    const pi = piRows[0];
    const items = await query(
      `SELECT pii.*,
              p.product_code,
              p.product_name,
              p.product_type,
              p.brand AS product_brand,
              p.unit,
              p.weight AS product_weight,
              p.fg_code,
              p.product_description
       FROM ${DB_PREFIX}${PI_ITEMS_TABLE} pii
       LEFT JOIN ${DB_PREFIX}products p ON pii.product_id = p.product_id
       WHERE pii.pi_id = ? AND pii.status <> 'delete'
       ORDER BY pii.pi_item_id ASC`,
      [pi_id]
    );

    const currency = pi.currency || "INR";
    const totalQty = items.reduce((total, it) => total + Number(it.qty || 0), 0);
    const totalWeight = items.reduce((total, it) => total + (Number(it.qty || 0) * Number(it.weight || it.product_weight || 0)), 0);
    const invoiceTotal = items.reduce((total, it) => total + Number(it.line_value || 0), 0);
    const containers = Math.max(1, Math.ceil(totalQty / 400));
    const grossWeight = totalWeight + (containers * 900);
    const currencySymbol = currency === "USD" ? "$" : (currency === "EUR" ? "€" : (currency === "GBP" ? "£" : "₹"));

    const previewData = {
      exporter: {
        logo_url: `${env.appUrl.replace(/\/$/, "")}/images/sai-samrat-logo.png`,
        name: "SAI ACCUMULATOR INDUSTRIES PRIVATE LIMITED",
        tagline: "Manufacturer & Exporter of Batteries",
        address_line1: "Plot No. 52,53,76, Sangamner Co-Op. Ind. Estate Ltd.",
        address_line2: "City: SANGAMNER-422608, Dist. Ahmednagar, State: MAHARASHTRA, Country: INDIA",
        email: "admin@saisamrat.com",
        export_email: "exports@saisamrat.com",
        phone: "0091-2425-259068",
        mobile: "0091 9958309603",
        iec_code: "3106016043",
        pan: "ABHCS1151K",
        gst: "27ABHCS1151K1Z8",
      },
      invoice: {
        pi_no: pi.pi_no,
        pi_date: formatDate(pi.pi_date),
        currency,
        currency_symbol: currencySymbol,
        remarks: pi.remarks || "-",
      },
      customer: {
        name: pi.customer_company_name || pi.customer_name || "-",
        address: pi.customer_address || "-",
        country: pickText(pi.customer_country, pi.country),
        postal_code: pickText(pi.customer_postal_code),
        email: pickText(pi.customer_email),
        mobile: pickText(pi.customer_mobile),
        vat_no: pickText(pi.customer_vat_no, pi.customer_gst_number),
      },
      consignee: {
        name: pi.customer_company_name || pi.customer_name || "-",
        address: pi.customer_address || "-",
        country: pickText(pi.customer_country, pi.country),
        postal_code: pickText(pi.customer_postal_code),
        email: pickText(pi.customer_email),
        mobile: pickText(pi.customer_mobile),
        vat_no: pickText(pi.customer_vat_no, pi.customer_gst_number),
      },
      terms: {
        payment: pi.payment_terms || "50 % Advance along with PI & Balance against proof of BL",
        delivery: "Within 30 Days from the date of Advance along with PO",
        delivery_terms: pi.delivery_terms || "CIF SHARJAH",
        packing: pickText(pi.packing, "20' Container, 20 Pallets, 20 Batteries in Each Pallet"),
        validity: pickText(pi.validity_of_offer, "7 Days from the date of generation of this PI"),
        other_term: pickText(pi.other_term),
      },
      shipment: {
        country_of_origin: pickText(pi.country_of_origin, "INDIA"),
        port_of_loading: pickText(pi.port_of_loading, "NHAVA SHEVA"),
        country_of_export: pickText(pi.country_of_export, pi.customer_country),
        port_of_discharge: pickText(pi.port_of_discharge),
        final_destination: pickText(pi.final_destination, pi.customer_country),
      },
      items: items.map((it, idx) => ({
        sr_no: idx + 1,
        brand: pickText(it.brand_snapshot, it.product_brand, pi.brand),
        model_code: pickText(it.product_code_snapshot, it.product_code),
        fg_code:pickText(it.fg_code),
        description: pickText(it.product_description),
        marking: pickText(it.product_marking, it.product_name_snapshot, it.product_name),
        hsn_code: "85072000",
        weight: formatQty(it.weight || it.product_weight, 2),
        qty: formatQty(it.qty),
        unit: pickText(it.unit, "Nos"),
        rate: formatMoney(it.unit_rate),
        line_value: formatMoney(it.line_value || (Number(it.qty || 0) * Number(it.unit_rate || 0))),
      })),
      blankRows: Array.from({ length: Math.max(0, 9 - items.length) }),
      summary: {
        containers: formatQty(containers, 2),
        total_qty: formatQty(totalQty, 2),
        net_weight: formatQty(totalWeight, 2),
        gross_weight: formatQty(grossWeight, 2),
        invoice_total: formatMoney(invoiceTotal),
        insurance: "-",
        freight: "at Actual",
        advance_received: "-",
        pi_total: formatMoney(invoiceTotal),
        amount_in_words: amountToWords(invoiceTotal, currency),
      },
      bank: {
        transfer_to: "-",
        account_no: "091680600000030",
        name: "SAI ACCUMULATOR INDUSTRIES PRIVATE LIMITED",
        bank_name: "YES BANK, BRANCH SANGAMNER",
        swift_code: "YESBINBB",
        correspondent_bank: "JP Morgan Chase Bank",
        correspondent_account: "765902317 (ABA Routing No.: 021000021)",
        correspondent_swift: "CHASUS33",
      },
    };

    const html = await renderTemplate("proformaInvoiceCompact", "preview", previewData);
    if (req.path.endsWith("/pdf")) {
      const pdf = await renderProformaPdf(html);
      const filename = `${String(previewData.invoice.pi_no || "Proforma Invoice").replace(/[^a-zA-Z0-9_-]/g, "_")} - Proforma Invoice.pdf`;
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      return res.send(pdf);
    }
    return successResponse(res, {
      code: 1004,
      httpStatus: 200,
      data: { html, invoice: previewData.invoice },
    });
  } catch (error) {
    return failureResponse(res, { code: 2008, httpStatus: 500, message: error.message });
  }
};
