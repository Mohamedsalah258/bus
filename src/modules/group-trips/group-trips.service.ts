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
import { AuthenticatedUser } from "../auth/auth.types.js";
import { hasPermissions, Permission } from "../auth/permissions.js";
import { DriversRepository } from "../fleet/drivers.repository.js";
import { VehiclesRepository } from "../fleet/vehicles.repository.js";
import { NotificationTemplate } from "../notifications/notification-template.js";
import { NotificationsService } from "../notifications/notifications.service.js";
import { TripStatus } from "../trips/trip.constants.js";
import { TripsRepository } from "../trips/trips.repository.js";
import { UsersRepository } from "../users/users.repository.js";
import {
  ApproveGroupTripDto,
  CreateGroupTripDto,
  GroupTripDetailResponse,
  GroupTripResponse,
  ListGroupTripsQueryDto,
} from "./dto/group-trip.dto.js";
import {
  canGroupTripTransition,
  GROUP_TRIP_TRANSITIONS,
  GroupTripStatus,
  GroupTripTransition,
} from "./group-trip-status.js";
import { GroupTripsRepository } from "./group-trips.repository.js";

type Bus = { plate: string; driverName: string; driverPhone: string | null };

/**
 * BL-15, decision D7: the transport office approves group trips. Approval
 * assigns buses and drivers and creates GROUP trips that hold them for the
 * whole outing, so the same resources cannot be double-booked.
 */
@Injectable()
export class GroupTripsService {
  constructor(
    private readonly db: Database,
    private readonly requests: GroupTripsRepository,
    private readonly users: UsersRepository,
    private readonly vehicles: VehiclesRepository,
    private readonly drivers: DriversRepository,
    private readonly trips: TripsRepository,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
  ) {}

  /** Saves the requester's name, phone and faculty with the request, like the old form. */
  create(user: AuthenticatedUser, dto: CreateGroupTripDto) {
    if (Date.parse(dto.returnAt) <= Date.parse(dto.departureAt))
      throw new BadRequestException("Return must be after departure");
    if (Date.parse(dto.departureAt) <= Date.now())
      throw new BadRequestException("Departure must be in the future");
    return this.db.transaction(async (tx) => {
      await this.users.updateProfile(
        user.id,
        {
          name: dto.name,
          phone: dto.phone,
          ...(user.role === "MEMBER" ? { facultyId: dto.facultyId } : {}),
        },
        tx,
      );
      const id = await this.requests.insert(user.id, dto, tx);
      await this.audit.record(tx, {
        actorId: user.id,
        action: AuditAction.GroupTripRequested,
        entityId: id,
        metadata: { passengers: dto.passengers },
      });
      const request = (await this.requests.find(id, tx))!;
      await this.notify(request, "RECEIVED", null, [], tx);
      return this.detail(request, tx);
    });
  }

  /**
   * Assigns one or more buses (seats must cover the group) and creates the
   * GROUP trips. Lock order: request, then vehicles, then drivers, each by id,
   * as for any trip assignment.
   */
  approve(id: string, dto: ApproveGroupTripDto, staff: AuthenticatedUser) {
    const vehicleIds = dto.assignments.map((a) => a.vehicleId);
    const driverIds = dto.assignments.map((a) => a.driverId);
    if (
      new Set(vehicleIds).size !== vehicleIds.length ||
      new Set(driverIds).size !== driverIds.length
    )
      throw new BadRequestException("Each bus and driver can be assigned once");
    return this.db.transaction(async (tx) => {
      const request = await this.lockRequest(id, tx);
      this.assertTransition("approve", request.status);
      if (!(await this.requests.isFuture(id, tx)))
        throw new ConflictException("The departure time has passed");

      const vehicles = new Map<
        string,
        Awaited<ReturnType<VehiclesRepository["lockForUpdate"]>>
      >();
      for (const vid of [...vehicleIds].sort())
        vehicles.set(vid, await this.vehicles.lockForUpdate(vid, tx));
      const drivers = new Map<
        string,
        Awaited<ReturnType<DriversRepository["lockForUpdate"]>>
      >();
      for (const did of [...driverIds].sort())
        drivers.set(did, await this.drivers.lockForUpdate(did, tx));

      let seats = 0;
      const departureAt = new Date(request.departureAt).toISOString();
      const returnAt = new Date(request.returnAt).toISOString();
      for (const a of dto.assignments) {
        const v = vehicles.get(a.vehicleId);
        const d = drivers.get(a.driverId);
        if (!v?.active || !d?.active)
          throw new BadRequestException(
            "Buses and drivers must exist and be active",
          );
        if (
          await this.trips.hasAssignmentOverlap(
            a.vehicleId,
            a.driverId,
            departureAt,
            returnAt,
            tx,
          )
        )
          throw new ConflictException(
            `Bus ${v.plate} or driver ${d.name} is already assigned at that time`,
          );
        seats += v.capacity;
      }
      if (seats < request.passengers)
        throw new BadRequestException(
          `Assigned seats (${seats}) are fewer than the passengers (${request.passengers})`,
        );

      const buses: Bus[] = [];
      for (const a of dto.assignments) {
        const v = vehicles.get(a.vehicleId)!;
        const d = drivers.get(a.driverId)!;
        await this.trips.insertGroupTrip(
          {
            requestId: id,
            vehicleId: v.id,
            driverId: d.id,
            departureAt,
            returnAt,
            capacity: v.capacity,
          },
          tx,
        );
        buses.push({
          plate: v.plate,
          driverName: d.name,
          driverPhone: d.phone,
        });
      }
      await this.requests.decide(
        id,
        GroupTripStatus.Approved,
        dto.reason,
        staff.id,
        tx,
      );
      await this.audit.record(tx, {
        actorId: staff.id,
        action: AuditAction.GroupTripDecided,
        entityId: id,
        metadata: {
          to: GroupTripStatus.Approved,
          buses: dto.assignments.length,
          seats,
          reason: dto.reason,
        },
      });
      await this.notify(request, "APPROVED", dto.reason, buses, tx);
      return this.detail((await this.requests.find(id, tx))!, tx);
    });
  }

