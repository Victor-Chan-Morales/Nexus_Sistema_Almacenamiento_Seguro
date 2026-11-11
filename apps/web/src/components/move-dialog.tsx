"use client";

import { type FormEvent, useEffect, useRef, useState } from "react";
import { ApiError } from "@/lib/api/client";
import { getFolderItems, listChildFolders, updateFile, updateFolder } from "@/lib/api/files";
import type { Folder, UUID } from "@/lib/api/types";
import { Dialog } from "@/components/dialog";
import type { OrganizeKind } from "@/components/rename-dialog";
import { UiIcon } from "@/components/ui-icon";

type StorageLocation = NonNullable<Folder["destinationLocation"]>;

export type MoveTarget = {
  kind: OrganizeKind;
  id: string;
  name: string;
  /** Carpeta donde está el elemento ahora. Se deshabilita: mover ahí no cambiaría nada (SPEC-212, D2). */
  currentFolderId: string;
  /** Ubicación del almacén del elemento. Si es null, no se compara por almacén (SPEC-212, D1). */
  location: StorageLocation | null;
};

/** Resultado de un movimiento. `name` es el del elemento; `targetName` la carpeta de destino. */
export type MovedItem = { kind: OrganizeKind; id: string; name: string; targetName: string };

/**
 * SPEC-212 escenario 4: mensajes en español para los códigos de SPEC-211 al mover.
 * Se decide por `code` (estable). No se usa errorMessage() porque convierte cualquier 422 en "cuota".
 */
export function moveErrorMessage(error: unknown): string {
  const fallback = "No fue posible mover. Inténtalo de nuevo.";
  if (!(error instanceof ApiError)) return fallback;
  switch (error.code) {
    case "FOLDER_CYCLE_NOT_ALLOWED": return "No puedes mover una carpeta dentro de sí misma ni de sus subcarpetas.";
    case "DESTINATION_MISMATCH": return "El destino usa un almacén distinto. Elige otra carpeta.";
    case "RESOURCE_NOT_MOVABLE": return "La raíz y los elementos en papelera no se pueden mover.";
    case "FILE_NAME_CONFLICT": return "Ya existe un archivo con ese nombre en la carpeta destino.";
    case "FOLDER_NAME_CONFLICT": return "Ya existe una carpeta con ese nombre en la carpeta destino.";
    case "DRIVE_PERMISSION_DENIED": return "No tienes permiso para mover este elemento.";
    case "VALIDATION_ERROR": return "La carpeta destino no es válida.";
    default: break;
  }
  if (error.status === 404) return "El elemento o la carpeta destino ya no están disponibles. Actualiza la carpeta.";
  if (error.status === 400) return "La carpeta destino no es válida.";
  return fallback;
}

type ChildCache = Map<string, Folder[]>;
type NodeState = { status: "loading" | "ready" | "error"; children: Folder[] };

/** Hijos directos de una carpeta, con caché para no pedir dos veces la misma. */
async function fetchChildren(cache: ChildCache, parentId: string, token: string, driveId: UUID): Promise<Folder[]> {
  const cached = cache.get(parentId);
  if (cached) return cached;
  const response = await listChildFolders(parentId, token, undefined, driveId);
  cache.set(parentId, response.items);
  return response.items;
}

/** Ids de una carpeta y de todos sus descendientes, recorridos por niveles (una petición por carpeta). */
async function collectSubtree(cache: ChildCache, rootId: string, token: string, driveId: UUID): Promise<Set<string>> {
  const found = new Set<string>([rootId]);
  let frontier = [rootId];
  while (frontier.length > 0) {
    const levels = await Promise.all(frontier.map((id) => fetchChildren(cache, id, token, driveId)));
    frontier = [];
    for (const children of levels) {
      for (const child of children) {
        if (!found.has(child.id)) {
          found.add(child.id);
          frontier.push(child.id);
        }
      }
    }
  }
  return found;
}

