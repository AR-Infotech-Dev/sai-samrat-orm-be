import express from 'express';
import * as systemController from './system.controller.js';


const systemRoutes = express.Router();
systemRoutes.post('/getDefinations', systemController.getDefinations);
systemRoutes.post('/searchList', systemController.getFreeTextSearch);
systemRoutes.post('/searchAssignee', systemController.getFreeTextAssignee);
systemRoutes.post('/searchSlugList', systemController.getslugList);
systemRoutes.get('/exchange-rates', systemController.getCurrencyExchangeRates);
systemRoutes.post('/exchange-rates', systemController.getCurrencyExchangeRates);

export default systemRoutes;
