import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { toPage } from "../../common/dto/page.dto.js";
import { Database } from "../../database/database.service.js";
import { Queryable } from "../../database/database.types.js";
import { AuditAction } from "../audit/audit-action.js";
import { AuditService } from "../audit/audit.service.js";
import { MfaService } from "../auth/mfa/mfa.service.js";
import { EmailOtpPurpose } from "../auth/otp/email-otp.js";
import { EmailOtpService } from "../auth/otp/email-otp.service.js";
import { hashPassword } from "../auth/password.js";
import { SessionsService } from "../auth/sessions.service.js";
import { CategoriesRepository } from "../categories/categories.repository.js";
import { UserAdminResponse } from "../users/dto/user.response.js";
import { UserRole } from "../users/user-role.js";
import { UsersRepository } from "../users/users.repository.js";
import {
  AdminEditProfileDto,
  ChangeRoleDto,
  ChangeStatusDto,
  CreateUserDto,
  ListUsersQueryDto,
  ResetPasswordDto,
} from "./dto/user-management.dto.js";

/**
 * BL-04. Every change is audited with its reason. Administrators cannot act
 * on their own account here, and the last active administrator cannot be
 * demoted or deactivated.
 *
 * Lock order: all active admins (by id), then the target account.
 */
@Injectable()
export class UserManagementService {
  constructor(
    private readonly db: Database,
    private readonly users: UsersRepository,
    private readonly categories: CategoriesRepository,
    private readonly sessions: SessionsService,
    private readonly mfa: MfaService,
    private readonly emailOtp: EmailOtpService,
    private readonly audit: AuditService,
  ) {}

  async list(query: ListUsersQueryDto) {
    const { items, total } = await this.users.list(query, query);
    return toPage(items, total, query);
  }

  async get(id: string) {
    const user = await this.users.findAdminView(id);
    if (!user) throw new NotFoundException();
    return user;
  }

  async create(dto: CreateUserDto, actorId: string) {
    this.assertFacultyScope(dto.role, dto.facultyId ?? null);
    if (dto.categoryId && !(await this.categories.allActive([dto.categoryId])))
      throw new BadRequestException("Unknown or inactive category");
    const passwordHash = await hashPassword(dto.temporaryPassword);
    return this.db.transaction(async (tx) => {
      const user = await this.users.create(
        {
          email: dto.email,
          name: dto.name,
          passwordHash,
          role: dto.role,
          facultyId: dto.facultyId ?? null,
          categoryId: dto.categoryId ?? null,
          passwordChangeRequired: true,
        },
        tx,
      );
      // The new user confirms the address the administrator typed.
      await this.emailOtp.issue(user, EmailOtpPurpose.VerifyEmail, tx, {
        enforceLimits: false,
      });
      await this.audit.record(tx, {
        actorId,
        action: AuditAction.UserCreated,
        entityId: user.id,
        metadata: { role: user.role },
      });
      return user;
    });
  }

  changeRole(id: string, dto: ChangeRoleDto, actorId: string) {
    this.assertNotSelf(id, actorId, "change your own role");
    return this.db.transaction(async (tx) => {
      const admins = await this.users.lockActiveAdminIds(tx);
      const target = await this.lockTarget(id, tx);
      const facultyId =
        dto.facultyId ??
        (dto.role === UserRole.FacultyCoordinator ? target.facultyId : null);
      this.assertFacultyScope(dto.role, facultyId);
      if (target.role === dto.role && target.facultyId === facultyId)
        return target;
      if (target.role === UserRole.Admin && dto.role !== UserRole.Admin)
        this.assertAnotherAdminRemains(admins, id);

      const updated = await this.users.setRole(id, dto.role, facultyId, tx);
      await this.audit.record(tx, {
        actorId,
        action: AuditAction.UserRoleChanged,
        entityId: id,
        metadata: {
          from: target.role,
          to: dto.role,
          facultyId,
          reason: dto.reason,
        },
      });
      return updated;
    });
  }

