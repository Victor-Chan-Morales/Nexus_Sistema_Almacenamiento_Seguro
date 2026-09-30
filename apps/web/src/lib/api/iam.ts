import { apiRequest, ApiRequestOptions } from "./client";

export type RegisterInput = {
  fullName: string;
  email: string;
  password: string;
  organizationName: string;
};

export type RegisterResponse = {
  userId: string;
  organizationId: string;
  role: string;
  verificationRequired: boolean;
};

export type LoginInput = { email: string; password: string };

export type LoginResponse = {
  accessToken: string;
  expiresAt: string;
  user: { id: string; fullName: string; email: string };
  organization: { id: string; name: string };
  role: string;
};

export type CurrentUserResponse = {
  user: { id: string; fullName: string; email: string };
  organization: { id: string; name: string };
  role: string;
};

export function register(input: RegisterInput, options?: ApiRequestOptions) {
  return apiRequest<RegisterResponse>("/auth/register", { method: "POST", body: JSON.stringify(input), headers: { "Content-Type": "application/json" } }, options);
}

export function login(input: LoginInput, options?: ApiRequestOptions) {
  return apiRequest<LoginResponse>("/auth/login", { method: "POST", body: JSON.stringify(input), headers: { "Content-Type": "application/json" } }, options);
}

export function getCurrentUser(accessToken: string, options?: Omit<ApiRequestOptions, "accessToken">) {
  return apiRequest<CurrentUserResponse>("/auth/me", { method: "GET" }, { ...options, accessToken });
}
