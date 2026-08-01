import { DB_PREFIX, getDbPool, query } from "#config/database.js";
import { toMysqlDateTime } from "#shared/utils/dateTime.js";
import { isSuperAdminRole } from "#shared/utils/role.utils.js";
import { findCustomerProductSerialConflicts, getCustomerTableColumns } from "./customer.model.js";
import {
  normalizeCustomerProducts,
  normalizeImportDate,
  normalizeTermPeriod,
  normalizeYesNo,
  validateCustomerContacts,
} from "./customer.utils.js";
import {
  buildCustomerWorkbook,
  CUSTOMER_WORKBOOK_CLEAR_VALUE,
  parseCustomerWorkbook,
} from "./customer-workbook.utils.js";

const CUSTOMER_FIELDS = [
  "name",
  "wa_no",
  "pan_number",
  "gst_number",
  "company_name",
  "billing_name",
  "address",
  "billing_address",
  "mailing_address",
  "is_amc",
  "amc_term_period",
  "amc_start_date",
  "amc_end_date",
  "exp_call_count",
  "responsible_person",
  "status",
];

const CONTACT_FIELDS = ["name", "mobile_no", "email", "designation", "department", "is_primary"];
const PRODUCT_FIELDS = ["product_id", "product_name", "serial_number", "expiry_date", "add_ons"];

const normalizeAction = (value) => String(value || "").trim().toUpperCase();
const normalizeCode = (value) => String(value || "").trim().toLowerCase();
const normalizeId = (value) => {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
};
const isClearValue = (value) => String(value || "").trim().toUpperCase() === CUSTOMER_WORKBOOK_CLEAR_VALUE;
const hasValue = (value) => value !== undefined && value !== null && String(value).trim() !== "";
const normalizeMobile = (value) => String(value || "").replace(/\D/g, "");
const comparable = (value) => {
  if (Array.isArray(value)) return JSON.stringify(value.map((item) => String(item || "").trim()));
  if (value === null || value === undefined || value === "") return "";
  return String(value).trim();
};
const valuesEqual = (left, right) => comparable(left) === comparable(right);

const queryWith = async (executor, sql, params = []) => {
  const [rows] = await executor.execute(sql, params);
  return rows;
};

const addRowsToLookup = (lookup, rows = []) => {
  rows.forEach((row) => {
    if (normalizeAction(row.action) === "EXAMPLE") return;
    const id = normalizeId(row.customer_id);
    const code = normalizeCode(row.customer_code);
    const key = id ? `id:${id}` : code ? `code:${code}` : "unlinked";
    const current = lookup.get(key) || [];
    current.push(row);
    lookup.set(key, current);
  });
};

const getLinkedRows = (lookup, customerRow) => {
  const id = normalizeId(customerRow.customer_id);
  const code = normalizeCode(customerRow.customer_code);
  return lookup.get(id ? `id:${id}` : `code:${code}`) || [];
};

const readCell = (row, key, { newRecord = false } = {}) => {
  if (!Object.prototype.hasOwnProperty.call(row, key)) return undefined;
  const value = row[key];
  if (isClearValue(value)) return null;
  if (!hasValue(value)) return newRecord ? null : undefined;
  return String(value).trim();
};

const normalizeCustomerField = (key, value) => {
  if (value === undefined || value === null) return value;
  if (key === "is_amc") return normalizeYesNo(value);
  if (key === "amc_term_period") return normalizeTermPeriod(value);
  if (["amc_start_date", "amc_end_date"].includes(key)) return normalizeImportDate(value);
  if (["exp_call_count", "responsible_person"].includes(key)) return normalizeId(value);
  return value;
};

const buildCustomerChanges = (row, newRecord) => CUSTOMER_FIELDS.reduce((changes, key) => {
  const value = readCell(row, key, { newRecord });
  if (value !== undefined) changes[key] = normalizeCustomerField(key, value);
  return changes;
}, {});

