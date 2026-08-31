import { DB_PREFIX, query } from "#config/database.js";
import * as CommonModel from "#shared/models/common.model.js";
import { toMysqlDateTime } from "#shared/utils/dateTime.js";
import { isSuperAdminRole } from "#shared/utils/role.utils.js";
import { buildProductWorkbook, parseProductWorkbook } from "./product-workbook.utils.js";

const MODULE_TABLE = "products";

const PRODUCT_FIELDS = [
  "tally_item_id",
  "product_code",
  "product_name",
  "product_type",
  "brand",
  "unit",
  "standard_rate",
  "gst_rate",
  "weight",
  "ready_stock",
  "fg_code",
  "product_description",
  "status",
];

const REQUIRED_FIELDS = ["product_code", "product_name", "product_type", "brand", "unit", "standard_rate", "gst_rate"];

const hasValue = (value) => value !== undefined && value !== null && String(value).trim() !== "";
const normalizeString = (value) => (hasValue(value) ? String(value).trim() : "");
const normalizeId = (value) => {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
};
const normalizeNumber = (value, fallback = null) => {
  if (!hasValue(value)) return fallback;
  const normalized = String(value).replace(/,/g, "").trim();
  const number = Number(normalized);
  return Number.isFinite(number) ? number : fallback;
};

const isRowEmpty = (row = {}) =>
  PRODUCT_FIELDS.every((key) => !hasValue(row[key])) && !hasValue(row.product_id);

const normalizeStatus = (value) => {
  const status = normalizeString(value).toLowerCase();
  if (!status) return "active";
  if (["active", "inactive"].includes(status)) return status;
  throw new Error("Status must be active or inactive.");
};

const getUserCompanyId = (user, row = {}) => {
  const rowCompanyId = normalizeId(row.company_id);
  const userCompanyId = normalizeId(user?.company_id);
  if (isSuperAdminRole(user)) return rowCompanyId ?? userCompanyId ?? 0;
  return userCompanyId ?? rowCompanyId ?? 0;
};

const resolveProductType = async (value) => {
  if (!hasValue(value)) return null;
  const numericId = normalizeId(value);
  if (numericId) return numericId;

  const text = normalizeString(value).toLowerCase();
  const rows = await query(
    `SELECT category_id FROM ${DB_PREFIX}categories
      WHERE status = 'active'
        AND (LOWER(TRIM(categoryName)) = ? OR LOWER(TRIM(slug)) = ?)
      LIMIT 1`,
    [text, text]
  );
  return rows?.[0]?.category_id || null;
};

const findExistingProduct = async ({ productId, productCode, companyId }) => {
  if (productId) {
    const params = [productId];
    let companySql = "";
    if (companyId) {
      companySql = " AND company_id = ?";
      params.push(companyId);
    }
    const rows = await query(
      `SELECT * FROM ${DB_PREFIX}${MODULE_TABLE}
        WHERE product_id = ?${companySql}
        LIMIT 1`,
      params
    );
    return rows?.[0] || null;
  }

  if (!productCode) return null;
  const params = [productCode.toLowerCase()];
  let companySql = "";
  if (companyId) {
    companySql = " AND company_id = ?";
    params.push(companyId);
  }
  const rows = await query(
    `SELECT * FROM ${DB_PREFIX}${MODULE_TABLE}
      WHERE LOWER(TRIM(product_code)) = ?
        AND status <> 'delete'
        ${companySql}
      LIMIT 1`,
    params
  );
  return rows?.[0] || null;
};

