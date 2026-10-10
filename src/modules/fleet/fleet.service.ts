import {
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
import { DriversRepository } from "./drivers.repository.js";
import { CreateDriverDto } from "./dto/create-driver.dto.js";
import { CreateVehicleDto } from "./dto/create-vehicle.dto.js";
import { UpdateDriverDto, UpdateVehicleDto } from "./dto/update-fleet.dto.js";
import { FleetUsageRepository } from "./fleet-usage.repository.js";
import { VehiclesRepository } from "./vehicles.repository.js";

@Injectable()
export class FleetService {
  constructor(
    private readonly db: Database,
    private readonly vehicles: VehiclesRepository,
    private readonly drivers: DriversRepository,
    private readonly usage: FleetUsageRepository,
    private readonly audit: AuditService,
  ) {}

  async listVehicles(page: PaginationQueryDto) {
    const { items, total } = await this.vehicles.list(page);
    return toPage(items, total, page);
  }

  createVehicle(dto: CreateVehicleDto) {
    return this.vehicles.create(dto);
  }

  async listDrivers(page: PaginationQueryDto) {
    const { items, total } = await this.drivers.list(page);
    return toPage(items, total, page);
  }

  createDriver(dto: CreateDriverDto) {
    return this.drivers.create(dto.name, dto.phone ?? null);
  }

  /**
   * BL-10. A capacity change does not touch existing trips (each keeps its
   * own capacity). Retiring is refused while anything still depends on it.
   */
  updateVehicle(id: string, dto: UpdateVehicleDto, actorId: string) {
    return this.db.transaction(async (tx) => {
      const before = await this.vehicles.lockForUpdate(id, tx);
      if (!before) throw new NotFoundException();
      if (dto.active === false && before.active)
        await this.assertUnused("vehicle", id, tx);
      const { reason, ...change } = dto;
      const after = await this.vehicles.update(id, change, tx);
      await this.audit.record(tx, {
        actorId,
        action: AuditAction.FleetUpdated,
        entityId: id,
        metadata: { kind: "vehicle", before, after, reason },
      });
      return after;
    });
  }

  updateDriver(id: string, dto: UpdateDriverDto, actorId: string) {
    return this.db.transaction(async (tx) => {
      const before = await this.drivers.lockForUpdate(id, tx);
      if (!before) throw new NotFoundException();
      if (dto.active === false && before.active)
        await this.assertUnused("driver", id, tx);
      const { reason, ...change } = dto;
      const after = await this.drivers.update(id, change, tx);
      await this.audit.record(tx, {
        actorId,
        action: AuditAction.FleetUpdated,
        entityId: id,
        // Phone numbers stay out of the audit trail.
        metadata: {
          kind: "driver",
          changed: Object.keys(change),
          active: after.active,
          reason,
        },
      });
      return after;
    });
  }

  private async assertUnused(
    kind: "vehicle" | "driver",
    id: string,
    tx: Queryable,
  ) {
    const { upcomingTrips, routes } = await this.usage.usage(kind, id, tx);
    if (upcomingTrips || routes.length)
      throw new ConflictException(
        `Still in use: ${upcomingTrips} upcoming trip(s)` +
          (routes.length ? `; default on route(s): ${routes.join(", ")}` : "") +
          ". Reassign or cancel them first.",
      );
  }
}