  /** Deactivation takes effect on the next request and ends all sessions. */
  changeStatus(id: string, dto: ChangeStatusDto, actorId: string) {
    this.assertNotSelf(id, actorId, "change your own status");
    return this.db.transaction(async (tx) => {
      const admins = await this.users.lockActiveAdminIds(tx);
      const target = await this.lockTarget(id, tx);
      if (target.active === dto.active) return target;
      if (!dto.active && target.role === UserRole.Admin)
        this.assertAnotherAdminRemains(admins, id);

      const updated = await this.users.setActive(id, dto.active, tx);
      if (!dto.active) await this.sessions.revokeAll(id, tx);
      await this.audit.record(tx, {
        actorId,
        action: dto.active
          ? AuditAction.UserActivated
          : AuditAction.UserDeactivated,
        entityId: id,
        metadata: { reason: dto.reason },
      });
      return updated;
    });
  }

  /** Corrects a user's name, phone, job title, faculty or category; audited. */
  async editProfile(id: string, dto: AdminEditProfileDto, actorId: string) {
    this.assertNotSelf(id, actorId, "edit your own profile here");
    if (dto.categoryId && !(await this.categories.allActive([dto.categoryId])))
      throw new BadRequestException("Unknown or inactive category");
    return this.db.transaction(async (tx) => {
      await this.lockTarget(id, tx);
      const { reason, ...change } = dto;
      await this.users.updateProfile(id, change, tx);
      await this.audit.record(tx, {
        actorId,
        action: AuditAction.UserProfileEditedByAdmin,
        entityId: id,
        metadata: { changed: Object.keys(change), reason },
      });
      return (await this.users.findAdminView(id, tx))!;
    });
  }

  /** For a lost authenticator: the user must enrol again at next login. */
  resetMfa(id: string, reason: string, actorId: string) {
    this.assertNotSelf(id, actorId, "reset your own second factor");
    return this.db.transaction(async (tx) => {
      await this.lockTarget(id, tx);
      await this.mfa.reset(id, tx);
      await this.audit.record(tx, {
        actorId,
        action: AuditAction.MfaReset,
        entityId: id,
        metadata: { reason },
      });
      return (await this.users.findAdminView(id, tx))!;
    });
  }

  /** Until self-service recovery exists (BL-05). Ends all sessions. */
  async resetPassword(id: string, dto: ResetPasswordDto, actorId: string) {
    this.assertNotSelf(id, actorId, "reset your own password here");
    const passwordHash = await hashPassword(dto.temporaryPassword);
    return this.db.transaction(async (tx) => {
      await this.lockTarget(id, tx);
      await this.users.setPassword(id, passwordHash, true, tx);
      await this.sessions.revokeAll(id, tx);
      await this.audit.record(tx, {
        actorId,
        action: AuditAction.UserPasswordReset,
        entityId: id,
        metadata: { reason: dto.reason },
      });
      return (await this.users.findAdminView(id, tx))!;
    });
  }

  private async lockTarget(
    id: string,
    tx: Queryable,
  ): Promise<UserAdminResponse> {
    const target = await this.users.lockAdminView(id, tx);
    if (!target) throw new NotFoundException();
    return target;
  }

  private assertNotSelf(id: string, actorId: string, action: string) {
    if (id === actorId) throw new ForbiddenException(`You cannot ${action}`);
  }

  private assertFacultyScope(role: UserRole, facultyId: string | null) {
    if (role === UserRole.FacultyCoordinator && !facultyId)
      throw new BadRequestException(
        "A faculty coordinator must be assigned a faculty",
      );
  }

  private assertAnotherAdminRemains(activeAdminIds: string[], id: string) {
    if (!activeAdminIds.some((adminId) => adminId !== id))
      throw new ConflictException(
        "At least one active administrator must remain",
      );
  }
}
