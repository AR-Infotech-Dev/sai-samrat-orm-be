import * as CommonModel from "#shared/models/common.model.js";
import { successResponse, failureResponse } from "#shared/utils/apiResponse.js";
import { prepareFilterData } from "#shared/utils/filter.builder.js";
import { toMysqlDateTime } from "#shared/utils/dateTime.js";
import { validateBody } from "#shared/utils/bodyValidator.js";
import { CUSTOMER_SEARCH_COLUMNS, MODULE_TABLE } from "./customer.constants.js";
import { customColumns, defaultColumns } from "./customer.filter.js";
import { customerValidationRules } from "./customer.validation.js";
import {
  createCustomer,
  deleteCustomers,
  findCustomerProductSerialConflicts,
  findExistingCustomerDuplicateKeys,
  getCustomerById,
  getCustomerContacts,
  getCustomerTableColumns,
  replaceCustomerContacts,
  updateCustomer,
} from "./customer.model.js";
import {
  buildCustomerPayloadFromImport,
  buildImportDataFromRow,
  filterPayloadByColumns,
  findImportHeaderIndex,
  isSuperAdmin,
  normalizeCustomerProducts,
  normalizeCustomerContacts,
  parseCustomerProducts,
  rowLooksEmpty,
  rowLooksLikeSampleRow,
  rowLooksLikeTemplateKeyRow,
  validateCustomerContacts,
} from "./customer.utils.js";
import * as XLSX from "xlsx";
import { env } from "#config/env.js";
import { buildCustomerWorkbook, isCustomerWorkbook } from "./customer-workbook.utils.js";
import { buildCustomerExportWorkbook, importCustomerWorkbook } from "./customer-workbook.service.js";

const buildCustomerDuplicateKey = ({ name = "", email = "", company_id = null } = {}) => {
  const normalizedName = String(name || "").trim().toLowerCase();
  const normalizedEmail = String(email || "").trim().toLowerCase();

  if (!normalizedName || !normalizedEmail) {
    return "";
  }

  return `${company_id ?? "no-company"}::${normalizedName}::${normalizedEmail}`;
};

const getDuplicateSerialNumbers = (products = []) => {
  const seen = new Set();
  const duplicates = new Set();

  products.forEach((product) => {
    const serial = String(product?.serial_number || "").trim().toLowerCase();
    if (!serial) return;

    if (seen.has(serial)) {
      duplicates.add(String(product.serial_number || "").trim());
      return;
    }

    seen.add(serial);
  });

  return [...duplicates];
};

const validateCustomerProductSerials = async ({ products = [], excludeCustomerId = null } = {}) => {
  const duplicateSerials = getDuplicateSerialNumbers(products);

  if (duplicateSerials.length) {
    return {
      isValid: false,
      message: `Duplicate product serial number in this customer: ${duplicateSerials.join(", ")}`,
    };
  }

  const conflicts = await findCustomerProductSerialConflicts({
    serialNumbers: products.map((product) => product.serial_number),
    excludeCustomerId,
  });

  if (conflicts.length) {
    const conflict = conflicts[0];
    return {
      isValid: false,
      message: `Product serial number ${conflict.serial_number} already exists for customer ${conflict.customer_name || conflict.customer_id}`,
    };
  }

  return { isValid: true };
};

