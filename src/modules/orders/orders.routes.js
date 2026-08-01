import express from "express";
import * as bookingController from "./booking/booking.controller.js";
import * as confirmationController from "./confirmation/confirmation.controller.js";
import * as planningController from "./planning/planning.controller.js";
import * as productionController from "./production/production.controller.js";
import * as readyStockController from "./ready-stock/ready-stock.controller.js";
import * as dispatchController from "./dispatch/dispatch.controller.js";
import { requirePermission } from "#middlewares/permissions.middleware.js";

const ordersRoutes = express.Router();

ordersRoutes.post("/confirmation", requirePermission(["order-confirmation"], "view"), confirmationController.list);
ordersRoutes.get("/confirmation/:id", requirePermission(["order-confirmation"], "view"), confirmationController.details);
ordersRoutes.post("/confirmation/:id/confirm", requirePermission(["order-confirmation"], "edit"), confirmationController.confirm);
ordersRoutes.post("/confirmation/:id/hold", requirePermission(["order-confirmation"], "edit"), confirmationController.hold);
ordersRoutes.post("/confirmation/:id/send-back", requirePermission(["order-confirmation"], "edit"), confirmationController.sendBack);

ordersRoutes.post("/planning", requirePermission(["order-planning"], "view"), planningController.list);
ordersRoutes.get("/planning/order/:orderId", requirePermission(["order-planning"], "view"), planningController.orderDetails);
ordersRoutes.post("/planning/order/:orderId/save", requirePermission(["order-planning"], "edit"), planningController.saveOrderPlanning);
ordersRoutes.get("/planning/:orderItemId", requirePermission(["order-planning"], "view"), planningController.details);
ordersRoutes.post("/planning/:orderItemId/save", requirePermission(["order-planning"], "edit"), planningController.savePlanning);

ordersRoutes.post("/production", requirePermission(["production"], "view"), productionController.list);
ordersRoutes.get("/production/order/:orderId", requirePermission(["production"], "view"), productionController.orderDetails);
ordersRoutes.get("/production/order/:orderId/start", requirePermission(["production"], "edit"), productionController.startProduction);
ordersRoutes.post("/production/order/:orderId/save", requirePermission(["production"], "edit"), productionController.saveOrderProduction);

ordersRoutes.post("/dispatch", requirePermission(["dispatch"], "view"), dispatchController.list);
ordersRoutes.get("/dispatch/ready-order/:orderId", requirePermission(["dispatch"], "view"), dispatchController.getReadyOrder);
ordersRoutes.put("/dispatch/create", requirePermission(["dispatch"], "create"), dispatchController.save);
ordersRoutes.get("/dispatch/:dispatchId", requirePermission(["dispatch"], "view"), dispatchController.details);
ordersRoutes.post("/dispatch/:dispatchId", requirePermission(["dispatch"], "edit"), dispatchController.save);

ordersRoutes.post("/ready-stock", requirePermission(["ready-stock"], "view"), readyStockController.list);
ordersRoutes.get("/ready-stock/order/:orderId", requirePermission(["ready-stock"], "view"), readyStockController.orderDetails);

ordersRoutes.post("/", requirePermission(["order-booking"], "view"), bookingController.list);
ordersRoutes.post("/delete", requirePermission(["order-booking"], "delete"), bookingController.changeStatus);
ordersRoutes.put("/create", requirePermission(["order-booking"], "create"), bookingController.getOrderDetails);
ordersRoutes.get("/:id", requirePermission(["order-booking"], "view"), bookingController.getOrderDetails);
ordersRoutes.post("/:id", requirePermission(["order-booking"], "edit"), bookingController.getOrderDetails);

export default ordersRoutes;



