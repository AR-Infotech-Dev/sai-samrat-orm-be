import * as CommonModel from "#shared/models/common.model.js";
import { successResponse, failureResponse } from "#shared/utils/apiResponse.js";
import { prepareFilterData } from "#shared/utils/filter.builder.js";
import { validate } from "#shared/utils/request.validator.js";
import { toMysqlDateTime } from "#shared/utils/dateTime.js";
import { buildTablePayload } from "#shared/utils/tablePayload.js";
import Joi from "joi";
import { sendEmail } from "#shared/utils/email.js";
import { env } from "#config/env.js";
import { renderTemplate } from "#shared/utils/templateMaker.js";
import { hashPassword, verifyPassword } from "#shared/utils/password.js";
import { DB_PREFIX, query } from "#config/database.js";
import { getUserCompanyId, isSuperAdminRole } from "#shared/utils/role.utils.js";

const MODULE_TABLE = "admin";
const USER_LOCATION_LOGS_TABLE = "user_location_logs";

const locationLogSchema = Joi.object({
  status: Joi.alternatives().try(Joi.string()).required(),
  latitude: Joi.alternatives().try(Joi.string(), Joi.number()).required(),
  longitude: Joi.alternatives().try(Joi.string(), Joi.number()).required(),
  location: Joi.string().allow("", null),
  alive_data: Joi.any().allow(null),
});

const sanitizeSqlPayload = (payload = {}) =>
  Object.entries(payload).reduce((data, [key, value]) => {
    data[key] = value === undefined ? null : value;
    return data;
  }, {});

const normalizeJsonValue = (value) => {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  if (typeof value === "string") {
    return value;
  }

  return JSON.stringify(value);
};

const getLocationPayload = (body = {}) => ({
  status: body.status ?? body.status,
  latitude: body.latitude ?? body.lat,
  longitude: body.longitude ?? body.lng,
  location: body.location ?? body.google_location ?? body.address ?? null,
  alive_data: body.alive_data ?? null,
});

