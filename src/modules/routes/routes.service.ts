import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { toPage } from "../../common/dto/page.dto.js";
import { PaginationQueryDto } from "../../common/dto/pagination-query.dto.js";
import { Database } from "../../database/database.service.js";
import { Queryable } from "../../database/database.types.js";
import { AuditAction } from "../audit/audit-action.js";
import { AuditService } from "../audit/audit.service.js";
import { CategoriesRepository } from "../categories/categories.repository.js";
import {
  CreateRouteDto,
  ReplaceStopsDto,
  RouteDefaultsDto,
  RouteEligibilityDto,
  UpdateRouteDto,
} from "./dto/create-route.dto.js";
import { RouteResponse, RouteUpdateResponse } from "./dto/route.response.js";
import { RoutesRepository } from "./routes.repository.js";

@Injectable()
export class RoutesService {
  constructor(
    private readonly db: Database,
    private readonly routes: RoutesRepository,
    private readonly categories: CategoriesRepository,
    private readonly audit: AuditService,
  ) {}

  async list(page: PaginationQueryDto, includeInactive = false) {
    const { items, total } = await this.routes.list(page, includeInactive);
    return toPage(items, total, page);
  }

  create(dto: CreateRouteDto, actorId: string): Promise<RouteResponse> {
    return this.db.transaction(async (tx) => {
      await this.assertCategories(dto.eligibleCategoryIds, tx);
      const { id } = await this.routes.insertRoute(dto.name, tx);
      for (const [position, stop] of dto.stops.entries())
        await this.routes.insertStop(id, stop.name, position, tx);
      await this.routes.replaceEligibility(id, dto.eligibleCategoryIds, tx);
      if (dto.defaultVehicleId || dto.defaultDriverId) {
        await this.assertDefaults(
          dto.defaultVehicleId ?? null,
          dto.defaultDriverId ?? null,
          tx,
        );
        await this.routes.setDefaults(
          id,
          dto.defaultVehicleId ?? null,
          dto.defaultDriverId ?? null,
          tx,
        );
      }
      await this.audit.record(tx, {
        actorId,
        action: AuditAction.RouteCreated,
        entityId: id,
      });
      return (await this.routes.findDetail(id, tx))!;
    });
  }

  /**
   * Changes who may REQUEST a subscription from now on. Existing
   * subscriptions are not revoked; their review already happened.
   */
  updateEligibility(
    id: string,
    dto: RouteEligibilityDto,
    actorId: string,
  ): Promise<RouteResponse> {
    return this.db.transaction(async (tx) => {
      if (!(await this.routes.lockForUpdate(id, tx)))
        throw new NotFoundException();
      await this.assertCategories(dto.categoryIds, tx);
      const before = (await this.routes.findDetail(id, tx))!;
      await this.routes.replaceEligibility(id, dto.categoryIds, tx);
      const after = (await this.routes.findDetail(id, tx))!;
      await this.audit.record(tx, {
        actorId,
        action: AuditAction.RouteEligibilityChanged,
        entityId: id,
        metadata: {
          from: before.eligibleCategoryIds,
          to: after.eligibleCategoryIds,
          reason: dto.reason,
        },
      });
      return after;
    });
  }

  /**
   * Rename, close or reopen a route. Closing stops new bookings, subscription
   * requests and trip generation at once; existing bookings are kept and the
   * number of upcoming trips is reported so staff can cancel them if needed.
   */
  update(
    id: string,
    dto: UpdateRouteDto,
    actorId: string,
  ): Promise<RouteUpdateResponse> {
    return this.db.transaction(async (tx) => {
      if (!(await this.routes.lockForUpdate(id, tx)))
        throw new NotFoundException();
      const before = (await this.routes.findDetail(id, tx))!;
      await this.routes.update(id, { name: dto.name, active: dto.active }, tx);
      const after = (await this.routes.findDetail(id, tx))!;
      await this.audit.record(tx, {
        actorId,
        action:
          dto.active === false && before.active
            ? AuditAction.RouteClosed
            : dto.active === true && !before.active
              ? AuditAction.RouteReopened
              : AuditAction.RouteUpdated,
        entityId: id,
        metadata: {
          name: { from: before.name, to: after.name },
          active: { from: before.active, to: after.active },
          reason: dto.reason,
        },
      });
      return {
        ...after,
        upcomingTrips: await this.routes.upcomingTrips(id, tx),
      };
    });
  }

