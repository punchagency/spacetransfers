import http from "http";
import app from "./app.js";
import { connectToDatabase } from "./config/db.js";
import { env } from "./config/env.js";

const start = async (): Promise<void> => {
  await connectToDatabase();

  const server = http.createServer(app);

  server.listen(env.port, () => {
    console.log(`space-transfer-server listening on port ${env.port}`);
  });
};

start().catch((error) => {
  console.error("Failed to start server", error);
  process.exit(1);
});