const saveUserLocationLog = async ({ req, eventType }) => {
  const adminID = req.user?.adminID;

  if (!adminID) {
    return {
      error: {
        code: 2004,
        httpStatus: 404,
        message: "User not found",
      },
    };
  }

  const payload = getLocationPayload(req.body);
  const result = validate(locationLogSchema, payload);

  if (!result.isValid) {
    return {
      error: {
        code: 2001,
        httpStatus: 400,
        message: result.message.replace(/"/g, ""),
      },
    };
  }

  const data = result.value;
  const now = toMysqlDateTime();
  const aliveData = normalizeJsonValue(data.alive_data);
  const companyId = req.user?.company_id ?? null;

  await CommonModel.saveMasterDetails({
    table: USER_LOCATION_LOGS_TABLE,
    data: sanitizeSqlPayload({
      adminID,
      company_id: companyId,
      event_type: eventType,
      latitude: String(data.latitude),
      longitude: String(data.longitude),
      location: data.location || null,
      alive_data: aliveData,
      status: String(data.status),
      created_by: adminID,
      created_date: now,
    }),
  });

  await CommonModel.updateMasterDetails({
    table: MODULE_TABLE,
    data: sanitizeSqlPayload({
      status: String(data.status),
      latitude: String(data.latitude),
      longitude: String(data.longitude),
      alive_data: aliveData,
      modified_by: adminID,
      modified_date: now,
    }),
    where: { adminID },
  });

  return { data };
};

// ======================================================
// VALIDATION SCHEMA
// ======================================================
const userSchema = Joi.object({
  adminID: Joi.number().integer().positive().allow(null),
  name: Joi.string().required(),
  default_company: Joi.number().allow(null).default(null),
  time_zone: Joi.string().allow("", null),
  company_id: Joi.number().integer().allow(null),

  is_approver: Joi.string().valid("yes", "no").default("no"),
  userName: Joi.string().required(),
  email: Joi.string().email().required(),
  isEmailSend: Joi.string().valid("yes", "no").default("no"),

  password: Joi.string().allow("", null),

  is_sys_user: Joi.string().valid("yes", "no").default("no"),
  roleID: Joi.number().integer().required(),

  address: Joi.string().allow("", null),
  google_location: Joi.string().allow("", null),

  contactNo: Joi.string().allow("", null),
  whatsappNo: Joi.string().allow("", null),

  dateOfBirth: Joi.date().allow(null),

  created_by: Joi.number().integer().allow(null),
  modified_by: Joi.number().integer().allow(null),

  status: Joi.string().default("active"),

  user_setting: Joi.any().allow(null),
  photo: Joi.string().allow("", null),

  latitude: Joi.string().allow("", null),
  longitude: Joi.string().allow("", null),
  country_code: Joi.string().allow("", null),

  otp: Joi.any().allow("", null),
  isVerified: Joi.string().valid("Y", "N").default("N"),

  lastLogin: Joi.date().allow(null),
  gfcmToken: Joi.string().allow("", null),

  is_google_sync: Joi.string().valid("y", "n").default("n"),
  is_one_drive_sync: Joi.string().valid("y", "n").default("n"),

  g_cal_token: Joi.string().allow("", null),
  one_drive_access_token: Joi.string().allow("", null),

  otp_exp_time: Joi.date().allow(null),
  active_session_id: Joi.string().allow(null),
  active_session_id_mob: Joi.string().allow(null),

  created_date: Joi.date().allow(null),
  modified_date: Joi.date().allow(null),
});

// ======================================================
// LIST USERS
// ======================================================
const default_columns = {
  roleID: {
    table: "user_role_master",
    alias: "r",
    column: "roleName",
    key2: "roleID",
    select: "",
  },
  default_company: {
    table: "company_master",
    alias: "dc",
    column: "company_name",
    key2: "company_id",
    select: "",
  },

};

const custom_columns = {
  modified_by: {
    table: "admin",
    alias: "am",
    column: "name",
    key2: "adminID",
    select: "",
  },
  created_by: {
    table: "admin",
    alias: "ad",
    column: "name",
    key2: "adminID",
    select: "",
  },
};

export const list = async (req, res) => {
  try {
    const {
      page = 1,
      searchText = "",
      getAll = "N",
      orderBy = "created_date",
      order = "DESC",
      company_id = null,
      filters,
    } = req.body;

    // const limit = 10;
    const limit = env.perPage;

    const currentPage = Number(page) || 1;
    const start = (currentPage - 1) * limit;

    const other1 = {
      orderBy,
      order,
      searchColumns: ["ad.name", "am.name", "r.roleName", 't.userName', "t.email"],
    };

    const filterData = prepareFilterData({
      filters,
      searchText,
      other: other1,
      default_columns,
      custom_columns,
    });

    const { select, where, values, join, other } = filterData;
    const scopedCompanyId = isSuperAdminRole(req.user?.role_slug)
      ? null
      : getUserCompanyId(req.user);

    if (scopedCompanyId) {
      where.push("t.company_id = ?");
      values.push(scopedCompanyId);
    }
    // HIDE SUPER ADMIN FROM LIST
    where.push("r.slug != ?");
    values.push('super_admin');

    const total = await CommonModel.getCountsByParameter({
      table: MODULE_TABLE,
      where,
      values,
      join,
      other,
    });

    const totalPages = Math.ceil(total / limit);

    let end = start + limit;
    if (end > total) end = total;

    let data = [];

    if (getAll === "Y") {
      data = await CommonModel.GetMasterListDetails({
        select,
        table: MODULE_TABLE,
        where,
        values,
        join,
        other,
      });
    } else {
      data = await CommonModel.GetMasterListDetails({
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
        data,
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
export const listNoAuth = async (req, res) => {
  try {
    const { searchText = "", getAll = "N", orderBy = "created_date", order = "DESC", company_id = null, } = req.body;
    const text = String(searchText).trim();
    const where = [];
    const values = [];
    const list = 'name, adminID, company_id, email, roleID ';
    const isCompanyWise = true;
    const wherec = 'name'
   
    if (text) {
      where.push(`t.${wherec} LIKE ?`);
      values.push(`%${text}%`);
    }
    if (!isSuperAdminRole(req.user?.role_slug)) {
      where.push(`t.company_id = ${req.user.company_id} `);
    }
    if (!isSuperAdminRole(req.user?.role_slug) && isCompanyWise === true) {
      where.push(`t.company_id = ${req.user.company_id} `);
    }
    const result = await CommonModel.GetMasterListDetails({ select: list, table: MODULE_TABLE, where, values });

    return successResponse(res, {
      code: 1004,
      httpStatus: 200,
      data: {
        data: result,
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
export const getAdminDetails = async (req, res) => {
  try {
    const method = req.method.toUpperCase();
    const { id: adminID = null } = req.params;

    const body = await buildTablePayload(MODULE_TABLE, req.body);

    delete body.alive_data;

    let data = {};
    if (method !== "GET") {
      const result = validate(userSchema, body);

      if (!result.isValid) {
        return failureResponse(res, {
          code: 2004,
          httpStatus: 404,
          message: result.message.replace(/"/g, ""),
        });
      }

      data = result.value;

      const duplicateCheck = await validateAdminDetails(
        data.email,
        data.userName,
        adminID
      );

      if (duplicateCheck) {
        return failureResponse(res, duplicateCheck);
      }
    }

    switch (method) {
      case "PUT": {
        const plainPassword = data.password;
        if (plainPassword) {
          data.password = await hashPassword(plainPassword);
        }

        data = await buildTablePayload(MODULE_TABLE, {
          ...data,
          created_by: req.user.adminID,
          created_date: toMysqlDateTime(),
        });

        const result = await CommonModel.saveMasterDetails({
          table: MODULE_TABLE,
          data,
        });

        const template = await renderTemplate("userAccountCredentials", "email", {
          name: data.name,
          userName: data.userName,
          password: plainPassword,
          appName: env.appName,
        });
        const { success, error } = await sendEmail({
          to: data.email,
          subject: "User Login Credentials",
          html: template,
          text: "",
          company_id: data.company_id || req.user.company_id,
        });
        if (!success) {
          return failureResponse(res, {
            code: 2008,
            httpStatus: 500,
            message: error,
          });
        }

        return successResponse(res, {
          code: 1001,
          httpStatus: 201,
          data: {
            insertId: result.insertId,
          },
        });
      }

      case "POST": {
        if (!adminID) {
          return failureResponse(res, {
            code: 2004,
            httpStatus: 404,
          });
        }

        if (data.password) {
          data.password = await hashPassword(data.password);
        } else {
          delete data.password;
        }
        
        if (data.userName) {
          delete data.password;
        }

        data = await buildTablePayload(MODULE_TABLE, {
          ...data,
          modified_by: req.user.adminID,
          modified_date: toMysqlDateTime(),
        });

        await CommonModel.updateMasterDetails({
          table: MODULE_TABLE,
          data,
          where: { adminID },
        });

        return successResponse(res, {
          code: 1002,
          httpStatus: 200,
          data: [],
        });
      }

      case "GET": {
        if (!adminID) {
          return failureResponse(res, {
            code: 2004,
            httpStatus: 404,
          });
        }

        const details = await CommonModel.getMasterDetails(
          MODULE_TABLE,
          "*",
          { adminID }
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

// ======================================================
// CHANGE STATUS / DELETE
// ======================================================
export const changeStatus = async (req, res) => {
  try {
    const { action = "", ids = [], status = "active" } = req.body;

    switch (action.trim().toLowerCase()) {
      case "delete":
        await CommonModel.deleteMasterDetails({
          table: MODULE_TABLE,
          where: { adminID: ids },
        });

        return successResponse(res, {
          code: 1003,
          httpStatus: 200,
          data: [],
        });

      case "changestatus":
        await CommonModel.changeMasterStatus(
          MODULE_TABLE,
          status,
          ids
        );

        return successResponse(res, {
          code: 1002,
          httpStatus: 200,
          data: [],
        });

      default:
        return failureResponse(res, {
          code: 2000,
          httpStatus: 400,
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

export const updateLocation = async (req, res) => {
  try {
    const adminID = req.user?.adminID;
    const latitude = req.body?.latitude ?? req.body?.lat;
    const longitude = req.body?.longitude ?? req.body?.lng;

    if (!adminID) {
      return failureResponse(res, {
        code: 2004,
        httpStatus: 404,
        message: "User not found",
      });
    }

    if (latitude === undefined || longitude === undefined || latitude === "" || longitude === "") {
      return failureResponse(res, {
        code: 2001,
        httpStatus: 400,
        message: "Latitude and longitude are required",
      });
    }

    const data = sanitizeSqlPayload(await buildTablePayload(MODULE_TABLE, {
      latitude,
      longitude,
      alive_data: req.body?.alive_data,
      modified_by: adminID,
      modified_date: toMysqlDateTime(),
    }));

    if (!Object.keys(data).length) {
      return failureResponse(res, {
        code: 2001,
        httpStatus: 400,
        message: "No valid location fields found for update",
      });
    }

    const result = await CommonModel.updateMasterDetails({
      table: MODULE_TABLE,
      data,
      where: { adminID },
    });

    if (!result.affectedRows) {
      return failureResponse(res, {
        code: 2004,
        httpStatus: 404,
        message: "User not found",
      });
    }

    return successResponse(res, {
      code: 1002,
      httpStatus: 200,
      message: "Location updated successfully",
      data: [],
    });
  } catch (error) {
    return failureResponse(res, {
      code: 2008,
      httpStatus: 500,
      message: error.message,
    });
  }
}

export const saveSignInLocation = async (req, res) => {
  try {
    const result = await saveUserLocationLog({ req, eventType: "signin" });

    if (result.error) {
      return failureResponse(res, result.error);
    }

    return successResponse(res, {
      code: 1001,
      httpStatus: 201,
      message: "Sign-in successfully",
      data: [],
    });
  } catch (error) {
    return failureResponse(res, {
      code: 2008,
      httpStatus: 500,
      message: error.message,
    });
  }
}

export const saveSignOutLocation = async (req, res) => {
  try {
    const result = await saveUserLocationLog({ req, eventType: "signout" });

    if (result.error) {
      return failureResponse(res, result.error);
    }

    return successResponse(res, {
      code: 1001,
      httpStatus: 201,
      message: "Sign-out successfully",
      data: [],
    });
  } catch (error) {
    return failureResponse(res, {
      code: 2008,
      httpStatus: 500,
      message: error.message,
    });
  }
}

export const updateStatus = async (req, res) => {
  try {
    const adminID = req.user?.adminID;
    const status = req.body?.status;

    if (!adminID) {
      return failureResponse(res, {
        code: 2004,
        httpStatus: 404,
        message: "User not found",
      });
    }

    if (status === undefined || status === "") {
      return failureResponse(res, {
        code: 2001,
        httpStatus: 400,
        message: "Status are required",
      });
    }

    const data = sanitizeSqlPayload(await buildTablePayload(MODULE_TABLE, {
      status,
      modified_by: adminID,
      modified_date: toMysqlDateTime(),
    }));

    const result = await CommonModel.updateMasterDetails({
      table: MODULE_TABLE,
      data,
      where: { adminID },
    });

    if (!result.affectedRows) {
      return failureResponse(res, {
        code: 2004,
        httpStatus: 404,
        message: "User not found",
      });
    }

    return successResponse(res, {
      code: 1002,
      httpStatus: 200,
      message: "Status updated successfully",
      data: [],
    });
  } catch (error) {
    return failureResponse(res, {
      code: 2008,
      httpStatus: 500,
      message: error.message,
    });
  }
}

export const getMarkers = async (req, res) => {
  try {
    const { employee_id, user_id, adminID, from_date, showVisits, to_date } = req.body;
    const company_id = req.user.company_id;
    const selectedEmployeeId = employee_id || user_id || adminID;
    const shouldShowVisits = showVisits === true || showVisits === "true" || showVisits === "y" || showVisits === 1 || showVisits === "1";
    const where = ["a.latitude IS NOT NULL", "a.longitude IS NOT NULL", "a.latitude != ''", "a.longitude != ''",];
    const values = [];
    const visitWhere = [
      // "v.status = 'active'",
    ];
    const visitValues = [];

    if (company_id) {
      where.push("a.company_id = ?");
      values.push(company_id);
      visitWhere.push("v.company_id = ?");
      visitValues.push(company_id);
    }

    if (selectedEmployeeId) {
      where.push("a.adminID = ?");
      values.push(selectedEmployeeId);
      visitWhere.push("v.employee_id = ?");
      visitValues.push(selectedEmployeeId);
    }

    if (from_date) {
      visitWhere.push("DATE(COALESCE(v.visited_at, v.visit_scheduled_at)) >= ?");
      visitValues.push(from_date);
    }

    if (to_date) {
      visitWhere.push("DATE(COALESCE(v.visited_at, v.visit_scheduled_at)) <= ?");
      visitValues.push(to_date);
    }

    const data = await query(` SELECT a.adminID, a.latitude, a.longitude, a.name, a.alive_data, a.status FROM ${DB_PREFIX}${MODULE_TABLE} a WHERE ${where.join(" AND ")} ORDER BY a.name ASC `, values);
    let visits = [];

    if (shouldShowVisits) {
      visits = await query(` SELECT v.visit_id, v.ticket_id, v.employee_id, v.latitude, v.longitude, v.visit_scheduled_at, v.visited_at, v.visit_details, v.visit_status, a.name AS employee_name, t.ticket_no FROM ${DB_PREFIX}ticket_visits v INNER JOIN ${DB_PREFIX}${MODULE_TABLE} a ON v.employee_id = a.adminID LEFT JOIN ${DB_PREFIX}tickets t ON v.ticket_id = t.ticket_id WHERE ${visitWhere.join(" AND ")} AND v.latitude IS NOT NULL AND v.longitude IS NOT NULL AND v.latitude != '' AND v.longitude != '' ORDER BY COALESCE(v.visited_at) DESC, v.visit_id DESC `, visitValues);
    }

    return successResponse(res, {
      code: 1004,
      httpStatus: 200,
      data: {
        data,
        visits,
      },
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

export const getProfile = async (req, res) => {
  try {
    const adminID = req.user?.adminID;

    if (!adminID) {
      return failureResponse(res, {
        code: 2004,
        httpStatus: 404,
        message: "User not found",
      });
    }

    const rows = await CommonModel.GetMasterListDetails({
      select: `
        t.adminID,
        t.name,
        t.email,
        t.dateOfBirth,
        t.userName,
        t.whatsappNo,
        t.time_zone,
        t.roleID,
        r.roleName AS roleName,
        r.slug AS role_slug,
        t.company_id,
        cm.company_name AS company_name,
        t.is_approver,
        t.google_location,
        t.status,
        t.address,
        t.contactNo,
        t.created_date,
        t.lastLogin
      `,
      table: MODULE_TABLE,
      where: ["t.adminID = ?"],
      values: [adminID],
      join: [
        {
          type: "LEFT JOIN",
          table: "user_role_master",
          alias: "r",
          key1: "roleID",
          key2: "roleID",
        },
        {
          type: "LEFT JOIN",
          table: "company_master",
          alias: "cm",
          key1: "company_id",
          key2: "company_id",
        },
      ],
    });

    if (!rows.length) {
      return failureResponse(res, {
        code: 2004,
        httpStatus: 404,
        message: "User not found",
      });
    }

    return successResponse(res, {
      code: 1004,
      httpStatus: 200,
      data: {
        data: rows[0],
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

export const updateProfile = async (req, res) => {
  try {
    const adminID = req.user?.adminID;

    if (!adminID) {
      return failureResponse(res, {
        code: 2004,
        httpStatus: 404,
        message: "User not found",
      });
    }

    const editableData = {
      email: req.body.email,
      dateOfBirth: req.body.dateOfBirth,
      whatsappNo: req.body.whatsappNo ?? req.body.whatsapp_no ?? req.body.wa_no,
      address: req.body.address,
      userName: req.body.userName ?? req.body.user_name,
    };

    const profileSchema = Joi.object({
      email: Joi.string().email().required(),
      dateOfBirth: Joi.string().allow("", null),
      whatsappNo: Joi.string().allow("", null),
      address: Joi.string().allow("", null),
      userName: Joi.string().trim().min(3).required(),
    });

    const result = validate(profileSchema, editableData);

    if (!result.isValid) {
      return failureResponse(res, {
        code: 2001,
        httpStatus: 400,
        message: result.message.replace(/"/g, ""),
      });
    }

    const duplicateCheck = await validateAdminDetails(
      result.value.email,
      result.value.userName,
      adminID
    );

    if (duplicateCheck) {
      return failureResponse(res, duplicateCheck);
    }

    await CommonModel.updateMasterDetails({
      table: MODULE_TABLE,
      data: {
        ...result.value,
        modified_by: adminID,
        modified_date: toMysqlDateTime(),
      },
      where: { adminID },
    });

    const updatedRows = await CommonModel.getMasterDetails(
      MODULE_TABLE,
      "*",
      { adminID }
    );

    return successResponse(res, {
      code: 1002,
      httpStatus: 200,
      message: "Profile updated successfully",
      data: {
        data: updatedRows[0] || result.value,
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

export const changeProfilePassword = async (req, res) => {
  try {
    const adminID = req.user?.adminID;
    const { current_password, currentPassword, new_password, newPassword, confirm_password, confirmPassword } = req.body;
    const current = current_password ?? currentPassword;
    const next = new_password ?? newPassword;
    const confirm = confirm_password ?? confirmPassword;

    if (!adminID) {
      return failureResponse(res, {
        code: 2004,
        httpStatus: 404,
        message: "User not found",
      });
    }

    if (!current || !next || !confirm) {
      return failureResponse(res, {
        code: 2001,
        httpStatus: 400,
        message: "Current password, new password and confirm password are required",
      });
    }

    if (String(next).length < 6) {
      return failureResponse(res, {
        code: 2001,
        httpStatus: 400,
        message: "New password must be at least 6 characters",
      });
    }

    if (String(next) !== String(confirm)) {
      return failureResponse(res, {
        code: 2001,
        httpStatus: 400,
        message: "New password and confirm password must match",
      });
    }

    const rows = await CommonModel.getMasterDetails(
      MODULE_TABLE,
      "adminID, password",
      { adminID }
    );
    const user = rows[0];

    if (!user) {
      return failureResponse(res, {
        code: 2004,
        httpStatus: 404,
        message: "User not found",
      });
    }

    const isCurrentPasswordValid = await verifyPassword(current, user.password);

    if (!isCurrentPasswordValid) {
      return failureResponse(res, {
        code: 2002,
        httpStatus: 401,
        message: "Current password is incorrect",
      });
    }

    const hashedPassword = await hashPassword(next);

    await CommonModel.updateMasterDetails({
      table: MODULE_TABLE,
      data: {
        password: hashedPassword,
        modified_by: adminID,
        modified_date: toMysqlDateTime(),
      },
      where: { adminID },
    });

    return successResponse(res, {
      code: 1002,
      httpStatus: 200,
      message: "Password changed successfully",
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
// UNIQUE CHECK
// ======================================================
const validateAdminDetails = async (
  email,
  userName,
  adminID = null
) => {
  if (email) {
    const emailExist = await CommonModel.getMasterDetails(
      MODULE_TABLE,
      "*",
      { email }
    );

    if (
      emailExist.length &&
      Number(emailExist[0].adminID) !== Number(adminID)
    ) {
      return {
        code: 2002,
        httpStatus: 409,
        message: "Email already exists",
      };
    }
  }

  if (userName) {
    const userExist = await CommonModel.getMasterDetails(
      MODULE_TABLE,
      "*",
      { userName }
    );

    if (
      userExist.length &&
      Number(userExist[0].adminID) !== Number(adminID)
    ) {
      return {
        code: 2003,
        httpStatus: 409,
        message: "Username already exists",
      };
    }
  }

  return null;
};
