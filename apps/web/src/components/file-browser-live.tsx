"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { type ChangeEvent, type FormEvent, type DragEvent, useCallback, useMemo, useRef, useState } from "react";
import { ApiError } from "@/lib/api/client";
import { getDashboard } from "@/lib/api/dashboard";
import { createFolder, deleteFile, deleteFolder, downloadFile, getFolderItems, listFolders, uploadFile } from "@/lib/api/files";
import { getStoragePolicy } from "@/lib/api/storage";
import type { DashboardResponse, FileMetadata, Folder, StoragePolicy } from "@/lib/api/types";
import { formatBytes, formatIsoDate, usagePercent } from "@/lib/format";
import { locationLabel, storageErrorMessage } from "@/lib/storage-labels";
import { useLoad } from "@/lib/use-load";
import { RequireSession, useSession, type Session } from "@/lib/session";
import { Brand } from "@/components/brand";
import { Dialog } from "@/components/dialog";
import { FileVersionsModal } from "@/components/file-versions-modal";
import { AccountMenu } from "@/components/account-menu";
import { LoadingIndicator, useToast } from "@/components/toast";
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
  /** SPEC-804: política de almacenamiento. Null si no se pudo cargar: el explorador sigue funcionando. */
  policy: StoragePolicy | null;
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

/** SPEC-804: los 422 al crear carpeta son de destino (no de cuota), así que se explican con storageErrorMessage. */
function createFolderErrorMessage(error: unknown) {
  const fallback = "No fue posible crear la carpeta.";
  if (error instanceof ApiError && error.code === "FOLDER_NAME_CONFLICT") return error.message;
  if (error instanceof ApiError && error.status === 422) return storageErrorMessage(error, fallback);
  return errorMessage(error, fallback);
}

function extensionOf(name: string) {
  return name.split(".").pop()?.toUpperCase() || "FILE";
}

const fileIcons = new Map([
  ["PDF", "filePdf"], ["DOCX", "fileWord"], ["XLSX", "fileSpreadsheet"], ["PPTX", "fileSlides"],
  ["JPG", "fileImage"], ["PNG", "fileImage"], ["TXT", "fileText"], ["ZIP", "fileZip"],
]);

function FileTypeIcon({ name }: { name: string }) {
  return <span className="drive-file-icon"><UiIcon name={fileIcons.get(extensionOf(name)) ?? "fileGeneric"} /></span>;
}

export function FileBrowserLive({ quotaExceeded = false }: { quotaExceeded?: boolean }) {
  return <RequireSession>{(session) => <FileBrowserSession session={session} quotaExceeded={quotaExceeded} />}</RequireSession>;
}

