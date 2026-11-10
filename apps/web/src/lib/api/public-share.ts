import { apiRequest, apiRequestBlob, filenameFromContentDisposition } from "./client";
import type { ApiRequestOptions, PublicShareLinkInfo } from "./types";

/** SPEC-217: consulta pública de un enlace compartido. Sin sesión ni accessToken. */
export function getPublicShareLink(token: string, options?: Omit<ApiRequestOptions, "accessToken">) {
  return apiRequest<PublicShareLinkInfo>(`/public/share-links/${encodeURIComponent(token)}`, { method: "GET" }, options);
}

/** SPEC-217: descarga pública con contraseña opcional en el cuerpo JSON. Sin accessToken. */
export async function downloadPublicShareLink(token: string, password?: string, options?: Omit<ApiRequestOptions, "accessToken">) {
  const result = await apiRequestBlob(`/public/share-links/${encodeURIComponent(token)}/download`, options, {
    method: "POST",
    body: JSON.stringify({ password }),
    headers: { "Content-Type": "application/json" },
  });
  return { ...result, filename: filenameFromContentDisposition(result.contentDisposition) };
}
