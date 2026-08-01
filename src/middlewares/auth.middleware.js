import jwt from "jsonwebtoken";
import { env } from "#config/env.js";
import { failureResponse } from "#shared/utils/apiResponse.js";
import { getActiveSessionId } from "#shared/utils/activeSession.js";

// export const verifyToken = (req, res, next) => {
//     try {
//         const authHeader = req.headers.authorization || "";
//         if (!authHeader.startsWith("Bearer ")) {
//             return failureResponse(res, {
//                 code: 2006,
//                 httpStatus: 401,
//                 message: "Token required"
//             });
//         }

//         // const token = authHeader.split(" ")[1];
//         const token = req.cookies?.access_token || authHeader.replace("Bearer ", "");

//         const decoded = jwt.verify(token, env.jwtSecret);

//         req.user = decoded;

//         next();

//     } catch (error) {
//         console.log(error);
//         return failureResponse(res, {
//             code: 2007,
//             httpStatus: 401,
//             message: "Invalid or expired token"
//         });
//     }
// };
export const verifyToken = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization || "";
    const isMobile = Boolean(req.headers.ismobile) || false;
    const cookieToken = req.cookies?.access_token;
    const bearerToken = authHeader.startsWith("Bearer ")
      ? authHeader.split(" ")[1]
      : "";
    
    const token = cookieToken || bearerToken;

    if (!token) {
      return failureResponse(res, {
        code: 2006,
        httpStatus: 401,
        message: "Token required",
      });
    }

    const decoded = jwt.verify(token, env.jwtSecret);

    if (!decoded.active_session_id) {
      return failureResponse(res, {
        code: 2007,
        httpStatus: 401,
        message: "Session expired. Please login again.",
      });
    }

    const activeSessionId = await getActiveSessionId(decoded.adminID,isMobile);
    if (!activeSessionId || activeSessionId !== decoded.active_session_id) {
      return failureResponse(res, {
        code: 2009,
        httpStatus: 401,
        message: "Session Expired.",
      });
    }

    req.user = decoded;

    return next();
  } catch (error) {
    console.log(error);
    return failureResponse(res, {
      code: 2007,
      httpStatus: 401,
      message: "Invalid or expired token",
    });
  }
};
