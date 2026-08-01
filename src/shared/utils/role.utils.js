export const SUPER_ADMIN_ROLE_SLUGS = new Set(["super_admin", "superadmin", "administrator"]);
export const ADMIN_ROLE_SLUGS = new Set(["admin"]);
export const VIEW_ALL_ROLE_SLUGS = new Set(["admin", "super_admin"]);

export const getRoleSlug = (userOrRole = "") => {
  if (typeof userOrRole === "object" && userOrRole !== null) {
    return String(userOrRole.role_slug || "").toLowerCase();
  }
  return String(userOrRole || "").toLowerCase();
};

export const isSuperAdminRole = (userOrRole = "") => SUPER_ADMIN_ROLE_SLUGS.has(getRoleSlug(userOrRole));

export const isAdminRole = (userOrRole = "") => ADMIN_ROLE_SLUGS.has(getRoleSlug(userOrRole));

export const canViewAllByRole = (userOrRole = "") => VIEW_ALL_ROLE_SLUGS.has(getRoleSlug(userOrRole));

export const getUserCompanyId = (user = {}) => user?.company_id || user?.default_company || null;
