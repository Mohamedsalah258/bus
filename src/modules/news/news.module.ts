import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module.js";
import { NewsController } from "./news.controller.js";
import { NewsRepository } from "./news.repository.js";
import { NewsService } from "./news.service.js";

@Module({
  imports: [AuditModule],
  controllers: [NewsController],
  providers: [NewsRepository, NewsService],
})
export class NewsModule {}
