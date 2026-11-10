/** Shared TypeScript contract types for the Nexus web API clients. */

export type ApiErrorPayload = {
  code?: string;
  message?: string;
  requestId?: string;
};

export type ApiRequestOptions = {
  /** Short-lived access token kept by the caller in memory. */
  accessToken?: string;
  headers?: HeadersInit;
  signal?: AbortSignal;
};

/** Open until the IAM owners finalize the complete role enum. */
export type UserRole = string;
export type UUID = string;
export type ISODateTime = string;

export type UserIdentity = {
  id: UUID;
  fullName: string;
  email: string;
};

export type OrganizationReference = {
  id: UUID;
  name: string;
};

export type RegisterInput = {
  fullName: string;
  email: string;
  password: string;
  organizationName: string;
};

export type RegisterResponse = {
  userId: UUID;
  organizationId: UUID;
  role: UserRole;
  verificationRequired: boolean;
};

export type LoginInput = {
  email: string;
  password: string;
};

export type LoginResponse = {
  accessToken: string;
  expiresAt: ISODateTime;
  user: UserIdentity;
  organization: OrganizationReference;
  role: UserRole;
  /** SPEC-501: solo en la respuesta; nunca viaja en el access token. */
  isSuperAdmin: boolean;
};

export type VerifyEmailResponse = {
  verified: true;
};

export type CurrentUserResponse = {
  user: UserIdentity;
  organization: OrganizationReference;
  role: UserRole;
  /** SPEC-501 */
  isSuperAdmin: boolean;
};

export type Plan = {
  id: UUID;
  name: string;
  description: string;
  priceMonthly: number;
  storageLimitBytes: number;
  userLimit: number;
  validityDays: number | null;
};

export type PlanCatalogResponse = {
  items: Plan[];
};

export type ActivateSubscriptionResponse = {
  subscriptionId: UUID;
  status: "active";
  simulated: true;
  startDate: ISODateTime;
  endDate: ISODateTime | null;
};

export type DashboardPlan = {
  id: UUID;
  name: string;
  storageLimitBytes: number;
  userLimit: number;
  expiresAt: ISODateTime | null;
  simulated: boolean;
};

export type DashboardResponse<TPlan = DashboardPlan | null, TActivity = never> = {
  organizationName: string;
  plan: TPlan;
  storageUsedBytes: number;
  storageLimitBytes: number;
  recentActivity: TActivity[];
};

export type Folder = {
  id: UUID;
  name: string;
  parentFolderId: UUID | null;
  driveId: UUID;
  sizeBytes?: number;
  createdAt?: ISODateTime;
  /** SPEC-803: destino de la carpeta. Las subcarpetas heredan el de su carpeta principal. */
  destinationId?: UUID | null;
  /** SPEC-803: ubicación del destino para la etiqueta Nube / Servidor local del explorador. */
  destinationLocation?: DestinationLocation | null;
};

export type PersonalDrive = {
  id: UUID;
  name: string;
  rootFolderId: UUID;
};

export type FolderListResponse = {
  drive: PersonalDrive;
  items: Folder[];
};

export type CreateFolderInput = {
  name: string;
  parentFolderId?: UUID;
  /** SPEC-803: solo en carpetas principales de un modelo híbrido. En otros casos la API responde 422. */
  destinationId?: UUID;
};

export type CreateFolderResponse = Folder & {
  createdAt: ISODateTime;
};

export type FileMetadata = {
  id: UUID;
  name: string;
  mimeType: string;
  sizeBytes: number;
  versionId: UUID;
  uploadedAt: ISODateTime;
};

export type FolderItemsResponse<TFile = FileMetadata> = {
  folder: Folder;
  folders: Folder[];
  files: TFile[];
};

export type UploadFileResponse = {
  id: UUID;
  name: string;
  mimeType: string;
  sizeBytes: number;
  versionId: UUID;
  uploadedAt: ISODateTime;
};

