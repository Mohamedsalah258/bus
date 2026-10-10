import { SetMetadata } from "@nestjs/common";
import { ALLOW_INCOMPLETE_ACCOUNT_KEY } from "../auth.constants.js";

/**
 * Reachable while the account must still change its password or enrol a
 * second factor. Everything else answers 403 until setup is complete.
 */
export const AllowIncompleteAccount = () =>
  SetMetadata(ALLOW_INCOMPLETE_ACCOUNT_KEY, true);