const getIncomingPrimary = (contactRows = []) => {
  const activeRows = contactRows.filter((row) => !["DELETE", "EXAMPLE"].includes(normalizeAction(row.action)));
  return activeRows.find((row) => normalizeYesNo(row.is_primary) === "yes") || activeRows[0] || null;
};

const findExistingCustomer = async ({ executor, row, user, contactRows }) => {
  const customerId = normalizeId(row.customer_id);
  const userCompanyId = isSuperAdminRole(user) ? normalizeId(row.company_id) : normalizeId(user.company_id);

  if (customerId) {
    const params = [customerId];
    let companySql = "";
    if (userCompanyId) {
      companySql = " AND company_id = ?";
      params.push(userCompanyId);
    }
    const rows = await queryWith(executor, `SELECT * FROM ${DB_PREFIX}customer WHERE customer_id = ?${companySql} LIMIT 1`, params);
    if (!rows.length) throw new Error(`Customer ID ${customerId} was not found or is outside your company.`);
    return rows[0];
  }

  const name = String(row.name || "").trim();
  const primary = getIncomingPrimary(contactRows);
  const email = String(primary?.email || "").trim().toLowerCase();
  const mobile = normalizeMobile(primary?.mobile_no);
  if (!name || (!email && !mobile)) return null;
  if (!userCompanyId) throw new Error("Company ID is required for a new customer.");

  const matchParts = [];
  const params = [name.toLowerCase(), userCompanyId];
  if (email) {
    matchParts.push("LOWER(TRIM(email)) = ?");
    params.push(email);
  }
  if (mobile) {
    matchParts.push("REPLACE(REPLACE(REPLACE(REPLACE(mobile_no, ' ', ''), '-', ''), '+91', ''), '+', '') = ?");
    params.push(mobile);
  }

  const rows = await queryWith(
    executor,
    `SELECT * FROM ${DB_PREFIX}customer
      WHERE LOWER(TRIM(name)) = ? AND company_id = ? AND (${matchParts.join(" OR ")})
      LIMIT 1`,
    params
  );
  return rows[0] || null;
};

const assertRowVersion = (row, existing) => {
  if (!existing || !hasValue(row.row_version)) return;
  const expected = String(row.row_version).trim();
  const current = String(existing.modified_date || existing.created_date || "").trim();
  if (expected !== current) {
    throw new Error("Customer was modified after this workbook was exported. Export again before updating.");
  }
};

