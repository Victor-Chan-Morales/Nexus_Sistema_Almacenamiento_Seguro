"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import { Dialog } from "@/components/dialog";
import { Notice } from "@/components/notice";
import { AppShell } from "@/components/app-shell";
import { UiIcon } from "@/components/ui-icon";
import { ApiError } from "@/lib/api/client";
import { getTrash, purgeFile, purgeFolder, restoreFile, restoreFolder } from "@/lib/api/files";
import type { TrashItem, TrashResponse } from "@/lib/api/types";
import { formatBytes, formatIsoDate } from "@/lib/format";
import { RequireSession, useSession, type Session } from "@/lib/session";
import { useLoad } from "@/lib/use-load";

const LOAD_ERROR = "No pudimos cargar la papelera. Inténtalo de nuevo.";
const GENERIC_ERROR = "No se pudo completar la operación. Inténtalo de nuevo.";
const GONE_ERROR = "Este elemento ya no está en la papelera.";

/** Mapea los códigos de la API a mensajes en español (SPEC-205 §7). */
export function trashErrorMessage(error: unknown): string {
  if (!(error instanceof ApiError)) return GENERIC_ERROR;
  if (error.status === 0) return error.message;
  if (error.status === 404) return GONE_ERROR;
  switch (error.code) {
    case "FILE_NAME_CONFLICT":
      return "Ya existe un archivo con ese nombre en la carpeta";
    case "FOLDER_NAME_CONFLICT":
      return "Ya existe una carpeta con ese nombre en la ubicación original";
    case "PARENT_FOLDER_UNAVAILABLE":
      return "La carpeta original ya no está disponible";
    case "CANNOT_PURGE_ACTIVE_FILE":
      return GONE_ERROR;
    case "STORAGE_QUOTA_EXCEEDED":
      return "No hay espacio suficiente en tu plan para restaurar este elemento. Libera espacio o cambia de plan.";
    default:
      return GENERIC_ERROR;
  }
}

/** Un 404 o un archivo ya no en papelera significa que la lista está desfasada: conviene recargarla. */
function isStaleListError(error: unknown) {
  return error instanceof ApiError && (error.status === 404 || error.code === "CANNOT_PURGE_ACTIVE_FILE");
}

export function TrashView() {
  return <RequireSession>{(session) => <TrashSession session={session} />}</RequireSession>;
}

