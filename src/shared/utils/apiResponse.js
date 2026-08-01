import { getSuccessMessage, getFailureMessage, getHttpStatusMessage } from "./legacyMessages.js";

// ===============================
// SUCCESS RESPONSE
// ===============================
export const successResponse = (res, { code = 1000, httpStatus = 200, data = null, message } = {}) => {
  return res.status(httpStatus).json({
    success: true,
    code,
    type: getHttpStatusMessage(httpStatus),
    message: message || getSuccessMessage(code),
    ...data
  });
};

// ===============================
// FAILURE RESPONSE
// ===============================
export const failureResponse = (res, { code = 2000, httpStatus = 500, data = null , message, } = {}) => {
  return res.status(httpStatus).json({
    success: false,
    code,
    type: getHttpStatusMessage(httpStatus),
    message: message || getFailureMessage(code),
    ...data
  });
};
