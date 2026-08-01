import express from "express";
import * as categoryController from "./categories.controller.js";
import { requirePermission } from "#middlewares/permissions.middleware.js";

const categoryRoutes = express.Router();

categoryRoutes.post("/", requirePermission(["categories", "category-master"], "view"), categoryController.getcategoryDetails);
categoryRoutes.post("/getcategoryDetails", requirePermission(["categories", "category-master"], "view"), categoryController.getcategoryDetails);
categoryRoutes.put("/create", requirePermission(["categories", "category-master"], "create"), categoryController.categoryMaster);
categoryRoutes.post("/delete", requirePermission(["categories"], "delete"), categoryController.changeStatus);
categoryRoutes.post("/slugList", requirePermission(["categories", "category-master"], "view"), categoryController.getslugList);
categoryRoutes.post("/changePosition", requirePermission(["categories", "category-master"], "edit"), categoryController.changePosition);
categoryRoutes.post("/partial-update/:id", requirePermission(["categories", "category-master"], "edit"), categoryController.categoryUpdate);
categoryRoutes.get("/slug/:slug", requirePermission(["categories", "category-master"], "view"), categoryController.categoryIDBySlug);
categoryRoutes.get("/:id", requirePermission(["categories", "category-master"], "view"), categoryController.categoryMaster);
categoryRoutes.post("/:id", requirePermission(["categories", "category-master"], "edit"), categoryController.categoryMaster);

export default categoryRoutes;