function TrashSession({ session }: { session: Session }) {
  const token = session.accessToken;
  const { failSession } = useSession();
  const fetchTrash = useCallback((signal: AbortSignal): Promise<TrashResponse> => getTrash(token, { signal }), [token]);
  const { state, reload } = useLoad(fetchTrash, true, LOAD_ERROR);
  const [removedIds, setRemovedIds] = useState<ReadonlySet<string>>(() => new Set());
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [actionError, setActionError] = useState("");
  const [purgeTarget, setPurgeTarget] = useState<TrashItem | null>(null);

  const items = state.status === "ready" ? state.data.items.filter((item) => !removedIds.has(item.id)) : [];

  function hideItem(id: string) {
    setRemovedIds((current) => new Set(current).add(id));
  }

  function handleActionError(error: unknown) {
    if (failSession(error)) return;
    setActionError(trashErrorMessage(error));
    if (isStaleListError(error)) reload();
  }

  async function restore(item: TrashItem) {
    setBusyId(item.id);
    setNotice("");
    setActionError("");
    try {
      if (item.kind === "folder") await restoreFolder(item.id, token);
      else await restoreFile(item.id, token);
      hideItem(item.id);
      setNotice(item.kind === "folder"
        ? `Se restauró «${item.name}» con su contenido.`
        : `Se restauró «${item.name}».`);
    } catch (error) {
      handleActionError(error);
    } finally {
      setBusyId(null);
    }
  }

  async function purge(item: TrashItem) {
    setPurgeTarget(null);
    setBusyId(item.id);
    setNotice("");
    setActionError("");
    try {
      const result = item.kind === "folder"
        ? await purgeFolder(item.id, token)
        : await purgeFile(item.id, token);
      hideItem(item.id);
      const subject = item.kind === "folder" ? `«${item.name}» y su contenido` : `«${item.name}»`;
      setNotice(`Se eliminó definitivamente ${subject}. Se liberaron ${formatBytes(result.freedBytes)}.`);
    } catch (error) {
      handleActionError(error);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <AppShell active="/papelera">
      <div className="trash-page">
        <div className="dashboard-page-heading trash-page-heading">
          <div>
            <p className="eyebrow">GESTIÓN DE ARCHIVOS</p>
            <h1>Papelera</h1>
            <p>Administra los archivos que moviste fuera de tu espacio.</p>
          </div>
          <Link href="/archivos" className="button trash-back-button"><UiIcon name="arrowLeft" size={15} />Volver a Mis archivos</Link>
        </div>

        <section className="trash-retention-note">
          <span className="trash-retention-icon"><UiIcon name="trash" size={18} /></span>
          <div>
            <b>Los elementos cuentan para tu almacenamiento durante 30 días</b>
            <p>Después dejan de contar para la cuota, pero no se eliminan automáticamente. Puedes restaurarlos o eliminarlos definitivamente.</p>
          </div>
          <span className="trash-item-count">{state.status === "ready" ? `${items.length} ${items.length === 1 ? "elemento" : "elementos"}` : "Papelera"}</span>
        </section>

        {notice && <div className="drive-notice" role="status">{notice}<button type="button" onClick={() => setNotice("")} aria-label="Cerrar aviso">×</button></div>}
        {actionError && <Notice title="No se pudo completar la operación" message={actionError} />}

        {state.status === "loading" && <div className="drive-empty-state trash-state-card" role="status"><span><UiIcon name="recent" size={21} /></span><b>Cargando papelera…</b><p>Estamos recuperando tus archivos y carpetas eliminados.</p></div>}
        {state.status === "error" && <Notice title="No se pudo cargar la papelera" message={state.message} onRetry={reload} />}
        {state.status === "ready" && items.length === 0 && (
          <div className="drive-empty-state trash-state-card">
            <span><UiIcon name="trash" size={21} /></span>
            <b>La papelera está vacía</b>
            <p>Cuando muevas archivos o carpetas a la papelera, aparecerán aquí y podrás restaurarlos o eliminarlos definitivamente.</p>
            <Link href="/archivos" className="button button-primary">Ir a Mis archivos</Link>
          </div>
        )}

        {state.status === "ready" && items.length > 0 && (
          <section className="panel trash-panel">
            <div className="dashboard-section-heading">
              <div><h2>Elementos eliminados</h2><p>Restaura archivos y carpetas, o elimínalos de forma permanente.</p></div>
            </div>
            <div className="drive-list-card">
              <div className="drive-list-head"><span>Nombre</span><span>Tamaño</span><span>Eliminado</span><span>Se conserva hasta</span><span>Acciones</span></div>
              {items.map((item) => (
                <TrashRow
                  key={item.id}
                  item={item}
                  busy={busyId !== null}
                  pending={busyId === item.id}
                  onRestore={() => restore(item)}
                  onPurge={() => setPurgeTarget(item)}
                />
              ))}
            </div>
          </section>
        )}

        {purgeTarget && (
          <Dialog labelledBy="purge-title" onClose={() => setPurgeTarget(null)} disabled={busyId !== null}>
            <span className="drive-modal-icon trash-modal-icon"><UiIcon name="trash" size={20} /></span>
            <h2 id="purge-title">¿Eliminar definitivamente «{purgeTarget.name}»{purgeTarget.kind === "folder" ? " y todo su contenido" : ""}?</h2>
            <p>Esta acción no se puede deshacer. {purgeTarget.kind === "folder" ? "La carpeta, sus subcarpetas y archivos no podrán recuperarse." : "El archivo no podrá recuperarse."}</p>
            <div className="drive-modal-actions">
              <button type="button" className="drive-subtle-button" onClick={() => setPurgeTarget(null)}>Cancelar</button>
              <button type="button" className="drive-primary-button trash-purge-confirm" onClick={() => purge(purgeTarget)}>Eliminar definitivamente</button>
            </div>
          </Dialog>
        )}
      </div>
    </AppShell>
  );
}

function TrashRow({
  item,
  busy,
  pending,
  onRestore,
  onPurge,
}: {
  item: TrashItem;
  busy: boolean;
  pending: boolean;
  onRestore: () => void;
  onPurge: () => void;
}) {
  return (
    <div className="drive-list-row trash-list-row">
      <span className="drive-item-name"><span className="trash-file-icon"><UiIcon name={item.kind === "folder" ? "folder" : "files"} size={15} /></span><span className="trash-file-label"><b>{item.name}{item.kind === "folder" ? " · Carpeta" : ""}</b><small>Eliminado {formatIsoDate(item.deletedAt)}</small><small>Se conserva hasta {formatIsoDate(item.retentionEndsAt)}</small></span></span>
      <span>{formatBytes(item.sizeBytes)}</span>
      <span>{formatIsoDate(item.deletedAt)}</span>
      <span>{formatIsoDate(item.retentionEndsAt)}</span>
      <span className="drive-row-actions trash-row-actions">
        <button type="button" onClick={onRestore} disabled={busy} aria-label={`Restaurar «${item.name}»`}>
          <UiIcon name="restore" size={14} />{pending ? "Procesando…" : "Restaurar"}
        </button>
        <button className="trash-purge-button" type="button" onClick={onPurge} disabled={busy} aria-label={`Eliminar definitivamente «${item.name}»`}>
          <UiIcon name="close" size={14} />
          Eliminar definitivamente
        </button>
      </span>
    </div>
  );
}
