import { SetMetadata } from "@nestjs/common";
import { PERMISSIONS_KEY } from "../auth.constants.js";
import { Permission } from "../permissions.js";

/** Caller's role must grant every listed permission (see ROLE_PERMISSIONS). */
export const RequirePermissions = (...permissions: Permission[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);
