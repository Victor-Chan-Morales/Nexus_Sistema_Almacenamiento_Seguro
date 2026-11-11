import { apiRequest, apiRequestBlob, filenameFromContentDisposition } from "./client";
import type { ApiRequestOptions, CreateFolderInput, CreateShareLinkInput, CreatedShareLink, CreateFolderResponse, DeleteFileResponse, Drive, DriveLevel, DrivesResponse, FileMetadata, FileVersionsResponse, FolderItemsResponse, FolderListResponse, PurgeFileResponse, RestoreFileResponse, RestoredFileVersionResponse, ShareLinksResponse, TrashResponse, UUID, UploadFileResponse } from "./types";

/** SPEC-222: `?driveId=` solo cuando se indica un Drive. Sin él, la API usa el Drive personal. */
function driveQuery(driveId?: UUID) {
  return driveId ? `?driveId=${encodeURIComponent(driveId)}` : "";
}

/** SPEC-222: Drives del solicitante (personal y de sus equipos), con `myLevel`. */
export function listDrives(accessToken: string, options?: Omit<ApiRequestOptions, "accessToken">) {
  return apiRequest<DrivesResponse>("/drives", { method: "GET" }, { ...options, accessToken });
}

/** SPEC-223/224: `owner` o `write` permiten subir, crear carpetas y mandar a la papelera. */
export function canWriteDrive(level: DriveLevel | null | undefined): boolean {
  return level === "owner" || level === "write";
}

/** SPEC-224: la purga definitiva en el Drive personal la hace su dueño; en un Drive de equipo, solo tenant_admin (ADR-008 §7). */
export function canPurgeDrive(drive: Pick<Drive, "type" | "myLevel">, role: string | null | undefined): boolean {
  return drive.type === "personal" ? drive.myLevel === "owner" : role === "tenant_admin";
}

/** SPEC-223: con `driveId`, la respuesta trae el Drive pedido y su `rootFolderId`. */
export function listFolders(accessToken: string, options?: Omit<ApiRequestOptions, "accessToken">, driveId?: UUID) {
  return apiRequest<FolderListResponse>(`/folders${driveQuery(driveId)}`, { method: "GET" }, { ...options, accessToken });
}

export function createFolder(input: CreateFolderInput, accessToken: string, options?: Omit<ApiRequestOptions, "accessToken">) {
  return apiRequest<CreateFolderResponse>("/folders", {
    method: "POST",
    body: JSON.stringify(input),
    headers: { "Content-Type": "application/json" },
  }, { ...options, accessToken });
}

export function getFolderItems<TFile = FileMetadata>(folderId: UUID, accessToken: string, options?: Omit<ApiRequestOptions, "accessToken">) {
  return apiRequest<FolderItemsResponse<TFile>>(`/folders/${encodeURIComponent(folderId)}/items`, { method: "GET" }, { ...options, accessToken });
}

/** Mueve una carpeta y su contenido a la papelera como unidad restaurable. */
export function deleteFolder(folderId: UUID, accessToken: string, options?: Omit<ApiRequestOptions, "accessToken">) {
  return apiRequest<DeleteFileResponse>(`/folders/${encodeURIComponent(folderId)}`, { method: "DELETE" }, { ...options, accessToken });
}

export function restoreFolder(folderId: UUID, accessToken: string, options?: Omit<ApiRequestOptions, "accessToken">) {
  return apiRequest<{ id: UUID; name: string; parentFolderId: UUID }>(`/folders/${encodeURIComponent(folderId)}/restore`, { method: "POST" }, { ...options, accessToken });
}

export function purgeFolder(folderId: UUID, accessToken: string, options?: Omit<ApiRequestOptions, "accessToken">) {
  return apiRequest<PurgeFileResponse>(`/folders/${encodeURIComponent(folderId)}/purge`, { method: "DELETE" }, { ...options, accessToken });
}

export function uploadFile(folderId: UUID, file: File, accessToken: string, idempotencyKey?: string, options?: Omit<ApiRequestOptions, "accessToken">) {
  const body = new FormData();
  body.set("folderId", folderId);
  body.set("file", file);
  const headers = new Headers(options?.headers);
  if (idempotencyKey) headers.set("Idempotency-Key", idempotencyKey);
  return apiRequest<UploadFileResponse>("/files/upload", { method: "POST", body, headers }, { ...options, accessToken });
}

