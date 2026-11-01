import { apiRequest, apiRequestBlob, filenameFromContentDisposition } from "./client";
import type { ApiRequestOptions, CreateFolderInput, CreateFolderResponse, DeleteFileResponse, FileMetadata, FolderItemsResponse, FolderListResponse, PurgeFileResponse, RestoreFileResponse, TrashResponse, UUID, UploadFileResponse } from "./types";

export function listFolders(accessToken: string, options?: Omit<ApiRequestOptions, "accessToken">) {
  return apiRequest<FolderListResponse>("/folders", { method: "GET" }, { ...options, accessToken });
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

/** SPEC-202: archivos de la papelera del solicitante. */
export function getTrash(accessToken: string, options?: Omit<ApiRequestOptions, "accessToken">) {
  return apiRequest<TrashResponse>("/files/trash", { method: "GET" }, { ...options, accessToken });
}

/** SPEC-203: devuelve un archivo de la papelera a su carpeta. */
export function restoreFile(fileId: UUID, accessToken: string, options?: Omit<ApiRequestOptions, "accessToken">) {
  return apiRequest<RestoreFileResponse>(`/files/${encodeURIComponent(fileId)}/restore`, { method: "POST" }, { ...options, accessToken });
}

/** SPEC-204: elimina definitivamente un archivo de la papelera. */
export function purgeFile(fileId: UUID, accessToken: string, options?: Omit<ApiRequestOptions, "accessToken">) {
  return apiRequest<PurgeFileResponse>(`/files/${encodeURIComponent(fileId)}/purge`, { method: "DELETE" }, { ...options, accessToken });
}

/** SPEC-202/205: mueve un archivo activo a la papelera (borrado lógico). */
export function deleteFile(fileId: UUID, accessToken: string, options?: Omit<ApiRequestOptions, "accessToken">) {
  return apiRequest<DeleteFileResponse>(`/files/${encodeURIComponent(fileId)}`, { method: "DELETE" }, { ...options, accessToken });
}
