"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { type ChangeEvent, type FormEvent, useCallback, useMemo, useRef, useState } from "react";
import { ApiError } from "@/lib/api/client";
import { getDashboard } from "@/lib/api/dashboard";
import { createFolder, downloadFile, getFolderItems, listFolders, uploadFile } from "@/lib/api/files";
import type { DashboardResponse, FileMetadata, Folder } from "@/lib/api/types";
import { formatBytes, formatIsoDate, usagePercent } from "@/lib/format";
import { useLoad } from "@/lib/use-load";
import { initialsOf, RequireSession, useSession, type Session } from "@/lib/session";
import { Brand } from "@/components/brand";
import { UiIcon } from "@/components/ui-icon";

const MAX_FILE_BYTES = 100_000_000;
const ALLOWED_EXTENSIONS = new Set(["pdf", "docx", "xlsx", "pptx", "jpg", "png", "txt", "zip"]);
const LOAD_ERROR = "No pudimos cargar tus archivos. Inténtalo de nuevo.";

type BrowserData = {
  driveName: string;
  rootFolderId: string;
  folder: Folder;
  folders: Folder[];
  files: FileMetadata[];
  dashboard: DashboardResponse;
};

function errorMessage(error: unknown, fallback: string) {
  if (!(error instanceof ApiError)) return fallback;
  if (error.code === "STORAGE_QUOTA_EXCEEDED" || error.status === 422) return "La cuota disponible no alcanza para esta operación.";
  if (error.status === 413) return "El archivo supera el límite de 100 MB.";
  if (error.status === 415) return "Ese tipo de archivo no está permitido.";
  if (error.status === 404) return "No encontramos esta carpeta o archivo.";
  if (error.status === 0) return error.message;
  return fallback;
}

function extensionOf(name: string) {
  return name.split(".").pop()?.toUpperCase() || "FILE";
}

function FileGlyph({ name }: { name: string }) {
  const extension = extensionOf(name);
  const label = extension === "DOCX" ? "W" : extension === "XLSX" ? "X" : extension === "PPTX" ? "P" : extension.slice(0, 3);
  return <span aria-hidden="true" className={`drive-file-glyph glyph-${extension.toLowerCase()}`}><span>{label}</span></span>;
}

export function FileBrowserLive({ trash = false, quotaExceeded = false }: { trash?: boolean; quotaExceeded?: boolean }) {
  return <RequireSession>{(session) => <FileBrowserSession session={session} trash={trash} quotaExceeded={quotaExceeded} />}</RequireSession>;
}

