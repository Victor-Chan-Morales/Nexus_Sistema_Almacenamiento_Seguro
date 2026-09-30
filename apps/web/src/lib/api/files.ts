import { apiRequest, apiRequestBlob, ApiRequestOptions, filenameFromContentDisposition } from "./client";

export type Folder = {
  id: string;
  name: string;
  parentFolderId: string | null;
  driveId: string;
};

export type FolderListResponse = { items: Folder[] };
export type CreateFolderInput = { name: string; parentFolderId?: string };
export type CreateFolderResponse = Folder & { createdAt: string };

/** File listing fields are not fully specified in CONTRACTS.md yet. */
export type FolderItemsResponse = { folders: Folder[]; files: unknown[] };

export type UploadFileResponse = {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  versionId: string;
  uploadedAt: string;
};

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

export function getFolderItems(folderId: string, accessToken: string, options?: Omit<ApiRequestOptions, "accessToken">) {
  return apiRequest<FolderItemsResponse>(`/folders/${encodeURIComponent(folderId)}/items`, { method: "GET" }, { ...options, accessToken });
}

export function uploadFile(folderId: string, file: File, accessToken: string, idempotencyKey?: string, options?: Omit<ApiRequestOptions, "accessToken">) {
  const body = new FormData();
  body.set("folderId", folderId);
  body.set("file", file);
  const headers = new Headers(options?.headers);
  if (idempotencyKey) headers.set("Idempotency-Key", idempotencyKey);
  return apiRequest<UploadFileResponse>("/files/upload", { method: "POST", body, headers }, { ...options, accessToken });
}

export async function downloadFile(fileId: string, accessToken: string, options?: Omit<ApiRequestOptions, "accessToken">) {
  const result = await apiRequestBlob(`/files/${encodeURIComponent(fileId)}/download`, { ...options, accessToken });
  return { ...result, filename: filenameFromContentDisposition(result.contentDisposition) };
}