const buildContactState = (existingContacts = [], rows = [], newCustomer = false) => {
  const contacts = existingContacts.map((contact) => ({ ...contact, __existing: true }));
  const operations = [];

  rows.forEach((row) => {
    const action = normalizeAction(row.action);
    if (action === "EXAMPLE") return;
    const contactId = normalizeId(row.contact_id);

    if (action === "DELETE") {
      if (!contactId) throw new Error(`Contacts row ${row.__row}: Contact ID is required for DELETE.`);
      const index = contacts.findIndex((contact) => Number(contact.contact_id) === contactId);
      if (index === -1) throw new Error(`Contacts row ${row.__row}: Contact ID ${contactId} does not belong to this customer.`);
      contacts.splice(index, 1);
      operations.push({ type: "delete", contactId });
      return;
    }

    if (contactId) {
      const contact = contacts.find((item) => Number(item.contact_id) === contactId);
      if (!contact) throw new Error(`Contacts row ${row.__row}: Contact ID ${contactId} does not belong to this customer.`);
      const changes = {};
      CONTACT_FIELDS.forEach((key) => {
        const value = readCell(row, key);
        if (value === undefined) return;
        const normalizedValue = key === "mobile_no" ? normalizeMobile(value) : key === "is_primary" ? (normalizeYesNo(value) === "yes" ? "y" : "n") : value;
        if (!valuesEqual(contact[key], normalizedValue)) changes[key] = normalizedValue;
      });
      Object.assign(contact, changes);
      if (Object.keys(changes).length) operations.push({ type: "update", contactId, changes });
      return;
    }

    const contact = CONTACT_FIELDS.reduce((data, key) => {
      const value = readCell(row, key, { newRecord: true });
      data[key] = key === "mobile_no" ? normalizeMobile(value) : key === "is_primary" ? (normalizeYesNo(value) === "yes" ? "y" : "n") : value;
      return data;
    }, {});
    contacts.push(contact);
    operations.push({ type: "insert", contact });
  });

  const primaryRows = rows.filter((row) => normalizeAction(row.action) !== "DELETE" && normalizeYesNo(row.is_primary) === "yes");
  if (primaryRows.length === 1) {
    const primaryRow = primaryRows[0];
    const requestedPrimaryId = normalizeId(primaryRow.contact_id);
    const requestedPrimaryMobile = normalizeMobile(primaryRow.mobile_no);
    const requestedPrimaryName = String(primaryRow.name || "").trim().toLowerCase();
    const targetPrimary = contacts.find((contact) => requestedPrimaryId
      ? Number(contact.contact_id) === requestedPrimaryId
      : normalizeMobile(contact.mobile_no) === requestedPrimaryMobile && String(contact.name || "").trim().toLowerCase() === requestedPrimaryName);
    if (!targetPrimary) throw new Error(`Contacts row ${primaryRow.__row}: Primary contact could not be resolved.`);

    contacts.forEach((contact) => {
      const isTarget = contact === targetPrimary;
      const nextPrimary = isTarget ? "y" : "n";
      const primaryChanged = !valuesEqual(contact.is_primary, nextPrimary);
      contact.is_primary = nextPrimary;
      if (!contact.__existing) return;
      if (!primaryChanged) return;
      let operation = operations.find((item) => item.type === "update" && item.contactId === contact.contact_id);
      if (!operation) {
        operation = { type: "update", contactId: contact.contact_id, changes: {} };
        operations.push(operation);
      }
      operation.changes.is_primary = nextPrimary;
    });
  }

  const existingHadPrimary = existingContacts.some((contact) => contact.is_primary === "y");
  const primaryTouched = operations.some((operation) =>
    operation.type === "insert"
    || operation.type === "delete"
    || Object.prototype.hasOwnProperty.call(operation.changes || {}, "is_primary"));
  const validation = validateCustomerContacts(contacts, {
    requirePrimary: newCustomer || existingHadPrimary || primaryTouched,
  });
  if ((newCustomer || operations.length) && !validation.isValid) throw new Error(validation.message);
  return { contacts, operations };
};

const parseAddOns = (value) => {
  if (value === null) return [];
  if (Array.isArray(value)) return value;
  return String(value || "").split(/[,+|]/).map((item) => item.trim()).filter(Boolean);
};

const buildProductState = async ({ customerId, existingProducts, rows }) => {
  const products = normalizeCustomerProducts(existingProducts).map((product, index) => ({
    ...product,
    __rowKey: customerId ? `${customerId}:${index + 1}` : "",
  }));
  let changed = false;

  rows.forEach((row) => {
    const action = normalizeAction(row.action);
    if (action === "EXAMPLE") return;
    const rowKey = String(row.product_row_key || "").trim();
    let index = -1;
    if (rowKey) {
      const [keyCustomerId, keyIndex] = rowKey.split(":").map(Number);
      if (!customerId || keyCustomerId !== Number(customerId) || !Number.isInteger(keyIndex) || keyIndex < 1) {
        throw new Error(`Products row ${row.__row}: Invalid Product Row Key.`);
      }
      index = products.findIndex((product) => product.__rowKey === rowKey);
      if (!products[index]) throw new Error(`Products row ${row.__row}: Product row no longer exists.`);
    }

    if (action === "DELETE") {
      if (index < 0) throw new Error(`Products row ${row.__row}: Product Row Key is required for DELETE.`);
      products.splice(index, 1);
      changed = true;
      return;
    }

    const newProduct = index < 0;
    const product = newProduct ? {} : products[index];
    let rowChanged = newProduct;
    PRODUCT_FIELDS.forEach((key) => {
      const value = readCell(row, key, { newRecord: newProduct });
      if (value === undefined) return;
      const nextValue = key === "expiry_date"
        ? (value ? normalizeImportDate(value) : "")
        : key === "add_ons"
          ? parseAddOns(value)
          : value ?? "";
      if (!valuesEqual(product[key], nextValue)) {
        product[key] = nextValue;
        rowChanged = true;
      }
    });
    if (!product.product_id) throw new Error(`Products row ${row.__row}: Product ID is required.`);
    if (newProduct) products.push(product);
    if (rowChanged) changed = true;
  });

  const serials = new Set();
  for (const product of products) {
    const serial = String(product.serial_number || "").trim().toLowerCase();
    if (!serial) continue;
    if (serials.has(serial)) throw new Error(`Duplicate product serial number: ${product.serial_number}`);
    serials.add(serial);
  }

  const conflicts = changed ? await findCustomerProductSerialConflicts({
    serialNumbers: products.map((product) => product.serial_number),
    excludeCustomerId: customerId,
  }) : [];
  if (conflicts.length) {
    const conflict = conflicts[0];
    throw new Error(`Product serial number ${conflict.serial_number} already exists for customer ${conflict.customer_name || conflict.customer_id}.`);
  }
  return {
    products: products.map(({ __rowKey: _rowKey, ...product }) => product),
    changed,
  };
};

