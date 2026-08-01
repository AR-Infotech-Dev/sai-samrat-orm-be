import * as CommonModel from "#shared/models/common.model.js";
import { successResponse, failureResponse } from "#shared/utils/apiResponse.js";
import { prepareFilterData } from "#shared/utils/filter.builder.js";
import { toMysqlDateTime } from "#shared/utils/dateTime.js";
import { validateBody } from "#shared/utils/bodyValidator.js";
import { clearCompanyMailerCache, testSmtpConnection } from "#shared/utils/email.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { env } from "process";

const MODULE_TABLE = "company_master";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const COMPANY_LOGO_DIR = path.resolve(__dirname, "../../../public/images/company-logos");

const default_columns = {};

const custom_columns = {
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

const companyValidationRules = {
  company_id: { label: "Company ID", type: "number" },
  company_name: { label: "Company Name", required: true },
  cc_email: { label: "CC Email", type: "email" },
  sender_email: { label: "Sender Email", type: "email" },
  sender_name: { label: "Sender Name" },
  mail_provider: { label: "Mail Provider" },
  smtp_host: { label: "SMTP Host" },
  smtp_port: { label: "SMTP Port" },
  smtp_encryption: { label: "SMTP Encryption" },
  smtp_username: { label: "SMTP Username" },
  email_app_password: { label: "App password" },
  mobile_number: { label: "Mobile Number" },
  company_address: { label: "Company Address" },
  country: { label: "Country", },
  state: { label: "State", },
  city: { label: "City", },
  zip: { label: "Zip" },
  pan: { label: "PAN" },
  time_format: { label: "Time Format" },
  date_format: { label: "Date Format" },
  email_logo: { label: "Email Logo" },
  created_by: { label: "Created By", type: "number" },
  modified_by: { label: "Modified By", type: "number" },
  ticket_prefix: { label: "Ticket Prefix" },
  ticket_include_year: { label: "Include Year" },
  ticket_yearly_reset: { label: "Ticket Yearly Reset" },
  ticket_prefix_padding: { label: "Padding", type: "number" },
  ticket_no_reset: { label: "Reset Preference" },
  status: { label: "Status" },
};

const mailTestValidationRules = {
  company_id: { label: "Company ID", type: "number" },
  company_name: { label: "Company Name" },
  sender_name: { label: "Sender Name", required: true },
  sender_email: { label: "Sender Email", type: "email", required: true },
  mail_provider: { label: "Mail Provider", required: true },
  smtp_host: { label: "SMTP Host" },
  smtp_port: { label: "SMTP Port" },
  smtp_encryption: { label: "SMTP Encryption" },
  smtp_username: { label: "SMTP Username" },
  email_app_password: { label: "Email App Password", required: true },
};

const MAIL_PROVIDER_DEFAULTS = {
  gmail: { smtp_host: "smtp.gmail.com", smtp_port: "587", smtp_encryption: "tls" },
  yahoo: { smtp_host: "smtp.mail.yahoo.com", smtp_port: "587", smtp_encryption: "tls" },
  outlook: { smtp_host: "smtp.office365.com", smtp_port: "587", smtp_encryption: "tls" },
};

const normalizeMailConfig = (data = {}) => {
  const provider = String(data.mail_provider || "gmail").toLowerCase();
  const defaults = MAIL_PROVIDER_DEFAULTS[provider] || {};

  return {
    ...data,
    mail_provider: provider,
    smtp_host: data.smtp_host || defaults.smtp_host,
    smtp_port: data.smtp_port || defaults.smtp_port || "587",
    smtp_encryption: data.smtp_encryption || defaults.smtp_encryption || "tls",
    smtp_username: data.smtp_username || data.sender_email,
  };
};

const ensureCompanyLogoDir = () => {
  fs.mkdirSync(COMPANY_LOGO_DIR, { recursive: true });
};

const getLogoExtension = (file = {}) => {
  const mime = String(file.mimetype || "").toLowerCase();
  if (mime === "image/png") return ".png";
  if (mime === "image/webp") return ".webp";
  if (mime === "image/svg+xml") return ".svg";
  return ".jpg";
};

// ======================================================
// LIST COMPANIES
// ======================================================
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

    const limit = env.perPage;
    // const limit = 10;
    const currentPage = Number(page) || 1;
    const start = (currentPage - 1) * limit;

    const filterData = prepareFilterData({
      filters,
      searchText,
      other: {
        orderBy,
        order,
        searchColumns: [
          "company_name",
          "sender_email",
          "cc_email",
          "sender_name",
          "mobile_number",
          "pan",
        ],
      },
      default_columns,
      custom_columns,
    });

    const { select, where, values, join, other } = filterData;
    other.freeTextSearch = searchText;
    other.searchColumns = [
      "t.company_name",
      "t.sender_email",
      "t.cc_email",
      "t.sender_name",
      "t.mobile_number",
      "t.pan",
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

    let companyDetails = [];
    if (getAll === "Y") {
      companyDetails = await CommonModel.GetMasterListDetails({
        select,
        table: MODULE_TABLE,
        where,
        values,
        join,
        other,
      });
    } else {
      companyDetails = await CommonModel.GetMasterListDetails({
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
        data: companyDetails,
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

export const testMailConfig = async (req, res) => {
  try {
    const validation = validateBody(req.body, mailTestValidationRules);
    if (!validation.isValid) {
      return failureResponse(res, {
        code: 2001,
        httpStatus: 400,
        message: validation.message,
      });
    }

    const data = normalizeMailConfig(validation.data);
    if (data.mail_provider === "custom" && (!data.smtp_host || !data.smtp_port || !data.smtp_username || !data.smtp_encryption)) {
      return failureResponse(res, {
        code: 2001,
        httpStatus: 400,
        message: "SMTP host, port, username, and encryption are required for Custom SMTP",
      });
    }

    const result = await testSmtpConnection(data);
    const companyId = data.company_id || req.user.company_id || null;

    if (companyId) {
      try {
        await CommonModel.updateMasterDetails({
          table: MODULE_TABLE,
          data: {
            mail_connection_status: result.success ? "connected" : "failed",
            mail_last_tested_at: toMysqlDateTime(),
          },
          where: { company_id: companyId },
        });
      } catch (statusError) {
        console.warn("Unable to update SMTP test status:", statusError.message);
      }
      clearCompanyMailerCache(companyId);
    }

    if (!result.success) {
      return failureResponse(res, {
        code: 2008,
        httpStatus: 400,
        message: result.message,
      });
    }

    return successResponse(res, {
      code: 1002,
      httpStatus: 200,
      message: result.message,
      data: {
        data: {
          mail_connection_status: "connected",
          mail_last_tested_at: toMysqlDateTime(),
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

export const uploadCompanyLogo = async (req, res) => {
  try {
    if (!req.file?.buffer) {
      return failureResponse(res, {
        code: 2001,
        httpStatus: 400,
        message: "Company logo file is required",
      });
    }

    const companyId = req.params.id || req.body.company_id || null;
    const extension = getLogoExtension(req.file);
    const safeCompanyPart = companyId ? `company-${companyId}` : "company-new";
    const fileName = `${safeCompanyPart}-${Date.now()}${extension}`;
    const relativePath = `/images/company-logos/${fileName}`;
    const absolutePath = path.join(COMPANY_LOGO_DIR, fileName);

    ensureCompanyLogoDir();
    fs.writeFileSync(absolutePath, req.file.buffer);

    if (companyId) {
      const result = await CommonModel.updateMasterDetails({
        table: MODULE_TABLE,
        data: {
          email_logo: relativePath,
          modified_by: req.user.adminID,
          modified_date: toMysqlDateTime(),
        },
        where: { company_id: companyId },
      });

      if (!result.affectedRows) {
        return failureResponse(res, {
          code: 2004,
          httpStatus: 404,
          message: "Company not found",
        });
      }

      clearCompanyMailerCache(companyId);
    }

    return successResponse(res, {
      code: 1002,
      httpStatus: 200,
      message: "Company logo uploaded successfully",
      data: {
        data: {
          email_logo: relativePath,
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
export const removeCompanyLogo = async (req, res) => {
  try {
    const companyId = req.params.id;
    const company = await CommonModel.getMasterDetails(MODULE_TABLE, "email_logo", {
      company_id: companyId,
    });

    if (!company?.length) {
      return failureResponse(res, {
        code: 2004,
        httpStatus: 404,
        message: "Company not found",
      });
    }

    const logoPath = company[0].email_logo;

    // Delete physical file if exists
    if (logoPath) {
      const absolutePath = path.resolve(process.cwd(), logoPath.replace(/^\/+/, ""));

      if (fs.existsSync(absolutePath)) {
        fs.unlinkSync(absolutePath);
      }
    }

    // Update DB
    await CommonModel.updateMasterDetails({
      table: MODULE_TABLE,
      data: {
        email_logo: null,
        modified_by: req.user.adminID,
        modified_date: toMysqlDateTime(),
      },
      where: { company_id: companyId },
    });

    // Clear mail cache
    clearCompanyMailerCache(companyId);

    return successResponse(res, {
      code: 1003,
      httpStatus: 200,
      message: "Company logo removed successfully",
      data: {},
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
export const getCompanyDetails = async (req, res) => {
  try {
    const method = req.method.toUpperCase();
    const { id: company_id = null } = req.params;

    switch (method) {
      case "PUT": {
        const validation = validateBody(req.body, companyValidationRules);
        if (!validation.isValid) {
          return failureResponse(res, {
            code: 2001,
            httpStatus: 400,
            message: validation.message,
          });
        }

        const data = validation.data;
        delete data.company_id;
        data.created_by = req.user.adminID;
        data.created_date = toMysqlDateTime();
        data.status = data.status || "active";

        const result = await CommonModel.saveMasterDetails({
          table: MODULE_TABLE,
          data,
        });
        clearCompanyMailerCache(result.insertId);

        return successResponse(res, {
          code: 1001,
          httpStatus: 201,
          data: {
            insertId: result.insertId,
          },
        });
      }

      case "POST": {
        if (!company_id) {
          return failureResponse(res, {
            code: 2004,
            httpStatus: 404,
          });
        }

        const validation = validateBody(req.body, companyValidationRules);
        if (!validation.isValid) {
          return failureResponse(res, {
            code: 2001,
            httpStatus: 400,
            message: validation.message,
          });
        }

        const data = validation.data;
        delete data.company_id;
        delete data.created_by;
        delete data.created_date;
        data.modified_by = req.user.adminID;
        data.modified_date = toMysqlDateTime();

        const result = await CommonModel.updateMasterDetails({
          table: MODULE_TABLE,
          data,
          where: { company_id },
        });

        if (!result.affectedRows) {
          return failureResponse(res, {
            code: 2004,
            httpStatus: 404,
          });
        }
        clearCompanyMailerCache(company_id);

        return successResponse(res, {
          code: 1002,
          httpStatus: 200,
          data: [],
        });
      }

      case "GET": {
        if (!company_id) {
          return failureResponse(res, {
            code: 2004,
            httpStatus: 404,
          });
        }

        const details = await CommonModel.getMasterDetails(MODULE_TABLE, "*", {
          company_id,
        });

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

    await CommonModel.deleteMasterDetails({
      table: MODULE_TABLE,
      where: { company_id: ids },
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
