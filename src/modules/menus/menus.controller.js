import * as CommonModel from "#shared/models/common.model.js";
import { successResponse, failureResponse } from "#shared/utils/apiResponse.js";
import { prepareFilterData } from "#shared/utils/filter.builder.js";
import { toMysqlDateTime } from "#shared/utils/dateTime.js";
import { validateBody } from "#shared/utils/bodyValidator.js";
import { env } from "#config/env.js";

const MODULE_TABLE = "menu_master";

const default_columns = {};

const custom_columns = {
  created_by: {
    table: "admin",
    alias: "ad",
    column: "name",
    key2: "adminID",
  },
  modified_by: {
    table: "admin",
    alias: "am",
    column: "name",
    key2: "adminID",
  },
};

// =============================================
// VALIDATION
// =============================================
const menuValidationRules = {
  menu_name: { label: "Menu Name", required: true },
  table_name: { label: "Table Name" },
  module_name: { label: "Module Name" },
  menu_link: { label: "Menu Link" },
  module_description: { label: "Description" },
  plural_label: { label: "Plural Label" },
  label: { label: "Label" },
  icon_name: { label: "Icon" },
  status: { label: "Status" },
};

// =============================================
// LIST MENU
// =============================================
export const list = async (req, res) => {
  try {
    const {
      page = 1,
      searchText = "",
      getAll = "N",
      orderBy = "menu_index",
      order = "ASC",
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
        searchColumns: ["menuName", "module_name", "menuLink"],
      },
      default_columns,
      custom_columns,
    });

    const { select, where, values, join, other } = filterData;

    const total = await CommonModel.getCountsByParameter({
      table: MODULE_TABLE,
      where,
      values,
      join,
      other,
    });

    const totalPages = Math.ceil(total / limit);
    const end = Math.min(start + limit, total);

    let menuList = [];
    if (getAll === "Y") {
      menuList = await CommonModel.GetMasterListDetails({
        select,
        table: MODULE_TABLE,
        where,
        values,
        join,
        other,
      });
    } else {
      menuList = await CommonModel.GetMasterListDetails({
        select,
        table: MODULE_TABLE,
        where,
        values,
        limit,
        start,
        join,
        other,
      });
    }

    return successResponse(res, {
      code: 1004,
      httpStatus: 200,
      data: {
        data: menuList,
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
export const menulist = async (req, res) => {
  try {
    const {
      page = 1,
      searchText = "",
      getAll = "N",
      orderBy = "menu_index",
      order = "ASC",
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
        searchColumns: ["menuName", "module_name", "menuLink"],
      },
      default_columns,
      custom_columns,
    });

    const { select, where, values, join, other } = filterData;

    const total = await CommonModel.getCountsByParameter({
      table: MODULE_TABLE,
      where,
      values,
      join,
      other,
    });

    const totalPages = Math.ceil(total / limit);
    const end = Math.min(start + limit, total);

    let menuList = [];
    
    if (getAll === "Y") {
      menuList = await CommonModel.GetMasterListDetails({
        select,
        table: MODULE_TABLE,
        where,
        values,
        join,
        other,
      });
    } else {
      menuList = await CommonModel.GetMasterListDetails({
        select,
        table: MODULE_TABLE,
        where,
        values,
        limit,
        start,
        join,
        other,
      });
    }

    return successResponse(res, {
      code: 1004,
      httpStatus: 200,
      data: {
        data: menuList,
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

// =============================================
// CREATE / UPDATE / GET SINGLE
// =============================================
export const getMenuDetails = async (req, res) => {
  try {
    const method = req.method.toUpperCase();
    const { id: menu_id = null } = req.params;

    switch (method) {

      // ================= CREATE =================
      case "PUT": {
        const validation = validateBody(req.body, menuValidationRules);
        if (!validation.isValid) {
          return failureResponse(res, {
            code: 2001,
            httpStatus: 400,
            message: validation.message,
          });
        }
        const data = validation.data;
        data.created_by = req.user.adminID;
        data.created_date = toMysqlDateTime();

        const result = await CommonModel.saveMasterDetails({ table: MODULE_TABLE, data, });

        return successResponse(res, {
          code: 1001,
          httpStatus: 201,
          data: { insertId: result.insertId },
        });
      }

      // ================= UPDATE =================
      case "POST": {
        if (!menu_id) {
          return failureResponse(res, {
            code: 2004,
            httpStatus: 404,
          });
        }

        const validation = validateBody(req.body, menuValidationRules);

        if (!validation.isValid) {
          return failureResponse(res, {
            code: 2001,
            httpStatus: 400,
            message: validation.message,
          });
        }
        const data = validation.data;
        delete data.created_by;
        data.modified_by = req.user.adminID;
        data.modified_date = toMysqlDateTime();

        await CommonModel.updateMasterDetails({
          table: MODULE_TABLE,
          data,
          where: { menu_id },
        });

        return successResponse(res, {
          code: 1002,
          httpStatus: 200,
          data: [],
        });
      }

      // ================= GET SINGLE =================
      case "GET": {
        if (!menu_id) {
          return failureResponse(res, {
            code: 2004,
            httpStatus: 404,
          });
        }

        const details = await CommonModel.getMasterDetails(
          MODULE_TABLE,
          "*",
          { menu_id }
        );

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

// =============================================
// DELETE
// =============================================
export const changeStatus = async (req, res) => {
  try {
    const { action = "", ids = [] } = req.body;

    if (action.toLowerCase() !== "delete") {
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

    await CommonModel.deleteMasterDetails({
      table: MODULE_TABLE,
      where: { menu_id: ids },
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

export const updatePositions = async (req, res) => {
  try {
    const { positions = [] } = req.body;
    
    await CommonModel.updateMenuPositions({
      table: MODULE_TABLE,
      positions,
    });

    return successResponse(res, {
      code: 1002,
      httpStatus: 200,
      data: [],
    });

  } catch (error) {
    console.log(error);
    
    return failureResponse(res, {
      code: 2008,
      httpStatus: 500,
      message: error.message,
    });
  }
}