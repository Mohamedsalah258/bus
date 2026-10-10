export const UserRole = {
  Member: "MEMBER",
  Dispatcher: "DISPATCHER",
  Admin: "ADMIN",
  FacultyCoordinator: "FACULTY_COORDINATOR",
  Supervisor: "SUPERVISOR",
  Support: "SUPPORT",
  Auditor: "AUDITOR",
} as const;

export type UserRole = (typeof UserRole)[keyof typeof UserRole];

export const USER_ROLES = Object.values(UserRole);

/** Roles that cannot use the API until a second factor is enrolled (BL-06). */
export const MFA_REQUIRED_ROLES: readonly UserRole[] = [
  UserRole.Admin,
  UserRole.Dispatcher,
];
