import express from "express";
import * as dashboardController from "./dashboard.controller.js";

const dashboardRoutes = express.Router();

dashboardRoutes.post("/", dashboardController.overview);

export default dashboardRoutes;