const buildPayload = async ({ row, user, existing }) => {
  const payload = {};

  PRODUCT_FIELDS.forEach((key) => {
    if (hasValue(row[key])) payload[key] = normalizeString(row[key]);
  });

  if (!existing) {
    REQUIRED_FIELDS.forEach((key) => {
      if (!hasValue(payload[key])) throw new Error(`${key.replace(/_/g, " ")} is required.`);
    });
  }

  if (hasValue(row.product_type)) {
    const productTypeId = await resolveProductType(row.product_type);
    if (!productTypeId) throw new Error(`Product Type "${row.product_type}" not found.`);
    payload.product_type = productTypeId;
  }

  ["standard_rate", "gst_rate", "weight", "ready_stock"].forEach((key) => {
    if (Object.prototype.hasOwnProperty.call(payload, key)) payload[key] = normalizeNumber(payload[key], 0);
  });

  if (Object.prototype.hasOwnProperty.call(payload, "status")) payload.status = normalizeStatus(payload.status);
  if (!existing && !payload.status) payload.status = "active";

  if (!existing) {
    payload.company_id = getUserCompanyId(user, row);
    payload.created_by = user?.adminID || null;
    payload.created_date = toMysqlDateTime();
  } else {
    payload.modified_by = user?.adminID || null;
    payload.modified_date = toMysqlDateTime();
  }

  return payload;
};

const valuesEqual = (left, right) => String(left ?? "").trim() === String(right ?? "").trim();

const getChangedPayload = (payload, existing) => {
  if (!existing) return payload;
  return Object.entries(payload).reduce((changes, [key, value]) => {
    if (["modified_by", "modified_date"].includes(key) || !valuesEqual(existing[key], value)) {
      changes[key] = value;
    }
    return changes;
  }, {});
};

export const buildProductExportWorkbook = async (products = []) => {
  const typeIds = [...new Set(products.map((product) => normalizeId(product.product_type)).filter(Boolean))];
  const typeLookup = new Map();

  if (typeIds.length) {
    const placeholders = typeIds.map(() => "?").join(",");
    const rows = await query(
      `SELECT category_id, categoryName FROM ${DB_PREFIX}categories WHERE category_id IN (${placeholders})`,
      typeIds
    );
    rows.forEach((row) => typeLookup.set(Number(row.category_id), row.categoryName));
  }

  return buildProductWorkbook({
    products: products.map((product) => ({
      ...product,
      product_type_name: product.product_type_name || product.product_type_label || typeLookup.get(Number(product.product_type)),
    })),
  });
};

export const importProductWorkbook = async ({ workbook, user, dryRun = false } = {}) => {
  const rows = parseProductWorkbook(workbook).filter((row) => !isRowEmpty(row));
  const errors = [];
  const processed = [];
  let inserted = 0;
  let updated = 0;
  let unchanged = 0;
  let skipped = 0;
  const seenProductCodes = new Set();

  for (const row of rows) {
    try {
      const productId = normalizeId(row.product_id);
      const productCode = normalizeString(row.product_code);
      const companyId = getUserCompanyId(user, row);

      if (productCode) {
        const duplicateKey = productCode.toLowerCase();
        if (seenProductCodes.has(duplicateKey)) throw new Error(`Duplicate Product Code "${productCode}" in import file.`);
        seenProductCodes.add(duplicateKey);
      }

      const existing = await findExistingProduct({ productId, productCode, companyId });

      if (productId && !existing) throw new Error(`Product ID ${productId} not found.`);

      const payload = await buildPayload({ row, user, existing });
      const changes = getChangedPayload(payload, existing);
      const operation = existing ? (Object.keys(changes).length > 2 ? "update" : "unchanged") : "insert";

      if (!dryRun) {
        if (!existing) {
          await CommonModel.saveMasterDetails({ table: MODULE_TABLE, data: payload });
        } else if (operation === "update") {
          await CommonModel.updateMasterDetails({
            table: MODULE_TABLE,
            data: changes,
            where: { product_id: existing.product_id },
          });
        }
      }

      if (operation === "insert") inserted += 1;
      else if (operation === "update") updated += 1;
      else unchanged += 1;

      processed.push({
        row: row.__row,
        product_code: productCode,
        product_name: payload.product_name || existing?.product_name || "",
        action: operation,
      });
    } catch (error) {
      skipped += 1;
      errors.push({ sheet: "Products", row: row.__row, message: error.message });
    }
  }

  return {
    inserted,
    updated,
    unchanged,
    skipped,
    errors,
    rows: processed,
    preview: dryRun,
  };
};
