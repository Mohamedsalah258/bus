import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Database } from "../../database/database.service.js";
import { AuditAction } from "../audit/audit-action.js";
import { AuditService } from "../audit/audit.service.js";
import { DriversRepository } from "../fleet/drivers.repository.js";
import { VehiclesRepository } from "../fleet/vehicles.repository.js";
import { TripsRepository } from "../trips/trips.repository.js";
import {
  CreateScheduleDto,
  GenerateTripsDto,
  GenerationReport,
  ScheduleResponse,
  ServiceExceptionDto,
  UpdateScheduleDto,
} from "./dto/schedule.dto.js";
import { ScheduleRow, SchedulesRepository } from "./schedules.repository.js";
import { fromDow, toDow } from "./weekdays.js";

const MAX_GENERATION_DAYS = 400;

/** Thrown inside the transaction so a dry run rolls back everything. */
class DryRunRollback {
  constructor(readonly report: GenerationReport) {}
}

/**
 * BL-11. Staff define recurring trips (time, days, seats, cutoffs, bus and
 * driver) and generate real trips for a period. Nothing is hard-coded.
 */
@Injectable()
export class SchedulesService {
  constructor(
    private readonly db: Database,
    private readonly schedules: SchedulesRepository,
    private readonly trips: TripsRepository,
    private readonly vehicles: VehiclesRepository,
    private readonly drivers: DriversRepository,
    private readonly audit: AuditService,
  ) {}

  async list(routeId: string | null) {
    return (await this.schedules.list(routeId)).map(present);
  }

  create(dto: CreateScheduleDto, actorId: string) {
    assertDates(dto.validFrom, dto.validUntil);
    return this.db.transaction(async (tx) => {
      const route = await this.schedules.routeDefaults(dto.routeId, tx);
      if (!route?.active) throw new BadRequestException("Route is unavailable");
      const created = await this.schedules.create(dto, tx);
      await this.audit.record(tx, {
        actorId,
        action: AuditAction.ScheduleCreated,
        entityId: created.id,
      });
      return present(created);
    });
  }

  /** Affects trips generated from now on; trips already generated keep their values. */
  update(id: string, dto: UpdateScheduleDto, actorId: string) {
    return this.db.transaction(async (tx) => {
      const current = await this.schedules.lock(id, tx);
      if (!current) throw new NotFoundException();
      const { weekdays, ...rest } = dto;
      const next: Omit<ScheduleRow, "id"> = {
        ...current,
        ...Object.fromEntries(
          Object.entries(rest).filter(([, v]) => v !== undefined),
        ),
        ...(weekdays ? { weekdays: toDow(weekdays) } : {}),
      };
      assertDates(next.validFrom, next.validUntil);
      const updated = await this.schedules.replace(id, next, tx);
      await this.audit.record(tx, {
        actorId,
        action: AuditAction.ScheduleUpdated,
        entityId: id,
        metadata: { changed: Object.keys(dto) },
      });
      return present(updated);
    });
  }