function FileBrowserSession({ session, quotaExceeded }: { session: Session; quotaExceeded: boolean }) {
  const params = useParams<{ folderId?: string }>();
  const router = useRouter();
  const { signOut, failSession } = useSession();
  const folderId = params.folderId;
  const [query, setQuery] = useState("");
  const [folderName, setFolderName] = useState("");
  const [newFolderDestination, setNewFolderDestination] = useState("");
  const [showCreateFolder, setShowCreateFolder] = useState(false);
  const [folderDeleteTarget, setFolderDeleteTarget] = useState<Folder | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const notify = useToast();
  const [dragging, setDragging] = useState(false);
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null);
  const dragDepth = useRef(0);
  const uploadInProgress = useRef(false);
  const [selectedFile, setSelectedFile] = useState<FileMetadata | null>(null);
  const [versionsTarget, setVersionsTarget] = useState<FileMetadata | null>(null);
  const pendingUploads = useRef(new Map<string, string>());
  const token = session.accessToken;

  const fetchData = useCallback(async (signal: AbortSignal): Promise<BrowserData> => {
    const root = await listFolders(token, { signal });
    const targetFolderId = folderId ?? root.drive.rootFolderId;
    // SPEC-804: la política es informativa para el explorador; si falla, la pantalla carga igual sin selector.
    const [contents, dashboard, policy] = await Promise.all([
      getFolderItems(targetFolderId, token, { signal }),
      getDashboard(token, { signal }),
      getStoragePolicy(token, { signal }).catch(() => null),
    ]);
    return {
      driveName: root.drive.name,
      rootFolderId: root.drive.rootFolderId,
      folder: contents.folder,
      folders: contents.folders,
      files: contents.files,
      dashboard,
      policy,
    };
  }, [folderId, token]);

  const { state, reload } = useLoad(fetchData, true, LOAD_ERROR);
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

  // SPEC-804 escenario 4: en un modelo híbrido, una carpeta principal debe elegir Nube o Local. Las subcarpetas no muestran selector.
  const creatingInRoot = Boolean(data && data.folder.id === data.rootFolderId);
  const needsDestinationChoice = creatingInRoot && data?.policy?.model === "hybrid";

  async function createFolderSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!data) return;
    const name = folderName.trim();
    if (name.length < 1) { setActionError("Escribe un nombre para la carpeta."); return; }
    if (needsDestinationChoice && !newFolderDestination) { setActionError("Elige dónde se guardará la carpeta."); return; }
    setBusy(true); setActionError("");
    try {
      await createFolder({
        name,
        parentFolderId: data.folder.id,
        ...(needsDestinationChoice ? { destinationId: newFolderDestination } : {}),
      }, token);
      setShowCreateFolder(false);
      setFolderName("");
      setNewFolderDestination("");
      notify("success", "Carpeta creada.");
      reload();
    } catch (error) {
      if (!failSession(error)) setActionError(createFolderErrorMessage(error));
    } finally { setBusy(false); }
  }

  const canUpload = Boolean(data && data.folder.id === (folderId ?? data.rootFolderId) && plan && limitBytes > 0 && !busy && !showCreateFolder && !folderDeleteTarget);

  async function uploadOne(file: File, targetId: string, availableBytes: number) {
    const extension = file.name.includes(".") ? file.name.split(".").pop()?.toLowerCase() : "";
    if (file.size > MAX_FILE_BYTES) return "El archivo supera el límite de 100 MB.";
    if (!extension || !ALLOWED_EXTENSIONS.has(extension)) return "Tipo no permitido. Se admiten PDF, DOCX, XLSX, PPTX, JPG, PNG, TXT y ZIP.";

    const fingerprint = JSON.stringify([targetId, file.name, file.size, file.lastModified]);
    const pendingKey = pendingUploads.current.get(fingerprint);
    // La API puede haber guardado el archivo aunque se haya perdido la respuesta.
    if (!pendingKey && file.size > availableBytes) return "La cuota disponible no alcanza para este archivo. Las versiones anteriores y la papelera también ocupan espacio.";

    const idempotencyKey = pendingKey ?? crypto.randomUUID();
    pendingUploads.current.set(fingerprint, idempotencyKey);
    await uploadFile(targetId, file, token, idempotencyKey);
    pendingUploads.current.delete(fingerprint);
  }

  async function uploadFiles(files: File[]) {
    if (!data || !canUpload || uploadInProgress.current || files.length === 0) return;
    uploadInProgress.current = true;
    setBusy(true);
    setActionError("");
    let uploaded = false;
    let availableBytes = limitBytes - usedBytes;
    try {
      for (const [index, file] of files.entries()) {
        const current = index + 1;
        const label = `Archivo ${current} de ${files.length}`;
        setProgress({ current, total: files.length });
        try {
          const validationError = await uploadOne(file, data.folder.id, availableBytes);
          if (validationError) {
            notify("error", `${label}. ${validationError}`);
            continue;
          }
          availableBytes -= file.size;
          uploaded = true;
          notify("success", `${label} subido.`);
        } catch (error) {
          if (failSession(error)) {
            notify("error", `${label}. La sesión venció y se detuvo la carga.`);
            break;
          }
          notify("error", `${label}. ${errorMessage(error, "No fue posible subir el archivo.")}`);
        }
      }
    } finally {
      uploadInProgress.current = false;
      setProgress(null);
      setBusy(false);
      if (uploaded) reload();
    }
  }

  function uploadSelected(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.currentTarget.files ?? []);
    event.currentTarget.value = "";
    void uploadFiles(files);
  }

  function dragEnter(event: DragEvent<HTMLElement>) {
    if (!event.dataTransfer.types.includes("Files")) return;
    event.preventDefault();
    dragDepth.current++;
    if (canUpload) setDragging(true);
  }

  function dragOver(event: DragEvent<HTMLElement>) {
    if (!event.dataTransfer.types.includes("Files")) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = canUpload ? "copy" : "none";
  }

  function dragLeave(event: DragEvent<HTMLElement>) {
    if (!event.dataTransfer.types.includes("Files")) return;
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragging(false);
  }

  function dropFiles(event: DragEvent<HTMLElement>) {
    if (!event.dataTransfer.types.includes("Files")) return;
    event.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    if (!canUpload) return;
    const { items, files } = event.dataTransfer;
    const fileItems = Array.from(items).filter((item) => item.kind === "file");
    if (fileItems.length === 0) {
      void uploadFiles(Array.from(files));
      return;
    }

    const droppedFiles: File[] = [];
    for (const item of fileItems) {
      if (item.webkitGetAsEntry?.()?.isDirectory) {
        notify("error", "Selecciona archivos individuales para subir.");
        continue;
      }
      const file = item.getAsFile();
      if (file) droppedFiles.push(file);
    }
    void uploadFiles(droppedFiles);
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
      if (!failSession(error)) notify("error", errorMessage(error, "No fue posible descargar el archivo."));
    } finally { setBusy(false); }
  }

  /** SPEC-205 T2: borrado lógico. El archivo sale de la lista y el aviso enlaza con la papelera. */
  async function deleteSelected(file: FileMetadata) {
    setBusy(true); setActionError("");
    try {
      await deleteFile(file.id, token);
      setSelectedFile((current) => (current?.id === file.id ? null : current));
      notify("success", <>Archivo movido a la papelera. <Link href="/papelera">Ver papelera</Link></>);
      reload();
    } catch (error) {
      if (!failSession(error)) notify("error", errorMessage(error, "No fue posible mover el archivo a la papelera."));
    } finally { setBusy(false); }
  }

  async function deleteFolderSelected(folder: Folder) {
    setBusy(true); setActionError("");
    try {
      await deleteFolder(folder.id, token);
      setFolderDeleteTarget(null);
      notify("success", <>La carpeta y su contenido se movieron a la papelera. <Link href="/papelera">Ver papelera</Link></>);
      reload();
    } catch (error) {
      if (!failSession(error)) notify("error", errorMessage(error, "No fue posible mover la carpeta a la papelera."));
    } finally { setBusy(false); }
  }

  const displayName = data?.folder.name ?? "Mis archivos";
  const isRoot = !folderId;
  const visibleItemsCount = filteredFolders.length + filteredFiles.length;

  return <div className="drive-shell">
    <aside className="drive-sidebar">
      <Link className="drive-logo" href="/dashboard" aria-label="Nexus, ir al dashboard"><Brand /></Link>
      <button className="drive-upload-main" type="button" onClick={() => document.getElementById("drive-upload-input")?.click()} disabled={!canUpload} aria-label="Subir archivo"><UiIcon name="upload" size={18} /><span>Subir archivo</span></button>
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
      <header className="drive-topbar"><div><span className="drive-mobile-brand">Nexus</span><span className="drive-breadcrumb-label">{data?.driveName ?? "Mi espacio"} <i>/</i> {displayName}</span></div><div className="drive-top-tools"><Link className="drive-upgrade" href="/planes">Ver planes</Link><AccountMenu name={session.user.fullName} email={session.user.email} /></div></header>
      <div className={`drive-workspace${selectedFile ? " has-detail" : ""}`}>
        <section
          className={`drive-content${dragging && canUpload ? " drive-drop-active" : ""}`}
          onDragEnter={dragEnter} onDragOver={dragOver} onDragLeave={dragLeave} onDrop={dropFiles}
        >
          {dragging && canUpload && <div className="drive-drop-hint" role="status">Suelta para subir a {displayName}</div>}
          {progress && <LoadingIndicator>Subiendo {progress.current} de {progress.total}…</LoadingIndicator>}
          <div className="drive-title-row"><div><p className="drive-eyebrow">DRIVE PERSONAL</p><h1>{displayName}</h1><p>{data?.folder?.sizeBytes !== undefined ? `${formatBytes(data.folder.sizeBytes)} en total · Carpetas y archivos guardados en Nexus.` : "Carpetas y archivos guardados en Nexus."}</p></div><button className="drive-create-button" type="button" onClick={() => { setShowCreateFolder(true); setActionError(""); }} disabled={!data || busy}><UiIcon name="plus" size={15} />Crear carpeta</button></div>

          {plan && limitBytes > 0 && <section className="drive-storage-summary"><div className="drive-storage-head"><div><span className="drive-storage-icon"><UiIcon name="storage" size={16} /></span><span><b>Almacenamiento</b><small>{percent}% utilizado</small></span></div><b>{formatBytes(usedBytes)} <small>de {formatBytes(limitBytes)}</small></b></div><div className={`drive-storage-bar ${atLimit ? "is-full" : ""}`}><i style={{ width: `${percent}%` }} /></div><div className="drive-storage-foot"><span>{formatBytes(Math.max(0, limitBytes - usedBytes))} disponibles</span><Link href="/suscripcion">Administrar plan</Link></div></section>}
          {!plan && data && <section className="drive-quota-alert"><span>!</span><div><b>No hay una suscripción activa</b><p>La cuota es cero hasta que la organización tenga un plan.</p></div><Link href="/planes">Ver planes</Link></section>}
          {(quotaExceeded || atLimit) && <section className="drive-quota-alert"><span>!</span><div><b>Almacenamiento completo</b><p>Libera espacio o cambia a un plan con mayor capacidad para subir archivos.</p></div><Link href="/planes">Ver planes</Link></section>}
          {actionError && <div className="drive-quota-alert" role="alert"><span>!</span><div><b>No se pudo completar la operación</b><p>{actionError}</p></div><button type="button" className="drive-subtle-button" onClick={() => setActionError("")}>Cerrar</button></div>}

          <div className="drive-toolbar"><label className="drive-search"><span aria-hidden="true">⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar en esta carpeta" /></label><button className="drive-upload-button" type="button" onClick={() => document.getElementById("drive-upload-input")?.click()} disabled={!canUpload} aria-label="Subir archivo"><UiIcon name="upload" size={15} /><span>{busy ? "Procesando…" : "Subir archivo"}</span></button></div>

          {data && !isRoot && <div className="drive-crumbs"><Link href={parentHref}>Mi espacio</Link><span>/</span><b>{data.folder.name}</b></div>}
          {state.status === "loading" && <LoadingIndicator>Cargando archivos…</LoadingIndicator>}
          {state.status === "error" && <div className="drive-empty-state" role="alert"><b>No se pudieron cargar los archivos</b><p>{state.message}</p><button className="drive-empty-button" type="button" onClick={reload}>Reintentar</button></div>}

          {data && <div className="drive-list-card">
            <div className="drive-list-head"><span>Nombre</span><span>Tipo</span><span>Tamaño</span><span>Modificado</span><span>Acciones</span></div>
            {filteredFolders.map((folder) => <div className="drive-list-row" key={`folder-${folder.id}`}><Link className="drive-item-name" href={`/archivos/${encodeURIComponent(folder.id)}`}><span className="drive-folder-glyph"><UiIcon name="folder" size={17} /></span><b>{folder.name}</b>{folder.destinationLocation && <span className={`location-badge ${folder.destinationLocation === "cloud" ? "location-badge-cloud" : "location-badge-local"}`}>{locationLabel(folder.destinationLocation)}</span>}</Link><span>Carpeta</span><span>{formatBytes(folder.sizeBytes ?? 0)}</span><span>{formatIsoDate(folder.createdAt)}</span><span className="drive-row-actions"><Link href={`/archivos/${encodeURIComponent(folder.id)}`}>Abrir</Link><button className="folder-trash-button" type="button" onClick={() => setFolderDeleteTarget(folder)} disabled={busy} aria-label={`Mover carpeta y contenido a la papelera: ${folder.name}`} title="Mover carpeta y contenido a la papelera"><UiIcon name="trash" size={15} /></button></span></div>)}
            {filteredFiles.map((file) => <div className={`drive-list-row ${selectedFile?.id === file.id ? "selected" : ""}`} key={`file-${file.id}`}><button className="drive-item-name drive-item-button" type="button" onClick={() => setSelectedFile(file)}><FileTypeIcon name={file.name} /><b>{file.name}</b></button><span>{file.mimeType || extensionOf(file.name)}</span><span>{formatBytes(file.sizeBytes)}</span><span>{formatIsoDate(file.uploadedAt)}</span><span className="drive-row-actions"><button type="button" onClick={() => downloadSelected(file)} disabled={busy}>Descargar</button><button type="button" onClick={() => setVersionsTarget(file)} disabled={busy} aria-label={`Versiones de «${file.name}»`}>Versiones</button><button type="button" onClick={() => deleteSelected(file)} disabled={busy} aria-label={`Mover a la papelera «${file.name}»`}>Mover a papelera</button></span></div>)}
            {visibleItemsCount === 0 && <div className="drive-empty-state"><span><UiIcon name="files" size={20} /></span><b>{query ? "No encontramos coincidencias" : "Esta carpeta está vacía"}</b><p>{query ? "Prueba con otro término de búsqueda." : "Crea una carpeta o sube un archivo para empezar."}</p>{!query && <button className="drive-empty-button" type="button" onClick={() => setShowCreateFolder(true)}>Crear carpeta</button>}</div>}
          </div>}

          <p className="drive-demo-note">Los archivos y carpetas mostrados vienen de la API de Nexus.</p>
        </section>

        {selectedFile && <aside className="drive-detail-panel"><button className="drive-detail-close" type="button" onClick={() => setSelectedFile(null)} aria-label="Cerrar detalles">×</button><div className="drive-preview"><FileTypeIcon name={selectedFile.name} /><span>Metadatos del archivo</span></div><div className="drive-detail-name"><FileTypeIcon name={selectedFile.name} /><div><b>{selectedFile.name}</b><small>{selectedFile.mimeType}</small></div></div><dl className="drive-detail-list"><dt>Tamaño</dt><dd>{formatBytes(selectedFile.sizeBytes)}</dd><dt>Versión</dt><dd>{selectedFile.versionId}</dd><dt>Subido</dt><dd>{formatIsoDate(selectedFile.uploadedAt)}</dd></dl><div className="drive-detail-actions"><button className="drive-primary-button" type="button" onClick={() => downloadSelected(selectedFile)} disabled={busy}>Descargar</button><button className="drive-subtle-button" type="button" onClick={() => setVersionsTarget(selectedFile)} disabled={busy}>Versiones</button><button className="drive-subtle-button" type="button" onClick={() => deleteSelected(selectedFile)} disabled={busy}>Mover a papelera</button></div></aside>}
      </div>
    </main>

    {folderDeleteTarget && <Dialog labelledBy="delete-folder-title" onClose={() => setFolderDeleteTarget(null)} disabled={busy}><span className="drive-modal-icon folder-trash-modal-icon"><UiIcon name="trash" size={20} /></span><h2 id="delete-folder-title">¿Mover «{folderDeleteTarget.name}» a la papelera?</h2><p>La carpeta, sus subcarpetas y todos sus archivos se moverán juntos. Desde la papelera podrás restaurarlos o eliminarlos definitivamente.</p><div className="drive-modal-actions"><button type="button" className="drive-subtle-button" onClick={() => setFolderDeleteTarget(null)}>Cancelar</button><button type="button" className="drive-primary-button folder-delete-confirm" onClick={() => deleteFolderSelected(folderDeleteTarget)} disabled={busy}>{busy ? "Moviendo…" : "Mover a papelera"}</button></div></Dialog>}
    {versionsTarget && <FileVersionsModal file={versionsTarget} token={token} onClose={() => setVersionsTarget(null)} onRestored={reload} />}
    {showCreateFolder &&  <div className="drive-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setShowCreateFolder(false); }}><section className="drive-modal" role="dialog" aria-modal="true" aria-labelledby="create-folder-title"><button className="drive-modal-close" type="button" onClick={() => setShowCreateFolder(false)} aria-label="Cerrar">×</button><span className="drive-modal-icon"><UiIcon name="folder" size={20} /></span><h2 id="create-folder-title">Crear carpeta</h2><p>Se creará dentro de <b>{data?.folder.name}</b>.</p><form onSubmit={createFolderSubmit}><label className="drive-form-label" htmlFor="folder-name">Nombre de la carpeta</label><input className="drive-modal-input" id="folder-name" autoFocus value={folderName} onChange={(event) => { setFolderName(event.target.value); setActionError(""); }} maxLength={255} required />{needsDestinationChoice && <><label className="drive-form-label" htmlFor="folder-destination">¿Dónde se guardará?</label><select className="drive-modal-input" id="folder-destination" value={newFolderDestination} onChange={(event) => { setNewFolderDestination(event.target.value); setActionError(""); }} required><option value="" disabled>Elige un destino</option>{data?.policy?.destinations.map((destination) => <option key={destination.id} value={destination.id}>{`${destination.name} · ${locationLabel(destination.location)}`}</option>)}</select></>}{actionError && <span className="drive-form-error" role="alert">{actionError}</span>}<div className="drive-modal-actions"><button type="button" className="drive-subtle-button" onClick={() => setShowCreateFolder(false)} disabled={busy}>Cancelar</button><button className="drive-primary-button" type="submit" disabled={busy || (needsDestinationChoice && !newFolderDestination)}>{busy ? "Creando…" : "Crear carpeta"}</button></div></form></section></div>}
  </div>;
}
