import express from 'express';
import * as systemController from './system.controller.js';


const systemRoutes = express.Router();
systemRoutes.post('/getDefinations', systemController.getDefinations);
systemRoutes.post('/searchList', systemController.getFreeTextSearch);
systemRoutes.post('/searchAssignee', systemController.getFreeTextAssignee);
systemRoutes.post('/searchSlugList', systemController.getslugList);

export default systemRoutes;
