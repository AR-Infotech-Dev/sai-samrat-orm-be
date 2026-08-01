import express from "express";
import { menulist } from "#modules/menus/menus.controller.js";
import { listNoAuth } from '#modules/users/users.controller.js';
import { getModulesAccess } from "#modules/module-access/module-access.controller.js";
import { verifyToken } from "#middlewares/auth.middleware.js"

const bootstrapRouter = express.Router();
bootstrapRouter.get("/get-permissions/:id", getModulesAccess);
bootstrapRouter.post("/get-menus", menulist);
bootstrapRouter.post("/get-users", verifyToken, listNoAuth);
export default bootstrapRouter;
