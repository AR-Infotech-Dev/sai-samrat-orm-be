import * as XLSX from "xlsx";

export const CUSTOMER_WORKBOOK_SHEETS = {
  instructions: "Instructions",
  customers: "Customers",
  contacts: "Contacts",
  products: "Products",
};

export const CUSTOMER_WORKBOOK_CLEAR_VALUE = "__CLEAR__";

const customerColumns = [
  ["action", "Action", 12],
  ["customer_code", "Customer Code", 16],
  ["customer_id", "Customer ID", 12],
  ["row_version", "Row Version", 20],
  ["name", "Customer Name", 28],
  ["wa_no", "WhatsApp No", 16],
  ["pan_number", "PAN Number", 16],
  ["gst_number", "GST Number", 20],
  ["company_name", "Company Name", 24],
  ["billing_name", "Billing Name", 24],
  ["address", "Address", 34],
  ["billing_address", "Billing Address", 34],
  ["mailing_address", "Mailing Address", 34],
  ["contact_name", "Contact Person", 24],
  ["contact_mobile_numbers", "Contact Mobile Numbers", 26],
  ["contact_email", "Contact Email", 28],
  ["contact_designation", "Contact Designation", 22],
  ["contact_department", "Contact Department", 22],
  ["status", "Status", 12],
];

const contactColumns = [
  ["action", "Action", 12],
  ["customer_code", "Customer Code", 16],
  ["customer_id", "Customer ID", 12],
  ["contact_id", "Contact ID", 12],
  ["name", "Contact Name", 24],
  ["mobile_no", "Mobile Number", 16],
  ["email", "Email", 28],
  ["designation", "Designation", 20],
  ["department", "Department", 20],
  ["is_primary", "Is Primary", 12],
];

const productColumns = [
  ["action", "Action", 12],
  ["customer_code", "Customer Code", 16],
  ["customer_id", "Customer ID", 12],
  ["product_row_key", "Product Row Key", 20],
  ["product_id", "Product ID", 12],
  ["product_name", "Product Name", 26],
  ["serial_number", "Serial Number", 20],
  ["expiry_date", "Expiry Date", 16],
  ["add_ons", "Add-ons", 28],
];

export const CUSTOMER_WORKBOOK_COLUMNS = {
  customers: customerColumns,
  contacts: contactColumns,
  products: productColumns,
};

const normalizeHeader = (value = "") => String(value || "")
  .trim()
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, "_")
  .replace(/^_+|_+$/g, "");

const formatDateOnly = (value) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toISOString().slice(0, 10);
};

const toCustomerCode = (customer = {}, index = 0) =>
  customer.customer_code || (customer.customer_id ? `CUST-${customer.customer_id}` : `NEW-${index + 1}`);

const createSheet = (columns, rows = [], visibleKeys = null) => {
  const headers = columns.map(([, label]) => label);
  const data = rows.map((row) => columns.map(([key]) => row?.[key] ?? ""));
  const sheet = XLSX.utils.aoa_to_sheet([headers, ...data]);
  const systemKeys = new Set(["action", "customer_code", "customer_id", "row_version"]);
  sheet["!cols"] = columns.map(([key, , width]) => ({
    wch: width,
    hidden: visibleKeys instanceof Set && !systemKeys.has(key) && !visibleKeys.has(key),
  }));
  sheet["!autofilter"] = { ref: `A1:${XLSX.utils.encode_col(columns.length - 1)}1` };
  return sheet;
};

const buildInstructionsSheet = () => {
  const rows = [
    ["Customer Import / Update Workbook - Single Sheet"],
    ["Use the Customers sheet only. Customer details and contact person details are in one row."],
    ["Rule", "Meaning"],
    ["Blank cell", "Keep the existing value unchanged during update"],
    [CUSTOMER_WORKBOOK_CLEAR_VALUE, "Clear the existing value"],
    ["Contact Mobile Numbers", "Add multiple numbers in one cell separated by comma, e.g. 9876543210,9123456789"],
    ["IDs / Row Version", "Do not edit system identity columns"],
    ["New customer", "Keep IDs blank. Customer Code is optional."],
    ["Existing customer", "Keep Customer ID and Row Version from export"],
    ["EXAMPLE action", "Example rows are ignored. Clear EXAMPLE before importing your data"],
  ];
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  sheet["!cols"] = [{ wch: 26 }, { wch: 76 }];
  return sheet;
};

