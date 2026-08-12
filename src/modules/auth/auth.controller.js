import jwt from "jsonwebtoken";
import { query } from "#config/database.js";
import { env } from "#config/env.js";
import { verifyUserDetails, findUserByEmail, saveForgotPasswordOtp, findUserByOtp, updatePasswordByAdminID } from "./auth.model.js";
import { successResponse, failureResponse } from "#shared/utils/apiResponse.js";
import { validateBody } from "#shared/utils/bodyValidator.js";
import { toMysqlDateTime } from "#shared/utils/dateTime.js";
import { sendEmail } from "#shared/utils/email.js";
import { renderTemplate } from "#shared/utils/templateMaker.js";
import { hashPassword, isPasswordHash, verifyPassword } from "#shared/utils/password.js";
import { createActiveSessionId, setActiveSessionId } from "#shared/utils/activeSession.js";
import { decryptLoginPassword, getLoginPublicKey } from "#shared/utils/loginEncryption.js";

export const getPublicKey = (req, res) => {
  return successResponse(res, {
    code: 1004,
    httpStatus: 200,
    data: getLoginPublicKey(),
    message: "success",
  });
};

export const login = async (req, res) => {
  try {
    const {
      username = "",
      password = "",
      encryptedPassword = "",
      password_encrypted = "",
      isMobile = false,
    } = req.body;
    const submittedPassword = encryptedPassword || password_encrypted;
    const loginPassword = submittedPassword
      ? decryptLoginPassword(submittedPassword)
      : password;
    // ===============================
    // VALIDATION
    // ===============================
    if (!username || !loginPassword) {
      return failureResponse(res, {
        code: 2001,
        httpStatus: 400,
        message: "Username and password are required",
      });
    }

    // ===============================
    // CHECK USER
    // ===============================
    const rows = await verifyUserDetails(username);
    const user = rows[0];

    if (!user) {
      return failureResponse(res, {
        code: 2002,
        httpStatus: 401,
        message: "Invalid username or password",
      });
    }

    // ===============================
    // PASSWORD CHECK
    // ===============================
    const isPasswordValid = await verifyPassword(loginPassword, user.password);
    if (!isPasswordValid) {
      return failureResponse(res, {
        code: 2002,
        httpStatus: 401,
        message: "Invalid username or password",
      });
    }

    if (!isPasswordHash(user.password)) {
      await updatePasswordByAdminID(user.adminID, {
        password: await hashPassword(loginPassword),
        modified_by: user.adminID,
        modified_date: toMysqlDateTime(),
      });
    }

    // ===============================
    // GENERATE TOKEN
    // ===============================
    const activeSessionId = createActiveSessionId();
    await setActiveSessionId(user.adminID, activeSessionId, isMobile);

    const token = jwt.sign(
      {
        adminID: user.adminID,
        username: user.userName,
        roleID: user.roleID,
        role_slug: user.role_slug,
        active_session_id: activeSessionId,
      },
      env.jwtSecret,
      {
        expiresIn: env.jwtExpire,
      }
    );

    // ===============================
    // SUCCESS
    // ===============================
    if (isMobile) {
      return successResponse(res, {
        code: 1001,
        httpStatus: 200,
        data: {
          token,
          user: {
            adminID: user.adminID,
            name: user.name,
            userName: user.userName,
            roleID: user.roleID,
            role_slug: user.role_slug,
          },
        },
        message: "Login successful",
      });
    }

    res.cookie("access_token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
      maxAge: 24 * 60 * 60 * 1000,
    });
    return successResponse(res, {
      code: 1001,
      httpStatus: 200,
      data: {
        user: {
          adminID: user.adminID,
          name: user.name,
          userName: user.userName,
          roleID: user.roleID,
          role_slug: user.role_slug,
        },
      },
      message: "Login successful",
    });

  } catch (error) {
    console.log('error : ', error);

    return failureResponse(res, {
      code: 2008,
      httpStatus: 500,
      message: error.message,
    });
  }
};

