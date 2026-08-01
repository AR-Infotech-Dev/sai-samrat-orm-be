import { legacyConfig } from "#config/legacy.js";
import { query } from "#config/database.js";

const table = (name) => `\`${legacyConfig.dbPrefix}${name}\``;

export async function findActiveUserByIdentity(identity) {
  const rows = await query(
    `SELECT * FROM ${table("admin")}
     WHERE (email = ? OR userName = ? OR contactNo = ?)
       AND status = 'active'
     LIMIT 1`,
    [identity, identity, identity]
  );

  return rows[0] || null;
}

export async function findRoleById(roleID) {
  const rows = await query(
    `SELECT roleName, slug FROM ${table("user_role_master")} WHERE roleID = ? LIMIT 1`,
    [roleID]
  );

  return rows[0] || null;
}

export async function findCompanyById(company_id) {
  const rows = await query(
    `SELECT * FROM ${table("company_master")} WHERE company_id = ? AND status = 'active' LIMIT 1`,
    [company_id]
  );

  return rows[0] || null;
}

export async function updateAdminLoginInfo(adminID, gfcmToken) {
  await query(
    `UPDATE ${table("admin")}
     SET lastLogin = NOW(), gfcmToken = ?
     WHERE adminID = ?`,
    [gfcmToken, adminID]
  );
}

export async function createAdminSession(adminID, sessionKey, ip) {
  await query(
    `INSERT INTO ${table("admin_sessions")}
      (adminID, sessionKey, accessDate, created_date, IP)
     VALUES (?, ?, NOW(), NOW(), ?)`,
    [adminID, sessionKey, ip]
  );
}

export async function deleteAdminSessions(adminID) {
  await query(`DELETE FROM ${table("admin_sessions")} WHERE adminID = ?`, [adminID]);
}
