import { apiRequest } from "./client";
import type {
  ApiRequestOptions,
  CurrentUserResponse,
  ForgotPasswordResponse,
  LoginInput,
  LoginResponse,
  RegisterInput,
  RegisterResponse,
  ResendVerificationResponse,
  ResetPasswordResponse,
  VerifyEmailResponse,
} from "./types";

/** SPEC-113: cuerpo de `PATCH /auth/me`. La API normaliza con trim y exige 2–120 caracteres. */
export type UpdateProfileInput = { fullName: string };

/** SPEC-113: cuerpo de `POST /auth/change-password`. */
export type ChangePasswordInput = { currentPassword: string; newPassword: string };

export function register(input: RegisterInput, options?: ApiRequestOptions) {
  return apiRequest<RegisterResponse>("/auth/register", { method: "POST", body: JSON.stringify(input), headers: { "Content-Type": "application/json" } }, options);
}

export function login(input: LoginInput, options?: ApiRequestOptions) {
  return apiRequest<LoginResponse>("/auth/login", { method: "POST", body: JSON.stringify(input), headers: { "Content-Type": "application/json" } }, options);
}

export function getCurrentUser(accessToken: string, options?: Omit<ApiRequestOptions, "accessToken">) {
  return apiRequest<CurrentUserResponse>("/auth/me", { method: "GET" }, { ...options, accessToken });
}

/** SPEC-113: cambia el nombre de la cuenta (PATCH /auth/me). Devuelve el perfil ya actualizado. */
export function updateProfile(accessToken: string, input: UpdateProfileInput, options?: Omit<ApiRequestOptions, "accessToken">) {
  return apiRequest<CurrentUserResponse>(
    "/auth/me",
    { method: "PATCH", body: JSON.stringify(input), headers: { "Content-Type": "application/json" } },
    { ...options, accessToken },
  );
}

/** SPEC-113: cambia la contraseña con la actual (POST /auth/change-password). 204 sin cuerpo; revoca las sesiones. */
export function changePassword(accessToken: string, input: ChangePasswordInput, options?: Omit<ApiRequestOptions, "accessToken">) {
  return apiRequest<void>(
    "/auth/change-password",
    { method: "POST", body: JSON.stringify(input), headers: { "Content-Type": "application/json" } },
    { ...options, accessToken },
  );
}

export function verifyEmail(token: string, options?: ApiRequestOptions) {
  return apiRequest<VerifyEmailResponse>("/auth/verify-email", { method: "POST", body: JSON.stringify({ token }), headers: { "Content-Type": "application/json" } }, options);
}

export function resendVerification(email: string, options?: ApiRequestOptions) {
  return apiRequest<ResendVerificationResponse>(
    "/auth/resend-verification",
    { method: "POST", body: JSON.stringify({ email }), headers: { "Content-Type": "application/json" } },
    options,
  );
}

/** Endpoint del contrato v0.3: renueva el access token con la cookie HttpOnly. */
export function refreshSession(options?: ApiRequestOptions) {
  return apiRequest<LoginResponse>("/auth/refresh", { method: "POST" }, options);
}

/** Endpoint del contrato v0.3: revoca la sesión y limpia la cookie. */
export function logout(options?: ApiRequestOptions) {
  return apiRequest<void>("/auth/logout", { method: "POST" }, options);
}

/** SPEC-105: Solicita enlace de recuperación de contraseña (POST /auth/forgot-password). */
export function forgotPassword(email: string, options?: ApiRequestOptions) {
  return apiRequest<ForgotPasswordResponse>(
    "/auth/forgot-password",
    {
      method: "POST",
      body: JSON.stringify({ email }),
      headers: { "Content-Type": "application/json" },
    },
    options,
  );
}

/** SPEC-105: Restablece la contraseña con token de un solo uso (POST /auth/reset-password). */
export function resetPassword(token: string, newPassword: string, options?: ApiRequestOptions) {
  return apiRequest<ResetPasswordResponse>(
    "/auth/reset-password",
    {
      method: "POST",
      body: JSON.stringify({ token, newPassword }),
      headers: { "Content-Type": "application/json" },
    },
    options,
  );
}
