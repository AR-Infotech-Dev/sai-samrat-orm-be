import express from "express";

import systemRoutes from "#modules/system/system.routes.js";
import loginRoutes from "#modules/auth/auth.routes.js";
import usersRoutes from "#modules/users/users.routes.js";
import menuRoutes from "#modules/menus/menus.routes.js";
import customerRoutes from "#modules/customer/customer.routes.js";
import categoryRoutes from "#modules/categories/categories.routes.js";
import productRoutes from "#modules/product/product.routes.js";
import moduleAccessRoutes from "#modules/module-access/module-access.routes.js";
import dashboardRoutes from "#modules/dashboard/dashboard.routes.js";
import bootstrapRoutes from "#modules/bootstrap/bootstrap.routes.js";
import ordersRoutes from "#modules/orders/orders.routes.js";
import {verifyToken} from "#middlewares/auth.middleware.js"

const router = express.Router();

router.use('/', loginRoutes);
router.use('/',bootstrapRoutes);
router.use('/system',verifyToken, systemRoutes);
router.use("/dashboard", verifyToken, dashboardRoutes);
router.use('/users',verifyToken, usersRoutes);
router.use('/menus',verifyToken, menuRoutes);
router.use('/categories',verifyToken, categoryRoutes);
router.use('/customers',verifyToken, customerRoutes);
router.use('/products',verifyToken, productRoutes);
router.use('/permissions',verifyToken, moduleAccessRoutes);
router.use('/orders',verifyToken, ordersRoutes);

export default router;
