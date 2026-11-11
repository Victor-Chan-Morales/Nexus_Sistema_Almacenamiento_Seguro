"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import { Dialog } from "@/components/dialog";
import { LoadingIndicator, useToast } from "@/components/toast";
import { Notice } from "@/components/notice";
import { AppShell } from "@/components/app-shell";
import { UiIcon } from "@/components/ui-icon";
import { ApiError } from "@/lib/api/client";
import { canPurgeDrive, canWriteDrive, getTrash, listDrives, purgeFile, purgeFolder, restoreFile, restoreFolder } from "@/lib/api/files";
import type { Drive, TrashItem, TrashResponse } from "@/lib/api/types";
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
  // SPEC-223 escenario 8: la papelera se consulta por Drive. Sin selección, se usa el Drive personal, como antes.
  const [selectedDriveId, setSelectedDriveId] = useState<string | null>(null);
  const fetchDrives = useCallback((signal: AbortSignal): Promise<Drive[]> => listDrives(token, { signal }).then((response) => response.items), [token]);
  const drivesLoad = useLoad(fetchDrives, true, LOAD_ERROR);
  const drives = drivesLoad.state.status === "ready" ? drivesLoad.state.data : [];
  const personalDrive = drives.find((drive) => drive.type === "personal") ?? null;
  const activeDrive = drives.find((drive) => drive.id === (selectedDriveId ?? personalDrive?.id)) ?? null;
  // SPEC-224: restaurar exige escritura; purgar, ser dueño del Drive personal o tenant_admin en un Drive de equipo.
  const canRestore = canWriteDrive(activeDrive?.myLevel);
  const canPurge = activeDrive !== null && canPurgeDrive(activeDrive, session.role);
  const fetchTrash = useCallback((signal: AbortSignal): Promise<TrashResponse> => getTrash(token, { signal }, selectedDriveId ?? undefined), [token, selectedDriveId]);
  const { state, reload } = useLoad(fetchTrash, true, LOAD_ERROR);
  const [removedIds, setRemovedIds] = useState<ReadonlySet<string>>(() => new Set());
  const [busyId, setBusyId] = useState<string | null>(null);
  const notify = useToast();
  const [purgeTarget, setPurgeTarget] = useState<TrashItem | null>(null);

  const items = state.status === "ready" ? state.data.items.filter((item) => !removedIds.has(item.id)) : [];

  function changeDrive(id: string) {
    setSelectedDriveId(id);
    setRemovedIds(new Set<string>());
  }

  function hideItem(id: string) {
    setRemovedIds((current) => new Set(current).add(id));
  }

  function handleActionError(error: unknown) {
    if (failSession(error)) return;
    notify("error", trashErrorMessage(error));
    if (isStaleListError(error)) reload();
  }

  async function restore(item: TrashItem) {
    setBusyId(item.id);
    try {
      if (item.kind === "folder") await restoreFolder(item.id, token);
      else await restoreFile(item.id, token);
      hideItem(item.id);
      notify("success", `Se restauró «${item.name}»${item.kind === "folder" ? " con su contenido" : ""}.`);
    } catch (error) {
      handleActionError(error);
    } finally {
      setBusyId(null);
    }
  }

  async function purge(item: TrashItem) {
    setPurgeTarget(null);
    setBusyId(item.id);
    try {
      const result = item.kind === "folder"
        ? await purgeFolder(item.id, token)
        : await purgeFile(item.id, token);
      hideItem(item.id);
      notify("success", `Se eliminó definitivamente «${item.name}». Se liberaron ${formatBytes(result.freedBytes)}.`);
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
            <b>La papelera ocupa espacio hasta la eliminación definitiva</b>
            <p>La purga automática se ejecuta a partir de los 30 días. Puedes restaurar los elementos mientras sigan aquí.</p>
          </div>
          <span className="trash-item-count">{state.status === "ready" ? `${items.length} ${items.length === 1 ? "elemento" : "elementos"}` : "Papelera"}</span>
        </section>


        {drives.length > 0 && (
          <label className="trash-drive-select">
            <span>Drive</span>
            <select value={selectedDriveId ?? personalDrive?.id ?? ""} onChange={(event) => changeDrive(event.target.value)}>
              {drives.map((drive) => <option key={drive.id} value={drive.id}>{drive.type === "personal" ? "Mi espacio" : drive.name}</option>)}
            </select>
          </label>
        )}
        {state.status === "loading" && <LoadingIndicator>Cargando papelera…</LoadingIndicator>}
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
              <div className="drive-list-head"><span>Nombre</span><span>Tamaño</span><span>Eliminado</span><span>Se eliminará el</span><span>Acciones</span></div>
              {items.map((item) => (
                <TrashRow
                  key={item.id}
                  item={item}
                  busy={busyId !== null}
                  pending={busyId === item.id}
                  onRestore={() => restore(item)}
                  onPurge={() => setPurgeTarget(item)}
                  canRestore={canRestore}
                  canPurge={canPurge}
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
  canRestore,
  canPurge,
}: {
  item: TrashItem;
  busy: boolean;
  pending: boolean;
  onRestore: () => void;
  onPurge: () => void;
  canRestore: boolean;
  canPurge: boolean;
}) {
  return (
    <div className="drive-list-row trash-list-row">
      <span className="drive-item-name"><span className="trash-file-icon"><UiIcon name={item.kind === "folder" ? "folder" : "files"} size={15} /></span><span className="trash-file-label"><b>{item.name}{item.kind === "folder" ? " · Carpeta" : ""}</b><small>Eliminado {formatIsoDate(item.deletedAt)}</small><small>Se eliminará el {formatIsoDate(item.retentionEndsAt)}</small></span></span>
      <span>{formatBytes(item.sizeBytes)}</span>
      <span>{formatIsoDate(item.deletedAt)}</span>
      <span>{formatIsoDate(item.retentionEndsAt)}</span>
      <span className="drive-row-actions trash-row-actions">
        {canRestore && (
          <button type="button" onClick={onRestore} disabled={busy} aria-label={`Restaurar «${item.name}»`}>
            <UiIcon name="restore" size={14} />{pending ? "Procesando…" : "Restaurar"}
          </button>
        )}
        {canPurge && (
          <button className="trash-purge-button" type="button" onClick={onPurge} disabled={busy} aria-label={`Eliminar definitivamente «${item.name}»`}>
            <UiIcon name="close" size={14} />
            Eliminar definitivamente
          </button>
        )}
      </span>
    </div>
  );
}
