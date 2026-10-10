import { INestApplication, ValidationPipe } from "@nestjs/common";
import { NestExpressApplication } from "@nestjs/platform-express";
import { SwaggerModule } from "@nestjs/swagger";
import helmet from "helmet";
import { AllExceptionsFilter } from "./common/filters/all-exceptions.filter.js";
import { requestIdMiddleware } from "./common/http/request-id.middleware.js";
import { requestLoggingMiddleware } from "./common/http/request-logging.middleware.js";
import { APP_CONFIG, AppConfig } from "./config/app-config.js";
import { API_PREFIX, buildOpenApiDocument } from "./openapi.js";

/** HTTP pipeline shared by the server and the end-to-end tests. */
export function configureApp(app: INestApplication) {
  const config = app.get<AppConfig>(APP_CONFIG);
  // Explicit hop count only: `true` would let clients spoof X-Forwarded-For
  // and escape per-IP rate limits.
  (app as NestExpressApplication).set(
    "trust proxy",
    config.trustProxyHops > 0 ? config.trustProxyHops : false,
  );
  app.use(requestIdMiddleware);
  app.use(requestLoggingMiddleware);
  app.use(helmet());
  app.setGlobalPrefix(API_PREFIX);
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());
  app.enableCors({
    origin: [...config.corsOrigins],
    credentials: false,
    exposedHeaders: ["X-Request-Id"],
  });
  app.enableShutdownHooks();
  if (config.swaggerEnabled)
    SwaggerModule.setup("docs", app, buildOpenApiDocument(app));
}
