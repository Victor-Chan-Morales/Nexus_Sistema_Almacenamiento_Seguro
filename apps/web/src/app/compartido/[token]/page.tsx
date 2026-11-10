"use client";

import { useParams } from "next/navigation";
import { FormEvent, ReactNode, useCallback, useEffect, useState } from "react";
import { Brand } from "@/components/brand";
import { LoadingIndicator } from "@/components/toast";
import { ApiError } from "@/lib/api/client";
import { downloadPublicShareLink, getPublicShareLink } from "@/lib/api/public-share";
import type { PublicShareLinkInfo } from "@/lib/api/types";
import { formatBytes, formatIsoDate } from "@/lib/format";

type ShareView =
  | { kind: "loading" }
  | { kind: "unavailable" }
  | { kind: "error" }
  | { kind: "ready"; info: PublicShareLinkInfo };

type DownloadState = { status: "idle" | "busy" | "done"; error: string };

/** SPEC-217: un 404 siempre significa "no disponible", sin distinguir la causa. */
function isUnavailable(error: unknown) {
  return error instanceof ApiError && error.status === 404;
}

/** Mensajes de la descarga pública (plan §4.4). Aquí un 401 es contraseña incorrecta, no sesión vencida. */
function downloadErrorMessage(error: unknown) {
  if (error instanceof ApiError && error.status === 401) return "La contraseña no es correcta.";
  if (error instanceof ApiError && error.status === 429) return "Demasiados intentos. Espera unos minutos antes de volver a intentar.";
  return "No fue posible descargar el archivo. Inténtalo de nuevo.";
}

/** Entrega el Blob al navegador con el nombre del servidor o el de los metadatos. */
function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Consulta pública del enlace, sin sesión ni accessToken. */
function usePublicShareLink(token: string) {
  const [view, setView] = useState<ShareView>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    getPublicShareLink(token, { signal: controller.signal })
      .then((info) => setView({ kind: "ready", info }))
      .catch((error: unknown) => {
        if (error instanceof Error && error.name === "AbortError") return;
        setView(isUnavailable(error) ? { kind: "unavailable" } : { kind: "error" });
      });
    return () => controller.abort();
  }, [token, attempt]);

  const reload = useCallback(() => { setView({ kind: "loading" }); setAttempt((value) => value + 1); }, []);
  const markUnavailable = useCallback(() => setView({ kind: "unavailable" }), []);
  return { view, reload, markUnavailable };
}

/** Descarga pública: guarda el archivo o traduce el error; un 404 pasa a "no disponible". */
function usePublicDownload(token: string, fallbackName: string | undefined, onUnavailable: () => void) {
  const [state, setState] = useState<DownloadState>({ status: "idle", error: "" });

  const download = useCallback((password?: string) => {
    setState({ status: "busy", error: "" });
    downloadPublicShareLink(token, password)
      .then((result) => {
        saveBlob(result.blob, result.filename || fallbackName || "archivo");
        setState({ status: "done", error: "" });
      })
      .catch((error: unknown) => {
        if (isUnavailable(error)) { onUnavailable(); return; }
        setState({ status: "idle", error: downloadErrorMessage(error) });
      });
  }, [token, fallbackName, onUnavailable]);

  return { state, download };
}

/** Marco de la página pública: sin AppShell, sin enlaces ni recursos externos. */
function PublicShareFrame({ children }: { children: ReactNode }) {
  return <main className="auth-layout">
    <meta name="referrer" content="no-referrer" />
    <section className="auth-card auth-form-card auth-result-card">
      <div className="auth-logo-link"><Brand /></div>
      {children}
      <p className="auth-demo-caption">Nexus · Almacenamiento seguro</p>
    </section>
  </main>;
}

function ShareUnavailable() {
  return <>
    <h1 className="title">Este enlace no está disponible</h1>
    <p className="lead">Pide a quien te lo compartió que revise el enlace.</p>
  </>;
}

function ShareLoadError({ onRetry }: { onRetry: () => void }) {
  return <>
    <div className="auth-alert" role="alert">No pudimos cargar el enlace. Inténtalo de nuevo.</div>
    <button className="button button-primary button-wide auth-submit" type="button" onClick={onRetry} aria-label="Reintentar cargar el enlace">Reintentar</button>
  </>;
}

function DownloadButton({ busy, onClick }: { busy: boolean; onClick?: () => void }) {
  return <button className="button button-primary button-wide auth-submit" type={onClick ? "button" : "submit"} onClick={onClick} disabled={busy} aria-label={busy ? "Descargando archivo…" : "Descargar archivo"}>
    {busy ? "Descargando…" : "Descargar"}
  </button>;
}

function DownloadFeedback({ state }: { state: DownloadState }) {
  if (state.error) return <div className="auth-alert" role="alert">{state.error}</div>;
  if (state.status === "done") return <p className="notice" role="status">Descarga iniciada.</p>;
  return null;
}

/** Vista sin contraseña: nombre como texto, tamaño y vencimiento. */
function OpenShareView({ info, state, onDownload }: { info: PublicShareLinkInfo; state: DownloadState; onDownload: () => void }) {
  return <>
    <h1 className="title" style={{ overflowWrap: "anywhere" }}>{info.name ?? "Archivo compartido"}</h1>
    <dl className="drive-detail-list">
      <dt>Tamaño</dt><dd>{formatBytes(info.sizeBytes)}</dd>
      <dt>Vence el</dt><dd>{formatIsoDate(info.expiresAt)}</dd>
    </dl>
    <DownloadFeedback state={state} />
    <DownloadButton busy={state.status === "busy"} onClick={onDownload} />
  </>;
}

/** Vista con contraseña: no muestra nombre ni tamaño hasta descargar. */
function PasswordForm({ state, onDownload }: { state: DownloadState; onDownload: (password: string) => void }) {
  const [password, setPassword] = useState("");

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onDownload(password);
  }

  return <>
    <h1 className="title">Archivo protegido</h1>
    <p className="lead">Este archivo está protegido con contraseña.</p>
    <form className="auth-form" onSubmit={submit}>
      <div className="field">
        <label htmlFor="share-password">Contraseña</label>
        <input id="share-password" name="password" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} disabled={state.status === "busy"} required aria-describedby={state.error ? "share-password-error" : undefined} />
        {state.error && <div id="share-password-error" className="auth-alert" role="alert">{state.error}</div>}
      </div>
      {state.status === "done" && <p className="notice" role="status">Descarga iniciada.</p>}
      <DownloadButton busy={state.status === "busy"} />
    </form>
  </>;
}

function PublicShareView({ token, info, onUnavailable }: { token: string; info: PublicShareLinkInfo; onUnavailable: () => void }) {
  const { state, download } = usePublicDownload(token, info.name, onUnavailable);
  if (info.requiresPassword) return <PasswordForm state={state} onDownload={download} />;
  return <OpenShareView info={info} state={state} onDownload={() => download()} />;
}

/** SPEC-217: página pública de un enlace compartido. No usa sesión ni muestra el token. */
export default function PublicSharePage() {
  const { token } = useParams<{ token: string }>();
  const { view, reload, markUnavailable } = usePublicShareLink(token);

  return <PublicShareFrame>
    {view.kind === "loading" && <LoadingIndicator>Cargando archivo…</LoadingIndicator>}
    {view.kind === "unavailable" && <ShareUnavailable />}
    {view.kind === "error" && <ShareLoadError onRetry={reload} />}
    {view.kind === "ready" && <PublicShareView token={token} info={view.info} onUnavailable={markUnavailable} />}
  </PublicShareFrame>;
}
