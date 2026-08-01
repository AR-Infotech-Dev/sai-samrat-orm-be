import app from "./app.js";
import http from "http";
import { env } from "#config/env.js";

const server = http.createServer(app); // ✅

server.listen(env.port, "0.0.0.0", () => {
  console.log(`${env.appName} listening on port ${env.port}`);
});