const forgotPasswordRules = {
  email: { label: "Email", required: true, type: "email" },
};

const verifyForgotPasswordRules = {
  otp: { label: "OTP", required: true },
  new_password: { label: "New Password", required: true },
  re_enter_password: { label: "Re Enter Password", required: true },
};

const generateOtp = () =>
  String(Math.floor(100000 + Math.random() * 900000));

// ======================================================
// FORGOT PASSWORD
// ======================================================
export const forgotPassword = async (req, res) => {
  try {
    const validation = validateBody(req.body, forgotPasswordRules);

    if (!validation.isValid) {
      return failureResponse(res, {
        code: 2001,
        httpStatus: 400,
        message: validation.message,
      });
    }

    const { email } = validation.data;
    const user = await findUserByEmail(email);

    if (!user) {
      return failureResponse(res, {
        code: 2004,
        httpStatus: 404,
        message: "Email not found",
      });
    }

    const otp = generateOtp();
    const expiryDate = new Date(Date.now() + 10 * 60 * 1000);
    await saveForgotPasswordOtp(user.adminID, {
      otp,
      otp_exp_time: toMysqlDateTime(expiryDate),
      isEmailSend: "yes",
      modified_by: user.adminID,
      modified_date: toMysqlDateTime(),
    });
    // console.log('sql : ',sql);
    const template = await renderTemplate("forgotPasswordOtp", "email", {
      name: user.name || user.userName || "User",
      otp,
    });

    const { success, error } = await sendEmail({
      to: user.email,
      subject: "Forgot Password OTP",
      html: template,
      text: `Your OTP is ${otp}. It will expire in 10 minutes.`,
      company_id: null,
    });

    if (!success) {
      return failureResponse(res, {
        code: 2008,
        httpStatus: 500,
        message: error || "Failed to send OTP email",
      });
    }

    return successResponse(res, {
      code: 1004,
      httpStatus: 200,
      data: [],
      message: "OTP sent successfully",
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
// VERIFY FORGOT PASSWORD OTP
// ======================================================
export const verifyForgotPassword = async (req, res) => {
  try {
    const validation = validateBody(req.body, verifyForgotPasswordRules);

    if (!validation.isValid) {
      return failureResponse(res, {
        code: 2001,
        httpStatus: 400,
        message: validation.message,
      });
    }

    const { otp, new_password, re_enter_password } = validation.data;

    if (String(new_password) !== String(re_enter_password)) {
      return failureResponse(res, {
        code: 2001,
        httpStatus: 400,
        message: "New password and re enter password must match",
      });
    }

    const user = await findUserByOtp(otp);

    if (!user) {
      return failureResponse(res, {
        code: 2004,
        httpStatus: 404,
        message: "Invalid or expired OTP",
      });
    }

    const hashedPassword = await hashPassword(new_password);

    await updatePasswordByAdminID(user.adminID, {
      password: hashedPassword,
      otp: null,
      otp_exp_time: null,
      isEmailSend: "no",
      modified_by: user.adminID,
      modified_date: toMysqlDateTime(),
    });

    const template = await renderTemplate("passwordUpdated", "email", {
      name: user.name || user.userName || "User",
    });

    const { success, error } = await sendEmail({
      to: user.email,
      subject: "Password Updated Successfully",
      html: template,
      text: "Your password has been updated successfully.",
      company_id: null,
    });

    if (!success) {
      return failureResponse(res, {
        code: 2008,
        httpStatus: 500,
        message: error || "Password updated but confirmation email failed",
      });
    }

    return successResponse(res, {
      code: 1002,
      httpStatus: 200,
      data: [],
      message: "Password updated successfully",
    });
  } catch (error) {
    return failureResponse(res, {
      code: 2008,
      httpStatus: 500,
      message: error.message,
    });
  }
};
