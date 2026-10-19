import { transitionPi } from "./pi-lifecycle.model.js";
import { successResponse, failureResponse } from "#shared/utils/apiResponse.js";

export const changePiLifecycle = async (req, res) => {
  const userId = req.user?.adminID;
  if (!userId) return failureResponse(res, { code: 2001, httpStatus: 401, message: "Login required" });
  const approve = req.path.endsWith("/approve");
  try {
    const changed = await transitionPi(req.params.id, approve ? "waiting" : "draft", approve ? "approved" : "waiting", userId);
    if (!changed) return failureResponse(res, { code: 2001, httpStatus: 409, message: approve ? "Only Waiting PIs can be approved" : "Only Draft PIs can be submitted" });
    return successResponse(res, { code: 1002, httpStatus: 200, message: approve ? "PI approved successfully" : "PI submitted for approval" });
  } catch (error) {
    console.log('error : ', error);
    return failureResponse(res, { code: 2008, httpStatus: 500, message: error.message });
  }
};