/** Archivo movido individualmente a `GET /files/trash`. */
export type TrashFileItem = {
  kind: "file";
  id: UUID;
  name: string;
  mimeType: string;
  sizeBytes: number;
  deletedAt: ISODateTime;
  retentionEndsAt: ISODateTime;
};

/** Carpeta y árbol de contenido movidos juntos a `GET /files/trash`. */
export type TrashFolderItem = {
  kind: "folder";
  id: UUID;
  name: string;
  parentFolderId: UUID;
  sizeBytes: number;
  deletedAt: ISODateTime;
  retentionEndsAt: ISODateTime;
};

export type TrashItem = TrashFileItem | TrashFolderItem;
export type TrashResponse = { items: TrashItem[]; totalItems: number };
export type RestoreFileResponse = { id: UUID; name: string; folderId: UUID };
export type PurgeFileResponse = { id: UUID; freedBytes: number };
export type DeleteFileResponse = { success: boolean; id: UUID };

/** SPEC-206: una versión del historial de un archivo (sin campos internos de almacenamiento). */
export type FileVersionItem = {
  versionId: UUID;
  versionNumber: number;
  sizeBytes: number;
  uploadedAt: ISODateTime;
  isCurrent: boolean;
};
/** SPEC-206: respuesta de `GET /files/:id/versions`, de la más reciente a la más antigua. */
export type FileVersionsResponse = {
  fileId: UUID;
  fileName: string;
  currentVersion: number;
  versions: FileVersionItem[];
};
/** SPEC-210: respuesta de `POST /files/:id/versions/:versionId/restore`. `versionId` y `versionNumber` son de la versión nueva. */
export type RestoredFileVersionResponse = {
  fileId: UUID;
  versionId: UUID;
  versionNumber: number;
  sizeBytes: number;
  uploadedAt: ISODateTime;
};

export type BillingOperationType = "charge" | "renewal";

export type BillingOperationItem = {
  id: UUID;
  type: BillingOperationType;
  planName: string;
  amount: number;
  simulated: boolean;
  occurredAt: ISODateTime;
};

export type BillingOperationsResponse = {
  items: BillingOperationItem[];
};

export type RenewSubscriptionResponse = ActivateSubscriptionResponse;

// SPEC-106: Gestión de miembros
export type MemberRole = "tenant_admin" | "colaborador";
export type MemberStatus = "active" | "suspended";

export type OrganizationMember = {
  id: UUID;
  userId: UUID;
  fullName: string;
  email: string;
  role: MemberRole;
  status: MemberStatus;
  joinedAt?: ISODateTime;
  createdAt?: ISODateTime;
};

export type OrganizationMembersResponse = {
  members: OrganizationMember[];
  totalMembers: number;
  userLimit: number | null;
};

export type UpdateMemberInput = {
  role?: MemberRole;
  status?: MemberStatus;
};

export type AddMemberInput = {
  fullName: string;
  email: string;
  role: MemberRole;
};

export type AddMemberResponse = {
  id: UUID;
  userId: UUID;
  email: string;
  fullName: string;
  role: MemberRole;
  status: MemberStatus;
  createdAt: ISODateTime;
};

// SPEC-105: Recuperación de contraseña
export type ForgotPasswordInput = {
  email: string;
};

export type ForgotPasswordResponse = {
  message: string;
};

export type ResetPasswordInput = {
  token: string;
  newPassword: string;
};

export type ResetPasswordResponse = {
  message: string;
};

export type AuditEvent = {
  id: UUID;
  /** Código de CONTRACTS v0.5 «Auditoría». Se tipa como string: la pantalla debe mostrar un código desconocido tal cual. */
  action: string;
  resourceType: string | null;
  resourceId: UUID | null;
  actorId: UUID;
  result: string;
  occurredAt: ISODateTime;
};

export type AuditEventsResponse = {
  events: AuditEvent[];
  nextBefore: ISODateTime | null;
};