const writeCustomer = async ({ connection, existing, changes, companyId, user, products, productsChanged, primaryContact }) => {
  const now = toMysqlDateTime();
  const userId = user.adminID || null;
  const customerData = { ...changes };
  if (productsChanged) customerData.customer_products = JSON.stringify(products);
  if (primaryContact) {
    customerData.contact_person = primaryContact.name || null;
    customerData.mobile_no = primaryContact.mobile_no || null;
    customerData.email = primaryContact.email || null;
  }

  if (existing) {
    customerData.modified_by = userId;
    customerData.modified_date = now;
    const entries = Object.entries(customerData);
    if (entries.length) {
      await connection.execute(
        `UPDATE ${DB_PREFIX}customer SET ${entries.map(([key]) => `\`${key}\` = ?`).join(", ")} WHERE customer_id = ?`,
        [...entries.map(([, value]) => value), existing.customer_id]
      );
    }
    return existing.customer_id;
  }

  customerData.company_id = companyId;
  customerData.created_by = userId;
  customerData.created_date = now;
  customerData.modified_by = userId;
  customerData.modified_date = now;
  const entries = Object.entries(customerData);
  const [result] = await connection.execute(
    `INSERT INTO ${DB_PREFIX}customer (${entries.map(([key]) => `\`${key}\``).join(", ")}) VALUES (${entries.map(() => "?").join(", ")})`,
    entries.map(([, value]) => value)
  );
  return result.insertId;
};

const writeContacts = async ({ connection, customerId, operations, user }) => {
  const now = toMysqlDateTime();
  const counts = { inserted: 0, updated: 0, deleted: 0 };
  for (const operation of operations) {
    if (operation.type === "delete") {
      await connection.execute(`DELETE FROM ${DB_PREFIX}customer_contacts WHERE customer_id = ? AND contact_id = ?`, [customerId, operation.contactId]);
      counts.deleted += 1;
      continue;
    }
    if (operation.type === "update") {
      const entries = Object.entries(operation.changes);
      if (!entries.length) continue;
      entries.push(["modified_by", user.adminID || null], ["modified_date", now]);
      await connection.execute(
        `UPDATE ${DB_PREFIX}customer_contacts SET ${entries.map(([key]) => `\`${key}\` = ?`).join(", ")} WHERE customer_id = ? AND contact_id = ?`,
        [...entries.map(([, value]) => value), customerId, operation.contactId]
      );
      counts.updated += 1;
      continue;
    }
    const contact = operation.contact;
    await connection.execute(
      `INSERT INTO ${DB_PREFIX}customer_contacts
        (customer_id, name, designation, mobile_no, email, is_primary, department, created_by, created_date, modified_by, modified_date)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [customerId, contact.name, contact.designation, contact.mobile_no, contact.email, contact.is_primary, contact.department, user.adminID || null, now, user.adminID || null, now]
    );
    counts.inserted += 1;
  }
  return counts;
};

