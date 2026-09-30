/** Shared HTTP transport for the approved Nexus API contract. */

export type ApiErrorPayload = {
  code?: string;
  message?: string;
  requestId?: string;
};

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly requestId?: string;

  constructor({ status, code, message, requestId }: { status: number; code: string; message: string; requestId?: string }) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.requestId = requestId;
  }
}

export type ApiRequestOptions = {
  accessToken?: string;
  headers?: HeadersInit;
  signal?: AbortSignal;
};

function apiUrl(path: string) {
  const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL?.trim().replace(/\/+$/, "");
  if (!baseUrl) {
    throw new ApiError({ status: 0, code: "API_NOT_CONFIGURED", message: "Falta configurar NEXT_PUBLIC_API_BASE_URL." });
  }
  return `${baseUrl}/${path.replace(/^\/+/, "")}`;
}

async function apiFetch(path: string, init: RequestInit, options: ApiRequestOptions = {}) {
  const headers = new Headers(options.headers);
  new Headers(init.headers).forEach((value, key) => headers.set(key, value));
  if (options.accessToken) headers.set("Authorization", `Bearer ${options.accessToken}`);

  try {
    const response = await fetch(apiUrl(path), {
      ...init,
      headers,
      signal: options.signal ?? init.signal,
      // Needed for the refresh/session cookie defined by the IAM contract.
      credentials: "include",
    });
    if (!response.ok) throw await toApiError(response);
    return response;
  } catch (error) {
    if (error instanceof ApiError || (error instanceof Error && error.name === "AbortError")) throw error;
    throw new ApiError({ status: 0, code: "NETWORK_ERROR", message: "No fue posible conectar con Nexus API." });
  }
}

async function toApiError(response: Response): Promise<ApiError> {
  let payload: ApiErrorPayload = {};
  if (response.headers.get("content-type")?.includes("json")) {
    try {
      const value: unknown = await response.json();
      if (value && typeof value === "object") payload = value as ApiErrorPayload;
    } catch {
      // Keep a safe, generic message if the error body is malformed.
    }
  }
  return new ApiError({
    status: response.status,
    code: payload.code || `HTTP_${response.status}`,
    message: payload.message || `La solicitud falló (${response.status}).`,
    requestId: payload.requestId,
  });
}

export async function apiRequest<T>(path: string, init: RequestInit = {}, options: ApiRequestOptions = {}): Promise<T> {
  const response = await apiFetch(path, init, options);
  if (response.status === 204 || response.headers.get("content-length") === "0") return undefined as T;

  if (!response.headers.get("content-type")?.includes("json")) {
    throw new ApiError({ status: response.status, code: "INVALID_RESPONSE", message: "La API devolvió una respuesta con formato inesperado." });
  }

  try {
    return await response.json() as T;
  } catch {
    throw new ApiError({ status: response.status, code: "INVALID_RESPONSE", message: "La API devolvió JSON inválido." });
  }
}

export async function apiRequestBlob(path: string, options: ApiRequestOptions = {}) {
  const response = await apiFetch(path, { method: "GET" }, options);
  return {
    blob: await response.blob(),
    contentDisposition: response.headers.get("content-disposition"),
  };
}

export function filenameFromContentDisposition(value: string | null) {
  if (!value) return undefined;
  const extended = value.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  const quoted = value.match(/filename="([^"]+)"/i)?.[1];
  const plain = value.match(/filename=([^;]+)/i)?.[1]?.trim();
  const candidate = extended ? decodeFilename(extended) : quoted ?? plain;
  // Never let a response header produce a local path.
  return candidate?.replace(/[\\/]/g, "_");
}

function decodeFilename(value: string) {
  try { return decodeURIComponent(value); } catch { return value; }
}
