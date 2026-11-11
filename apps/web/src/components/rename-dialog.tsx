"use client";

import { type FormEvent, useEffect, useRef, useState } from "react";
import { ApiError } from "@/lib/api/client";
import { updateFile, updateFolder } from "@/lib/api/files";
import { Dialog } from "@/components/dialog";
import { UiIcon } from "@/components/ui-icon";

export type OrganizeKind = "file" | "folder";

export type RenameTarget = { kind: OrganizeKind; id: string; name: string };

/** Resultado de un renombrado. `name` es el que devolvió la API, ya normalizado por el backend. */
export type RenamedItem = { kind: OrganizeKind; id: string; name: string };

/**
 * SPEC-212 escenario 4: mensajes en español para los códigos de SPEC-211.
 * Se decide por `code` (estable). No se usa errorMessage() porque convierte cualquier 422 en "cuota".
 */
export function renameErrorMessage(error: unknown): string {
  const fallback = "No fue posible renombrar. Inténtalo de nuevo.";
  if (!(error instanceof ApiError)) return fallback;
  switch (error.code) {
    case "FILE_NAME_CONFLICT": return "Ya existe un archivo con ese nombre en esta carpeta.";
    case "FOLDER_NAME_CONFLICT": return "Ya existe una carpeta con ese nombre en esta carpeta.";
    case "RESOURCE_NOT_MOVABLE": return "La raíz y los elementos en papelera no se pueden renombrar.";
    case "DRIVE_PERMISSION_DENIED": return "No tienes permiso para cambiar este elemento.";
    case "VALIDATION_ERROR": return "El nombre no es válido.";
    default: break;
  }
  if (error.status === 404) return "Este elemento ya no está disponible. Actualiza la carpeta.";
  if (error.status === 400) return "El nombre no es válido.";
  return fallback;
}

/**
 * Diálogo para cambiar el nombre de un archivo o carpeta (SPEC-212, escenarios 1 y 4).
 * No modifica la fila: solo informa el resultado con `onRenamed`. Si falla, el diálogo queda abierto con el mensaje.
 */
export function RenameDialog({
  target,
  token,
  onClose,
  onRenamed,
  onSessionError,
}: {
  target: RenameTarget;
  token: string;
  onClose: () => void;
  onRenamed: (item: RenamedItem) => void;
  /** Devuelve true si el error era de sesión y ya lo gestionó el llamador. */
  onSessionError: (error: unknown) => boolean;
}) {
  const [name, setName] = useState(target.name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const isFolder = target.kind === "folder";

  // Dialog enfoca el primer control (el cierre). Este efecto corre después y deja el foco en el campo, con el texto seleccionado.
  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next = name.trim();
    if (next.length === 0) { setError("Escribe un nombre."); return; }
    if (next === target.name) { onClose(); return; }
    setBusy(true); setError("");
    try {
      const result = isFolder
        ? await updateFolder(target.id, { name: next }, token)
        : await updateFile(target.id, { name: next }, token);
      onRenamed({ kind: target.kind, id: target.id, name: result.name });
    } catch (caught) {
      if (!onSessionError(caught)) setError(renameErrorMessage(caught));
    } finally { setBusy(false); }
  }

  return <Dialog labelledBy="rename-title" onClose={onClose} disabled={busy}>
    <span className="drive-modal-icon"><UiIcon name={isFolder ? "folder" : "files"} size={20} /></span>
    <h2 id="rename-title">{isFolder ? "Renombrar carpeta" : "Renombrar archivo"}</h2>
    <p>Escribe el nombre nuevo para <b>{target.name}</b>.</p>
    <form onSubmit={submit} aria-busy={busy}>
      <label className="drive-form-label" htmlFor="rename-input">Nombre nuevo</label>
      <input
        ref={inputRef}
        className="drive-modal-input"
        id="rename-input"
        value={name}
        onChange={(event) => { setName(event.target.value); setError(""); }}
        maxLength={255}
        required
        disabled={busy}
      />
      {error && <span className="drive-form-error" role="alert">{error}</span>}
      <div className="drive-modal-actions">
        <button type="button" className="drive-subtle-button" onClick={onClose} disabled={busy}>Cancelar</button>
        <button className="drive-primary-button" type="submit" disabled={busy}>{busy ? "Renombrando…" : "Renombrar"}</button>
      </div>
    </form>
  </Dialog>;
}
