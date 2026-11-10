"use client";

import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { Dialog } from "@/components/dialog";
import { LoadingIndicator, useToast } from "@/components/toast";
import { UiIcon } from "@/components/ui-icon";
import { ApiError } from "@/lib/api/client";
import { createShareLink, listShareLinks, revokeShareLink } from "@/lib/api/files";
import type { CreateShareLinkInput, FileMetadata, ShareExpiryDays, ShareLinkItem, ShareLinkStatus, ShareLinksResponse, UUID } from "@/lib/api/types";
import { formatIsoDate } from "@/lib/format";
import { useSession } from "@/lib/session";
import { type Load, useLoad } from "@/lib/use-load";

const LOAD_ERROR = "No pudimos cargar los enlaces. Inténtalo de nuevo.";
const VERSION_HELP = "El enlace apunta a la versión actual del archivo. Si subes una nueva, este enlace seguirá entregando la anterior.";
const COPY_FAILED = "No pudimos copiar automáticamente. Selecciona el enlace y cópialo.";
const MIN_PASSWORD_LENGTH = 8;
const EXPIRY_OPTIONS: { value: ShareExpiryDays; label: string }[] = [
  { value: 1, label: "1 día" },
  { value: 7, label: "7 días" },
  { value: 30, label: "30 días" },
];
const STATUS_LABELS: Record<ShareLinkStatus, string> = { active: "Activo", expired: "Vencido", revoked: "Revocado" };

/** Traduce un error al crear el enlace. No revela causas internas. */
function createErrorMessage(error: unknown) {
  if (error instanceof ApiError && error.status === 400) return "Revisa la vigencia y la contraseña (mínimo 8 caracteres).";
  if (error instanceof ApiError && error.status === 404) return "No encontramos este archivo. Puede estar en la papelera.";
  return "No fue posible crear el enlace. Inténtalo de nuevo.";
}

/** Traduce un error al revocar el enlace. */
function revokeErrorMessage(error: unknown) {
  if (error instanceof ApiError && error.status === 404) return "Este enlace ya no está disponible.";
  return "No fue posible revocar el enlace.";
}

/**
 * Crea enlaces compartidos. La URL con el token vive solo en este estado de React: no se guarda en
 * localStorage, sessionStorage ni cookies, ni se muestra en avisos. Al cerrar el diálogo desaparece.
 */
function useCreateLink(fileId: UUID, token: string, onCreated: () => void) {
  const { failSession } = useSession();
  const [creating, setCreating] = useState(false);
  const [createdUrl, setCreatedUrl] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [returnFocus, setReturnFocus] = useState(false);

  async function create(input: CreateShareLinkInput) {
    setCreating(true);
    setError("");
    try {
      const created = await createShareLink(fileId, input, token);
      // El origen se calcula aquí, en el navegador, y no durante el render (SSR).
      setCreatedUrl(`${window.location.origin}/compartido/${encodeURIComponent(created.token)}`);
      onCreated();
    } catch (failure) {
      if (!failSession(failure)) setError(createErrorMessage(failure));
    } finally {
      setCreating(false);
    }
  }

  const dismiss = () => { setCreatedUrl(null); setReturnFocus(true); };
  return { creating, createdUrl, error, returnFocus, create, clearError: () => setError(""), dismiss };
}

/** Revoca un enlace activo tras la confirmación en línea (D3). */
function useRevokeLink(token: string, onChanged: () => void) {
  const { failSession } = useSession();
  const notify = useToast();
  const [confirming, setConfirming] = useState<ShareLinkItem | null>(null);
  const [revoking, setRevoking] = useState(false);
  const [error, setError] = useState("");

  async function revoke(link: ShareLinkItem) {
    setRevoking(true);
    setError("");
    try {
      await revokeShareLink(link.id, token);
      setConfirming(null);
      notify("success", "Enlace revocado.");
      onChanged();
    } catch (failure) {
      if (failSession(failure)) return;
      setConfirming(null);
      setError(revokeErrorMessage(failure));
      // 404: la lista quedó desactualizada (el enlace ya venció o lo revocó otra sesión).
      if (failure instanceof ApiError && failure.status === 404) onChanged();
    } finally {
      setRevoking(false);
    }
  }

  const ask = (link: ShareLinkItem) => { setError(""); setConfirming(link); };
  return { confirming, revoking, error, revoke, ask, cancel: () => setConfirming(null) };
}

