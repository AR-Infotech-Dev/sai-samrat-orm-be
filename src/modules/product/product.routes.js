import express from "express";
import * as productController from "./product.controller.js";
import { requirePermission } from "#middlewares/permissions.middleware.js";

const productRoutes = express.Router();

productRoutes.post("/", requirePermission(["products", "product"], "view"), productController.list);
productRoutes.post("/delete", requirePermission(["products", "product"], "delete"), productController.changeStatus);
productRoutes.put("/create", requirePermission(["products", "product"], "create"), productController.getProductDetails);
productRoutes.get("/:id", requirePermission(["products", "product"], "view"), productController.getProductDetails);
productRoutes.post("/:id", requirePermission(["products", "product"], "edit"), productController.getProductDetails);

export default productRoutes;
