import { test } from "node:test";
import assert from "node:assert/strict";
import {
  hasPermissions,
  Permission,
  ROLE_PERMISSIONS,
} from "../../src/modules/auth/permissions.js";
import { USER_ROLES, UserRole } from "../../src/modules/users/user-role.js";

test("every role has an explicit permission list", () => {
  for (const role of USER_ROLES)
    assert.ok(Array.isArray(ROLE_PERMISSIONS[role]));
});

test("only administrators manage users, categories and faculties", () => {
  for (const permission of [
    Permission.UsersManage,
    Permission.CategoriesManage,
    Permission.FacultiesManage,
  ])
    for (const role of USER_ROLES)
      assert.equal(
        hasPermissions(role, [permission]),
        role === UserRole.Admin,
        `${role} ${permission}`,
      );
});

test("auditors can read but never change", () => {
  const granted = ROLE_PERMISSIONS[UserRole.Auditor];
  assert.ok(granted.every((p) => /:(read|read-all)$/.test(p)));
});

test("faculty coordinators review subscriptions and nothing operational", () => {
  assert.deepEqual(
    [...ROLE_PERMISSIONS[UserRole.FacultyCoordinator]].sort(),
    [Permission.SubscriptionsReadAll, Permission.SubscriptionsReview].sort(),
  );
});

test("members can request and book, not review", () => {
  assert.ok(hasPermissions(UserRole.Member, [Permission.BookingsCreate]));
  assert.ok(!hasPermissions(UserRole.Member, [Permission.SubscriptionsReview]));
});
