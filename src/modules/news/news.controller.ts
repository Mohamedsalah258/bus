import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiTags,
} from "@nestjs/swagger";
import { ApiPageResponse } from "../../common/dto/page.dto.js";
import { AuthenticatedUser } from "../auth/auth.types.js";
import { CurrentUser } from "../auth/decorators/current-user.decorator.js";
import { Public } from "../auth/decorators/public.decorator.js";
import { RequirePermissions } from "../auth/decorators/require-permissions.decorator.js";
import { Permission } from "../auth/permissions.js";
import {
  CreateNewsDto,
  ListNewsQueryDto,
  NewsResponse,
  UpdateNewsDto,
} from "./dto/news.dto.js";
import { NewsService } from "./news.service.js";

@ApiTags("News and alerts")
@Controller("news")
export class NewsController {
  constructor(private readonly news: NewsService) {}

  /** Public homepage feed: pinned first, newest first; hidden, scheduled and expired posts excluded. */
  @Public()
  @Get()
  @ApiPageResponse(NewsResponse)
  list(@Query() q: ListNewsQueryDto) {
    if (q.includeHidden)
      throw new ForbiddenException("Use GET /news/manage for hidden posts");
    return this.news.list(q, false);
  }

  /** Staff view, including hidden, scheduled and expired posts. */
  @ApiBearerAuth()
  @RequirePermissions(Permission.ContentManage)
  @Get("manage")
  @ApiPageResponse(NewsResponse)
  manage(@Query() q: ListNewsQueryDto) {
    return this.news.list(q, true);
  }

  @Public()
  @Get(":id")
  @ApiOkResponse({ type: NewsResponse })
  get(@Param("id", ParseUUIDPipe) id: string) {
    return this.news.get(id);
  }

  @ApiBearerAuth()
  @RequirePermissions(Permission.ContentManage)
  @Post()
  @ApiCreatedResponse({ type: NewsResponse })
  create(@Body() dto: CreateNewsDto, @CurrentUser() u: AuthenticatedUser) {
    return this.news.create(dto, u.id);
  }

  @ApiBearerAuth()
  @RequirePermissions(Permission.ContentManage)
  @Patch(":id")
  @ApiOkResponse({ type: NewsResponse })
  update(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: UpdateNewsDto,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.news.update(id, dto, u.id);
  }
}
