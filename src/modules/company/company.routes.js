import express from "express";
import multer from "multer";
import * as companyController from "./company.controller.js";
import { requirePermission } from "#middlewares/permissions.middleware.js";

const companyRoutes = express.Router();
const logoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (req, file, callback) => {
    if (String(file.mimetype || "").startsWith("image/")) {
      callback(null, true);
      return;
    }

    callback(new Error("Only image files are allowed"));
  },
});

companyRoutes.post("/", requirePermission(['company-master', 'companies'], "view"), companyController.list);
companyRoutes.post("/delete", requirePermission(['company-master', 'companies'], "delete"), companyController.changeStatus);
companyRoutes.post("/mail-config/test", requirePermission(['company-master', 'companies'], "edit"), companyController.testMailConfig);
companyRoutes.post("/logo", requirePermission(['company-master', 'companies'], "create"), logoUpload.single("logo"), companyController.uploadCompanyLogo);
companyRoutes.post("/:id/logo", requirePermission(['company-master', 'companies'], "edit"), logoUpload.single("logo"), companyController.uploadCompanyLogo);
companyRoutes.delete("/:id/logo/remove", requirePermission(['company-master', 'companies'], "edit"), companyController.removeCompanyLogo);
companyRoutes.put("/create", requirePermission(['company-master', 'companies'], "create"), companyController.getCompanyDetails);
companyRoutes.get("/:id", requirePermission(['company-master', 'companies'], "view"), companyController.getCompanyDetails);
companyRoutes.post("/:id", requirePermission(['company-master', 'companies'], "edit"), companyController.getCompanyDetails);

export default companyRoutes;
