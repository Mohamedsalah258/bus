import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  MaxLength,
} from "class-validator";
import { PaginationQueryDto } from "../../../common/dto/pagination-query.dto.js";
import {
  EGYPTIAN_MOBILE,
  normalizeEgyptianMobile,
} from "../../auth/dto/profile.dto.js";
import { USER_ROLES, UserRole } from "../../users/user-role.js";

const normalizeEmail = ({ value }: { value: unknown }) =>
  typeof value === "string" ? value.trim().toLowerCase() : value;

export class ReasonDto {
  @ApiProperty({ description: "Recorded in the audit log." })
  @IsString()
  @Length(3, 500)
  reason!: string;
}

export class CreateUserDto {
  @ApiProperty()
  @Transform(normalizeEmail)
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @ApiProperty() @IsString() @Length(2, 120) name!: string;

  @ApiProperty({ enum: USER_ROLES }) @IsIn(USER_ROLES) role!: UserRole;

  @ApiPropertyOptional({
    format: "uuid",
    description: "Required for FACULTY_COORDINATOR.",
  })
  @IsOptional()
  @IsUUID()
  facultyId?: string;

  @ApiPropertyOptional({ format: "uuid" })
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @ApiProperty({
    minLength: 12,
    maxLength: 128,
    description: "Handed over out of band; must be changed at first login.",
  })
  @IsString()
  @Length(12, 128)
  temporaryPassword!: string;
}

export class ChangeRoleDto extends ReasonDto {
  @ApiProperty({ enum: USER_ROLES }) @IsIn(USER_ROLES) role!: UserRole;

  @ApiPropertyOptional({
    format: "uuid",
    description:
      "Faculty scope; required when the role is FACULTY_COORDINATOR.",
  })
  @IsOptional()
  @IsUUID()
  facultyId?: string;
}

export class ChangeStatusDto extends ReasonDto {
  @ApiProperty() @IsBoolean() active!: boolean;
}

export class ResetPasswordDto extends ReasonDto {
  @ApiProperty({ minLength: 12, maxLength: 128 })
  @IsString()
  @Length(12, 128)
  temporaryPassword!: string;
}

export class ListUsersQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: USER_ROLES })
  @IsOptional()
  @IsIn(USER_ROLES)
  role?: UserRole;

  @ApiPropertyOptional({ type: Boolean })
  @IsOptional()
  @Transform(({ value }) =>
    value === "true" ? true : value === "false" ? false : value,
  )
  @IsBoolean()
  active?: boolean;

  @ApiPropertyOptional({ format: "uuid" })
  @IsOptional()
  @IsUUID()
  facultyId?: string;

  @ApiPropertyOptional({ description: "Part of the name or email." })
  @IsOptional()
  @IsString()
  @Length(1, 100)
  search?: string;
}

export class AdminEditProfileDto extends ReasonDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(2, 120)
  name?: string;

  @ApiPropertyOptional({ example: "01012345678" })
  @IsOptional()
  @Transform(normalizeEgyptianMobile)
  @Matches(EGYPTIAN_MOBILE, {
    message: "phone must be an Egyptian mobile number",
  })
  phone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(2, 120)
  jobTitle?: string;
  @ApiPropertyOptional({ format: "uuid" })
  @IsOptional()
  @IsUUID()
  facultyId?: string;
  @ApiPropertyOptional({ format: "uuid" })
  @IsOptional()
  @IsUUID()
  categoryId?: string;
}
