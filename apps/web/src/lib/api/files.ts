import { apiRequest, apiRequestBlob, filenameFromContentDisposition } from "./client";
import type { ApiRequestOptions, CreateFolderInput, CreateFolderResponse, FolderItemsResponse, FolderListResponse, UUID, UploadFileResponse } from "./types";

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

export function getFolderItems<TFile = unknown>(folderId: UUID, accessToken: string, options?: Omit<ApiRequestOptions, "accessToken">) {
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
