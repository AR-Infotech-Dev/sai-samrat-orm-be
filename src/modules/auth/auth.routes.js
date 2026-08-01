import express from 'express';
import * as loginController from './auth.controller.js';
import { rateLimit } from '#middlewares/rateLimit.middleware.js';

const loginRoutes = express.Router();
loginRoutes.get('/salt', loginController.getPublicKey);
loginRoutes.post('/login', rateLimit({ keyPrefix: 'login', max: 8, windowMs: 15 * 60 * 1000 }), loginController.login);
loginRoutes.post('/forgotPassword', rateLimit({ keyPrefix: 'forgot-password', max: 5, windowMs: 15 * 60 * 1000 }), loginController.forgotPassword);
loginRoutes.post('/verifyOtp', rateLimit({ keyPrefix: 'verify-otp', max: 8, windowMs: 15 * 60 * 1000 }), loginController.verifyForgotPassword);

export default loginRoutes;