  reject(id: string, reason: string, staff: AuthenticatedUser) {
    return this.officeDecision(id, "reject", reason, staff);
  }

  needsInfo(id: string, reason: string, staff: AuthenticatedUser) {
    return this.officeDecision(id, "needsInfo", reason, staff);
  }

  /** Cancels an approved outing and releases its buses. */
  cancel(id: string, reason: string, staff: AuthenticatedUser) {
    return this.db.transaction(async (tx) => {
      const request = await this.lockRequest(id, tx);
      this.assertTransition("cancel", request.status);
      for (const trip of await this.trips.groupTripsOf(id, tx))
        if (
          trip.status !== TripStatus.Cancelled &&
          trip.status !== TripStatus.Completed
        ) {
          await this.trips.lockForUpdate(trip.id, tx);
          await this.trips.applyTransition(
            trip.id,
            TripStatus.Cancelled,
            { reason, actorId: staff.id },
            tx,
          );
        }
      await this.requests.decide(
        id,
        GroupTripStatus.Cancelled,
        reason,
        staff.id,
        tx,
      );
      await this.audit.record(tx, {
        actorId: staff.id,
        action: AuditAction.GroupTripDecided,
        entityId: id,
        metadata: { to: GroupTripStatus.Cancelled, reason },
      });
      await this.notify(request, "CANCELLED", reason, [], tx);
      return this.detail((await this.requests.find(id, tx))!, tx);
    });
  }

  resubmit(id: string, note: string, user: AuthenticatedUser) {
    return this.requesterMove(id, "resubmit", note, user);
  }

  withdraw(id: string, user: AuthenticatedUser) {
    return this.requesterMove(id, "withdraw", null, user);
  }

  /** The requester, or transport office staff; anyone else gets 404. */
  async get(id: string, viewer: AuthenticatedUser) {
    const request = await this.requests.find(id);
    if (
      !request ||
      (request.userId !== viewer.id &&
        !hasPermissions(viewer.role, [Permission.GroupTripsRead]))
    )
      throw new NotFoundException();
    return this.detail(request);
  }

  async listMine(userId: string, page: PaginationQueryDto) {
    const { items, total } = await this.requests.listByUser(userId, page);
    return toPage(items, total, page);
  }

  async listForOffice(q: ListGroupTripsQueryDto) {
    const { items, total } = await this.requests.listForOffice(q);
    return toPage(items, total, q);
  }

  private officeDecision(
    id: string,
    name: "reject" | "needsInfo",
    reason: string,
    staff: AuthenticatedUser,
  ) {
    return this.db.transaction(async (tx) => {
      const request = await this.lockRequest(id, tx);
      this.assertTransition(name, request.status);
      const to = GROUP_TRIP_TRANSITIONS[name].to;
      await this.requests.decide(id, to, reason, staff.id, tx);
      await this.audit.record(tx, {
        actorId: staff.id,
        action: AuditAction.GroupTripDecided,
        entityId: id,
        metadata: { from: request.status, to, reason },
      });
      await this.notify(
        request,
        name === "reject" ? "REJECTED" : "NEEDS_INFO",
        reason,
        [],
        tx,
      );
      return this.detail((await this.requests.find(id, tx))!, tx);
    });
  }

  private requesterMove(
    id: string,
    name: "resubmit" | "withdraw",
    note: string | null,
    user: AuthenticatedUser,
  ) {
    return this.db.transaction(async (tx) => {
      const request = await this.lockRequest(id, tx);
      if (request.userId !== user.id) throw new NotFoundException();
      this.assertTransition(name, request.status);
      const to = GROUP_TRIP_TRANSITIONS[name].to;
      await this.requests.requesterMove(id, to, note, tx);
      await this.audit.record(tx, {
        actorId: user.id,
        action: AuditAction.GroupTripUpdatedByRequester,
        entityId: id,
        metadata: { from: request.status, to },
      });
      return this.detail((await this.requests.find(id, tx))!, tx);
    });
  }

  private async lockRequest(id: string, tx: Queryable) {
    const request = await this.requests.lock(id, tx);
    if (!request) throw new NotFoundException();
    return request;
  }

  private assertTransition(name: GroupTripTransition, from: GroupTripStatus) {
    if (!canGroupTripTransition(name, from))
      throw new ConflictException(`Cannot ${name} a request that is ${from}`);
  }

  private notify(
    r: GroupTripResponse,
    event: "RECEIVED" | "NEEDS_INFO" | "APPROVED" | "REJECTED" | "CANCELLED",
    reason: string | null,
    buses: Bus[],
    tx: Queryable,
  ) {
    return this.notifications.send(
      tx,
      { userId: r.userId, email: r.requesterEmail },
      NotificationTemplate.GroupTripUpdated,
      {
        name: r.requesterName ?? "",
        reference: r.reference,
        destination: r.destination,
        departureAt: new Date(r.departureAt).toISOString(),
        event,
        reason,
        buses,
      },
    );
  }

  private async detail(
    r: GroupTripResponse,
    tx?: Queryable,
  ): Promise<GroupTripDetailResponse> {
    return { ...r, trips: await this.trips.groupTripsOf(r.id, tx ?? this.db) };
  }
}
