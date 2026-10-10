import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { toPage } from "../../common/dto/page.dto.js";
import { Database } from "../../database/database.service.js";
import { AuditAction } from "../audit/audit-action.js";
import { AuditService } from "../audit/audit.service.js";
import {
  CreatePlanDto,
  ListPlansQueryDto,
  PlanStatusDto,
} from "./dto/plan.dto.js";
import { PlansRepository } from "./plans.repository.js";

/**
 * Decision D2: plans carry the period (annual or term) and the fee (free or
 * paid). A season can offer several plans side by side.
 */
@Injectable()
export class PlansService {
  constructor(
    private readonly db: Database,
    private readonly plans: PlansRepository,
    private readonly audit: AuditService,
  ) {}

  async listOpen(query: ListPlansQueryDto) {
    const { items, total } = await this.plans.listOpen(query);
    return toPage(items, total, query);
  }

  create(dto: CreatePlanDto, actorId: string) {
    if (dto.endsOn < dto.startsOn)
      throw new BadRequestException("Plan end must follow its start");
    return this.db.transaction(async (tx) => {
      if (!(await this.plans.fitsSeason(dto, tx)))
        throw new BadRequestException(
          "Plan dates must fall inside an existing season",
        );
      const plan = await this.plans.create(dto, tx);
      await this.audit.record(tx, {
        actorId,
        action: AuditAction.PlanCreated,
        entityId: plan.id,
        metadata: { period: plan.period, feeMinor: plan.feeMinor },
      });
      return plan;
    });
  }

  /** Closing a plan stops new requests; existing subscriptions are untouched. */
  setStatus(id: string, dto: PlanStatusDto, actorId: string) {
    return this.db.transaction(async (tx) => {
      const plan = await this.plans.setActive(id, dto.active, tx);
      if (!plan) throw new NotFoundException();
      await this.audit.record(tx, {
        actorId,
        action: AuditAction.PlanStatusChanged,
        entityId: id,
        metadata: { active: dto.active, reason: dto.reason },
      });
      return plan;
    });
  }
}