  /**
   * Creates the template's trips between two dates. Skips service
   * exceptions, dates already generated, and dates whose cutoff passed;
   * reports bus/driver conflicts instead of failing the whole batch.
   * Lock order as for any trip: vehicle → driver.
   */
  async generate(
    id: string,
    dto: GenerateTripsDto,
    actorId: string,
  ): Promise<GenerationReport> {
    assertDates(dto.from, dto.to);
    const days = (Date.parse(dto.to) - Date.parse(dto.from)) / 86_400_000;
    if (days > MAX_GENERATION_DAYS)
      throw new BadRequestException(
        `Generate at most ${MAX_GENERATION_DAYS} days at a time`,
      );
    try {
      return await this.db.transaction(async (tx) => {
        const template = await this.schedules.lock(id, tx);
        if (!template) throw new NotFoundException();
        if (!template.active)
          throw new BadRequestException("Schedule is inactive");
        const route = await this.schedules.routeDefaults(template.routeId, tx);
        if (!route?.active)
          throw new BadRequestException("Route is unavailable");

        const vehicleId = template.vehicleId ?? route.vehicleId;
        const driverId = template.driverId ?? route.driverId;
        if (!vehicleId || !driverId)
          throw new BadRequestException(
            "No bus or driver: set them on the schedule or as the route's defaults",
          );
        const vehicle = await this.vehicles.lockForUpdate(vehicleId, tx);
        const driver = await this.drivers.lockForUpdate(driverId, tx);
        if (!vehicle?.active || !driver?.active)
          throw new BadRequestException("Bus and driver must be active");
        const capacity = template.capacity ?? vehicle.capacity;
        if (capacity > vehicle.capacity)
          throw new BadRequestException(
            `Schedule seats (${capacity}) exceed the bus capacity (${vehicle.capacity})`,
          );

        const report: GenerationReport = {
          dryRun: Boolean(dto.dryRun),
          created: 0,
          createdDates: [],
          skippedHolidays: [],
          skippedExisting: [],
          skippedPast: [],
          conflicts: [],
        };
        for (const o of await this.schedules.occurrences(
          template,
          dto.from,
          dto.to,
          tx,
        )) {
          if (o.holiday) report.skippedHolidays.push(o.serviceDate);
          else if (o.existing) report.skippedExisting.push(o.serviceDate);
          else if (o.past) report.skippedPast.push(o.serviceDate);
          else if (
            await this.trips.hasAssignmentOverlap(
              vehicleId,
              driverId,
              o.departureAt,
              o.arrivalAt,
              tx,
            )
          )
            report.conflicts.push({
              date: o.serviceDate,
              reason: "Bus or driver already assigned at that time",
            });
          else {
            await this.trips.insert(
              {
                routeId: template.routeId,
                vehicleId,
                driverId,
                direction: template.direction,
                departureAt: o.departureAt,
                arrivalAt: o.arrivalAt,
                bookingClosesAt: o.bookingClosesAt,
                cancellationClosesAt: o.cancellationClosesAt,
                capacity,
                publish: dto.publish !== false,
              },
              tx,
              { templateId: template.id, serviceDate: o.serviceDate },
            );
            report.created++;
            report.createdDates.push(o.serviceDate);
          }
        }
        if (report.dryRun) throw new DryRunRollback(report);
        await this.audit.record(tx, {
          actorId,
          action: AuditAction.ScheduleGenerated,
          entityId: template.id,
          metadata: {
            from: dto.from,
            to: dto.to,
            created: report.created,
            conflicts: report.conflicts.length,
          },
        });
        return report;
      });
    } catch (error) {
      if (error instanceof DryRunRollback) return error.report;
      throw error;
    }
  }

  // ---- service exceptions (holidays) ----

  addException(dto: ServiceExceptionDto, actorId: string) {
    return this.db.transaction(async (tx) => {
      const added = await this.schedules.addException(dto.date, dto.reason, tx);
      await this.audit.record(tx, {
        actorId,
        action: AuditAction.ServiceExceptionAdded,
        entityId: added.id,
        metadata: { date: dto.date, reason: dto.reason },
      });
      return added;
    });
  }

  listExceptions(from: string, to: string) {
    assertDates(from, to);
    return this.schedules.listExceptions(from, to);
  }

  removeException(id: string, actorId: string) {
    return this.db.transaction(async (tx) => {
      if (!(await this.schedules.removeException(id, tx)))
        throw new NotFoundException();
      await this.audit.record(tx, {
        actorId,
        action: AuditAction.ServiceExceptionRemoved,
        entityId: id,
      });
    });
  }
}

function present(row: ScheduleRow): ScheduleResponse {
  return { ...row, weekdays: fromDow(row.weekdays) };
}

function assertDates(from: string, to: string) {
  if (to < from)
    throw new BadRequestException("End date must not precede start date");
}
