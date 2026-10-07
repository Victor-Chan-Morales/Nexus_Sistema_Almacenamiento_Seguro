"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { DemoFile, DemoState, DEMO_EVENT, DEMO_PLAN_BYTES, formatBytes, readDemo, writeDemo } from "@/lib/demo";
import { Brand } from "@/components/brand";
import { UiIcon } from "@/components/ui-icon";

const allowedExtensions = ["pdf", "docx", "xlsx", "pptx", "jpg", "png", "txt", "zip"];
const maxFileBytes = 100 * 1024 * 1024;
type Dialog = "create-folder" | "upload-progress" | "upload-success" | "upload-error" | "duplicate" | "details" | "versions" | "version-detail" | "download-success" | "download-error" | "trash-confirm" | "delete-success" | null;

function useDemo() {
  const [state, setState] = useState<DemoState | null>(null);
  useEffect(() => { const update = () => setState(readDemo()); update(); window.addEventListener(DEMO_EVENT, update); window.addEventListener("storage", update); return () => { window.removeEventListener(DEMO_EVENT, update); window.removeEventListener("storage", update); }; }, []);
  return state;
}

function FileGlyph({ type }: { type: string }) {
  const label = type.toUpperCase();
  return <span aria-hidden="true" className={`drive-file-glyph glyph-${label.toLowerCase()}`}><span>{label === "DOCX" ? "W" : label === "XLSX" ? "X" : label === "PPTX" ? "P" : label.slice(0, 3)}</span></span>;
}

function storedBytes(file: DemoFile) { return file.versions?.reduce((sum, version) => sum + version.size, 0) ?? file.size; }
function fileVersions(file: DemoFile | undefined) { return file ? file.versions?.length ? file.versions : [{ number: 1, size: file.size, type: file.type, uploadedAt: "Hoy (demostración)" }] : []; }

