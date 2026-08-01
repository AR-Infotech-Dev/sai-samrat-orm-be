import * as CommonModel from "#shared/models/common.model.js";
import { successResponse, failureResponse } from "#shared/utils/apiResponse.js";
import { toMysqlDateTime } from "#shared/utils/dateTime.js";
import { validateBody } from "#shared/utils/bodyValidator.js";

const MODULE_TABLE = "module_access";

// =============================================
// VALIDATION
// =============================================
const menuValidationRules = {
  user_id: { label: "User Id", required: true },
  permissions: { label: "Permissions", required: true },
  company_id: { label: "Company ID", required: true },
};

// =============================================
// GET SINGLE
// =============================================
export const getModulesAccess = async (req, res) => {
  try {
    const { id: user_id = null } = req.params;
    const { company_id = "" } = req.query;

    if (!user_id) {
      return failureResponse(res, {
        code: 2004,
        httpStatus: 404,
        message: "User id required",
      });
    }

    const where = company_id ? { user_id, company_id } : { user_id };
    const details = await CommonModel.getMasterDetails(MODULE_TABLE, "*", where);

    if (!details.length) {
      return successResponse(res, {
        code: 1004,
        httpStatus: 200,
        data: {
          data: {},
        },
      });
    }

    return successResponse(res, {
      code: 1004,
      httpStatus: 200,
      data: {
        data: details[0],
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
// CREATE OR UPDATE
// =============================================
export const saveModulesAccess = async (req, res) => {
  try {
    const { id: user_id = null } = req.params;
    if (!user_id) {
      return failureResponse(res, {
        code: 2004,
        httpStatus: 404,
        message: "User id required",
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
    data.user_id = Number(user_id);
    data.permissions = typeof data.permissions === "string"
      ? data.permissions
      : JSON.stringify(data.permissions);

    const existingRows = await CommonModel.getMasterDetails(MODULE_TABLE, "*", {
      user_id: data.user_id,
      company_id: data.company_id,
    });

    if (!existingRows.length) {
      const createData = {
        user_id: data.user_id,
        company_id: data.company_id,
        permissions: data.permissions,
        created_by: req.user.adminID,
        created_date: toMysqlDateTime(),
        status: "active",
      };

      const result = await CommonModel.saveMasterDetails({
        table: MODULE_TABLE,
        data: createData,
      });

      return successResponse(res, {
        code: 1001,
        httpStatus: 201,
        data: {
          insertId: result.insertId,
        },
      });
    }

    const updateData = {
      permissions: data.permissions,
      modified_by: req.user.adminID,
      modified_date: toMysqlDateTime(),
    };

    await CommonModel.updateMasterDetails({
      table: MODULE_TABLE,
      data: updateData,
      where: { access_id: existingRows[0].access_id },
    });

    return successResponse(res, {
      code: 1002,
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
