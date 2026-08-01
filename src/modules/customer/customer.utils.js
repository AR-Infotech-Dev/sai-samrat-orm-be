import * as XLSX from "xlsx";
import { toMysqlDateTime } from "#shared/utils/dateTime.js";
import { isSuperAdminRole } from "#shared/utils/role.utils.js";
import { CUSTOMER_IMPORT_COLUMNS } from "./customer.constants.js";

export const isSuperAdmin = (user = {}) =>
  isSuperAdminRole(user);

export const normalizeProductIds = (value) => {
  if (Array.isArray(value)) {
    return value.map(String).map((item) => item.trim()).filter(Boolean);
  }

  if (value === undefined || value === null) {
    return [];
  }

  return String(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
};

const splitImportValues = (value) => {
  if (Array.isArray(value)) {
    return value.map(String).map((item) => item.trim()).filter(Boolean);
  }

  if (value === undefined || value === null) {
    return [];
  }

  const text = String(value).trim();
  if (!text) return [];

  return text
    .split(text.includes("|") ? "|" : ",")
    .map((item) => item.trim())
    .filter(Boolean);
};

const splitImportAddOnGroups = (value) => {
  if (value === undefined || value === null) return [];

  return String(value)
    .split("|")
    .map((group) =>
      group
        .split(/[+,]/)
        .map((item) => item.trim())
        .filter(Boolean)
    );
};

export const normalizeAddOns = (value = []) => {
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (typeof item === "object" && item !== null) {
          return String(item.name || item.add_on_name || item.label || "").trim();
        }

        return String(item || "").trim();
      })
      .filter(Boolean);
  }

  if (value === undefined || value === null) {
    return [];
  }

  return String(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
};

export const normalizeCustomerProducts = (value) => {
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return normalizeCustomerProducts(parsed);
    } catch {
      return normalizeProductIds(value).map((product_id) => ({ product_id, serial_number: "" }));
    }
  }

  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (typeof item === "object" && item !== null) {
          return {
            product_id: item.product_id,
            product_name: item.product_name || "",
            serial_number: item.serial_number || "",
            expiry_date: item.expiry_date || "",
            add_ons: normalizeAddOns(item.add_ons || item.addons || item.addOns),
          };
        }

        return {
          product_id: item,
          product_name: "",
          serial_number: "",
          expiry_date: "",
          add_ons: [],
        };
      })
      .filter((item) => item.product_id);
  }

  return [];
};

export const parseCustomerProducts = (value) => {
  if (Array.isArray(value)) return value;
  if (!value) return [];

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

export const normalizeCustomerContacts = (value) => {
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return normalizeCustomerContacts(parsed);
    } catch {
      return [];
    }
  }

  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => ({
      contact_id: item?.contact_id || null,
      name: String(item?.name || item?.contact_person || "").trim(),
      designation: String(item?.designation || "").trim(),
      mobile_no: String(item?.mobile_no || item?.contact_no || "").trim(),
      email: String(item?.email || "").trim(),
      is_primary: String(item?.is_primary || "n").toLowerCase() === "y" || item?.is_primary === true ? "y" : "n",
      department: String(item?.department || "").trim(),
    }))
    .filter((item) => item.name || item.designation || item.mobile_no || item.email || item.department);
};

export const validateCustomerContacts = (contacts = [], { requirePrimary = true } = {}) => {
  if (!contacts.length) {
    return { isValid: false, message: "At least one contact person is required" };
  }

  const invalidContact = contacts.find((contact) => !contact.name || !contact.mobile_no);
  if (invalidContact) {
    return { isValid: false, message: "Contact name and mobile number are required" };
  }

  const invalidMobile = contacts.find((contact) => !/^[0-9]\d{9}$/.test(String(contact.mobile_no || "")));
  if (invalidMobile) {
    return { isValid: false, message: `Contact mobile number ${invalidMobile.mobile_no || ""} must be a valid 10-digit number` };
  }

  const invalidEmail = contacts.find((contact) => contact.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(contact.email).trim()));
  if (invalidEmail) {
    return { isValid: false, message: `Contact email ${invalidEmail.email} must be a valid email` };
  }

  const primaryCount = contacts.filter((contact) => contact.is_primary === "y").length;
  if (primaryCount > 1 || (requirePrimary && primaryCount !== 1)) {
    return { isValid: false, message: "One primary contact is required" };
  }

  return { isValid: true };
};

const normalizeHeader = (value = "") =>
  String(value || "")
    .toLowerCase()
    .replace(/\*/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

const importHeaderMap = CUSTOMER_IMPORT_COLUMNS.reduce((map, column) => {
  map[normalizeHeader(column.label)] = column.key;
  map[normalizeHeader(column.key)] = column.key;
  return map;
}, {});

export const getCellValue = (value) => {
  if (value === undefined || value === null) return "";
  return String(value).trim();
};

export const normalizeYesNo = (value) => {
  const normalized = String(value || "").trim().toLowerCase();
  if (["yes", "y", "1", "true", "amc"].includes(normalized)) return "yes";
  if (["no", "n", "0", "false", "non amc", "non-amc"].includes(normalized)) return "no";
  return normalized || "no";
};

export const normalizeTermPeriod = (value) => {
  const normalized = String(value || "").trim().toLowerCase().replace(/\s+/g, "_");
  if (["4", "4_month", "4month", "4_months"].includes(normalized)) return "4_month";
  if (["6", "6_month", "6month", "6_months"].includes(normalized)) return "6_month";
  if (["year", "yearly", "annual", "1_year"].includes(normalized)) return "yearly";
  return normalized || null;
};

export const normalizeImportDate = (value) => {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().split("T")[0];
  }

  if (typeof value === "number") {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed) {
      return `${parsed.y}-${String(parsed.m).padStart(2, "0")}-${String(parsed.d).padStart(2, "0")}`;
    }
  }

  const text = String(value).trim();
  const date = new Date(text);
  if (!Number.isNaN(date.getTime())) return date.toISOString().split("T")[0];
  return text;
};

