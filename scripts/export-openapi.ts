import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { writeFile } from "node:fs/promises";
import { AppModule } from "../src/app.module.js";
import { API_PREFIX, buildOpenApiDocument } from "../src/openapi.js";

// Contract generation only: no database connection or HTTP listener.
process.env.JWT_SECRET ??= "openapi-generation-only-no-server-".repeat(2);
process.env.DATABASE_URL ??= "postgresql://unused/contract_only";
process.env.MFA_ENCRYPTION_KEY ??= Buffer.alloc(32).toString("base64");

const app = await NestFactory.create(AppModule, { logger: false });
try {
  app.setGlobalPrefix(API_PREFIX);
  const document = buildOpenApiDocument(app);
  await writeFile(
    "docs/openapi.json",
    JSON.stringify(document, null, 2) + "\n",
  );
  console.log("Exported docs/openapi.json");
} finally {
  await app.close();
}
