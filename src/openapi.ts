import { INestApplication } from "@nestjs/common";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";

export const API_PREFIX = "api/v1";
export const API_VERSION = "0.14.0";

export function buildOpenApiDocument(app: INestApplication) {
  const config = new DocumentBuilder()
    .setTitle("BSU Transport API")
    .setDescription("Backend foundation — not yet production complete")
    .setVersion(API_VERSION)
    .addBearerAuth()
    .build();
  return SwaggerModule.createDocument(app, config);
}
