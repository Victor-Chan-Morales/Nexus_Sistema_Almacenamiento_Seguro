import { Injectable } from '@nestjs/common';
import { AuditService } from '../../audit/audit.service';
import { AuditAction, AuditResource } from '../../audit/audit.types';
import { UserStatus } from '../domain/enums';
import { ChangePasswordDto } from '../dto/change-password.dto';
import { IamErrors } from '../iam.errors';
import { SessionRepository, UserRepository } from '../ports/repositories';
import { PasswordHasher } from '../ports/security';
import { UnitOfWork } from '../ports/transaction';
import { AuthUser } from '../interfaces/auth-user.interface';

/**
 * Cuenta del propio usuario con sesión iniciada (SPEC-113): cambio de nombre y de contraseña.
 * Todo sale de `actor` (JWT + membresía revalidada); nunca se toma un id del cuerpo de la petición.
 */
@Injectable()
export class AccountService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly users: UserRepository,
    private readonly sessions: SessionRepository,
    private readonly hasher: PasswordHasher,
    private readonly audit: AuditService,
  ) {}

  /** Escenario 1. Devuelve el nombre guardado; el controlador arma MeResponse. */
  async updateProfile(actor: AuthUser, fullName: string): Promise<string> {
    await this.uow.run((tx) => this.users.updateFullName(tx, actor.userId, fullName));
    return fullName;
  }

  /** Escenarios 2 y 3. */
  async changePassword(actor: AuthUser, dto: ChangePasswordDto): Promise<void> {
    const user = await this.users.findById(actor.userId);
    if (!user || user.status !== UserStatus.ACTIVE) throw IamErrors.unauthorized();

    const now = new Date();
    // Igual que el login (SPEC-112): el hash se verifica SIEMPRE, también con la cuenta bloqueada.
    const matches = await this.hasher.verify(user.passwordHash, dto.currentPassword);

    // Bloqueado: ni la contraseña correcta entra, y el intento no cuenta (no alarga el bloqueo).
    if (user.lockedUntil && user.lockedUntil.getTime() > now.getTime()) throw IamErrors.invalidCredentials();

    if (!matches) {
      // Fuera de la transacción que se revierte al lanzar: el fallo debe quedar guardado.
      await this.users.registerFailedLogin(user.id, now);
      throw IamErrors.invalidCredentials();
    }

    // Argon2id fuera de la transacción para no retener el bloqueo de fila mientras hashea.
    const passwordHash = await this.hasher.hash(dto.newPassword);

    await this.uow.run(async (tx) => {
      // Serializa cambios concurrentes: si el hash cambió mientras tanto, no se escribe nada.
      const locked = await this.users.findByIdForUpdate(user.id, tx);
      if (!locked || locked.passwordHash !== user.passwordHash) throw IamErrors.invalidCredentials();
      // Otra petición pudo bloquear la cuenta mientras se hasheaba: el bloqueo gana (SPEC-112).
      if (locked.lockedUntil && locked.lockedUntil.getTime() > Date.now()) throw IamErrors.invalidCredentials();

      await this.users.setPassword(tx, user.id, passwordHash);
      await this.sessions.revokeAllActiveOf(tx, user.id); // ADR-003: cambiar contraseña revoca todas las sesiones
      await this.users.clearFailedLogins(user.id, tx);
    });

    // SPEC-113: AUTH_PASSWORD_CHANGED tras el commit. Un fallo de auditoría no cambia la respuesta.
    void this.audit.logEvent({
      organizationId: actor.organizationId,
      actorId: actor.userId,
      action: AuditAction.AUTH_PASSWORD_CHANGED,
      resourceType: AuditResource.USER,
      resourceId: user.id,
    }).catch(() => {});
  }
}
