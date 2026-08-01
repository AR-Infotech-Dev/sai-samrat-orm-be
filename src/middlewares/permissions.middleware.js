import { query, DB_PREFIX } from "#config/database.js";
import { failureResponse } from "#shared/utils/apiResponse.js";
import { isSuperAdminRole } from "#shared/utils/role.utils.js";

const menuIdCache = new Map();

const ACTION_KEY_MAP = {
  create: "add",
  edit: "edit",
  view: "view",
  delete: "delete",
};

const parsePermissions = (rawPermissions) => {
  if (!rawPermissions) {
    return {};
  }

  if (typeof rawPermissions === "object") {
    return rawPermissions;
  }

  try {
    return JSON.parse(rawPermissions);
  } catch {
    return {};
  }
};

const hasPermission = (permissions, menuId, action) => {
  const actionKey = ACTION_KEY_MAP[action] || action;
  const entry = permissions?.[String(menuId)] || permissions?.[Number(menuId)];
  return entry?.[actionKey] === true;
};

const getMenuIdByModuleKey = async (moduleKey) => {
  if (!moduleKey) {
    return null;
  }

  if (menuIdCache.has(moduleKey)) {
    return menuIdCache.get(moduleKey);
  }

  const candidates = Array.isArray(moduleKey) ? moduleKey : [moduleKey];
  const values = candidates.flatMap((item) => [item, item]);
  const orClause = candidates.map(() => "(module_name = ? OR menu_link = ?)").join(" OR ");
  const sql = `SELECT menu_id FROM ${DB_PREFIX}menu_master WHERE ${orClause} LIMIT 1`;
  const rows = await query(sql, values);
  const menuId = rows[0]?.menu_id || null;

  for (const candidate of candidates) {
    menuIdCache.set(candidate, menuId);
  }

  return menuId;
};

const getUserModuleAccess = async (user_id, company_id) => {
  // const sql = `SELECT permissions FROM ${DB_PREFIX}module_access WHERE user_id = ? AND company_id = ? AND status = 'active' LIMIT 1 `;
  // const rows = await query(sql, [user_id, company_id]);
  const sql = `SELECT permissions FROM ${DB_PREFIX}module_access WHERE user_id = ? AND status = 'active' LIMIT 1 `;
  const rows = await query(sql, [user_id]);
  return rows[0] || null;
};

export const requirePermission = (moduleKey, action) => {
  return async (req, res, next) => {
    try {
      if (isSuperAdminRole(req.user)) {
        return next();
      }

      const user_id = req.user?.adminID;
      const company_id = req.user?.company_id;

      if (!user_id || !company_id) {
        return failureResponse(res, {
          code: 2007,
          httpStatus: 403,
          message: "Permission denied",
        });
      }

      const accessRow = await getUserModuleAccess(user_id, company_id);
      const permissions = parsePermissions(accessRow?.permissions);
      const menuId = await getMenuIdByModuleKey(moduleKey);
      
      if (!menuId) {
        return failureResponse(res, {
          code: 2007,
          httpStatus: 403,
          message: `Menu not configured for ${Array.isArray(moduleKey) ? moduleKey.join(", ") : moduleKey}`,
        });
      }


      if (!hasPermission(permissions, menuId, action)) {
        return failureResponse(res, {
          code: 2007,
          httpStatus: 403,
          message: `No ${action} permission for menu ${menuId}`,
        });
      }

      req.permissions = permissions;
      req.permissionMenuId = menuId;
      return next();
    } catch (error) {
      return failureResponse(res, {
        code: 2008,
        httpStatus: 500,
        message: error.message,
      });
    }
  };
};