export const buildCustomerWorkbook = ({ customers = [], contacts = [], template = false, selectedColumns = [] } = {}) => {
  const workbook = XLSX.utils.book_new();
  const customerRows = template ? [{
    action: "EXAMPLE",
    customer_code: "NEW-001",
    name: "ABC Traders",
    wa_no: "9876543210",
    company_name: "ABC Inc",
    contact_name: "Rakesh Dhumal",
    contact_mobile_numbers: "9876543210,9123456789",
    contact_email: "rakesh@example.com",
    contact_designation: "Owner",
    contact_department: "Management",
    status: "active",
  }] : customers.map((customer, index) => ({
    action: "",
    customer_code: toCustomerCode(customer, index),
    customer_id: customer.customer_id || "",
    row_version: customer.modified_date || customer.created_date || "",
    name: customer.name || "",
    wa_no: customer.wa_no || "",
    pan_number: customer.pan_number || "",
    gst_number: customer.gst_number || "",
    company_name: customer.company_name || "",
    billing_name: customer.billing_name || "",
    address: customer.address || "",
    billing_address: customer.billing_address || "",
    mailing_address: customer.mailing_address || "",
    contact_name: customer.primary_contact_name || customer.contact_name || "",
    contact_mobile_numbers: customer.contact_mobile_numbers || customer.contact_mobile || customer.mobile_no || "",
    contact_email: customer.primary_contact_email || customer.contact_email || customer.email || "",
    contact_designation: customer.primary_contact_designation || customer.contact_designation || "",
    contact_department: customer.primary_contact_department || customer.contact_department || "",
    status: customer.status || "active",
  }));

  const contactRows = template ? [{
    action: "EXAMPLE",
    customer_code: "NEW-001",
    name: "Rakesh Dhumal",
    mobile_no: "9876543210",
    email: "rakesh@example.com",
    designation: "Owner",
    department: "Management",
    is_primary: "y",
  }] : contacts.map((contact) => ({
    action: "",
    customer_code: contact.customer_code || `CUST-${contact.customer_id}`,
    customer_id: contact.customer_id || "",
    contact_id: contact.contact_id || "",
    name: contact.name || "",
    mobile_no: contact.mobile_no || "",
    email: contact.email || "",
    designation: contact.designation || "",
    department: contact.department || "",
    is_primary: contact.is_primary || "n",
  }));

  XLSX.utils.book_append_sheet(workbook, buildInstructionsSheet(), CUSTOMER_WORKBOOK_SHEETS.instructions);
  const visibleKeys = selectedColumns.length ? new Set(selectedColumns.map(String)) : null;
  XLSX.utils.book_append_sheet(workbook, createSheet(customerColumns, customerRows, visibleKeys), CUSTOMER_WORKBOOK_SHEETS.customers);
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
};

const readSheet = (workbook, sheetName, columns) => {
  const sheet = workbook.Sheets?.[sheetName];
  if (!sheet) return [];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: "", raw: false });
  const keyByHeader = new Map(columns.flatMap(([key, label]) => [
    [normalizeHeader(key), key],
    [normalizeHeader(label), key],
  ]));

  return rows.map((source, index) => {
    const row = { __row: index + 2 };
    Object.entries(source).forEach(([header, value]) => {
      const key = keyByHeader.get(normalizeHeader(header));
      if (key) row[key] = value === null || value === undefined ? "" : String(value).trim();
    });
    return row;
  }).filter((row) => Object.entries(row).some(([key, value]) => key !== "__row" && value !== ""));
};

export const isCustomerWorkbook = (workbook) =>
  workbook?.SheetNames?.includes(CUSTOMER_WORKBOOK_SHEETS.customers);

export const parseCustomerWorkbook = (workbook) => ({
  customers: readSheet(workbook, CUSTOMER_WORKBOOK_SHEETS.customers, customerColumns),
  contacts: readSheet(workbook, CUSTOMER_WORKBOOK_SHEETS.contacts, contactColumns),
  products: readSheet(workbook, CUSTOMER_WORKBOOK_SHEETS.products, productColumns),
});
