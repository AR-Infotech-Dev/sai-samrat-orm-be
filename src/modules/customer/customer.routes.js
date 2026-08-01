import express from "express";
import multer from "multer";
import * as customerController from "./customer.controller.js";
import { requirePermission } from "#middlewares/permissions.middleware.js";

const customerRoutes = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

customerRoutes.post("/", requirePermission('customers', 'view'), customerController.list);
customerRoutes.post("/download-excel", requirePermission('customers', 'view'), customerController.downloadExcel);
customerRoutes.get("/import-template", requirePermission('customers', 'view'), customerController.downloadImportTemplate);
customerRoutes.post("/import", requirePermission('customers', 'create'), upload.single("file"), customerController.importCustomers);
customerRoutes.post("/delete", requirePermission('customers', 'delete'), customerController.changeStatus);
customerRoutes.put("/create", requirePermission('customers', 'create'), customerController.getCustomerDetails);
customerRoutes.get("/:id", requirePermission('customers', 'view'), customerController.getCustomerDetails);
customerRoutes.post("/:id", requirePermission('customers', 'edit'), customerController.getCustomerDetails);

export default customerRoutes;
