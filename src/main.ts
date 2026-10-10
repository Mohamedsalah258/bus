import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { configureApp } from "./app.setup.js";
import { AppModule } from "./app.module.js";
import { JsonLogger } from "./common/logging/json-logger.js";
import { APP_CONFIG, AppConfig } from "./config/app-config.js";

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { logger: new JsonLogger() });
  configureApp(app);
  await app.listen(app.get<AppConfig>(APP_CONFIG).port, "0.0.0.0");
}

bootstrap().catch(() => {
  console.error("Startup failed. Check configuration and application logs.");
  process.exitCode = 1;
});
