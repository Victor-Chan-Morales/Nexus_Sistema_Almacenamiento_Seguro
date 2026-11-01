"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import { Dialog } from "@/components/dialog";
import { Notice } from "@/components/notice";
import { ApiError } from "@/lib/api/client";
import { getTrash, purgeFile, restoreFile } from "@/lib/api/files";
import type { TrashItem, TrashResponse } from "@/lib/api/types";
import { formatBytes, formatIsoDate } from "@/lib/format";
import { RequireSession, useSession, type Session } from "@/lib/session";
import { useLoad } from "@/lib/use-load";

const LOAD_ERROR = "No pudimos cargar la papelera. Inténtalo de nuevo.";
const GENERIC_ERROR = "No se pudo completar la operación. Inténtalo de nuevo.";
const GONE_ERROR = "Este archivo ya no está en la papelera.";

/** Mapea los códigos de la API a mensajes en español (SPEC-205 §7). */
export function trashErrorMessage(error: unknown): string {
  if (!(error instanceof ApiError)) return GENERIC_ERROR;
  if (error.status === 0) return error.message;
  if (error.status === 404) return GONE_ERROR;
  switch (error.code) {
    case "FILE_NAME_CONFLICT":
      return "Ya existe un archivo con ese nombre en la carpeta";
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
      await restoreFile(item.id, token);
      hideItem(item.id);
      setNotice(`Se restauró «${item.name}».`);
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
      const result = await purgeFile(item.id, token);
      hideItem(item.id);
      setNotice(`Se eliminó definitivamente «${item.name}». Se liberaron ${formatBytes(result.freedBytes)}.`);
    } catch (error) {
      handleActionError(error);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <main className="drive-shell">
      <section className="drive-content" style={{ padding: 32 }}>
        <Link href="/archivos">Volver a Mis archivos</Link>
        <h1>Papelera</h1>
        <p>Los archivos en la papelera cuentan para tu almacenamiento durante 30 días desde que los eliminaste.</p>

        {notice && <div className="drive-notice" role="status">{notice}<button type="button" onClick={() => setNotice("")} aria-label="Cerrar aviso">×</button></div>}
        {actionError && <Notice title="No se pudo completar la operación" message={actionError} />}

        {state.status === "loading" && <div className="drive-empty-state" role="status"><b>Cargando papelera…</b></div>}
        {state.status === "error" && <Notice title="No se pudo cargar la papelera" message={state.message} onRetry={reload} />}
        {state.status === "ready" && items.length === 0 && (
          <div className="drive-empty-state"><b>La papelera está vacía</b></div>
        )}

        {state.status === "ready" && items.length > 0 && (
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
        )}

        {purgeTarget && (
          <Dialog labelledBy="purge-title" onClose={() => setPurgeTarget(null)} disabled={busyId !== null}>
            <h2 id="purge-title">¿Eliminar definitivamente «{purgeTarget.name}»?</h2>
            <p>Esta acción no se puede deshacer.</p>
            <div className="drive-modal-actions">
              <button type="button" className="drive-subtle-button" onClick={() => setPurgeTarget(null)}>Cancelar</button>
              <button type="button" className="drive-primary-button" onClick={() => purge(purgeTarget)}>Eliminar definitivamente</button>
            </div>
          </Dialog>
        )}
      </section>
    </main>
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
    <div className="drive-list-row">
      <span className="drive-item-name"><b>{item.name}</b></span>
      <span>{formatBytes(item.sizeBytes)}</span>
      <span>{formatIsoDate(item.deletedAt)}</span>
      <span>{formatIsoDate(item.retentionEndsAt)}</span>
      <span className="drive-row-actions">
        <button type="button" onClick={onRestore} disabled={busy} aria-label={`Restaurar «${item.name}»`}>
          {pending ? "Procesando…" : "Restaurar"}
        </button>
        <button type="button" onClick={onPurge} disabled={busy} aria-label={`Eliminar definitivamente «${item.name}»`}>
          Eliminar definitivamente
        </button>
      </span>
    </div>
  );
}
