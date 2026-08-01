
import express from 'express';
import { requirePermission } from '#middlewares/permissions.middleware.js';

import {
    list,
    getMenuDetails,
    changeStatus,
    updatePositions
} from './menus.controller.js';

const menuRoutes = express.Router();
menuRoutes.post("/", requirePermission('menus', 'view'), list);
menuRoutes.post("/changestatus", requirePermission('menus', 'edit'), changeStatus);
menuRoutes.put("/create", requirePermission('menus', 'create'), getMenuDetails);
menuRoutes.post("/update-positions", requirePermission(['menu-master', 'menus'], 'edit'), updatePositions);
menuRoutes.get("/:id", requirePermission(['menu-master', 'menus'], 'view'), getMenuDetails);
menuRoutes.post("/:id", requirePermission(['menu-master', 'menus'], 'edit'), getMenuDetails);

export default menuRoutes;
