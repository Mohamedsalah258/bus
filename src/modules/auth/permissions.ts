import { UserRole } from "../users/user-role.js";

/**
 * What a caller may do. Endpoints require permissions, never roles, so the
 * role matrix below is the single place where access is decided.
 */
export const Permission = {
  FacultiesManage: "faculties:manage",
  CategoriesManage: "categories:manage",
  SeasonsManage: "seasons:manage",
  RoutesManage: "routes:manage",
  FleetRead: "fleet:read",
  FleetManage: "fleet:manage",
  TripsManage: "trips:manage",
  SubscriptionsRequest: "subscriptions:request",
  /** Faculty coordinators are limited to their own faculty in the service. */
  SubscriptionsReadAll: "subscriptions:read-all",
  SubscriptionsReview: "subscriptions:review",
  SubscriptionsRecordPayment: "subscriptions:record-payment",
  PlansManage: "plans:manage",
  BookingsCreate: "bookings:create",
  BookingsManage: "bookings:manage",
  GroupTripsRequest: "group-trips:request",
  GroupTripsRead: "group-trips:read",
  GroupTripsManage: "group-trips:manage",
  ComplaintsSubmit: "complaints:submit",
  ComplaintsRead: "complaints:read",
  ComplaintsHandle: "complaints:handle",
  ReportsRead: "reports:read",
  NotificationsManage: "notifications:manage",
  ContentManage: "content:manage",
  UsersRead: "users:read",
  UsersManage: "users:manage",
  AuditRead: "audit:read",
} as const;

export type Permission = (typeof Permission)[keyof typeof Permission];

const ALL = Object.values(Permission);

export const ROLE_PERMISSIONS: Readonly<
  Record<UserRole, readonly Permission[]>
> = {
  [UserRole.Admin]: ALL,
  [UserRole.Dispatcher]: [
    Permission.RoutesManage,
    Permission.FleetRead,
    Permission.FleetManage,
    Permission.TripsManage,
    Permission.BookingsManage,
    Permission.SubscriptionsReadAll,
    Permission.SubscriptionsReview,
    Permission.SubscriptionsRecordPayment,
    Permission.ComplaintsRead,
    Permission.ComplaintsHandle,
    Permission.GroupTripsRead,
    Permission.GroupTripsManage,
    Permission.ReportsRead,
    Permission.ContentManage,
  ],
  [UserRole.FacultyCoordinator]: [
    Permission.SubscriptionsReadAll,
    Permission.SubscriptionsReview,
  ],
  // Read-only oversight: may look, never change.
  [UserRole.Auditor]: [
    Permission.AuditRead,
    Permission.ComplaintsRead,
    Permission.GroupTripsRead,
    Permission.ReportsRead,
    Permission.UsersRead,
    Permission.SubscriptionsReadAll,
  ],
  [UserRole.Member]: [
    Permission.SubscriptionsRequest,
    Permission.BookingsCreate,
    Permission.ComplaintsSubmit,
    Permission.GroupTripsRequest,
  ],
  [UserRole.Support]: [Permission.ComplaintsRead, Permission.ComplaintsHandle],
  // Permissions arrive with boarding (BL-25).
  [UserRole.Supervisor]: [],
};

export function hasPermissions(
  role: UserRole,
  required: readonly Permission[],
) {
  const granted = ROLE_PERMISSIONS[role];
  return required.every((permission) => granted.includes(permission));
}