export async function downloadFile(fileId: UUID, accessToken: string, options?: Omit<ApiRequestOptions, "accessToken">) {
  const result = await apiRequestBlob(`/files/${encodeURIComponent(fileId)}/download`, { ...options, accessToken });
  return { ...result, filename: filenameFromContentDisposition(result.contentDisposition) };
}

/** SPEC-202: archivos de la papelera del solicitante. SPEC-222: con `driveId`, la del Drive indicado. */
export function getTrash(accessToken: string, options?: Omit<ApiRequestOptions, "accessToken">, driveId?: UUID) {
  return apiRequest<TrashResponse>(`/files/trash${driveQuery(driveId)}`, { method: "GET" }, { ...options, accessToken });
}

/** SPEC-203: devuelve un archivo de la papelera a su carpeta. */
export function restoreFile(fileId: UUID, accessToken: string, options?: Omit<ApiRequestOptions, "accessToken">) {
  return apiRequest<RestoreFileResponse>(`/files/${encodeURIComponent(fileId)}/restore`, { method: "POST" }, { ...options, accessToken });
}

/** SPEC-204: elimina definitivamente un archivo de la papelera. */
export function purgeFile(fileId: UUID, accessToken: string, options?: Omit<ApiRequestOptions, "accessToken">) {
  return apiRequest<PurgeFileResponse>(`/files/${encodeURIComponent(fileId)}/purge`, { method: "DELETE" }, { ...options, accessToken });
}

/** SPEC-206/207: historial de versiones de un archivo propio (solo lectura). */
export function getFileVersions(fileId: UUID, accessToken: string, options?: Omit<ApiRequestOptions, "accessToken">) {
  return apiRequest<FileVersionsResponse>(`/files/${encodeURIComponent(fileId)}/versions`, { method: "GET" }, { ...options, accessToken });
}

/** SPEC-210: descarga los bytes de una versión concreta (no necesariamente la vigente). */
export async function downloadFileVersion(fileId: UUID, versionId: UUID, accessToken: string, options?: Omit<ApiRequestOptions, "accessToken">) {
  const result = await apiRequestBlob(`/files/${encodeURIComponent(fileId)}/versions/${encodeURIComponent(versionId)}/download`, { ...options, accessToken });
  return { ...result, filename: filenameFromContentDisposition(result.contentDisposition) };
}

/** SPEC-210: crea una versión nueva con el contenido de una versión anterior. Sin Idempotency-Key: el llamador debe bloquear el doble clic. */
export function restoreFileVersion(fileId: UUID, versionId: UUID, accessToken: string, options?: Omit<ApiRequestOptions, "accessToken">) {
  return apiRequest<RestoredFileVersionResponse>(`/files/${encodeURIComponent(fileId)}/versions/${encodeURIComponent(versionId)}/restore`, { method: "POST" }, { ...options, accessToken });
}

/** SPEC-202/205: mueve un archivo activo a la papelera (borrado lógico). */
export function deleteFile(fileId: UUID, accessToken: string, options?: Omit<ApiRequestOptions, "accessToken">) {
  return apiRequest<DeleteFileResponse>(`/files/${encodeURIComponent(fileId)}`, { method: "DELETE" }, { ...options, accessToken });
}

/** SPEC-217: crea un enlace compartido. No envía `password` si viene vacía (la API exige mínimo 8 caracteres). */
export function createShareLink(fileId: UUID, input: CreateShareLinkInput, accessToken: string, options?: Omit<ApiRequestOptions, "accessToken">) {
  const body: CreateShareLinkInput = { expiresInDays: input.expiresInDays };
  if (input.password) body.password = input.password;
  return apiRequest<CreatedShareLink>(`/files/${encodeURIComponent(fileId)}/share-links`, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  }, { ...options, accessToken });
}

/** SPEC-217: lista los enlaces compartidos de un archivo propio. */
export function listShareLinks(fileId: UUID, accessToken: string, options?: Omit<ApiRequestOptions, "accessToken">) {
  return apiRequest<ShareLinksResponse>(`/files/${encodeURIComponent(fileId)}/share-links`, { method: "GET" }, { ...options, accessToken });
}

/** SPEC-217: revoca un enlace compartido (204 sin cuerpo). */
export function revokeShareLink(linkId: UUID, accessToken: string, options?: Omit<ApiRequestOptions, "accessToken">) {
  return apiRequest<void>(`/share-links/${encodeURIComponent(linkId)}`, { method: "DELETE" }, { ...options, accessToken });
}
