import path from "path";
import { env } from "./env.js";

const legacyRoot = path.resolve(process.cwd(), env.legacyRoot);

export const legacyConfig = {
  legacyRoot,
  appDir: path.join(legacyRoot, env.legacyAppDir),
  uploadsDir: path.join(legacyRoot, env.legacyUploadsDir),
  modelsDir: path.join(legacyRoot, env.legacyAppDir, "models"),
  dbPrefix: env.dbPrefix,
  timezone: env.legacyTimezone,
};