export function FileBrowser({ trash = false, quotaExceeded = false }: { trash?: boolean; quotaExceeded?: boolean }) {
  const params = useParams<{ folderId?: string }>();
  const router = useRouter();
  const state = useDemo();
  const [query, setQuery] = useState("");
  const [notice, setNotice] = useState("");
  const [dialog, setDialog] = useState<Dialog>(null);
  const [folderName, setFolderName] = useState("");
  const [folderError, setFolderError] = useState("");
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null);
  const [selectedTrashItem, setSelectedTrashItem] = useState<{ id: string; kind: "file" | "folder" } | null>(null);
  const [pendingUpload, setPendingUpload] = useState<File | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadError, setUploadError] = useState("");
  const [simulateDownloadFailure, setSimulateDownloadFailure] = useState(false);
  const [selectedVersion, setSelectedVersion] = useState(1);
  const [gridView, setGridView] = useState(false);
  const uploadTimer = useRef<number | null>(null);

  const folderId = params.folderId ?? "root";
  const folder = state?.folders.find((item) => item.id === folderId);
  const parent = folder?.parentId ? state?.folders.find((item) => item.id === folder.parentId) : null;
  const folders = useMemo(() => state?.folders.filter((item) => item.parentId === folderId && !item.deleted && !trash && item.name.toLowerCase().includes(query.toLowerCase())) ?? [], [state, folderId, trash, query]);
  const files = useMemo(() => state?.files.filter((item) => (trash ? item.deleted : !item.deleted && item.folderId === folderId) && item.name.toLowerCase().includes(query.toLowerCase())) ?? [], [state, folderId, trash, query]);
  const selectedFile = state?.files.find((item) => item.id === selectedFileId);
  const trashedFolders = state?.folders.filter((item) => item.deleted) ?? [];
  const usedBytes = state?.files.reduce((total, item) => total + storedBytes(item), 0) ?? 0;
  const visibleUsedBytes = quotaExceeded ? DEMO_PLAN_BYTES : usedBytes;
  const versionsForDetail = fileVersions(selectedFile);
  const selectedVersionRecord = versionsForDetail.find((item) => item.number === selectedVersion);
  const usedPercent = quotaExceeded ? 100 : Math.min(100, Math.round((usedBytes / DEMO_PLAN_BYTES) * 100));
  const displayFolder = folder?.name ?? "Mi espacio";

  function update(transform: (current: DemoState) => DemoState) { if (state) writeDemo(transform(state)); }
  function openCreateFolder() { setFolderName(""); setFolderError(""); setDialog("create-folder"); }
  function createFolder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = folderName.trim();
    if (!name) { setFolderError("Escribe un nombre para la carpeta."); return; }
    if (/[<>:"/\\|?*]/.test(name)) { setFolderError("El nombre contiene caracteres no permitidos."); return; }
    if (state?.folders.some((item) => item.parentId === folderId && !item.deleted && item.name.toLowerCase() === name.toLowerCase())) { setFolderError("Ya existe una carpeta con ese nombre en esta ubicación."); return; }
    update((current) => ({ ...current, folders: [...current.folders, { id: `folder-${Date.now()}`, name, parentId: folderId }] }));
    setDialog(null); setNotice(`Se creó la carpeta “${name}” en este navegador.`);
  }
  function inspectUpload(file: File) {
    setPendingUpload(file); setUploadError("");
    const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
    if (file.size > maxFileBytes) { setUploadError("El archivo supera el límite inicial de 100 MB."); setDialog("upload-error"); return; }
    if (!allowedExtensions.includes(extension)) { setUploadError(`El tipo .${extension || "desconocido"} no está permitido. Se admiten PDF, DOCX, XLSX, PPTX, JPG, PNG, TXT y ZIP.`); setDialog("upload-error"); return; }
    if (quotaExceeded || usedBytes + file.size > DEMO_PLAN_BYTES) { setUploadError("La cuota de almacenamiento disponible no alcanza para este archivo. Los elementos de la papelera también cuentan para la cuota."); setDialog("upload-error"); return; }
    const duplicate = state?.files.find((item) => !item.deleted && item.folderId === folderId && item.name.toLowerCase() === file.name.toLowerCase());
    if (duplicate) { setSelectedFileId(duplicate.id); setDialog("duplicate"); return; }
    beginUpload(file, false);
  }
  function beginUpload(file: File, asVersion: boolean) {
    setPendingUpload(file); setUploadProgress(8); setDialog("upload-progress");
    let progress = 8;
    uploadTimer.current = window.setInterval(() => {
      progress = Math.min(progress + 23, 100); setUploadProgress(progress);
      if (progress >= 100) {
        if (uploadTimer.current !== null) window.clearInterval(uploadTimer.current);
        uploadTimer.current = null;
        if (asVersion && selectedFileId) {
          update((current) => ({ ...current, files: current.files.map((item) => {
            if (item.id !== selectedFileId) return item;
            const versions = fileVersions(item);
            const type = file.name.split(".").pop()?.toUpperCase() ?? "FILE";
            versions.push({ number: versions.length + 1, size: file.size, type, uploadedAt: "Ahora (demostración)" });
            return { ...item, size: file.size, type, versionCount: versions.length, versions };
          }) }));
        } else {
          const type = file.name.split(".").pop()?.toUpperCase() ?? "FILE";
          const record: DemoFile = { id: `file-${Date.now()}`, name: file.name, folderId, size: file.size, type, versionCount: 1, versions: [{ number: 1, size: file.size, type, uploadedAt: "Ahora (demostración)" }] };
          update((current) => ({ ...current, files: [...current.files, record] }));
        }
        setDialog("upload-success");
      }
    }, 190);
  }
  function upload(event: ChangeEvent<HTMLInputElement>) { const file = event.target.files?.[0]; if (file) inspectUpload(file); event.target.value = ""; }
  function inspectNewVersion(file: File) {
    const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
    if (file.size > maxFileBytes) { setUploadError("La nueva versión supera el límite inicial de 100 MB."); setDialog("upload-error"); return; }
    if (!allowedExtensions.includes(extension)) { setUploadError("El tipo de archivo no está permitido. Se admiten PDF, DOCX, XLSX, PPTX, JPG, PNG, TXT y ZIP."); setDialog("upload-error"); return; }
    if (quotaExceeded || usedBytes + file.size > DEMO_PLAN_BYTES) { setUploadError("La cuota disponible no alcanza para almacenar una nueva versión. Las versiones anteriores también cuentan para la cuota."); setDialog("upload-error"); return; }
    if (selectedFile && selectedFile.name.toLowerCase() !== file.name.toLowerCase()) { setUploadError(`Para crear una versión, selecciona el mismo nombre: ${selectedFile.name}.`); setDialog("upload-error"); return; }
    beginUpload(file, true);
  }
  function moveToTrash(id: string, kind: "file" | "folder") {
    const descendants = new Set<string>([id]);
    if (kind === "folder" && state) { let grew = true; while (grew) { grew = false; state.folders.forEach((item) => { if (item.parentId && descendants.has(item.parentId) && !descendants.has(item.id)) { descendants.add(item.id); grew = true; } }); } }
    update((current) => kind === "file"
      ? { ...current, files: current.files.map((item) => item.id === id ? { ...item, deleted: true } : item) }
      : { ...current, folders: current.folders.map((item) => descendants.has(item.id) ? { ...item, deleted: true } : item), files: current.files.map((item) => descendants.has(item.folderId) ? { ...item, deleted: true } : item) });
    setDialog(null); setNotice("El elemento se movió a la papelera.");
  }
  function restore(id: string, kind: "file" | "folder") {
    const descendants = new Set<string>([id]);
    if (kind === "folder" && state) { let grew = true; while (grew) { grew = false; state.folders.forEach((item) => { if (item.parentId && descendants.has(item.parentId) && !descendants.has(item.id)) { descendants.add(item.id); grew = true; } }); } }
    update((current) => kind === "file"
      ? { ...current, files: current.files.map((item) => item.id === id ? { ...item, deleted: false } : item) }
      : { ...current, folders: current.folders.map((item) => descendants.has(item.id) ? { ...item, deleted: false } : item), files: current.files.map((item) => descendants.has(item.folderId) ? { ...item, deleted: false } : item) });
    setNotice("El elemento se restauró a su ubicación original.");
  }
  function permanentlyDelete() {
    if (!selectedTrashItem) return;
    const target = selectedTrashItem;
    const descendants = new Set<string>([target.id]);
    if (target.kind === "folder" && state) { let grew = true; while (grew) { grew = false; state.folders.forEach((item) => { if (item.parentId && descendants.has(item.parentId) && !descendants.has(item.id)) { descendants.add(item.id); grew = true; } }); } }
    update((current) => target.kind === "file"
      ? { ...current, files: current.files.filter((item) => item.id !== target.id) }
      : { ...current, folders: current.folders.filter((item) => !descendants.has(item.id)), files: current.files.filter((item) => !descendants.has(item.folderId)) });
    setDialog("delete-success"); setSelectedTrashItem(null);
  }
  function download(file: DemoFile, fail = simulateDownloadFailure) {
    if (fail) { setDialog("download-error"); return; }
    const content = `Descarga de demostración de Nexus\nArchivo: ${file.name}\nTamaño registrado: ${formatBytes(file.size)}\n\nEl prototipo no conserva el binario original.`;
    const url = URL.createObjectURL(new Blob([content], { type: "text/plain;charset=utf-8" }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = `${file.name}.demo.txt`; anchor.click(); URL.revokeObjectURL(url); setDialog("download-success");
  }
  const detail = selectedFile;
  const deletedLabel = selectedTrashItem?.kind === "folder" ? trashedFolders.find((item) => item.id === selectedTrashItem.id)?.name : files.find((item) => item.id === selectedTrashItem?.id)?.name;

  return <div className="drive-shell">
    <aside className="drive-sidebar">
      <Link className="drive-logo" href="/dashboard" aria-label="Nexus, ir al dashboard"><Brand /></Link>
      <Link className="drive-upload-main" href="#subir" onClick={(e) => { e.preventDefault(); document.getElementById("drive-upload-input")?.click(); }}><UiIcon name="upload" size={19} /> <span>Subir archivo</span></Link>
      <nav className="drive-nav" aria-label="Navegación de archivos">
        <span className="drive-nav-section">MI ESPACIO</span>
        <Link href="/archivos" aria-current={!trash && folderId === "root" ? "page" : undefined}><UiIcon name="files" />Todos los archivos</Link>
        <Link href="/archivos" aria-current="false"><UiIcon name="recent" />Recientes</Link>
        <Link href="/archivos" aria-current="false"><UiIcon name="shared" />Compartidos conmigo</Link>
        <span className="drive-nav-section drive-nav-section-spaced">ORGANIZACIÓN</span>
        <Link href="/archivos"><UiIcon name="team" />Carpeta de equipo</Link>
        <Link href="/papelera" aria-current={trash ? "page" : undefined}><UiIcon name="trash" />Papelera</Link>
      </nav>
      <div className="drive-sidebar-bottom"><Link href="/configuracion"><UiIcon name="settings" size={15} /> Configuración</Link><Link href="/perfil"><UiIcon name="user" size={15} /> Mi perfil</Link><button type="button" onClick={() => { sessionStorage.removeItem("nexus-demo-session"); router.push("/login"); }}><UiIcon name="logout" size={15} /> Cerrar sesión</button><div className="drive-quota-card"><div><b>{state?.plan ?? "Demo"}</b><span>{formatBytes(usedBytes)} de 5 GB</span></div><div className="drive-quota-track"><i style={{ width: `${usedPercent}%` }} /></div></div></div>
    </aside>
    <main className="drive-main">
      <header className="drive-topbar"><div><span className="drive-mobile-brand">Nexus</span><span className="drive-breadcrumb-label">Principal <i>/</i> {trash ? "Papelera" : "Mi espacio"}</span></div><div className="drive-top-tools"><Link className="drive-upgrade" href="/planes">Mejorar plan</Link><span className="drive-user-avatar">AM</span><span className="drive-user-name">{state?.user.name ?? "Ana Martínez"}</span></div></header>
      <div className={`drive-workspace ${detail && !trash ? "has-detail" : ""}`}>
        <section className="drive-content">
          <div className="drive-title-row"><div><p className="drive-eyebrow">{trash ? "ELEMENTOS ELIMINADOS" : "DRIVE PERSONAL"}</p><h1>{trash ? "Papelera" : folderId === "root" ? "Mi espacio" : displayFolder}</h1><p>{trash ? "Los elementos se conservan durante 30 días. Siguen ocupando espacio hasta su eliminación definitiva." : "Tus carpetas y archivos, organizados en un solo lugar."}</p></div>{!trash && <button className="drive-create-button" onClick={openCreateFolder}><UiIcon name="plus" size={16} /> Crear</button>}</div>
          {!trash && quotaExceeded && <div className="drive-quota-alert" role="alert"><span>!</span><div><b>Has alcanzado el límite de almacenamiento</b><p>Tu espacio está al 100% de su capacidad. Libera espacio o mejora tu plan para seguir subiendo archivos.</p></div><Link href="/planes">Mejorar plan</Link></div>}
          {!trash && <div className="drive-toolbar"><label className="drive-search"><UiIcon name="search" size={17} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar en Mi espacio…" aria-label="Buscar archivos y carpetas" /></label><button className={`drive-toolbar-icon ${gridView ? "is-active" : ""}`} title={gridView ? "Cambiar a vista de lista" : "Cambiar a vista de cuadrícula"} aria-label={gridView ? "Cambiar a vista de lista" : "Cambiar a vista de cuadrícula"} aria-pressed={gridView} onClick={() => setGridView((current) => !current)}><UiIcon name="grid" size={17} /></button><label className={`drive-upload-button ${quotaExceeded ? "is-disabled" : ""}`}><UiIcon name="upload" size={16} /> <span>Subir archivo</span><input id="drive-upload-input" type="file" onChange={upload} disabled={quotaExceeded} hidden /></label></div>}
          {!trash && <div className="drive-storage-summary"><div className="drive-storage-head"><div><span className="drive-storage-icon"><UiIcon name="storage" size={16} /></span><span><b>Almacenamiento</b><small>Plan {state?.plan ?? "Demo"}</small></span></div><b>{formatBytes(visibleUsedBytes)} <small>de 5 GB utilizados{quotaExceeded ? " (100% lleno)" : ""}</small></b></div><div className={`drive-storage-bar ${quotaExceeded ? "is-full" : ""}`}><i style={{ width: `${usedPercent}%` }} /></div><div className="drive-storage-foot"><span>{usedPercent}% utilizado</span><Link href="/suscripcion">Ver plan</Link></div></div>}
          {!trash && <div className="drive-crumbs"><Link href="/archivos">Mi espacio</Link>{parent && <><span>/</span><Link href={parent.id === "root" ? "/archivos" : `/archivos/${parent.id}`}>{parent.name}</Link></>}<span>/</span><b>{folderId === "root" ? "Todos los archivos" : displayFolder}</b></div>}
          {notice && <div className="drive-notice" role="status"><span><UiIcon name="check" size={15} /></span>{notice}<button aria-label="Cerrar aviso" onClick={() => setNotice("")}><UiIcon name="close" size={15} /></button></div>}
          <section className={`drive-list-card ${gridView ? "is-grid-view" : ""}`} aria-label={trash ? "Elementos en la papelera" : "Archivos y carpetas"}>
            <div className="drive-list-head"><span>Nombre</span><span>Tipo</span><span>Tamaño</span><span>Modificado</span><span>Acciones</span></div>
            {folders.map((item) => <div className="drive-list-row" key={item.id}><Link className="drive-item-name" href={`/archivos/${item.id}`}><span className="drive-folder-glyph"><UiIcon name="folder" size={20} /></span><b>{item.name}</b></Link><span>Carpeta</span><span>{formatBytes(state?.files.filter((file) => file.folderId === item.id && !file.deleted).reduce((sum, file) => sum + storedBytes(file), 0) ?? 0)}</span><span>Hoy</span><div className="drive-row-actions"><Link href={`/archivos/${item.id}`} title="Abrir carpeta">Abrir</Link><button title="Mover carpeta a la papelera" onClick={() => { setSelectedTrashItem({ id: item.id, kind: "folder" }); setDialog("trash-confirm"); }}><UiIcon name="more" size={16} /></button></div></div>)}
            {files.map((file) => <div className={`drive-list-row ${selectedFileId === file.id ? "selected" : ""}`} key={file.id}><button className="drive-item-name drive-item-button" onClick={() => { setSelectedFileId(file.id); setDialog("details"); }}><FileGlyph type={file.type} /><b>{file.name}</b></button><span>{file.type}</span><span>{formatBytes(file.size)}</span><span>Hoy</span><div className="drive-row-actions"><button title="Ver detalles" onClick={() => { setSelectedFileId(file.id); setDialog("details"); }}>Detalles</button><button title="Mover archivo a la papelera" onClick={() => { setSelectedTrashItem({ id: file.id, kind: "file" }); setDialog("trash-confirm"); }}>···</button></div></div>)}
            {trash && trashedFolders.map((item) => <div className="drive-list-row" key={item.id}><div className="drive-item-name"><span className="drive-folder-glyph"><UiIcon name="folder" size={20} /></span><b>{item.name}</b></div><span>Carpeta</span><span>—</span><span>Hoy</span><div className="drive-row-actions"><button onClick={() => restore(item.id, "folder")}><UiIcon name="restore" size={14} />Restaurar</button><button aria-label={`Eliminar definitivamente ${item.name}`} onClick={() => { setSelectedTrashItem({ id: item.id, kind: "folder" }); setDialog("trash-confirm"); }}><UiIcon name="more" size={16} /></button></div></div>)}
            {trash && files.map((file) => <div className="drive-list-row" key={file.id}><div className="drive-item-name"><FileGlyph type={file.type} /><b>{file.name}</b></div><span>{file.type}</span><span>{formatBytes(file.size)}</span><span>Hoy</span><div className="drive-row-actions"><button onClick={() => restore(file.id, "file")}>Restaurar</button><button aria-label={`Eliminar definitivamente ${file.name}`} onClick={() => { setSelectedTrashItem({ id: file.id, kind: "file" }); setDialog("trash-confirm"); }}>···</button></div></div>)}
            {folders.length + files.length + (trash ? trashedFolders.length : 0) === 0 && <div className="drive-empty-state"><span><UiIcon name={trash ? "trash" : "files"} size={22} /></span><b>{trash ? "La papelera está vacía" : query ? "No encontramos resultados" : "Esta carpeta está vacía"}</b><p>{trash ? "Los elementos eliminados aparecerán aquí." : query ? "Prueba con otro nombre o término de búsqueda." : "Sube un archivo o crea una carpeta para empezar a organizar tu espacio."}</p>{!trash && !query && <button className="drive-empty-button" onClick={openCreateFolder}><UiIcon name="plus" size={15} /> Crear carpeta</button>}</div>}
          </section>
          <p className="drive-demo-note">Prototipo frontend: las fichas se guardan localmente. El binario, las versiones y las operaciones reales requieren integración con la API y el almacenamiento.</p>
        </section>
        {detail && !trash && <aside className="drive-detail-panel"><button className="drive-detail-close" onClick={() => setSelectedFileId(null)} aria-label="Cerrar detalles"><UiIcon name="close" size={15} /></button><div className="drive-preview"><FileGlyph type={detail.type} /><span>Vista previa no disponible</span></div><div className="drive-detail-name"><FileGlyph type={detail.type} /><div><b>{detail.name}</b><small>{detail.type}</small></div></div><dl className="drive-detail-list"><dt>Guardado en</dt><dd>{state?.folders.find((item) => item.id === detail.folderId)?.name ?? "Mi espacio"}</dd><dt>Tamaño</dt><dd>{formatBytes(detail.size)}</dd><dt>Modificado</dt><dd>Hoy</dd><dt>Tipo</dt><dd>{detail.type}</dd><dt>Subido por</dt><dd>{state?.user.name ?? "Ana Martínez"}</dd></dl><div className="drive-detail-section"><b>Versiones</b><button onClick={() => setDialog("versions")}>v{detail.versionCount ?? 1} <span>Ver historial <UiIcon name="arrowRight" size={14} /></span></button></div><div className="drive-detail-actions"><button className="drive-primary-button" onClick={() => download(detail)}>Descargar</button><button className="drive-subtle-button" onClick={() => { setSelectedTrashItem({ id: detail.id, kind: "file" }); setDialog("trash-confirm"); }}>Mover a papelera</button><label className="drive-subtle-button">Subir nueva versión<input type="file" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) inspectNewVersion(file); event.target.value = ""; }} /></label></div><label className="drive-failure-toggle"><input type="checkbox" checked={simulateDownloadFailure} onChange={(event) => setSimulateDownloadFailure(event.target.checked)} />Simular error de descarga</label></aside>}
      </div>

      {dialog && <div className="drive-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && dialog !== "upload-progress") setDialog(null); }}><section className="drive-modal" role="dialog" aria-modal="true" aria-labelledby="drive-modal-title">
        {dialog === "create-folder" && <><button className="drive-modal-close" onClick={() => setDialog(null)} aria-label="Cerrar"><UiIcon name="close" size={16} /></button><span className="drive-modal-icon"><UiIcon name="folder" size={21} /></span><h2 id="drive-modal-title">Crear carpeta</h2><p>La carpeta se añadirá a <b>{displayFolder}</b>.</p><form onSubmit={createFolder}><label className="drive-form-label" htmlFor="folder-name">Nombre de la carpeta</label><input className="drive-modal-input" id="folder-name" autoFocus value={folderName} onChange={(event) => { setFolderName(event.target.value); setFolderError(""); }} placeholder="Ej. Documentos de proyecto" />{folderError && <span className="drive-form-error" role="alert">{folderError}</span>}<div className="drive-modal-actions"><button type="button" className="drive-subtle-button" onClick={() => setDialog(null)}>Cancelar</button><button className="drive-primary-button" type="submit">Crear carpeta</button></div></form></>}
        {dialog === "upload-progress" && <><span className="drive-modal-icon">⇧</span><h2 id="drive-modal-title">Subiendo archivo</h2><p>{pendingUpload?.name}</p><div className="drive-upload-progress"><i style={{ width: `${uploadProgress}%` }} /></div><div className="drive-progress-label"><span>{uploadProgress}%</span><span>{formatBytes(pendingUpload?.size ?? 0)}</span></div><small className="drive-modal-footnote">Progreso visual de demostración. No se está enviando el contenido a un servidor.</small><button className="drive-simulate-failure" onClick={() => { if (uploadTimer.current !== null) window.clearInterval(uploadTimer.current); uploadTimer.current = null; setUploadError("El destino de almacenamiento rechazó la carga. Comprueba el destino o vuelve a intentarlo."); setDialog("upload-error"); }}>Simular carga fallida</button></>}
        {dialog === "upload-success" && <><span className="drive-modal-icon success"><UiIcon name="check" size={22} /></span><h2 id="drive-modal-title">Carga exitosa</h2><p>La ficha de <b>{pendingUpload?.name}</b> se agregó al espacio en esta demostración.</p><p className="drive-inline-warning">El contenido binario no se ha guardado en MinIO/S3.</p><div className="drive-modal-actions"><button className="drive-primary-button" onClick={() => setDialog(null)}>Listo</button></div></>}
        {dialog === "upload-error" && <><span className="drive-modal-icon error">!</span><h2 id="drive-modal-title">No se pudo cargar el archivo</h2><p>{uploadError}</p><div className="drive-modal-actions"><button className="drive-subtle-button" onClick={() => setDialog(null)}>Cerrar</button><Link className="drive-primary-button" href="/suscripcion">Ver planes</Link></div></>}
        {dialog === "duplicate" && <><span className="drive-modal-icon">↻</span><h2 id="drive-modal-title">Este archivo ya existe</h2><p>“{pendingUpload?.name}” ya está guardado en esta carpeta.</p><p>Según las reglas del proyecto, una carga con el mismo nombre crea una nueva versión del archivo.</p><div className="drive-modal-actions"><button className="drive-subtle-button" onClick={() => setDialog(null)}>Cancelar</button><button className="drive-primary-button" onClick={() => pendingUpload && beginUpload(pendingUpload, true)}>Crear nueva versión</button></div></>}
        {dialog === "details" && detail && <><button className="drive-modal-close" onClick={() => setDialog(null)} aria-label="Cerrar"><UiIcon name="close" size={16} /></button><span className="drive-modal-icon"><FileGlyph type={detail.type} /></span><h2 id="drive-modal-title">Detalle del archivo</h2><p><b>{detail.name}</b></p><dl className="drive-modal-definition"><dt>Tipo</dt><dd>{detail.type}</dd><dt>Tamaño registrado</dt><dd>{formatBytes(detail.size)}</dd><dt>Versiones</dt><dd>{detail.versionCount ?? 1}</dd><dt>Ubicación</dt><dd>{state?.folders.find((item) => item.id === detail.folderId)?.name ?? "Mi espacio"}</dd></dl><div className="drive-modal-actions"><button className="drive-subtle-button" onClick={() => download(detail)}>Descargar</button><button className="drive-primary-button" onClick={() => setDialog("versions")}>Ver versiones</button></div></>}
        {dialog === "versions" && detail && <><button className="drive-modal-close" onClick={() => setDialog(null)} aria-label="Cerrar"><UiIcon name="close" size={16} /></button><span className="drive-modal-icon"><UiIcon name="recent" size={20} /></span><h2 id="drive-modal-title">Historial de versiones</h2><p>{detail.name}</p><div className="drive-version-list">{[...versionsForDetail].reverse().map((version) => <button key={version.number} onClick={() => { setSelectedVersion(version.number); setDialog("version-detail"); }}><span><b>Versión {version.number}{version.number === versionsForDetail.length ? " · Actual" : ""}</b><small>Subida por {state?.user.name ?? "Ana Martínez"} · {version.uploadedAt}</small></span><span>{formatBytes(version.size)} <UiIcon name="arrowRight" size={14} /></span></button>)}</div><small className="drive-modal-footnote">Historial de demostración: los bytes de versiones anteriores no están almacenados.</small></>}
        {dialog === "version-detail" && detail && selectedVersionRecord && <><button className="drive-modal-close" onClick={() => setDialog("versions")} aria-label="Volver">‹</button><span className="drive-modal-icon">◷</span><h2 id="drive-modal-title">Versión {selectedVersion}</h2><p><b>{detail.name}</b> · {selectedVersion === versionsForDetail.length ? "Actual" : "Anterior"}</p><dl className="drive-modal-definition"><dt>Tipo</dt><dd>{selectedVersionRecord.type}</dd><dt>Tamaño registrado</dt><dd>{formatBytes(selectedVersionRecord.size)}</dd><dt>Subido por</dt><dd>{state?.user.name ?? "Ana Martínez"}</dd><dt>Fecha</dt><dd>{selectedVersionRecord.uploadedAt}</dd></dl><div className="drive-modal-actions"><button className="drive-subtle-button" onClick={() => setDialog("versions")}>Volver al historial</button><button className="drive-primary-button" onClick={() => download(detail)}>Descargar versión</button></div></>}
        {dialog === "download-success" && <><span className="drive-modal-icon success"><UiIcon name="arrowDown" size={22} /></span><h2 id="drive-modal-title">Descarga de demostración</h2><p>Se descargó un archivo de texto con los metadatos de <b>{detail?.name}</b>. No es el binario original.</p><div className="drive-modal-actions"><button className="drive-primary-button" onClick={() => setDialog(null)}>Cerrar</button></div></>}
        {dialog === "download-error" && <><span className="drive-modal-icon error">!</span><h2 id="drive-modal-title">Error de descarga</h2><p>No se pudo recuperar el contenido. En este prototipo los binarios no se cargan ni se almacenan.</p><div className="drive-modal-actions"><button className="drive-subtle-button" onClick={() => setDialog(null)}>Cerrar</button><button className="drive-primary-button" onClick={() => detail && download(detail, false)}>Probar descarga de demostración</button></div></>}
        {dialog === "trash-confirm" && <><span className="drive-modal-icon error">♜</span><h2 id="drive-modal-title">{trash ? "Eliminar definitivamente" : "Mover a la papelera"}</h2><p>¿Quieres {trash ? "eliminar definitivamente" : "mover"} <b>“{deletedLabel ?? "este elemento"}”</b>{trash ? "? Esta acción no se puede deshacer." : " a la papelera? Podrás restaurarlo durante 30 días."}</p><div className="drive-modal-actions"><button className="drive-subtle-button" onClick={() => setDialog(null)}>Cancelar</button><button className="drive-danger-button" onClick={() => trash ? permanentlyDelete() : selectedTrashItem && moveToTrash(selectedTrashItem.id, selectedTrashItem.kind)}>{trash ? "Eliminar definitivamente" : "Mover a papelera"}</button></div></>}
        {dialog === "delete-success" && <><span className="drive-modal-icon success"><UiIcon name="check" size={22} /></span><h2 id="drive-modal-title">Eliminación definitiva exitosa</h2><p>El elemento se eliminó de los datos locales de demostración.</p><div className="drive-modal-actions"><button className="drive-primary-button" onClick={() => setDialog(null)}>Listo</button></div></>}
      </section></div>}
    </main>
  </div>;
}
