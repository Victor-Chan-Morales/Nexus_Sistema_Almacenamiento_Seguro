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

export type VerifyEmailResponse = {
  verified: true;
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

export type MemberRole = "tenant_admin" | "colaborador";

export type OrganizationMember = {
  id: UUID;
  userId: UUID;
  fullName: string;
  email: string;
  role: MemberRole;
  status: string;
  joinedAt?: ISODateTime;
  createdAt?: ISODateTime;
};

export type OrganizationMembersResponse = {
  members: OrganizationMember[];
  totalMembers: number;
  userLimit: number | null;
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
  status: string;
  createdAt: ISODateTime;
};

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
