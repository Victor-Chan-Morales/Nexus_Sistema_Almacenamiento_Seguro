import { AuditActorType, AuditResult } from './entities/audit-event.entity';

export { AuditActorType, AuditResult };

/** Acciones auditables del corte SPEC-401. Enum cerrado: no admite texto libre. */
export enum AuditAction {
  AUTH_LOGIN = 'AUTH_LOGIN',
  AUTH_PASSWORD_RESET = 'AUTH_PASSWORD_RESET',
  MEMBER_ADDED = 'MEMBER_ADDED',
  MEMBER_ROLE_CHANGED = 'MEMBER_ROLE_CHANGED',
  MEMBER_SUSPENDED = 'MEMBER_SUSPENDED',
  MEMBER_REACTIVATED = 'MEMBER_REACTIVATED',
  MEMBER_REMOVED = 'MEMBER_REMOVED',
  FILE_UPLOAD = 'FILE_UPLOAD',
  FILE_DOWNLOAD = 'FILE_DOWNLOAD',
  FILE_DELETE = 'FILE_DELETE',
  FILE_RESTORE = 'FILE_RESTORE',
  FILE_PURGE = 'FILE_PURGE',
  FILE_VERSION_RESTORED = 'FILE_VERSION_RESTORED',
  SHARE_LINK_CREATED = 'SHARE_LINK_CREATED',
  SHARE_LINK_REVOKED = 'SHARE_LINK_REVOKED',
  DESTINATION_CREATED = 'DESTINATION_CREATED',
  DESTINATION_UPDATED = 'DESTINATION_UPDATED',
  DESTINATION_TESTED = 'DESTINATION_TESTED',
  TEAM_CREATED = 'TEAM_CREATED',
  TEAM_MEMBER_ADDED = 'TEAM_MEMBER_ADDED',
  TEAM_MEMBER_LEVEL_CHANGED = 'TEAM_MEMBER_LEVEL_CHANGED',
  TEAM_MEMBER_REMOVED = 'TEAM_MEMBER_REMOVED',
  FOLDER_CREATE = 'FOLDER_CREATE',
  FOLDER_DELETE = 'FOLDER_DELETE',
  FOLDER_RESTORE = 'FOLDER_RESTORE',
  FOLDER_PURGE = 'FOLDER_PURGE',
  PLAN_ACTIVATED = 'PLAN_ACTIVATED',
  PLAN_RENEWED = 'PLAN_RENEWED',
  DEPLOYMENT_MODEL_CHANGED = 'DEPLOYMENT_MODEL_CHANGED',
  INSTALLATION_REQUESTED = 'INSTALLATION_REQUESTED',
}

/** Recurso afectado. `resource_type` es varchar(20). */
export enum AuditResource {
  USER = 'user',
  MEMBERSHIP = 'membership',
  FILE = 'file',
  FOLDER = 'folder',
  SUBSCRIPTION = 'subscription',
  SHARE_LINK = 'share_link',
  DESTINATION = 'destination',
  TEAM = 'team',
  ORGANIZATION = 'organization',
  INSTALLATION_REQUEST = 'installation_request',
}

/**
 * Entrada de `logEvent`. Sin campos libres: no puede transportar contraseñas, tokens ni nombres de archivo.
 * `actorId` es obligatorio si y solo si `actorType` es `user` (restricción ck_audit_event_actor): la purga automática
 * (`system`) y el acceso público por enlace (`visitor`) no tienen persona que registrar.
 */
export interface AuditEventInput {
  organizationId: string;
  actorId?: string;
  /** Por defecto `USER`. */
  actorType?: AuditActorType;
  action: AuditAction;
  resourceType?: AuditResource;
  resourceId?: string;
  /** Si falta, se genera un UUID por llamada. Las operaciones con varios eventos deben pasar el mismo valor. */
  correlationId?: string;
  /** Si falta, `success`. SPEC-802: una prueba de conexión fallida registra `failure`. */
  result?: AuditResult;
  /** Causa segura de un fallo: una categoría cerrada, nunca el mensaje crudo de un proveedor. */
  safeReason?: string | null;
}