export const getCustomerContactsForWorkbook = async (customerIds = []) => {
  if (!customerIds.length) return [];
  const rows = [];
  for (let index = 0; index < customerIds.length; index += 500) {
    const ids = customerIds.slice(index, index + 500);
    const placeholders = ids.map(() => "?").join(",");
    rows.push(...await query(
      `SELECT contact_id, customer_id, name, mobile_no, email, designation, department, is_primary
       FROM ${DB_PREFIX}customer_contacts WHERE customer_id IN (${placeholders}) ORDER BY customer_id, is_primary DESC, contact_id`,
      ids
    ));
  }
  return rows;
};

export const buildCustomerExportWorkbook = async (customers = [], selectedColumns = []) => {
  const customerIds = customers.map((customer) => normalizeId(customer.customer_id)).filter(Boolean);
  const contacts = await getCustomerContactsForWorkbook(customerIds);
  return buildCustomerWorkbook({ customers, contacts, selectedColumns });
};

export const importCustomerWorkbook = async ({ workbook, user, dryRun = false }) => {
  const parsed = parseCustomerWorkbook(workbook);
  const customerRows = parsed.customers.filter((row) => normalizeAction(row.action) !== "EXAMPLE");
  const contactLookup = new Map();
  const productLookup = new Map();
  addRowsToLookup(contactLookup, parsed.contacts);
  addRowsToLookup(productLookup, parsed.products);
  const tableColumns = await getCustomerTableColumns();
  const customerReferences = new Set();
  const duplicateCustomerReferences = new Set();
  customerRows.forEach((row) => {
    const id = normalizeId(row.customer_id);
    const code = normalizeCode(row.customer_code);
    const reference = id ? `id:${id}` : code ? `code:${code}` : "";
    if (!reference) return;
    if (customerReferences.has(reference)) duplicateCustomerReferences.add(reference);
    customerReferences.add(reference);
  });
  const serialReferences = new Map();
  parsed.products.forEach((row) => {
    if (["DELETE", "EXAMPLE"].includes(normalizeAction(row.action))) return;
    if (hasValue(row.product_row_key)) return;
    const serial = String(row.serial_number || "").trim().toLowerCase();
    if (!serial) return;
    serialReferences.set(serial, (serialReferences.get(serial) || 0) + 1);
  });
  const duplicateWorkbookSerials = new Set([...serialReferences.entries()].filter(([, count]) => count > 1).map(([serial]) => serial));
  const result = {
    inserted: 0,
    updated: 0,
    unchanged: 0,
    skipped: 0,
    contacts: { inserted: 0, updated: 0, deleted: 0 },
    products_updated: 0,
    errors: [],
    preview: dryRun,
  };

  for (const customerRow of customerRows) {
    const connection = await getDbPool().getConnection();
    try {
      if (normalizeAction(customerRow.action) === "DELETE") {
        throw new Error("Customer deletion is not allowed from import. Delete it from the application.");
      }
      if (!normalizeId(customerRow.customer_id) && !normalizeCode(customerRow.customer_code)) {
        throw new Error("Customer Code is required when Customer ID is blank.");
      }
      const customerReference = normalizeId(customerRow.customer_id)
        ? `id:${normalizeId(customerRow.customer_id)}`
        : `code:${normalizeCode(customerRow.customer_code)}`;
      if (duplicateCustomerReferences.has(customerReference)) {
        throw new Error("Duplicate Customer ID or Customer Code found in the Customers sheet.");
      }

      await connection.beginTransaction();
      const contactRows = getLinkedRows(contactLookup, customerRow);
      const productRows = getLinkedRows(productLookup, customerRow);
      const repeatedSerial = productRows
        .map((row) => String(row.serial_number || "").trim().toLowerCase())
        .find((serial) => serial && duplicateWorkbookSerials.has(serial));
      if (repeatedSerial) throw new Error(`Duplicate product serial number in workbook: ${repeatedSerial}`);
      const existing = await findExistingCustomer({ executor: connection, row: customerRow, user, contactRows });
      assertRowVersion(customerRow, existing);
      const newCustomer = !existing;
      const companyId = existing?.company_id || (isSuperAdminRole(user) ? normalizeId(customerRow.company_id) : normalizeId(user.company_id));
      if (!companyId) throw new Error("Company ID is required.");

      const changes = buildCustomerChanges(customerRow, newCustomer);
      if (newCustomer && !changes.name) throw new Error("Customer Name is required.");
      if (changes.is_amc !== "yes") {
        if (changes.is_amc !== undefined) {
          changes.amc_term_period = null;
          changes.amc_start_date = null;
          changes.amc_end_date = null;
        }
      }
      Object.keys(changes).forEach((key) => {
        if (!tableColumns.has(key)) delete changes[key];
      });
      if (existing) {
        Object.keys(changes).forEach((key) => {
          if (valuesEqual(existing[key], changes[key])) delete changes[key];
        });
      }

      const existingContacts = existing
        ? await queryWith(connection, `SELECT * FROM ${DB_PREFIX}customer_contacts WHERE customer_id = ? ORDER BY is_primary DESC, contact_id`, [existing.customer_id])
        : [];
      const contactState = buildContactState(existingContacts, contactRows, newCustomer);
      const productState = await buildProductState({
        customerId: existing?.customer_id || null,
        existingProducts: existing?.customer_products || [],
        rows: productRows,
      });
      const primaryContact = contactState.contacts.find((contact) => contact.is_primary === "y") || null;
      const hasContactChanges = contactState.operations.length > 0;
      const hasCustomerChanges = newCustomer || Object.keys(changes).length > 0 || productState.changed || hasContactChanges;

      if (dryRun) {
        contactState.operations.forEach((operation) => {
          if (operation.type === "insert") result.contacts.inserted += 1;
          if (operation.type === "update" && Object.keys(operation.changes).length) result.contacts.updated += 1;
          if (operation.type === "delete") result.contacts.deleted += 1;
        });
        await connection.rollback();
      } else if (hasCustomerChanges) {
        const customerId = await writeCustomer({
          connection,
          existing,
          changes,
          companyId,
          user,
          products: productState.products,
          productsChanged: productState.changed || newCustomer,
          primaryContact,
        });
        const contactCounts = await writeContacts({ connection, customerId, operations: contactState.operations, user });
        Object.keys(result.contacts).forEach((key) => { result.contacts[key] += contactCounts[key]; });
        await connection.commit();
      } else {
        await connection.commit();
      }

      if (!hasCustomerChanges) result.unchanged += 1;
      else if (newCustomer) result.inserted += 1;
      else result.updated += 1;
      if (productState.changed) result.products_updated += 1;
    } catch (error) {
      try { await connection.rollback(); } catch { /* connection may already be rolled back */ }
      result.skipped += 1;
      result.errors.push({ sheet: "Customers", row: customerRow.__row, message: error.message });
    } finally {
      connection.release();
    }
  }

  const linkedCustomerIds = new Set(customerRows.map((row) => normalizeId(row.customer_id)).filter(Boolean));
  const linkedCodes = new Set(customerRows.map((row) => normalizeCode(row.customer_code)).filter(Boolean));
  const addUnlinkedErrors = (rows, sheet) => rows.forEach((row) => {
    if (normalizeAction(row.action) === "EXAMPLE") return;
    const linked = (normalizeId(row.customer_id) && linkedCustomerIds.has(normalizeId(row.customer_id)))
      || (normalizeCode(row.customer_code) && linkedCodes.has(normalizeCode(row.customer_code)));
    if (!linked) {
      result.skipped += 1;
      result.errors.push({ sheet, row: row.__row, message: "No matching customer row found." });
    }
  });
  addUnlinkedErrors(parsed.contacts, "Contacts");
  addUnlinkedErrors(parsed.products, "Products");

  return result;
};
