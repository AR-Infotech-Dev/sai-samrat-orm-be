import { legacyRoutes } from "#routes/legacy.routes.js";

for (const route of legacyRoutes) {
  console.log(`${route.uriPattern} -> ${route.target} -> ${route.expressPath}`);
}

console.log(`Total routes: ${legacyRoutes.length}`);