function FileBrowserSession({ session, trash, quotaExceeded }: { session: Session; trash: boolean; quotaExceeded: boolean }) {
  const params = useParams<{ folderId?: string }>();
  const router = useRouter();
  const { signOut, failSession } = useSession();
  const folderId = params.folderId;
  const [query, setQuery] = useState("");
  const [folderName, setFolderName] = useState("");
  const [showCreateFolder, setShowCreateFolder] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const [notice, setNotice] = useState("");
  const [selectedFile, setSelectedFile] = useState<FileMetadata | null>(null);
  const pendingUpload = useRef<{ fingerprint: string; key: string } | null>(null);
  const token = session.accessToken;

  const fetchData = useCallback(async (signal: AbortSignal): Promise<BrowserData> => {
    const root = await listFolders(token, { signal });
    const targetFolderId = folderId ?? root.drive.rootFolderId;
    const [contents, dashboard] = await Promise.all([
      getFolderItems(targetFolderId, token, { signal }),
      getDashboard(token, { signal }),
    ]);
    return {
      driveName: root.drive.name,
      rootFolderId: root.drive.rootFolderId,
      folder: contents.folder,
      folders: contents.folders,
      files: contents.files,
      dashboard,
    };
  }, [folderId, token]);

  const { state, reload } = useLoad(fetchData, !trash, LOAD_ERROR);
  const data = state.status === "ready" ? state.data : null;
  const filteredFolders = useMemo(() => data?.folders.filter((item) => item.name.toLowerCase().includes(query.toLowerCase())) ?? [], [data, query]);
  const filteredFiles = useMemo(() => data?.files.filter((item) => item.name.toLowerCase().includes(query.toLowerCase())) ?? [], [data, query]);
  const plan = data?.dashboard.plan;
  const usedBytes = data?.dashboard.storageUsedBytes ?? 0;
  const limitBytes = data?.dashboard.storageLimitBytes ?? 0;
  const percent = usagePercent(usedBytes, limitBytes);
  const atLimit = limitBytes > 0 && usedBytes >= limitBytes;
  const parentFolderId = data?.folder.parentFolderId;
  const parentHref = parentFolderId && data && parentFolderId !== data.rootFolderId
    ? `/archivos/${encodeURIComponent(parentFolderId)}`
    : "/archivos";

  async function createFolderSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!data) return;
    const name = folderName.trim();
    if (name.length < 1) { setActionError("Escribe un nombre para la carpeta."); return; }
    setBusy(true); setActionError(""); setNotice("");
    try {
      await createFolder({ name, parentFolderId: data.folder.id }, token);
      setShowCreateFolder(false);
      setFolderName("");
      setNotice(`Se creó la carpeta «${name}».`);
      reload();
    } catch (error) {
      if (!failSession(error)) setActionError(errorMessage(error, "No fue posible crear la carpeta."));
    } finally { setBusy(false); }
  }

  async function uploadSelected(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !data) return;
    const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
    if (file.size > MAX_FILE_BYTES) { setActionError("El archivo supera el límite de 100 MB."); return; }
    if (!ALLOWED_EXTENSIONS.has(extension)) { setActionError("Tipo no permitido. Se admiten PDF, DOCX, XLSX, PPTX, JPG, PNG, TXT y ZIP."); return; }
    if (!plan || limitBytes === 0) { setActionError("Tu organización no tiene una suscripción activa; no puede cargar archivos."); return; }
    if (usedBytes + file.size > limitBytes) { setActionError("La cuota disponible no alcanza para este archivo. Las versiones anteriores y la papelera también ocupan espacio."); return; }

    setBusy(true); setActionError(""); setNotice("");
    try {
      const fingerprint = `${file.name}:${file.size}:${file.lastModified}`;
      const idempotencyKey = pendingUpload.current?.fingerprint === fingerprint
        ? pendingUpload.current.key
        : crypto.randomUUID();
      pendingUpload.current = { fingerprint, key: idempotencyKey };
      await uploadFile(data.folder.id, file, token, idempotencyKey);
      pendingUpload.current = null;
      setNotice(`Se subió «${file.name}».`);
      reload();
    } catch (error) {
      if (!failSession(error)) setActionError(errorMessage(error, "No fue posible subir el archivo."));
    } finally { setBusy(false); }
  }

  async function downloadSelected(file: FileMetadata) {
    setBusy(true); setActionError("");
    try {
      const result = await downloadFile(file.id, token);
      const url = URL.createObjectURL(result.blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = result.filename || file.name;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      if (!failSession(error)) setActionError(errorMessage(error, "No fue posible descargar el archivo."));
    } finally { setBusy(false); }
  }

  if (trash) {
    return <main className="drive-shell"><section className="drive-content" style={{ padding: 32 }}><h1>Papelera</h1><p>La API de consulta, restauración y eliminación definitiva de la papelera aún no está incluida en el contrato v0.3. No se muestran datos de demostración.</p><Link href="/archivos">Volver a Mis archivos</Link></section></main>;
  }

  const displayName = data?.folder.name ?? "Mis archivos";
  const isRoot = !folderId;
  const visibleItemsCount = filteredFolders.length + filteredFiles.length;

  return <div className="drive-shell">
    <aside className="drive-sidebar">
      <Link className="drive-logo" href="/dashboard" aria-label="Nexus, ir al dashboard"><Brand /></Link>
      <button className="drive-upload-main" type="button" onClick={() => document.getElementById("drive-upload-input")?.click()} disabled={busy || !plan}><UiIcon name="upload" size={18} /><span>Subir archivo</span></button>
      <input id="drive-upload-input" type="file" hidden accept=".pdf,.docx,.xlsx,.pptx,.jpg,.png,.txt,.zip" onChange={uploadSelected} />
      <nav className="drive-nav" aria-label="Navegación de archivos">
        <span className="drive-nav-section">MI ESPACIO</span>
        <Link href="/archivos" aria-current={isRoot ? "page" : undefined}><UiIcon name="files" />Todos los archivos</Link>
        <span className="drive-nav-section drive-nav-section-spaced">ORGANIZACIÓN</span>
        <Link href="/papelera"><UiIcon name="trash" />Papelera</Link>
      </nav>
      <div className="drive-sidebar-bottom">
        <Link href="/configuracion"><UiIcon name="settings" size={15} />Configuración</Link>
        <Link href="/perfil"><UiIcon name="user" size={15} />Mi perfil</Link>
        <button type="button" onClick={async () => { await signOut(); router.push("/login"); }}><UiIcon name="logout" size={15} />Cerrar sesión</button>
        <div className="drive-quota-card"><div><b>{plan?.name ?? "Sin plan"}</b><span>{formatBytes(usedBytes)} de {limitBytes ? formatBytes(limitBytes) : "0 B"}</span></div><div className="drive-quota-track"><i style={{ width: `${percent}%` }} /></div></div>
      </div>
    </aside>

    <main className="drive-main">
      <header className="drive-topbar"><div><span className="drive-mobile-brand">Nexus</span><span className="drive-breadcrumb-label">{data?.driveName ?? "Mi espacio"} <i>/</i> {displayName}</span></div><div className="drive-top-tools"><Link className="drive-upgrade" href="/planes">Ver planes</Link><span className="drive-user-avatar">{initialsOf(session.user.fullName)}</span><span className="drive-user-name">{session.user.fullName}</span></div></header>
      <div className={`drive-workspace${selectedFile ? " has-detail" : ""}`}>
        <section className="drive-content">
          <div className="drive-title-row"><div><p className="drive-eyebrow">DRIVE PERSONAL</p><h1>{displayName}</h1><p>{data?.folder?.sizeBytes !== undefined ? `${formatBytes(data.folder.sizeBytes)} en total · Carpetas y archivos guardados en Nexus.` : "Carpetas y archivos guardados en Nexus."}</p></div><button className="drive-create-button" type="button" onClick={() => { setShowCreateFolder(true); setActionError(""); }} disabled={!data || busy}><UiIcon name="plus" size={15} />Crear carpeta</button></div>

          {plan && limitBytes > 0 && <section className="drive-storage-summary"><div className="drive-storage-head"><div><span className="drive-storage-icon"><UiIcon name="storage" size={16} /></span><span><b>Almacenamiento</b><small>{percent}% utilizado</small></span></div><b>{formatBytes(usedBytes)} <small>de {formatBytes(limitBytes)}</small></b></div><div className={`drive-storage-bar ${atLimit ? "is-full" : ""}`}><i style={{ width: `${percent}%` }} /></div><div className="drive-storage-foot"><span>{formatBytes(Math.max(0, limitBytes - usedBytes))} disponibles</span><Link href="/suscripcion">Administrar plan</Link></div></section>}
          {!plan && data && <section className="drive-quota-alert"><span>!</span><div><b>No hay una suscripción activa</b><p>La cuota es cero hasta que la organización tenga un plan.</p></div><Link href="/planes">Ver planes</Link></section>}
          {(quotaExceeded || atLimit) && <section className="drive-quota-alert"><span>!</span><div><b>Almacenamiento completo</b><p>Libera espacio o cambia a un plan con mayor capacidad para subir archivos.</p></div><Link href="/planes">Ver planes</Link></section>}
          {actionError && <div className="drive-quota-alert" role="alert"><span>!</span><div><b>No se pudo completar la operación</b><p>{actionError}</p></div><button type="button" className="drive-subtle-button" onClick={() => setActionError("")}>Cerrar</button></div>}
          {notice && <div className="drive-notice" role="status">{notice}<button type="button" onClick={() => setNotice("")} aria-label="Cerrar aviso">×</button></div>}

          <div className="drive-toolbar"><label className="drive-search"><span aria-hidden="true">⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar en esta carpeta" /></label><button className="drive-upload-button" type="button" onClick={() => document.getElementById("drive-upload-input")?.click()} disabled={busy || !plan}><UiIcon name="upload" size={15} /><span>{busy ? "Procesando…" : "Subir archivo"}</span></button></div>

          {data && !isRoot && <div className="drive-crumbs"><Link href={parentHref}>Mi espacio</Link><span>/</span><b>{data.folder.name}</b></div>}
          {state.status === "loading" && <div className="drive-empty-state" role="status"><b>Cargando archivos…</b></div>}
          {state.status === "error" && <div className="drive-empty-state" role="alert"><b>No se pudieron cargar los archivos</b><p>{state.message}</p><button className="drive-empty-button" type="button" onClick={reload}>Reintentar</button></div>}

          {data && <div className="drive-list-card">
            <div className="drive-list-head"><span>Nombre</span><span>Tipo</span><span>Tamaño</span><span>Modificado</span><span>Acciones</span></div>
            {filteredFolders.map((folder) => <div className="drive-list-row" key={`folder-${folder.id}`}><Link className="drive-item-name" href={`/archivos/${encodeURIComponent(folder.id)}`}><span className="drive-folder-glyph"><UiIcon name="folder" size={17} /></span><b>{folder.name}</b></Link><span>Carpeta</span><span>{formatBytes(folder.sizeBytes ?? 0)}</span><span>{formatIsoDate(folder.createdAt)}</span><span className="drive-row-actions"><Link href={`/archivos/${encodeURIComponent(folder.id)}`}>Abrir</Link></span></div>)}
            {filteredFiles.map((file) => <div className={`drive-list-row ${selectedFile?.id === file.id ? "selected" : ""}`} key={`file-${file.id}`}><button className="drive-item-name drive-item-button" type="button" onClick={() => setSelectedFile(file)}><FileGlyph name={file.name} /><b>{file.name}</b></button><span>{file.mimeType || extensionOf(file.name)}</span><span>{formatBytes(file.sizeBytes)}</span><span>{formatIsoDate(file.uploadedAt)}</span><span className="drive-row-actions"><button type="button" onClick={() => downloadSelected(file)} disabled={busy}>Descargar</button></span></div>)}
            {visibleItemsCount === 0 && <div className="drive-empty-state"><span><UiIcon name="files" size={20} /></span><b>{query ? "No encontramos coincidencias" : "Esta carpeta está vacía"}</b><p>{query ? "Prueba con otro término de búsqueda." : "Crea una carpeta o sube un archivo para empezar."}</p>{!query && <button className="drive-empty-button" type="button" onClick={() => setShowCreateFolder(true)}>Crear carpeta</button>}</div>}
          </div>}

          <p className="drive-demo-note">Los archivos y carpetas mostrados vienen de la API de Nexus.</p>
        </section>

        {selectedFile && <aside className="drive-detail-panel"><button className="drive-detail-close" type="button" onClick={() => setSelectedFile(null)} aria-label="Cerrar detalles">×</button><div className="drive-preview"><FileGlyph name={selectedFile.name} /><span>Metadatos del archivo</span></div><div className="drive-detail-name"><FileGlyph name={selectedFile.name} /><div><b>{selectedFile.name}</b><small>{selectedFile.mimeType}</small></div></div><dl className="drive-detail-list"><dt>Tamaño</dt><dd>{formatBytes(selectedFile.sizeBytes)}</dd><dt>Versión</dt><dd>{selectedFile.versionId}</dd><dt>Subido</dt><dd>{formatIsoDate(selectedFile.uploadedAt)}</dd></dl><div className="drive-detail-actions"><button className="drive-primary-button" type="button" onClick={() => downloadSelected(selectedFile)} disabled={busy}>Descargar</button></div></aside>}
      </div>
    </main>

    {showCreateFolder && <div className="drive-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setShowCreateFolder(false); }}><section className="drive-modal" role="dialog" aria-modal="true" aria-labelledby="create-folder-title"><button className="drive-modal-close" type="button" onClick={() => setShowCreateFolder(false)} aria-label="Cerrar">×</button><span className="drive-modal-icon"><UiIcon name="folder" size={20} /></span><h2 id="create-folder-title">Crear carpeta</h2><p>Se creará dentro de <b>{data?.folder.name}</b>.</p><form onSubmit={createFolderSubmit}><label className="drive-form-label" htmlFor="folder-name">Nombre de la carpeta</label><input className="drive-modal-input" id="folder-name" autoFocus value={folderName} onChange={(event) => { setFolderName(event.target.value); setActionError(""); }} maxLength={255} required />{actionError && <span className="drive-form-error" role="alert">{actionError}</span>}<div className="drive-modal-actions"><button type="button" className="drive-subtle-button" onClick={() => setShowCreateFolder(false)} disabled={busy}>Cancelar</button><button className="drive-primary-button" type="submit" disabled={busy}>{busy ? "Creando…" : "Crear carpeta"}</button></div></form></section></div>}
  </div>;
}
