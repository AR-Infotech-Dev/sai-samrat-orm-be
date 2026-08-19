import dotenv from "dotenv";

dotenv.config();

const isProduction = process.env.NODE_ENV === "production";
// const requiredProductionEnv = [
//   "APP_URL",
//   "APP_FE_URL",
//   "SESSION_SECRET",
//   "JWT_SECRET",
//   "DB_HOST",
//   "DB_USER",
//   "DB_PASSWORD",
//   "DB_NAME",
//   // "EMAIL_USER",
//   // "EMAIL_PASS",
// ];

// if (isProduction) {
//   const missingEnv = requiredProductionEnv.filter((key) => !process.env[key]);

//   if (missingEnv.length > 0) {
//     throw new Error(`Missing required production environment variables: ${missingEnv.join(", ")}`);
//   }
// }

export const env = {
  nodeEnv: process.env.NODE_ENV || "development",
  port: Number(process.env.PORT || 3000),
  appName: process.env.APP_NAME || "Sai Samrat - ORM",
  appUrl: process.env.APP_URL || "http://localhost:3000",
  appLink: process.env.APP_FE_URL || "http://localhost:5173",
  // appFEUrl: process.env.APP_FE_URL || "http://192.168.1.23:5173",
  appFEUrl: process.env.APP_FE_URL || "http://localhost:5173",
  allowedOrigins: (process.env.ALLOWED_ORIGINS || process.env.APP_FE_URL || "http://localhost:5173")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
  baseUrl: process.env.APP_URL || "http://localhost:3000",
  logoUrl: process.env.APP_URL || "http://localhost:3000",
  sessionSecret: process.env.SESSION_SECRET || "change-me",
  dbHost: process.env.DB_HOST || "localhost",
  dbPort: Number(process.env.DB_PORT || 3306),
  dbUser: process.env.DB_USER || "root",
  dbPassword: process.env.DB_PASSWORD || "root",
  dbName: process.env.DB_NAME || "ticket_management",
  dbPrefix: process.env.DB_PREFIX || "ab_",
  perPage: process.env.PER_PAGE || 20,
  legacyRoot: process.env.LEGACY_ROOT || "..",
  legacyAppDir: process.env.LEGACY_APP_DIR || "application",
  legacyUploadsDir: process.env.LEGACY_UPLOADS_DIR || "uploads",
  legacyTimezone: process.env.LEGACY_TIMEZONE || "Asia/Kolkata",
  legacyEncryptionKey: process.env.LEGACY_ENCRYPTION_KEY || "KFjfdJFNBBKIRMICdkf45",
  jwtSecret: process.env.JWT_SECRET || "1132e486f42b1f714fae447fcdab07f1ea819b4f7b997864c8b5f4869e148811",
  jwtExpire: process.env.JWT_EXPIRE || "1d",

  EMAIL_USER: process.env.EMAIL_USER || "ranjitambare7@gmail.com",
  EMAIL_PASS: process.env.EMAIL_PASS || "kxqw bais cktp nvrl",
};
