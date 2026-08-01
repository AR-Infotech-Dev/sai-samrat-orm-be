import * as DashboardModel from "./dashboard.model.js";

export const getDashboardOverview = async (user,filter) => {
  return DashboardModel.getDashboardOverview(user,filter);
};
