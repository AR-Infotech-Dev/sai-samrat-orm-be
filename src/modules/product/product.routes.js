import express from "express";
import multer from "multer";
import * as productController from "./product.controller.js";
import { requirePermission } from "#middlewares/permissions.middleware.js";

const productRoutes = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

productRoutes.post("/", requirePermission(["products", "product"], "view"), productController.list);
productRoutes.post("/delete", requirePermission(["products", "product"], "delete"), productController.changeStatus);
productRoutes.get("/import-template", requirePermission(["products", "product"], "view"), productController.downloadImportTemplate);
productRoutes.post("/import", requirePermission(["products", "product"], "create"), upload.single("file"), productController.importProducts);
productRoutes.post("/export", requirePermission(["products", "product"], "view"), productController.exportProducts);
productRoutes.put("/create", requirePermission(["products", "product"], "create"), productController.getProductDetails);
productRoutes.get("/:id", requirePermission(["products", "product"], "view"), productController.getProductDetails);
productRoutes.post("/:id", requirePermission(["products", "product"], "edit"), productController.getProductDetails);

export default productRoutes;
