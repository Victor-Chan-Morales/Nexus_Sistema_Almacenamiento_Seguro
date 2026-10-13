/**
 * Valores tomados de la base real (verificados con psql el 2026-10-12).
 * Si una migración los cambia, este es el único archivo a ajustar.
 */

/** Roles. Valor = columna `iam.role.name` (el diagrama los llama TENANT_ADMIN y COLABORADOR). */
export enum Role {
  TENANT_ADMIN = 'tenant_admin',
  COLABORADOR = 'colaborador',
}

/** Tipo ENUM iam.user_status */
export enum UserStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
  LOCKED = 'locked',
}

/** Tipo ENUM admin.organization_status */
export enum OrgStatus {
  ACTIVE = 'active',
  SUSPENDED = 'suspended',
  CANCELLED = 'cancelled',
}

/** Tipo ENUM iam.membership_status */
export enum MembershipStatus {
  ACTIVE = 'active',
  SUSPENDED = 'suspended',
}

/** Tipo ENUM admin.deployment_model */
export enum DeploymentModel {
  CLOUD = 'cloud',
  ON_PREMISES = 'on_premises',
  HYBRID = 'hybrid',
}

/** Tipo ENUM iam.token_purpose */
export enum TokenPurpose {
  EMAIL_VERIFICATION = 'email_verification',
  PASSWORD_RESET = 'password_reset',
}

/**
 * Toda organización que se registra por el flujo público nace como `cloud` (la plataforma alojada).
 * on_premises / hybrid se solicitan después por el flujo de instalación (InstallationService, módulo Admin).
 */
export const INITIAL_DEPLOYMENT_MODEL = DeploymentModel.CLOUD;