// ======================================================
// LIST CUSTOMERS
// ======================================================
export const list = async (req, res) => {
  try {
    const { page = 1, searchText = "", getAll = "N", order_by = "created_date", order = "DESC", filters = [], } = req.body;
    // const limit = env. 10;
    const limit = env.perPage;
    const currentPage = Number(page) || 1;
    const start = (currentPage - 1) * limit;

    const filterData = prepareFilterData({
      filters,
      searchText,
      other: {
        orderBy: order_by,
        order,
        searchColumns: CUSTOMER_SEARCH_COLUMNS,
      },
      default_columns: defaultColumns,
      custom_columns: customColumns,
    });

    const { select, where, values, join, other } = filterData;
    other.freeTextSearch = searchText;
    other.searchColumns = CUSTOMER_SEARCH_COLUMNS;

    const total = await CommonModel.getCountsByParameter({ table: MODULE_TABLE, where, values, join, other, });
    const totalPages = Math.ceil(total / limit);
    const end = Math.min(start + limit, total);
    let customerDetails = [];

    if (getAll === "Y") {
      customerDetails = await CommonModel.GetMasterListDetails({ select, table: MODULE_TABLE, where, values, join, other, });
    } else {
      customerDetails = await CommonModel.GetMasterListDetails({ select, table: MODULE_TABLE, where, values, limit, start, join, other, });
    }
    return successResponse(res, {
      code: 1004,
      httpStatus: 200,
      data: {
        data: customerDetails,
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
    return failureResponse(res, {
      code: 2008,
      httpStatus: 500,
      message: error.message,
    });
  }
};
// ======================================================
// CREATE / UPDATE / GET SINGLE
// ======================================================
export const getCustomerDetails = async (req, res) => {
  try {
    const method = req.method.toUpperCase();
    const { id: customer_id = null } = req.params;

    switch (method) {
      case "PUT": {
        const validation = validateBody(req.body, customerValidationRules);
        if (!validation.isValid) {
          return failureResponse(res, {
            code: 2001,
            httpStatus: 400,
            message: validation.message,
          });
        }
        console.log('1');
        
        const data = validation.data;
        const customerContacts = normalizeCustomerContacts(req.body.customer_contacts ?? req.body.contact_persons);
        const customerProducts = normalizeCustomerProducts(req.body.customer_products ?? req.body.product_ids);
        const serialValidation = await validateCustomerProductSerials({ products: customerProducts });
        if (!serialValidation.isValid) {
          return failureResponse(res, {
            code: 2001,
            httpStatus: 400,
            message: serialValidation.message,
          });
        }
        
        console.log('2');
        delete data.product_ids;
        delete data.customer_contacts;
        delete data.contact_persons;
        data.customer_products = JSON.stringify(customerProducts);
        data.created_by = req.user.adminID;
        data.company_id = data.company_id || null;
        data.created_date = toMysqlDateTime();
        
        console.log('3');
        console.log('data',data);
        const result = await createCustomer(data);
        console.log('4');

        
        await replaceCustomerContacts({ customerId: result.insertId, contacts: customerContacts, user: req.user });

        return successResponse(res, {
          code: 1001,
          httpStatus: 201,
          data: {
            insertId: result.insertId,
          },
        });
      }

      case "POST": {
        if (!customer_id) {
          return failureResponse(res, {
            code: 2004,
            httpStatus: 404,
          });
        }

        const validation = validateBody(req.body, customerValidationRules);
        if (!validation.isValid) {
          return failureResponse(res, {
            code: 2001,
            httpStatus: 400,
            message: validation.message,
          });
        }

        const data = validation.data;
        const customerContacts = normalizeCustomerContacts(req.body.customer_contacts ?? req.body.contact_persons);
        const customerProducts = normalizeCustomerProducts(req.body.customer_products ?? req.body.product_ids);
        const serialValidation = await validateCustomerProductSerials({ products: customerProducts, excludeCustomerId: customer_id });
        if (!serialValidation.isValid) {
          return failureResponse(res, {
            code: 2001,
            httpStatus: 400,
            message: serialValidation.message,
          });
        }

        delete data.customer_id;
        delete data.product_ids;
        delete data.customer_contacts;
        delete data.contact_persons;
        data.customer_products = JSON.stringify(customerProducts);
        delete data.created_by;
        data.modified_by = req.user.adminID;

        const result = await updateCustomer(customer_id, data);

        if (!result.affectedRows) {
          return failureResponse(res, {
            code: 2004,
            httpStatus: 404,
          });
        }

        await replaceCustomerContacts({ customerId: customer_id, contacts: customerContacts, user: req.user });

        return successResponse(res, {
          code: 1002,
          httpStatus: 200,
          data: [],
        });
      }

      case "GET": {
        if (!customer_id) {
          return failureResponse(res, {
            code: 2004,
            httpStatus: 404,
          });
        }

        const details = await getCustomerById(customer_id);

        if (!details.length) {
          return failureResponse(res, {
            code: 2004,
            httpStatus: 404,
          });
        }

        const customerData = details[0];
        const products = parseCustomerProducts(customerData.customer_products);
        const contacts = await getCustomerContacts(customer_id);
        customerData.product_ids = products.map((product) => product.product_id);
        customerData.customer_products = products;
        customerData.products = products;
        customerData.customer_contacts = contacts;
        customerData.contact_persons = contacts;

        return successResponse(res, {
          code: 1004,
          httpStatus: 200,
          data: {
            data: customerData,
          },
        });
      }

      default:
        return failureResponse(res, {
          code: 2000,
          httpStatus: 405,
        });
    }
  } catch (error) {
    return failureResponse(res, {
      code: 2008,
      httpStatus: 500,
      message: error.message,
    });
  }
};

// ======================================================
// DELETE
// ======================================================
export const changeStatus = async (req, res) => {
  try {
    const { action = "", ids = [] } = req.body;

    if (action.trim().toLowerCase() !== "delete") {
      return failureResponse(res, {
        code: 2000,
        httpStatus: 400,
        message: "Invalid action",
      });
    }

    if (!Array.isArray(ids) || !ids.length) {
      return failureResponse(res, {
        code: 2001,
        httpStatus: 400,
        message: "ids are required",
      });
    }

    await deleteCustomers(ids);

    return successResponse(res, {
      code: 1003,
      httpStatus: 200,
      data: [],
    });
  } catch (error) {
    return failureResponse(res, {
      code: 2008,
      httpStatus: 500,
      message: error.message,
    });
  }
};

// ======================================================
// CUSTOMER IMPORT TEMPLATE
// ======================================================
export const downloadImportTemplate = async (req, res) => {
  try {
    const buffer = buildCustomerWorkbook({ template: true });

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", "attachment; filename=customer-import-template.xlsx");
    return res.send(buffer);
  } catch (error) {
    return failureResponse(res, {
      code: 2008,
      httpStatus: 500,
      message: error.message,
    });
  }
};
// ======================================================
// IMPORT CUSTOMERS
// ======================================================
export const importCustomers = async (req, res) => {
  try {
    if (!req.file?.buffer) {
      return failureResponse(res, {
        code: 2001,
        httpStatus: 400,
        message: "Customer Excel file is required",
      });
    }

    const workbook = XLSX.read(req.file.buffer, { type: "buffer", cellDates: true });
    if (isCustomerWorkbook(workbook)) {
      const dryRun = String(req.body?.mode || "commit").toLowerCase() === "preview";
      const result = await importCustomerWorkbook({ workbook, user: req.user, dryRun });
      return successResponse(res, {
        code: dryRun ? 1004 : 1001,
        httpStatus: 200,
        message: dryRun ? "Import preview generated." : (result.inserted || result.updated ? "Customer workbook imported successfully." : "No customer changes imported."),
        data: result,
      });
    }
    if (String(req.body?.mode || "commit").toLowerCase() === "preview") {
      return successResponse(res, {
        code: 1004,
        httpStatus: 200,
        message: "Legacy single-sheet file detected. Apply Changes will use the legacy insert-only import.",
        data: { inserted: 0, updated: 0, unchanged: 0, skipped: 0, errors: [], preview: true, legacy: true },
      });
    }
    const sheetName = workbook.SheetNames?.[0];
    const sheet = sheetName ? workbook.Sheets[sheetName] : null;

    if (!sheet) {
      return failureResponse(res, {
        code: 2001,
        httpStatus: 400,
        message: "Excel sheet not found",
      });
    }

    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", raw: false });
    const headerIndex = findImportHeaderIndex(rows);

    if (headerIndex === -1) {
      return failureResponse(res, {
        code: 2001,
        httpStatus: 400,
        message: "Template header not found. Please use the customer import template.",
      });
    }

    const headers = rows[headerIndex];
    const tableColumns = await getCustomerTableColumns();
    const errors = [];
    const validRows = [];
    const importDuplicateKeys = new Set();
    let inserted = 0;
    let skipped = 0;

    for (let index = headerIndex + 1; index < rows.length; index += 1) {
      const row = rows[index];
      const rowNumber = index + 1;

      if (rowLooksEmpty(row)) {
        continue;
      }

      const rowData = buildImportDataFromRow(headers, row);

      if (rowLooksLikeTemplateKeyRow(rowData) || rowLooksLikeSampleRow(rowData)) {
        skipped += 1;
        continue;
      }

      if (!rowData.name || !(rowData.contact_mobiles || rowData.mobile_no)) {
        skipped += 1;
        errors.push({ row: rowNumber, message: "Customer Name and Contact Mobiles are required" });
        continue;
      }

      const payload = buildCustomerPayloadFromImport(rowData, req.user);
      const contacts = normalizeCustomerContacts(payload.customer_contacts);
      const contactValidation = validateCustomerContacts(contacts);
      if (!contactValidation.isValid) {
        skipped += 1;
        errors.push({ row: rowNumber, message: contactValidation.message });
        continue;
      }

      const validation = validateBody(payload, customerValidationRules);

      if (!validation.isValid) {
        skipped += 1;
        errors.push({ row: rowNumber, message: validation.message });
        continue;
      }

      validRows.push({
        rowNumber,
        payload,
        contacts,
      });
    }

    const existingDuplicateKeys = await findExistingCustomerDuplicateKeys(validRows.map((row) => row.payload));
    const rowsToCreate = [];
    const importSerialNumbers = new Set();

    for (const { rowNumber, payload, contacts } of validRows) {
      const duplicateKey = buildCustomerDuplicateKey(payload);
      if (duplicateKey) {
        if (importDuplicateKeys.has(duplicateKey)) {
          skipped += 1;
          errors.push({ row: rowNumber, message: "Duplicate customer skipped from import file. Same Customer Name and Email already exists in this file." });
          continue;
        }

        if (existingDuplicateKeys.has(duplicateKey)) {
          skipped += 1;
          errors.push({ row: rowNumber, message: "Duplicate customer skipped. Same Customer Name and Email already exists." });
          continue;
        }

        importDuplicateKeys.add(duplicateKey);
      }

      const products = parseCustomerProducts(payload.customer_products);
      const rowDuplicateSerials = getDuplicateSerialNumbers(products);
      if (rowDuplicateSerials.length) {
        skipped += 1;
        errors.push({ row: rowNumber, message: `Duplicate product serial number in this customer: ${rowDuplicateSerials.join(", ")}` });
        continue;
      }

      const repeatedImportSerial = products
        .map((product) => String(product?.serial_number || "").trim())
        .find((serial) => serial && importSerialNumbers.has(serial.toLowerCase()));
      if (repeatedImportSerial) {
        skipped += 1;
        errors.push({ row: rowNumber, message: `Duplicate product serial number skipped from import file: ${repeatedImportSerial}` });
        continue;
      }

      const serialValidation = await validateCustomerProductSerials({ products });
      if (!serialValidation.isValid) {
        skipped += 1;
        errors.push({ row: rowNumber, message: serialValidation.message });
        continue;
      }

      products.forEach((product) => {
        const serial = String(product?.serial_number || "").trim().toLowerCase();
        if (serial) importSerialNumbers.add(serial);
      });

      const insertPayload = filterPayloadByColumns(payload, tableColumns);
      rowsToCreate.push({ payload: insertPayload, contacts });
    }

    for (const row of rowsToCreate) {
      const result = await createCustomer(row.payload);
      if (result?.insertId) {
        await replaceCustomerContacts({ customerId: result.insertId, contacts: row.contacts, user: req.user });
      }
      inserted += result?.affectedRows || 1;
    }

    return successResponse(res, {
      code: 1001,
      httpStatus: 200,
      message: inserted ? "Customers imported successfully." : "No customers imported.",
      data: {
        inserted,
        skipped,
        errors,
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


export const downloadExcel = async (req, res) => {
  try {
    const payload = req.method === "GET" ? req.query : req.body;
    const { searchText = "", order_by = "created_date", order = "DESC", filters = [], selectedColumns = [], visibleColumns = [] } = payload || {};
    const filterData = prepareFilterData({
      filters,
      searchText,
      other: {
        orderBy: order_by,
        order,
        searchColumns: CUSTOMER_SEARCH_COLUMNS,
      },
      default_columns: defaultColumns,
      custom_columns: customColumns,
    });

    const { select, where, values, join, other } = filterData;
    other.freeTextSearch = searchText;
    other.searchColumns = CUSTOMER_SEARCH_COLUMNS;

    const customerDetails = await CommonModel.GetMasterListDetails({ select: `${select}, t.company_id AS source_company_id`, table: MODULE_TABLE, where, values, join, other, });
    const exportColumns = Array.isArray(selectedColumns) && selectedColumns.length ? selectedColumns : visibleColumns;
    const buffer = await buildCustomerExportWorkbook(customerDetails, Array.isArray(exportColumns) ? exportColumns : []);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", "attachment; filename=Customer-Export.xlsx");
    return res.send(buffer);
  } catch (error) {
    return failureResponse(res, {
      code: 2008,
      httpStatus: 500,
      message: error.message,
    });
  }
};