  /**
   * BL-09. Replaces the stop list. A kept stop must keep its id and name; a
   * renamed or removed stop is retired (never deleted), so past bookings
   * still show the stop they used. Removing a stop that upcoming confirmed
   * bookings board at is refused.
   */
  replaceStops(
    id: string,
    dto: ReplaceStopsDto,
    actorId: string,
  ): Promise<RouteResponse> {
    return this.db.transaction(async (tx) => {
      if (!(await this.routes.lockForUpdate(id, tx)))
        throw new NotFoundException();
      const current = await this.routes.activeStops(id, tx);
      const byId = new Map(current.map((stop) => [stop.id, stop]));
      const seen = new Set<string>();
      const plan = dto.stops.map((stop) => {
        if (!stop.id) return { name: stop.name };
        const existing = byId.get(stop.id);
        if (!existing || seen.has(stop.id))
          throw new BadRequestException(
            "Unknown or repeated stop id for this route",
          );
        seen.add(stop.id);
        // A new name is a new stop: the old one is retired with its history.
        return existing.name === stop.name
          ? { id: stop.id, name: stop.name }
          : { name: stop.name };
      });
      const keptIds = new Set(plan.flatMap((p) => (p.id ? [p.id] : [])));
      const retire = current
        .filter((stop) => !keptIds.has(stop.id))
        .map((stop) => stop.id);
      const blocking = await this.routes.upcomingBookingsAt(retire, tx);
      if (blocking)
        throw new ConflictException(
          `${blocking} upcoming booking(s) board at a stop being removed or renamed; cancel or wait for them first`,
        );
      await this.routes.replaceStops(id, retire, plan, tx);
      const after = (await this.routes.findDetail(id, tx))!;
      await this.audit.record(tx, {
        actorId,
        action: AuditAction.RouteStopsChanged,
        entityId: id,
        metadata: {
          version: after.version,
          retired: retire.length,
          added: plan.filter((p) => !p.id).length,
          reason: dto.reason,
        },
      });
      return after;
    });
  }

  /** The route's usual bus and driver; existing trips keep their own. */
  updateDefaults(
    id: string,
    dto: RouteDefaultsDto,
    actorId: string,
  ): Promise<RouteResponse> {
    return this.db.transaction(async (tx) => {
      if (!(await this.routes.lockForUpdate(id, tx)))
        throw new NotFoundException();
      const vehicleId = dto.defaultVehicleId ?? null;
      const driverId = dto.defaultDriverId ?? null;
      await this.assertDefaults(vehicleId, driverId, tx);
      await this.routes.setDefaults(id, vehicleId, driverId, tx);
      await this.audit.record(tx, {
        actorId,
        action: AuditAction.RouteDefaultsChanged,
        entityId: id,
        metadata: { vehicleId, driverId, reason: dto.reason },
      });
      return (await this.routes.findDetail(id, tx))!;
    });
  }

  private async assertDefaults(
    vehicleId: string | null,
    driverId: string | null,
    tx: Queryable,
  ) {
    if (!(await this.routes.defaultsAreActive(vehicleId, driverId, tx)))
      throw new BadRequestException(
        "Default vehicle and driver must exist and be active",
      );
  }

  private async assertCategories(ids: readonly string[], tx: Queryable) {
    if (!(await this.categories.allActive(ids, tx)))
      throw new BadRequestException("Unknown or inactive category");
  }
}