/**
 * Diálogo para mover un archivo o carpeta a otra carpeta del mismo Drive (SPEC-212, escenarios 2, 3 y 4).
 * El árbol carga por niveles con `GET /folders?parentId=`. Las opciones no válidas se deshabilitan en la UI;
 * el backend sigue siendo la autoridad y su error se muestra en español sin cambiar la fila.
 */
export function MoveDialog({
  target,
  rootFolderId,
  rootName,
  driveId,
  token,
  onClose,
  onMoved,
  onSessionError,
}: {
  target: MoveTarget;
  rootFolderId: string;
  /** Nombre que muestra la raíz del árbol: "Mi espacio" o el nombre del Drive de equipo. */
  rootName: string;
  /** Drive al que pertenece el elemento (SPEC-223). Los hijos se piden dentro de ese Drive. */
  driveId: UUID;
  token: string;
  onClose: () => void;
  onMoved: (item: MovedItem) => void;
  /** Devuelve true si el error era de sesión y ya lo gestionó el llamador. */
  onSessionError: (error: unknown) => boolean;
}) {
  const cache = useRef<ChildCache>(new Map());
  const sessionErrorRef = useRef(onSessionError);
  const [preparing, setPreparing] = useState(true);
  const [prepareError, setPrepareError] = useState("");
  const [rootLocation, setRootLocation] = useState<StorageLocation | null>(null);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [nodes, setNodes] = useState<Record<string, NodeState>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<{ id: string; name: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    sessionErrorRef.current = onSessionError;
  });

  // Antes de mostrar el árbol se conoce: la ubicación de la raíz, las carpetas que no se pueden elegir
  // (la carpeta actual y, si el elemento es carpeta, ella misma y sus descendientes) y los hijos de la raíz.
  useEffect(() => {
    let active = true;
    async function prepare() {
      try {
        const [rootContents, subtree] = await Promise.all([
          getFolderItems(rootFolderId, token),
          target.kind === "folder" ? collectSubtree(cache.current, target.id, token, driveId) : Promise.resolve(new Set<string>()),
          fetchChildren(cache.current, rootFolderId, token, driveId),
        ]);
        if (!active) return;
        const restored: Record<string, NodeState> = {};
        for (const [id, children] of cache.current) restored[id] = { status: "ready", children };
        const blocked = new Set<string>(subtree);
        blocked.add(target.currentFolderId);
        setNodes(restored);
        setRootLocation(rootContents.folder.destinationLocation ?? null);
        setExcluded(blocked);
        setExpanded(new Set([rootFolderId]));
        setPreparing(false);
      } catch (caught) {
        if (!active) return;
        if (sessionErrorRef.current(caught)) return;
        setPrepareError("No pudimos preparar las carpetas de destino. Inténtalo de nuevo.");
      }
    }
    void prepare();
    return () => { active = false; };
  }, [rootFolderId, driveId, target.id, target.kind, target.currentFolderId, token]);

  async function loadChildren(id: string) {
    setNodes((current) => ({ ...current, [id]: { status: "loading", children: current[id]?.children ?? [] } }));
    try {
      const children = await fetchChildren(cache.current, id, token, driveId);
      setNodes((current) => ({ ...current, [id]: { status: "ready", children } }));
    } catch (caught) {
      if (onSessionError(caught)) return;
      setNodes((current) => ({ ...current, [id]: { status: "error", children: [] } }));
    }
  }

  function toggle(id: string) {
    if (expanded.has(id)) {
      setExpanded((current) => {
        const next = new Set(current);
        next.delete(id);
        return next;
      });
      return;
    }
    setExpanded((current) => new Set(current).add(id));
    if (nodes[id]?.status !== "ready") void loadChildren(id);
  }

  /** Motivo por el que una carpeta no se puede elegir, o null si sí se puede. */
  function blockedReason(id: string, location: StorageLocation | null | undefined): string | null {
    if (id === target.currentFolderId) return "Carpeta actual";
    if (id === target.id) return "Es la carpeta que se mueve";
    if (excluded.has(id)) return "Dentro de la carpeta que se mueve";
    // Si cualquiera de las dos ubicaciones es desconocida, no se decide por almacén: lo decide el backend.
    if (target.location && location && location !== target.location) return "Otro almacén";
    return null;
  }

  function renderFolder(id: string, name: string, location: StorageLocation | null | undefined, depth: number) {
    const node = nodes[id];
    const reason = blockedReason(id, location);
    const isOpen = expanded.has(id);
    const isSelected = selected?.id === id;
    const locked = busy || preparing;
    return <div key={id} className="drive-tree-node">
      <div className="drive-tree-row" style={{ paddingLeft: `${depth * 18}px` }}>
        <button
          type="button"
          className="drive-tree-toggle"
          aria-expanded={isOpen}
          aria-label={`${isOpen ? "Contraer" : "Expandir"} «${name}»`}
          onClick={() => toggle(id)}
          disabled={locked}
        >
          <UiIcon name="chevron" size={14} />
        </button>
        <button
          type="button"
          className={`drive-tree-item${isSelected ? " is-selected" : ""}`}
          aria-pressed={isSelected}
          onClick={() => setSelected({ id, name })}
          disabled={locked || Boolean(reason)}
        >
          <span>{name}</span>
          {reason && <small>{reason}</small>}
        </button>
      </div>
      {isOpen && node?.status === "loading" && <p className="drive-tree-status" role="status">Cargando carpetas…</p>}
      {isOpen && node?.status === "error" && <p className="drive-tree-status" role="alert">No pudimos cargar esta carpeta. <button type="button" className="drive-subtle-button" onClick={() => void loadChildren(id)}>Reintentar</button></p>}
      {isOpen && node?.status === "ready" && node.children.length === 0 && <p className="drive-tree-status">Sin subcarpetas.</p>}
      {isOpen && node?.status === "ready" && node.children.map((child) => renderFolder(child.id, child.name, child.destinationLocation, depth + 1))}
    </div>;
  }

  async function confirm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected || busy || preparing) return;
    setBusy(true); setError("");
    try {
      if (target.kind === "file") {
        await updateFile(target.id, { folderId: selected.id }, token);
      } else {
        await updateFolder(target.id, { parentId: selected.id }, token);
      }
      onMoved({ kind: target.kind, id: target.id, name: target.name, targetName: selected.name });
    } catch (caught) {
      if (!onSessionError(caught)) setError(moveErrorMessage(caught));
    } finally { setBusy(false); }
  }

  return <Dialog labelledBy="move-title" onClose={onClose} disabled={busy}>
    <span className="drive-modal-icon"><UiIcon name="folder" size={20} /></span>
    <h2 id="move-title">Mover «{target.name}» a…</h2>
    <p>Elige la carpeta de destino. Las carpetas que no se pueden usar aparecen deshabilitadas.</p>
    <form onSubmit={confirm} aria-busy={busy}>
      <div className="drive-tree" role="group" aria-label="Carpetas de destino">
        {preparing && !prepareError && <p className="drive-tree-status" role="status">Preparando destinos…</p>}
        {prepareError && <p className="drive-tree-status" role="alert">{prepareError}</p>}
        {!preparing && !prepareError && renderFolder(rootFolderId, rootName, rootLocation, 0)}
      </div>
      <p className="drive-tree-hint" aria-live="polite">{selected ? `Destino: ${selected.name}` : "Selecciona una carpeta de destino."}</p>
      {error && <span className="drive-form-error" role="alert">{error}</span>}
      <div className="drive-modal-actions">
        <button type="button" className="drive-subtle-button" onClick={onClose} disabled={busy}>Cancelar</button>
        <button className="drive-primary-button" type="submit" disabled={busy || preparing || !selected || Boolean(prepareError)}>{busy ? "Moviendo…" : "Mover aquí"}</button>
      </div>
    </form>
  </Dialog>;
}
