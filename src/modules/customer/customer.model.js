import * as CommonModel from "#shared/models/common.model.js";
import { DB_PREFIX, query } from "#config/database.js";
import { MODULE_TABLE } from "./customer.constants.js";

export const getCustomerById = (customerId) => CommonModel.getMasterDetails(MODULE_TABLE, "*", { customer_id: customerId });

export const createCustomer = (data) => CommonModel.saveMasterDetails({table: MODULE_TABLE,data,});

export const updateCustomer = (customerId, data) => CommonModel.updateMasterDetails({table: MODULE_TABLE, data,where: { customer_id: customerId }, });

export const deleteCustomers = (ids = []) => CommonModel.deleteMasterDetails({table: MODULE_TABLE,where: { customer_id: ids },});

export const getCustomerContacts = (customerId) => CommonModel.getMasterDetails("customer_contacts", "name, mobile_no ,email, department, designation, is_primary", { customer_id: customerId });

export const findCustomerContactByMobile = async ({ customerId, mobileNo } = {}) => {
  if (!customerId || !mobileNo) return null;

  const rows = await query(
    `
      SELECT contact_id, name, mobile_no, email, department, designation, is_primary
      FROM ${DB_PREFIX}customer_contacts
      WHERE customer_id = ?
        AND REPLACE(REPLACE(REPLACE(REPLACE(mobile_no, ' ', ''), '-', ''), '+91', ''), '+', '') = ?
      LIMIT 1
    `,
    [customerId, String(mobileNo || "").replace(/\D/g, "")],
  );

  return rows[0] || null;
};

export const createCustomerContactIfMissing = async ({ customerId, contact = {}, user = {} } = {}) => {
  const mobileNo = String(contact.mobile_no || contact.contact_no || "").replace(/\D/g, "");
  const name = String(contact.name || contact.contact_person || "").trim();

  if (!customerId || !mobileNo || !name) {
    return { inserted: false, reason: "missing_required_fields" };
  }

  const existing = await findCustomerContactByMobile({ customerId, mobileNo });
  if (existing) {
    return { inserted: false, existing };
  }

  const nowSql = new Date().toISOString().slice(0, 19).replace("T", " ");
  const result = await CommonModel.saveMasterDetails({
    table: "customer_contacts",
    data: {
      customer_id: customerId,
      name,
      designation: contact.designation || null,
      mobile_no: mobileNo,
      email: contact.email || null,
      is_primary: contact.is_primary === "y" ? "y" : "n",
      department: contact.department || null,
      created_by: user.adminID || null,
      created_date: nowSql,
      modified_by: user.adminID || null,
      modified_date: nowSql,
    },
  });

  return { inserted: true, insertId: result.insertId };
};

