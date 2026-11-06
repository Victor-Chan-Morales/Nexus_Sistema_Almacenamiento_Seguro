/** Acciones auditables del corte SPEC-401. Enum cerrado: no admite texto libre. */
export enum AuditAction {
  AUTH_LOGIN = 'AUTH_LOGIN',
  AUTH_PASSWORD_RESET = 'AUTH_PASSWORD_RESET',
  MEMBER_ADDED = 'MEMBER_ADDED',
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
  FOLDER_CREATE = 'FOLDER_CREATE',
  FOLDER_DELETE = 'FOLDER_DELETE',
  FOLDER_RESTORE = 'FOLDER_RESTORE',
  FOLDER_PURGE = 'FOLDER_PURGE',
  PLAN_ACTIVATED = 'PLAN_ACTIVATED',
  PLAN_RENEWED = 'PLAN_RENEWED',
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
}

/** Entrada de `logEvent`. Sin campos libres: no puede transportar contraseñas, tokens ni nombres de archivo. */
export interface AuditEventInput {
  organizationId: string;
  actorId: string;
  action: AuditAction;
  resourceType?: AuditResource;
  resourceId?: string;
  /** Si falta, se genera un UUID por llamada. Las operaciones con varios eventos deben pasar el mismo valor. */
  correlationId?: string;
}
