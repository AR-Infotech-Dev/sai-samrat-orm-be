import * as CommonModel from "#shared/models/common.model.js";
import * as XLSX from "xlsx";
import { successResponse, failureResponse } from "#shared/utils/apiResponse.js";
import { prepareFilterData } from "#shared/utils/filter.builder.js";
import { toMysqlDateTime } from "#shared/utils/dateTime.js";
import { validateBody } from "#shared/utils/bodyValidator.js";
import { isSuperAdminRole as isSuperAdmin } from "#shared/utils/role.utils.js";
import { env } from "#config/env.js";
import { buildProductWorkbook, isProductWorkbook } from "./product-workbook.utils.js";
import { buildProductExportWorkbook, importProductWorkbook } from "./product-workbook.service.js";

const MODULE_TABLE = "products";

const default_columns = {};

const custom_columns = {
  product_type: {
    table: "categories",
    alias: "ctg",
    column: "categoryName",
    key2: "category_id",
    select: "ctg.cat_color AS type_color",
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

const productValidationRules = {
  product_id: { label: "Product ID", type: "number" },
  product_name: { label: "Product Name", required: true },
  product_code: { label: "Product Code", required: true },
  product_type: { label: "Product Type", required: true },
  brand: { label: "Brand", required: true },
  unit: { label: "Product Unit", required: true },
  standard_rate: { label: "Rate", type: "number", required: true },
  weight: { label: "Weight", type: "number" },
  ready_stock: { label: "Ready Stock", type: "number" },
  fg_code: { label: "FG code"},
  product_description: { label: "product_description" },
  gst_rate: { label: "GST Rate", type: "number", required: true },
  status: { label: "Status", required: true },
  company_id: { label: "Company Id", type: "number" },
  created_by: { label: "Created By", type: "number" },
  modified_by: { label: "Modified By", type: "number" },
};

export const list = async (req, res) => {
  try {
    const {
      page = 1,
      searchText = "",
      getAll = "N",
      orderBy = "created_date",
      order = "DESC",
      filters = [],
    } = req.body;
    // const limit = 10;
    const limit = env.perPage;
    const currentPage = Number(page) || 1;
    const start = (currentPage - 1) * limit;

    const filterData = prepareFilterData({
      filters,
      searchText,
      other: {
        orderBy,
        order,
        searchColumns: [
          "product_name",
          "product_description",
        ],
      },
      default_columns,
      custom_columns,
    });

    const { select, where, values, join, other } = filterData;
    other.freeTextSearch = searchText;
    other.searchColumns = [
      "t.product_name",
      "t.product_code",
      "t.brand",
    ];

    const total = await CommonModel.getCountsByParameter({
      table: MODULE_TABLE,
      where,
      values,
      join,
      other,
    });

    const totalPages = Math.ceil(total / limit);
    const end = Math.min(start + limit, total);

    const productDetails = await CommonModel.GetMasterListDetails({
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
        data: productDetails,
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

export const getProductDetails = async (req, res) => {
  try {
    const method = req.method.toUpperCase();
    const { id: product_id = null } = req.params;

    switch (method) {
      case "PUT": {
        const validation = validateBody(req.body, productValidationRules);
        
        if (!validation.isValid) {
          return failureResponse(res, {
            code: 2001,
            httpStatus: 400,
            message: validation.message,
          });
        }

        const data = validation.data;
        delete data.product_id;
        data.created_by = req.user.adminID;
        data.created_date = toMysqlDateTime();

        const result = await CommonModel.saveMasterDetails({
          table: MODULE_TABLE,
          data,
        });

        return successResponse(res, {
          code: 1001,
          httpStatus: 201,
          data: {
            insertId: result.insertId,
          },
        });
      }

      case "POST": {
        if (!product_id) {
          return failureResponse(res, {
            code: 2004,
            httpStatus: 404,
          });
        }

        const where = { product_id };

        const validation = validateBody(req.body, productValidationRules);
        if (!validation.isValid) {
          return failureResponse(res, {
            code: 2001,
            httpStatus: 400,
            message: validation.message,
          });
        }

        const data = validation.data;
        delete data.product_id;
        delete data.company_id;
        delete data.created_by;
        delete data.created_date;
        data.modified_by = req.user.adminID;
        data.modified_date = toMysqlDateTime();

        const result = await CommonModel.updateMasterDetails({
          table: MODULE_TABLE,
          data,
          where,
        });

        if (!result.affectedRows) {
          return failureResponse(res, {
            code: 2004,
            httpStatus: 404,
          });
        }

        return successResponse(res, {
          code: 1002,
          httpStatus: 200,
          data: [],
        });
      }

      case "GET": {
        if (!product_id) {
          return failureResponse(res, {
            code: 2004,
            httpStatus: 404,
          });
        }

        const where = { product_id };
        const details = await CommonModel.getMasterDetails(MODULE_TABLE, "*", where);
        if (!details.length) {
          return failureResponse(res, {
            code: 2004,
            httpStatus: 404,
          });
        }

        return successResponse(res, {
          code: 1004,
          httpStatus: 200,
          data: {
            data: details[0],
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

    const where = { product_id: ids };

    await CommonModel.deleteMasterDetails({
      table: MODULE_TABLE,
      where,
    });

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

export const downloadImportTemplate = async (req, res) => {
  try {
    const buffer = buildProductWorkbook({ template: true });

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", "attachment; filename=product-import-template.xlsx");
    return res.send(buffer);
  } catch (error) {
    return failureResponse(res, {
      code: 2008,
      httpStatus: 500,
      message: error.message,
    });
  }
};

export const importProducts = async (req, res) => {
  try {
    if (!req.file?.buffer) {
      return failureResponse(res, {
        code: 2001,
        httpStatus: 400,
        message: "Product Excel file is required",
      });
    }

    const workbook = XLSX.read(req.file.buffer, { type: "buffer", cellDates: true });
    if (!isProductWorkbook(workbook)) {
      return failureResponse(res, {
        code: 2001,
        httpStatus: 400,
        message: "Products sheet not found. Please use the product import template.",
      });
    }

    const dryRun = String(req.body?.mode || "commit").toLowerCase() === "preview";
    const result = await importProductWorkbook({ workbook, user: req.user, dryRun });

    return successResponse(res, {
      code: dryRun ? 1004 : 1001,
      httpStatus: 200,
      message: dryRun ? "Import preview generated." : (result.inserted || result.updated ? "Product workbook imported successfully." : "No product changes imported."),
      data: result,
    });
  } catch (error) {
    return failureResponse(res, {
      code: 2008,
      httpStatus: 500,
      message: error.message,
    });
  }
};

export const exportProducts = async (req, res) => {
  try {
    const payload = req.method === "GET" ? req.query : req.body;
    const { searchText = "", order_by = "created_date", order = "DESC", filters = [] } = payload || {};

    const filterData = prepareFilterData({
      filters,
      searchText,
      other: {
        orderBy: order_by,
        order,
        searchColumns: [
          "product_name",
          "product_description",
        ],
      },
      default_columns,
      custom_columns,
    });

    const { select, where, values, join, other } = filterData;
    other.freeTextSearch = searchText;
    other.searchColumns = [
      "t.product_name",
      "t.product_code",
      "t.brand",
    ];

    const productDetails = await CommonModel.GetMasterListDetails({
      select,
      table: MODULE_TABLE,
      where,
      values,
      join,
      other,
    });
    const buffer = await buildProductExportWorkbook(productDetails);

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", "attachment; filename=Product-Export.xlsx");
    return res.send(buffer);
  } catch (error) {
    return failureResponse(res, {
      code: 2008,
      httpStatus: 500,
      message: error.message,
    });
  }
};
