import { serve } from "@hono/node-server";

import { createProductionApp } from "./app";

const DEFAULT_PORT = 3001;

const port = Number(process.env.PORT ?? DEFAULT_PORT);

const app = createProductionApp();

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`@ega/server listening on http://localhost:${info.port}`);
});
