import express from "express";
import cors from "cors";
import morgan from "morgan";
import session from "express-session";
import cookieParser from "cookie-parser";
import path from "path";
import routes from "#routes/index.js";
import { fileURLToPath } from "url";
import { env } from "#config/env.js";
import { legacyConfig } from "#config/legacy.js";
import { notFoundHandler } from "#middlewares/notFound.js";
import { errorHandler } from "#middlewares/errorHandler.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
app.use(express.static("public"));
app.use(cors({
  origin(origin, callback) {
    if (!origin || env.allowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    return callback(new Error("Not allowed by CORS"));
  },
  credentials: true,
  exposedHeaders: ["Content-Disposition", "Content-Type", "Content-Length"],
}));

morgan.token("ip", (req) => { return req.ip; });

app.use(morgan(":ip :method :url :status :res[content-length] - :response-time ms"));
app.use(cookieParser());
app.use(express.json({ limit: "20mb" }));
app.use(express.urlencoded({ extended: true, limit: "20mb" }));
app.use(
  session({
    name: "saisamrat.sid",
    secret: env.sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: false,
      maxAge: 2 * 60 * 60 * 1000
    }
  })
);
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    app: env.appName,
    legacyRoot: legacyConfig.legacyRoot,
    migratedControllers: ["login"]
  });
});
app.use("/uploads", express.static(path.resolve(__dirname, "..", "..", legacyConfig.uploadsDir)));
app.use('/api/v1/', routes);
app.use(notFoundHandler);
app.use(errorHandler);

export default app;
