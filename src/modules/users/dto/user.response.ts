import { ApiProperty } from "@nestjs/swagger";
import { USER_ROLES, UserRole } from "../user-role.js";

export class UserResponse {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty() email!: string;
  @ApiProperty({ nullable: true, type: String }) name!: string | null;
  @ApiProperty({ nullable: true, type: String, example: "01012345678" })
  phone!: string | null;
  @ApiProperty({ nullable: true, type: String }) jobTitle!: string | null;
  @ApiProperty({ enum: USER_ROLES }) role!: UserRole;
  @ApiProperty({ format: "uuid", nullable: true, type: String })
  facultyId!: string | null;
  @ApiProperty({ format: "uuid", nullable: true, type: String })
  categoryId!: string | null;
}

/** `GET /auth/me`: who I am and what my account still needs. */
export class MeResponse extends UserResponse {
  @ApiProperty() emailVerified!: boolean;
  @ApiProperty({
    description: "False until name, phone, faculty and category are set.",
  })
  profileComplete!: boolean;
  @ApiProperty() passwordChangeRequired!: boolean;
  @ApiProperty() mfaEnabled!: boolean;
  @ApiProperty({ description: "The role must enrol a second factor." })
  mfaRequired!: boolean;
}

/** Administrative view of an account. Never includes secrets. */
export class UserAdminResponse extends UserResponse {
  @ApiProperty() active!: boolean;
  @ApiProperty() emailVerified!: boolean;
  @ApiProperty() passwordChangeRequired!: boolean;
  @ApiProperty() mfaEnabled!: boolean;
  @ApiProperty({ type: String, format: "date-time" }) createdAt!: Date;
}
