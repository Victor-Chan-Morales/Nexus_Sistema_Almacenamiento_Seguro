import { apiRequest } from "./client";
import type { ApiRequestOptions, CurrentUserResponse, LoginInput, LoginResponse, RegisterInput, RegisterResponse } from "./types";

export function register(input: RegisterInput, options?: ApiRequestOptions) {
  return apiRequest<RegisterResponse>("/auth/register", { method: "POST", body: JSON.stringify(input), headers: { "Content-Type": "application/json" } }, options);
}

export function login(input: LoginInput, options?: ApiRequestOptions) {
  return apiRequest<LoginResponse>("/auth/login", { method: "POST", body: JSON.stringify(input), headers: { "Content-Type": "application/json" } }, options);
}

export function getCurrentUser(accessToken: string, options?: Omit<ApiRequestOptions, "accessToken">) {
  return apiRequest<CurrentUserResponse>("/auth/me", { method: "GET" }, { ...options, accessToken });
}