const parseStoredCustomerProducts = (value) => {
  if (Array.isArray(value)) return value;
  if (!value) return [];

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

export const findCustomerProductSerialConflicts = async ({ serialNumbers = [], excludeCustomerId = null } = {}) => {
  const serialSet = new Set(
    serialNumbers
      .map((serial) => String(serial || "").trim().toLowerCase())
      .filter(Boolean),
  );

  if (!serialSet.size) return [];

  const rows = await query(
    `
      SELECT customer_id, name, customer_products
      FROM ${DB_PREFIX}${MODULE_TABLE}
      ${excludeCustomerId ? "WHERE customer_id <> ?" : ""}
    `,
    excludeCustomerId ? [excludeCustomerId] : [],
  );

  const conflicts = [];

  rows.forEach((customer) => {
    parseStoredCustomerProducts(customer.customer_products).forEach((product) => {
      const serial = String(product?.serial_number || "").trim();

      if (serial && serialSet.has(serial.toLowerCase())) {
        conflicts.push({
          serial_number: serial,
          customer_id: customer.customer_id,
          customer_name: customer.name,
          product_name: product?.product_name || "",
        });
      }
    });
  });

  return conflicts;
};

export const replaceCustomerContacts = async ({ customerId, contacts = [], user = {} }) => { 
  await CommonModel.deleteMasterDetails({ table: "customer_contacts", where: { customer_id: customerId } });

  if (!contacts.length) {
    return 0;
  }

  const nowSql = new Date().toISOString().slice(0, 19).replace("T", " ");
  let inserted = 0;

  for (const contact of contacts) {
    const result = await CommonModel.saveMasterDetails({
      table: "customer_contacts",
      data: {
        customer_id: customerId,
        name: contact.name || null,
        designation: contact.designation || null,
        mobile_no: contact.mobile_no || null,
        email: contact.email || null,
        is_primary: contact.is_primary === "y" ? "y" : "n",
        department: contact.department || null,
        created_by: user.adminID || null,
        created_date: nowSql,
        modified_by: user.adminID || null,
        modified_date: nowSql,
      },
    });

    inserted += result?.affectedRows || 1;
  }

  return inserted;
};

export const getCustomerTableColumns = async () => {
  const rows = await query(`SHOW COLUMNS FROM ${DB_PREFIX}${MODULE_TABLE}`);
  return new Set(rows.map((row) => row.Field));
};

export const findCustomerByNameAndEmail = async ({ name = "", email = "", company_id = null } = {}) => {
  if (!name || !email) return null;

  const rows = await query(
    `
      SELECT customer_id
      FROM ${DB_PREFIX}${MODULE_TABLE}
      WHERE LOWER(TRIM(name)) = ?
        AND LOWER(TRIM(email)) = ?
        AND company_id <=> ?
      LIMIT 1
    `,
    [
      String(name).trim().toLowerCase(),
      String(email).trim().toLowerCase(),
      company_id,
    ],
  );

  return rows[0] || null;
};

const buildDuplicateKey = ({ name = "", email = "", company_id = null } = {}) => {
  const normalizedName = String(name || "").trim().toLowerCase();
  const normalizedEmail = String(email || "").trim().toLowerCase();

  if (!normalizedName || !normalizedEmail) return "";
  return `${company_id ?? "no-company"}::${normalizedName}::${normalizedEmail}`;
};

export const findExistingCustomerDuplicateKeys = async (customers = []) => {
  const keys = new Set();
  const candidates = customers
    .map((customer) => ({
      name: String(customer.name || "").trim().toLowerCase(),
      email: String(customer.email || "").trim().toLowerCase(),
      company_id: customer.company_id ?? null,
    }))
    .filter((customer) => customer.name && customer.email);

  for (let index = 0; index < candidates.length; index += 500) {
    const batch = candidates.slice(index, index + 500);
    const whereParts = [];
    const params = [];

    batch.forEach((customer) => {
      whereParts.push("(LOWER(TRIM(name)) = ? AND LOWER(TRIM(email)) = ? AND company_id <=> ?)");
      params.push(customer.name, customer.email, customer.company_id);
    });

    if (!whereParts.length) continue;

    const rows = await query(
      `
        SELECT name, email, company_id
        FROM ${DB_PREFIX}${MODULE_TABLE}
        WHERE ${whereParts.join(" OR ")}
      `,
      params,
    );

    rows.forEach((row) => {
      const key = buildDuplicateKey(row);
      if (key) keys.add(key);
    });
  }

  return keys;
};

export const createCustomersBulk = async (customers = [], chunkSize = 500) => {
  if (!customers.length) return 0;

  let inserted = 0;

  for (let index = 0; index < customers.length; index += chunkSize) {
    const batch = customers.slice(index, index + chunkSize);
    const columns = Object.keys(batch[0] || {});
    const rowPlaceholder = `(${columns.map(() => "?").join(",")})`;
    const placeholders = batch.map(() => rowPlaceholder).join(",");
    const values = batch.flatMap((customer) => columns.map((column) => customer[column] ?? null));

    if (!columns.length || !values.length) continue;

    const result = await query(
      `
        INSERT INTO ${DB_PREFIX}${MODULE_TABLE}
        (${columns.join(",")})
        VALUES ${placeholders}
      `,
      values,
    );

    inserted += result?.affectedRows || batch.length;
  }

  return inserted;
};