const buildCustomerProductsFromImport = (productIdsValue, serialNumbersValue, productNamesValue, expiryDatesValue, addOnsValue) => {
  const productIds = splitImportValues(productIdsValue);
  const serialNumbers = splitImportValues(serialNumbersValue);
  const productNames = splitImportValues(productNamesValue);
  const expiryDates = splitImportValues(expiryDatesValue).map(normalizeImportDate);
  const addOnGroups = splitImportAddOnGroups(addOnsValue);
  const maxRows = Math.max(productIds.length, productNames.length, serialNumbers.length, expiryDates.length);

  return Array.from({ length: maxRows }, (_, index) => ({
    product_id: productIds[index] || "",
    product_name: productNames[index] || "",
    expiry_date: expiryDates[index] || "",
    serial_number: serialNumbers[index] || "",
    add_ons: addOnGroups[index] || [],
  })).filter((item) => item.product_id || item.product_name || item.serial_number || item.expiry_date);
};

const buildCustomerContactsFromImport = (rowData = {}) => {
  const names = splitImportValues(rowData.contact_names || rowData.contact_person);
  const mobiles = splitImportValues(rowData.contact_mobiles || rowData.mobile_no);
  const emails = splitImportValues(rowData.contact_emails || rowData.email);
  const designations = splitImportValues(rowData.contact_designations);
  const departments = splitImportValues(rowData.contact_departments);
  const primaryMobile = String(rowData.primary_contact_mobile || mobiles[0] || "").trim();
  const maxRows = Math.max(names.length, mobiles.length, emails.length, designations.length, departments.length);

  return Array.from({ length: maxRows }, (_, index) => {
    const mobile = mobiles[index] || "";

    return {
      name: names[index] || "",
      mobile_no: mobile,
      email: emails[index] || "",
      designation: designations[index] || "",
      department: departments[index] || "",
      is_primary: String(mobile || "").trim() === primaryMobile ? "y" : "n",
    };
  }).filter((item) => item.name || item.mobile_no || item.email || item.designation || item.department);
};

export const rowLooksEmpty = (row = []) => row.every((cell) => getCellValue(cell) === "");

export const rowLooksLikeTemplateKeyRow = (data = {}) =>
  String(data.name || "").toLowerCase() === "name" ||
  String(data.mobile_no || data.contact_mobiles || "").toLowerCase() === "mobile_no" ||
  String(data.contact_mobiles || "").toLowerCase() === "contact_mobiles";

export const rowLooksLikeSampleRow = (data = {}) =>
  String(data.name || "") === "ABC Traders" &&
  ["9876543210", "9876543210|9876543211"].includes(String(data.mobile_no || data.contact_mobiles || ""));

export const findImportHeaderIndex = (rows = []) =>
  rows.findIndex((row) => {
    const keys = row.map((cell) => importHeaderMap[normalizeHeader(cell)]).filter(Boolean);
    return keys.includes("name") && (keys.includes("contact_mobiles") || keys.includes("mobile_no"));
  });

export const buildImportDataFromRow = (headers = [], row = []) => {
  const data = {};

  headers.forEach((header, index) => {
    const key = importHeaderMap[normalizeHeader(header)];
    if (!key) return;
    data[key] = getCellValue(row[index]);
  });

  return data;
};

export const buildCustomerPayloadFromImport = (rowData = {}, user = {}) => {
  const customerProducts = buildCustomerProductsFromImport(
    rowData.product_ids,
    rowData.serial_numbers,
    rowData.product_names,
    rowData.product_expiry_dates,
    rowData.product_add_ons,
  );
  const customerContacts = buildCustomerContactsFromImport(rowData);
  const primaryContact = customerContacts.find((contact) => contact.is_primary === "y") || customerContacts[0] || null;
  const payload = {
    name: rowData.name,
    contact_person: primaryContact?.name || rowData.contact_person || null,
    mobile_no: primaryContact?.mobile_no || rowData.mobile_no || null,
    email: primaryContact?.email || rowData.email || null,
    wa_no: rowData.wa_no || null,
    address: rowData.address || null,
    pan_number: rowData.pan_number || null,
    gst_number: rowData.gst_number || null,
    company_name: rowData.company_name || null,
    billing_name: rowData.billing_name || null,
    billing_address: rowData.billing_address || null,
    mailing_address: rowData.mailing_address || null,
    is_amc: normalizeYesNo(rowData.is_amc),
    amc_term_period: normalizeTermPeriod(rowData.amc_term_period),
    amc_start_date: normalizeImportDate(rowData.amc_start_date),
    amc_end_date: normalizeImportDate(rowData.amc_end_date),
    customer_products: JSON.stringify(customerProducts),
    customer_contacts: customerContacts,
    contact_persons: customerContacts,
    created_by: user.adminID || null,
    company_id: user.company_id || rowData.company_id || null,
    created_date: toMysqlDateTime(),
  };

  if (payload.is_amc !== "yes") {
    payload.amc_term_period = null;
    payload.amc_start_date = null;
    payload.amc_end_date = null;
  }

  Object.keys(payload).forEach((key) => {
    if (payload[key] === undefined || payload[key] === "") payload[key] = null;
  });

  return payload;
};

export const filterPayloadByColumns = (payload = {}, columns = new Set()) =>
  Object.entries(payload).reduce((data, [key, value]) => {
    if (columns.has(key)) {
      data[key] = value;
    }
    return data;
  }, {});