type RevokeActions = ReturnType<typeof useRevokeLink>;

/**
 * Diálogo para compartir un archivo (SPEC-217): crea enlaces con vigencia y contraseña opcional,
 * muestra el enlace una sola vez y lista los existentes con su estado, que entrega la API (REGLAS §4.2).
 */
export function ShareDialog({ file, token, onClose }: { file: FileMetadata; token: string; onClose: () => void }) {
  const fetcher = useCallback((signal: AbortSignal) => listShareLinks(file.id, token, { signal }), [file.id, token]);
  const { state, reload } = useLoad(fetcher, true, LOAD_ERROR);
  const creator = useCreateLink(file.id, token, reload);
  const revoker = useRevokeLink(token, reload);
  const busy = creator.creating || revoker.revoking;

  return (
    <Dialog labelledBy="share-dialog-title" onClose={onClose} disabled={busy}>
      <h2 id="share-dialog-title" className="share-dialog-title">Compartir «{file.name}»</h2>
      <p className="share-help">{VERSION_HELP}</p>
      {creator.createdUrl ? (
        <CreatedLinkPanel url={creator.createdUrl} onDone={creator.dismiss} />
      ) : (
        <CreateLinkForm creating={creator.creating} disabled={busy} focusOnMount={creator.returnFocus} apiError={creator.error} onEdit={creator.clearError} onSubmit={creator.create} />
      )}
      <ShareLinksSection state={state} reload={reload} revoker={revoker} disabled={busy} />
      <div className="drive-modal-actions">
        <button type="button" className="drive-subtle-button" onClick={onClose} disabled={busy} aria-label="Cerrar el diálogo de compartir">
          Cerrar
        </button>
      </div>
    </Dialog>
  );
}

/** Formulario de creación: vigencia de 1, 7 o 30 días (7 por defecto, D2) y contraseña opcional. */
function CreateLinkForm({ creating, disabled, focusOnMount, apiError, onEdit, onSubmit }: {
  creating: boolean; disabled: boolean; focusOnMount: boolean; apiError: string; onEdit: () => void; onSubmit: (input: CreateShareLinkInput) => void;
}) {
  const [days, setDays] = useState<ShareExpiryDays>(7);
  const [password, setPassword] = useState("");
  const [localError, setLocalError] = useState("");
  const error = localError || apiError;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (password && password.length < MIN_PASSWORD_LENGTH) {
      setLocalError("La contraseña debe tener al menos 8 caracteres.");
      return;
    }
    // Una contraseña vacía se omite: la API la rechazaría con 400.
    onSubmit(password ? { expiresInDays: days, password } : { expiresInDays: days });
  }

  function edit(update: () => void) {
    update();
    setLocalError("");
    onEdit();
  }

  return (
    <form className="share-form" onSubmit={submit} noValidate>
      <ExpiryFieldset days={days} disabled={disabled} focusOnMount={focusOnMount} onChange={(value) => edit(() => setDays(value))} />
      <label className="drive-form-label" htmlFor="share-password">Contraseña (opcional)</label>
      <input id="share-password" className="drive-modal-input" type="password" autoComplete="new-password" value={password} disabled={disabled} maxLength={128}
        onChange={(event) => edit(() => setPassword(event.target.value))} aria-describedby="share-password-help" aria-invalid={error ? true : undefined} />
      <span id="share-password-help" className="share-field-help">Mínimo 8 caracteres.</span>
      {error && <span className="drive-form-error" role="alert">{error}</span>}
      <button type="submit" className="drive-primary-button share-submit" disabled={disabled} aria-label={creating ? "Creando enlace compartido…" : "Crear enlace compartido"}>
        {creating ? "Creando…" : "Crear enlace"}
      </button>
    </form>
  );
}

