"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Dialog } from "@/components/dialog";
import { ApiError } from "@/lib/api/client";
import { downloadFileVersion, getFileVersions, restoreFileVersion } from "@/lib/api/files";
import type { FileMetadata, FileVersionItem } from "@/lib/api/types";
import { formatBytes, formatIsoDate } from "@/lib/format";
import { useSession } from "@/lib/session";
import { useLoad } from "@/lib/use-load";

const LOAD_ERROR = "No pudimos cargar el historial de versiones. Inténtalo de nuevo.";
const DOWNLOAD_ERROR = "No fue posible descargar esta versión.";
const RESTORE_ERROR = "No fue posible restaurar esta versión.";

/** Traduce un error de la API a un mensaje en español. El cliente no calcula cuota ni permisos (REGLAS §4.2). */
function versionErrorMessage(error: unknown, fallback: string) {
  if (!(error instanceof ApiError)) return fallback;
  if (error.code === "STORAGE_QUOTA_EXCEEDED") return "La cuota disponible no alcanza para restaurar esta versión.";
  if (error.code === "VERSION_ALREADY_CURRENT") return "Esa versión ya es la vigente.";
  if (error.status === 404) return "Esta versión ya no está disponible.";
  return fallback;
}

/**
 * Modal con el historial de versiones de un archivo (SPEC-207) y acciones de descarga y restauración (SPEC-210).
 * Solo las versiones no vigentes ofrecen acciones. Mientras hay una petición en curso, las demás acciones se deshabilitan
 * porque el backend no es idempotente en restaurar (D3).
 */
export function FileVersionsModal({ file, token, onClose, onRestored }: { file: FileMetadata; token: string; onClose: () => void; onRestored?: () => void }) {
  const { failSession } = useSession();
  const fetcher = useCallback((signal: AbortSignal) => getFileVersions(file.id, token, { signal }), [file.id, token]);
  const { state, reload } = useLoad(fetcher, true, LOAD_ERROR);
  const [action, setAction] = useState<{ kind: "download" | "restore"; version: FileVersionItem } | null>(null);
  const [confirming, setConfirming] = useState<FileVersionItem | null>(null);
  const [actionError, setActionError] = useState("");
  const [notice, setNotice] = useState<{ text: string } | null>(null);
  const noticeRef = useRef<HTMLParagraphElement>(null);
  const fileName = state.status === "ready" ? state.data.fileName : file.name;
  const busy = action !== null;
  const restoring = action?.kind === "restore";

  // Tras restaurar, el foco pasa al aviso: la fila que tenía el foco desaparece al recargar la lista.
  useEffect(() => {
    if (notice) noticeRef.current?.focus();
  }, [notice]);

  async function downloadVersion(version: FileVersionItem) {
    setAction({ kind: "download", version });
    setActionError("");
    setNotice(null);
    try {
      const result = await downloadFileVersion(file.id, version.versionId, token);
      const url = URL.createObjectURL(result.blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = result.filename || file.name;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      if (!failSession(error)) setActionError(versionErrorMessage(error, DOWNLOAD_ERROR));
    } finally {
      setAction(null);
    }
  }

  async function restoreVersion(version: FileVersionItem) {
    setAction({ kind: "restore", version });
    setActionError("");
    setNotice(null);
    try {
      const restored = await restoreFileVersion(file.id, version.versionId, token);
      setConfirming(null);
      setNotice({ text: `Se creó la versión ${restored.versionNumber} con el contenido de la versión ${version.versionNumber}.` });
      reload();
      onRestored?.();
    } catch (error) {
      if (failSession(error)) return;
      setConfirming(null);
      setActionError(versionErrorMessage(error, RESTORE_ERROR));
      // La lista pudo quedar desactualizada: 404 (ya no disponible) o 422 (ya es la vigente).
      if (error instanceof ApiError && (error.status === 404 || error.code === "VERSION_ALREADY_CURRENT")) reload();
    } finally {
      setAction(null);
    }
  }

  return (
    <>
      {/* El diálogo de confirmación va como hermano, no dentro de este, para que no compartan foco ni Escape. */}
      <Dialog labelledBy="file-versions-title" onClose={onClose} disabled={busy || confirming !== null}>
        <h2 id="file-versions-title">Versiones</h2>
        <p className="file-versions-name">
          <b>{fileName}</b>
        </p>

        {notice && (
          <p className="file-versions-notice" role="status" tabIndex={-1} ref={noticeRef}>
            {notice.text}
          </p>
        )}
        {action && (
          <p className="file-versions-progress" role="status">
            {action.kind === "download" ? `Descargando la versión ${action.version.versionNumber}…` : `Restaurando la versión ${action.version.versionNumber}…`}
          </p>
        )}
        {actionError && (
          <div className="file-versions-error" role="alert">
            <p>{actionError}</p>
          </div>
        )}

        {state.status === "loading" && <p role="status">Cargando versiones…</p>}

        {state.status === "error" && (
          <div className="file-versions-error" role="alert">
            <p>{state.message}</p>
            <button type="button" className="drive-empty-button" onClick={reload}>
              Reintentar
            </button>
          </div>
        )}

        {state.status === "ready" && (
          <>
            <ol className="file-versions-list">
              {state.data.versions.map((version) => {
                const number = version.versionNumber;
                const downloadingThis = action?.kind === "download" && action.version.versionId === version.versionId;
                const restoringThis = restoring && action?.version.versionId === version.versionId;
                return (
                  <li key={version.versionId} className="file-versions-item">
                    <b>v{number}</b>
                    <span>{formatBytes(version.sizeBytes)}</span>
                    <time dateTime={version.uploadedAt}>{formatIsoDate(version.uploadedAt)}</time>
                    {version.isCurrent && <span className="file-versions-badge">Actual</span>}
                    {!version.isCurrent && (
                      <div className="file-versions-actions">
                        <button
                          type="button"
                          className="file-versions-action"
                          onClick={() => downloadVersion(version)}
                          disabled={busy}
                          aria-label={`Descargar la versión ${number}`}
                        >
                          {downloadingThis ? "Descargando…" : "Descargar"}
                        </button>
                        <button
                          type="button"
                          className="file-versions-action"
                          onClick={() => setConfirming(version)}
                          disabled={busy}
                          aria-label={`Restaurar la versión ${number}`}
                        >
                          {restoringThis ? "Restaurando…" : "Restaurar"}
                        </button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ol>
            {state.data.versions.length <= 1 && <p className="file-versions-note">Aún no hay versiones anteriores</p>}
          </>
        )}

        <div className="drive-modal-actions">
          <button type="button" className="drive-subtle-button" onClick={onClose} disabled={busy}>
            Cerrar
          </button>
        </div>
      </Dialog>

      {confirming && (
        <Dialog labelledBy="restore-version-title" onClose={() => setConfirming(null)} disabled={restoring}>
          <h2 id="restore-version-title">¿Restaurar la versión {confirming.versionNumber}?</h2>
          <p>Se creará una versión nueva con el contenido de la versión {confirming.versionNumber}. Las versiones anteriores se conservan.</p>
          <div className="drive-modal-actions">
            <button type="button" className="drive-subtle-button" onClick={() => setConfirming(null)} disabled={restoring}>
              Cancelar
            </button>
            <button type="button" className="drive-primary-button" onClick={() => restoreVersion(confirming)} disabled={restoring}>
              {restoring ? "Restaurando…" : `Restaurar versión ${confirming.versionNumber}`}
            </button>
          </div>
        </Dialog>
      )}
    </>
  );
}
