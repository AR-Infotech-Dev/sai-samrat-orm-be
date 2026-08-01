// modules/auth/auth.model.js

import { query, DB_PREFIX } from "#config/database.js";

// ===================================
// VERIFY USER DETAILS
// ===================================
export const verifyUserDetails = async (userName) => {
  const sql = `
    SELECT t.*, r.slug AS role_slug, cmp.company_name as company_name 
    FROM ${DB_PREFIX}admin AS t
    LEFT JOIN ${DB_PREFIX}user_role_master as r ON t.roleID = r.roleID
    LEFT JOIN ${DB_PREFIX}company_master as cmp ON t.company_id = cmp.company_id
    WHERE (
      t.email = ?
      OR t.userName = ?
      OR t.contactNo = ?
    )
    `;
    // AND t.status = 'active'
  return await query(sql, [userName, userName, userName]);
};

// ===================================
// FIND USER BY EMAIL
// ===================================
export const findUserByEmail = async (email) => {

  const sql = `
    SELECT *
    FROM ${DB_PREFIX}admin
    WHERE email = ?
    LIMIT 1
    `;
    // AND status = 'active'
  const rows = await query(sql, [email]);
  return rows[0] || null;
};

// ===================================
// FIND USER BY OTP
// ===================================
export const findUserByOtp = async (otp) => {
  const sql = `
    SELECT *
    FROM ${DB_PREFIX}admin
    WHERE otp = ?
      AND isEmailSend = 'yes'
      LIMIT 1
      `;
      // AND otp_exp_time >= NOW()
      // AND status = 'active'
  
  const rows = await query(sql, [otp]);
  return rows[0] || null;
};

// ===================================
// SAVE FORGOT PASSWORD OTP
// ===================================
export const saveForgotPasswordOtp = async (adminID, data = {}) => {
  return await saveadminInfo(data, adminID);
};

// ===================================
// UPDATE PASSWORD WITH OTP RESET
// ===================================
export const updatePasswordByAdminID = async (adminID, data = {}) => {
  return await saveadminInfo(data, adminID);
};

// ===================================
// UPDATE ADMIN INFO
// ===================================
export const saveadminInfo = async (data, adminID) => {
  const keys = Object.keys(data);
  const values = Object.values(data);

  const setClause = keys.map((key) => `${key} = ?`).join(", ");

  const sql = `
    UPDATE ${DB_PREFIX}admin
    SET ${setClause}
    WHERE adminID = ?
  `;

  return await query(sql, [...values, adminID]);
};

// ===================================
// INSERT SESSION KEY
// ===================================
export const setSessionKey = async (
  adminID,
  sessionKey,
  ip
) => {
  const sql = `
    INSERT INTO admin_sessions
    (
      adminID,
      sessionKey,
      accessDate,
      created_date,
      IP
    )
    VALUES (?, ?, NOW(), NOW(), ?)
  `;

  return await query(sql, [
    adminID,
    sessionKey,
    ip,
  ]);
};

// ===================================
// DELETE SESSION KEY
// ===================================
export const unsetSessionKey = async (
  adminID
) => {
  const sql = `
    DELETE FROM admin_sessions
    WHERE adminID = ?
  `;

  return await query(sql, [adminID]);
};

// ===================================
// GET SESSION DETAILS
// ===================================
export const getSessionDetails = async (
  adminID
) => {
  const sql = `
    SELECT *
    FROM admin_sessions
    WHERE adminID = ?
  `;

  return await query(sql, [adminID]);
};

// ===================================
// UPDATE SESSION TIME
// ===================================
export const updateSession = async (
  adminID
) => {
  const sql = `
    UPDATE admin_sessions
    SET accessDate = NOW()
    WHERE adminID = ?
  `;

  return await query(sql, [adminID]);
};

// ===================================
// UPDATE MOBILE DEVICE
// ===================================
export const updateDeviceDetails = async (
  data,
  deviceID
) => {
  const keys = Object.keys(data);
  const values = Object.values(data);

  const setClause = keys.map((key) => `${key} = ?`).join(", ");

  const sql = `
    UPDATE mobileDevice
    SET ${setClause}
    WHERE deviceID = ?
  `;

  return await query(sql, [...values, deviceID]);
};

// ===================================
// GET MOBILE DEVICE DETAILS
// ===================================
export const getMobileDeviceDetails = async (
  deviceID
) => {
  const sql = `
    SELECT *
    FROM mobileDevice
    WHERE deviceID = ?
  `;

  return await query(sql, [deviceID]);
};

// ===================================
// SAVE MOBILE DEVICE
// ===================================
export const saveDeviceInfo = async (
  data
) => {
  const keys = Object.keys(data);
  const values = Object.values(data);

  const sql = `
    INSERT INTO mobileDevice
    (${keys.join(",")})
    VALUES (${keys.map(() => "?").join(",")})
  `;

  return await query(sql, values);
};

// ===================================
// GET USER OS
// ===================================
export const getUserOS = (
  userAgent = ""
) => {
  const osList = [
    { regex: /windows nt 10/i, name: "Windows 10" },
    { regex: /windows nt 6.3/i, name: "Windows 8.1" },
    { regex: /windows nt 6.1/i, name: "Windows 7" },
    { regex: /android/i, name: "Android" },
    { regex: /iphone/i, name: "iPhone" },
    { regex: /ipad/i, name: "iPad" },
    { regex: /mac/i, name: "Mac OS" },
    { regex: /linux/i, name: "Linux" },
  ];

  const match = osList.find((os) =>
    os.regex.test(userAgent)
  );

  return match
    ? match.name
    : "Unknown OS";
};
