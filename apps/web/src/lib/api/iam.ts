import { apiRequest } from "./client";
import type { ApiRequestOptions, CurrentUserResponse, LoginInput, LoginResponse, RegisterInput, RegisterResponse, VerifyEmailResponse } from "./types";

export function register(input: RegisterInput, options?: ApiRequestOptions) {
  return apiRequest<RegisterResponse>("/auth/register", { method: "POST", body: JSON.stringify(input), headers: { "Content-Type": "application/json" } }, options);
}

export function login(input: LoginInput, options?: ApiRequestOptions) {
  return apiRequest<LoginResponse>("/auth/login", { method: "POST", body: JSON.stringify(input), headers: { "Content-Type": "application/json" } }, options);
}

export function getCurrentUser(accessToken: string, options?: Omit<ApiRequestOptions, "accessToken">) {
  return apiRequest<CurrentUserResponse>("/auth/me", { method: "GET" }, { ...options, accessToken });
}

/** Endpoint del contrato v0.3; pendiente de implementación en IAM. */
export function verifyEmail(token: string, options?: ApiRequestOptions) {
  return apiRequest<VerifyEmailResponse>("/auth/verify-email", { method: "POST", body: JSON.stringify({ token }), headers: { "Content-Type": "application/json" } }, options);
}

/** Endpoint del contrato v0.3: renueva el access token con la cookie HttpOnly. */
export function refreshSession(options?: ApiRequestOptions) {
  return apiRequest<LoginResponse>("/auth/refresh", { method: "POST" }, options);
}

/** Endpoint del contrato v0.3: revoca la sesión y limpia la cookie. */
export function logout(options?: ApiRequestOptions) {
  return apiRequest<void>("/auth/logout", { method: "POST" }, options);
}
