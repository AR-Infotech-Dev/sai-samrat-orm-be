import * as DashboardService from "./dashboard.service.js";
import { successResponse, failureResponse } from "#shared/utils/apiResponse.js";

export const overview = async (req, res) => {
  try {
    const data = await DashboardService.getDashboardOverview(req.user, req.body);

    return successResponse(res, {
      code: 1004,
      httpStatus: 200,
      data: {
        data,
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
};
