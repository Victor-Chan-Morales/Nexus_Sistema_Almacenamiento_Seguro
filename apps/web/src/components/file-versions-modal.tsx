"use client";

import { useCallback } from "react";
import { Dialog } from "@/components/dialog";
import { getFileVersions } from "@/lib/api/files";
import type { FileMetadata } from "@/lib/api/types";
import { formatBytes, formatIsoDate } from "@/lib/format";
import { useLoad } from "@/lib/use-load";

const LOAD_ERROR = "No pudimos cargar el historial de versiones. Inténtalo de nuevo.";

/**
 * Modal de solo lectura con el historial de versiones de un archivo (SPEC-207).
 * Muestra las versiones en el orden que entrega la API, sin calcular nada de negocio en el cliente.
 */
export function FileVersionsModal({ file, token, onClose }: { file: FileMetadata; token: string; onClose: () => void }) {
  const fetcher = useCallback((signal: AbortSignal) => getFileVersions(file.id, token, { signal }), [file.id, token]);
  const { state, reload } = useLoad(fetcher, true, LOAD_ERROR);
  const fileName = state.status === "ready" ? state.data.fileName : file.name;

  return (
    <Dialog labelledBy="file-versions-title" onClose={onClose}>
      <h2 id="file-versions-title">Versiones</h2>
      <p className="file-versions-name">
        <b>{fileName}</b>
      </p>

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
            {state.data.versions.map((version) => (
              <li key={version.versionId} className="file-versions-item">
                <b>v{version.versionNumber}</b>
                <span>{formatBytes(version.sizeBytes)}</span>
                <time dateTime={version.uploadedAt}>{formatIsoDate(version.uploadedAt)}</time>
                {version.isCurrent && <span className="file-versions-badge">Actual</span>}
              </li>
            ))}
          </ol>
          {state.data.versions.length <= 1 && <p className="file-versions-note">Aún no hay versiones anteriores</p>}
        </>
      )}

      <div className="drive-modal-actions">
        <button type="button" className="drive-subtle-button" onClick={onClose}>
          Cerrar
        </button>
      </div>
    </Dialog>
  );
}