/** Grupo de radios para elegir la vigencia del enlace. */
function ExpiryFieldset({ days, disabled, focusOnMount, onChange }: {
  days: ShareExpiryDays; disabled: boolean; focusOnMount: boolean; onChange: (value: ShareExpiryDays) => void;
}) {
  const checkedRef = useRef<HTMLInputElement>(null);

  // Tras pulsar "Listo" el panel desaparece: el foco vuelve a la vigencia para no perderse.
  useEffect(() => {
    if (focusOnMount) checkedRef.current?.focus();
  }, [focusOnMount]);

  return (
    <fieldset className="share-expiry" disabled={disabled}>
      <legend className="drive-form-label">Vigencia</legend>
      <div className="share-expiry-options">
        {EXPIRY_OPTIONS.map((option) => (
          <label key={option.value} className="share-expiry-option">
            <input ref={days === option.value ? checkedRef : undefined} type="radio" name="share-expiry" value={option.value} checked={days === option.value} onChange={() => onChange(option.value)} />
            <span>{option.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** Copia al portapapeles; si la API no existe (HTTP sin TLS) o falla, recurre a execCommand sobre el input. */
async function copyFromInput(input: HTMLInputElement) {
  try {
    if (navigator.clipboard) {
      await navigator.clipboard.writeText(input.value);
      return true;
    }
  } catch {
    // Se intenta el método alternativo.
  }
  input.focus();
  input.select();
  try {
    return document.execCommand("copy");
  } catch {
    return false;
  }
}

/** Panel que muestra el enlace recién creado. Es la única vez que el token se ve. */
function CreatedLinkPanel({ url, onDone }: { url: string; onDone: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const copyRef = useRef<HTMLButtonElement>(null);
  const [copy, setCopy] = useState<"idle" | "copied" | "failed">("idle");

  // El formulario desaparece al crear: el foco pasa al botón "Copiar" para no perderse.
  useEffect(() => {
    copyRef.current?.focus();
  }, []);

  async function copyLink() {
    if (!inputRef.current) return;
    setCopy((await copyFromInput(inputRef.current)) ? "copied" : "failed");
  }

  return (
    <section className="share-created" aria-labelledby="share-created-title">
      <h3 id="share-created-title">Enlace creado</h3>
      <p className="share-created-warning"><UiIcon name="warning" size={16} /><span>Este enlace no se volverá a mostrar. Cópialo ahora.</span></p>
      <div className="share-created-row">
        <input ref={inputRef} className="drive-modal-input share-created-input" type="text" readOnly value={url} aria-label="Enlace compartido" onFocus={(event) => event.target.select()} />
        <button ref={copyRef} type="button" className="drive-primary-button" onClick={copyLink} aria-label="Copiar el enlace compartido">Copiar</button>
      </div>
      <p className="share-copy-status" role="status">{copy === "copied" ? "Enlace copiado." : ""}</p>
      {copy === "failed" && <p className="drive-form-error" role="alert">{COPY_FAILED}</p>}
      <div className="drive-modal-actions share-created-actions">
        <button type="button" className="drive-subtle-button" onClick={onDone} aria-label="Listo, ocultar el enlace creado">Listo</button>
      </div>
    </section>
  );
}

/** Sección con la lista de enlaces y sus estados: cargando, error, vacío y datos. */
function ShareLinksSection({ state, reload, revoker, disabled }: { state: Load<ShareLinksResponse>; reload: () => void; revoker: RevokeActions; disabled: boolean }) {
  return (
    <section className="share-links" aria-labelledby="share-links-title">
      <h3 id="share-links-title" tabIndex={-1}>Enlaces de este archivo</h3>
      {revoker.error && <p className="share-error" role="alert">{revoker.error}</p>}
      {state.status === "loading" && <LoadingIndicator>Cargando enlaces…</LoadingIndicator>}
      {state.status === "error" && (
        <div className="share-error" role="alert">
          <p>{state.message}</p>
          <button type="button" className="drive-empty-button" onClick={reload} aria-label="Reintentar la carga de enlaces">Reintentar</button>
        </div>
      )}
      {state.status === "ready" && state.data.items.length === 0 && (
        <div className="drive-empty-state share-empty">
          <span><UiIcon name="shared" size={22} /></span>
          <b>Aún no hay enlaces</b>
          <p>Crea uno arriba para compartir este archivo.</p>
        </div>
      )}
      {state.status === "ready" && state.data.items.length > 0 && <ShareLinkList items={state.data.items} revoker={revoker} disabled={disabled} />}
      {revoker.confirming && <RevokeConfirm link={revoker.confirming} revoker={revoker} />}
    </section>
  );
}

/** Tabla de enlaces. Solo los activos ofrecen "Revocar". */
function ShareLinkList({ items, revoker, disabled }: { items: ShareLinkItem[]; revoker: RevokeActions; disabled: boolean }) {
  return (
    <table className="share-table">
      <thead>
        <tr><th scope="col">Vence</th><th scope="col">Protección</th><th scope="col">Estado</th><th scope="col"><span className="share-sr-only">Acción</span></th></tr>
      </thead>
      <tbody>
        {items.map((link) => <ShareLinkRow key={link.id} link={link} revoker={revoker} disabled={disabled} />)}
      </tbody>
    </table>
  );
}

/** Fila de un enlace. El estado lo calcula la API; el cliente solo lo traduce. */
function ShareLinkRow({ link, revoker, disabled }: { link: ShareLinkItem; revoker: RevokeActions; disabled: boolean }) {
  const createdAt = formatIsoDate(link.createdAt);
  return (
    <tr>
      <td data-label="Vence"><time dateTime={link.expiresAt}>{formatIsoDate(link.expiresAt)}</time></td>
      <td data-label="Protección">{link.hasPassword ? "Con contraseña" : "Sin contraseña"}</td>
      <td data-label="Estado"><span className={`share-status share-status-${link.status}`}>{STATUS_LABELS[link.status]}</span></td>
      <td className="share-row-action">
        {link.status === "active" && (
          <button type="button" className="drive-subtle-button" onClick={() => revoker.ask(link)} disabled={disabled} data-share-revoke={link.id}
            aria-label={`Revocar el enlace creado el ${createdAt}`}>
            Revocar
          </button>
        )}
      </td>
    </tr>
  );
}

/** Confirmación en línea antes de revocar (D3): evita un diálogo anidado y window.confirm. */
function RevokeConfirm({ link, revoker }: { link: ShareLinkItem; revoker: RevokeActions }) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  // Al cerrar la confirmación, el foco vuelve al botón "Revocar" de la fila; si ya no existe, al título de la lista.
  useEffect(() => {
    cancelRef.current?.focus();
    return () => {
      const opener = document.querySelector<HTMLElement>(`[data-share-revoke="${link.id}"]`);
      (opener ?? document.getElementById("share-links-title"))?.focus();
    };
  }, [link.id]);

  return (
    <div className="share-confirm" role="group" aria-labelledby="share-confirm-text">
      <p id="share-confirm-text">¿Revocar este enlace? Quien lo tenga dejará de poder descargar el archivo.</p>
      <p className="share-confirm-detail">Creado el {formatIsoDate(link.createdAt)} · vence el {formatIsoDate(link.expiresAt)}</p>
      <div className="drive-modal-actions share-confirm-actions">
        <button ref={cancelRef} type="button" className="drive-subtle-button" onClick={revoker.cancel} disabled={revoker.revoking} aria-label="Cancelar la revocación">
          Cancelar
        </button>
        <button type="button" className="drive-danger-button" onClick={() => revoker.revoke(link)} disabled={revoker.revoking} aria-label={revoker.revoking ? "Revocando enlace…" : "Revocar enlace"}>
          {revoker.revoking ? "Revocando…" : "Revocar enlace"}
        </button>
      </div>
    </div>
  );
}
