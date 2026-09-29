import { AppShell } from "@/components/app-shell";
import { ScreenNote } from "@/components/screen-note";

export default function FilesPage() {
  return (
    <AppShell active="/archivos">
      <div className="page-heading"><p className="eyebrow">Files</p><h1>Archivos</h1><p>Carpetas y metadatos pertenecen al tenant autenticado.</p></div>
      <ScreenNote />
      <section className="panel" style={{ marginTop: 20 }}>
        <h2>Explorador pendiente de Figma y API</h2>
        <p className="muted">Esta zona se sustituye por el explorador que ya diseñó el equipo. La API debe validar carpeta, organización, cuota y permiso antes de cada operación.</p>
        <div className="form-actions">
          <button className="button" type="button" disabled>Crear carpeta</button>
          <button className="button button-primary" type="button" disabled>Subir archivo</button>
        </div>
        <p className="footer-note">El contenido vive en MinIO/S3; la base guarda metadatos y versiones. Estas acciones no están conectadas todavía.</p>
      </section>
    </AppShell>
  );
}
