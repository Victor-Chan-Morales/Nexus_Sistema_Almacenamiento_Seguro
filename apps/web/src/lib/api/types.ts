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
};

export type CurrentUserResponse = {
  user: UserIdentity;
  organization: OrganizationReference;
  role: UserRole;
};

export type Plan = {
  id: UUID;
  name: string;
  description: string;
  priceMonthly: number;
  storageLimitBytes: number;
  userLimit: number;
  validityDays: number;
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

export type DashboardResponse<TPlan = unknown, TActivity = unknown> = {
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
};

export type FolderListResponse = {
  items: Folder[];
};

export type CreateFolderInput = {
  name: string;
  parentFolderId?: UUID;
};

export type CreateFolderResponse = Folder & {
  createdAt: ISODateTime;
};

export type FolderItemsResponse<TFile = unknown> = {
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
