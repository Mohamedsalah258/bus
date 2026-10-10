import { UserRole } from "../users/user-role.js";

/** The caller attached to `request.user` after authentication. */
export interface AuthenticatedUser {
  id: string;
  email: string;
  /** Null until a password-free member fills in the subscription form. */
  name: string | null;
  phone: string | null;
  jobTitle: string | null;
  role: UserRole;
  facultyId: string | null;
  categoryId: string | null;
  emailVerified: boolean;
  /** Name, phone, faculty and category are all set. */
  profileComplete: boolean;
  passwordChangeRequired: boolean;
  mfaEnabled: boolean;
}

export interface AccessTokenClaims {
  sub: string;
  ver: number;
}

export interface MfaTokenClaims {
  sub: string;
  ver: number;
  purpose: "mfa";
}