export type AuditEventsQuery = {
  limit?: number;
  before?: ISODateTime;
};

// SPEC-803/804: modelo de despliegue, destinos de almacenamiento e solicitudes de instalación
export type DeploymentModel = "cloud" | "on_premises" | "hybrid";
export type DestinationLocation = "cloud" | "on_premises";
export type DestinationConnectionStatus = "Sin comprobar" | "Comprobando" | "Conectado" | "Sin conexión";
export type DestinationProviderType = "s3" | "minio";

/** SPEC-802: forma de un destino en `GET /destinations`. Sin credenciales; `endpoint` y `region` son null en los destinos de entorno. */
export type Destination = {
  id: UUID;
  name: string;
  location: DestinationLocation;
  providerType: DestinationProviderType;
  endpoint: string | null;
  bucket: string;
  region: string | null;
  connectionStatus: DestinationConnectionStatus;
  isEnabled: boolean;
  isDefault: boolean;
  createdAt: ISODateTime;
};

export type DestinationListResponse = {
  items: Destination[];
};

/** SPEC-802: cuerpo de `POST /destinations`. Las credenciales solo viajan en la solicitud; ninguna respuesta las devuelve. */
export type CreateDestinationInput = {
  name: string;
  location: DestinationLocation;
  providerType: DestinationProviderType;
  endpoint: string;
  bucket: string;
  region: string;
  accessKey: string;
  secretKey: string;
  useSsl: boolean;
};

/** SPEC-802: respuesta de `POST /destinations/:id/test`. `reason` es null cuando la conexión funciona. */
export type TestDestinationResponse = {
  status: "Conectado" | "Sin conexión";
  checkedAt: ISODateTime;
  reason: "AUTH" | "NETWORK" | "BUCKET_NOT_FOUND" | "DATA_MISMATCH" | null;
};

/** SPEC-803: destino que se ofrece para elegir en la política (sin endpoint ni credenciales). */
export type StoragePolicyDestination = {
  id: UUID;
  name: string;
  location: DestinationLocation;
};

/** SPEC-803: respuesta de `GET` y `PUT /organizations/storage-policy`. */
export type StoragePolicy = {
  model: DeploymentModel;
  defaultDestinationId: UUID | null;
  destinations: StoragePolicyDestination[];
};

/** SPEC-803: cuerpo de `PUT /organizations/storage-policy`. */
export type UpdateStoragePolicyInput = {
  model: DeploymentModel;
  defaultDestinationId: UUID;
};

export type InstallationRequestStatus = "Pendiente" | "Aprobada" | "Rechazada" | "Cerrada";

/** SPEC-803: solicitud de instalación de la organización (`GET /organizations/installation-requests`). */
export type InstallationRequest = {
  id: UUID;
  requestedModel: DeploymentModel;
  status: InstallationRequestStatus;
  createdAt: ISODateTime;
  reviewedAt: ISODateTime | null;
};

export type InstallationRequestListResponse = {
  items: InstallationRequest[];
};

export type CreateInstallationRequestInput = {
  requestedModel: DeploymentModel;
};

/** SPEC-803: respuesta `201` de `POST /organizations/installation-requests`. */
export type CreateInstallationRequestResponse = {
  id: UUID;
  status: InstallationRequestStatus;
  createdAt: ISODateTime;
};

/** SPEC-501: consultas de plataforma (solo Super Admin). */
export type PlatformOrganization = {
  id: UUID;
  name: string;
  status: string;
  deploymentModel: string;
  planName: string | null;
  usedBytes: number;
  storageLimitBytes: number | null;
  memberCount: number;
  createdAt: ISODateTime;
};

export type PlatformOrganizationsResponse = {
  items: PlatformOrganization[];
  total: number;
};

export type PlatformMetrics = {
  organizations: { active: number; suspended: number; cancelled: number };
  activeUsers: number;
  usedBytes: number;
  subscriptionsByPlan: { planName: string; count: number }[];
};
