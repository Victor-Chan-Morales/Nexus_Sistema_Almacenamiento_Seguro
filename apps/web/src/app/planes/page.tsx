import { AppShell } from "@/components/app-shell";
import { ScreenNote } from "@/components/screen-note";

export default function PlansPage() {
  return (
    <AppShell active="/planes">
      <div className="page-heading"><p className="eyebrow">Billing</p><h1>Planes</h1><p>El catálogo debe venir de datos persistidos por la API.</p></div>
      <ScreenNote />
      <section className="panel" style={{ marginTop: 20 }}>
        <h2>Catálogo pendiente de conexión</h2>
        <p className="muted">Mostrar nombre, descripción, precio mensual, vigencia, espacio y límite de usuarios obtenidos desde <code>GET /plans</code>. No definir precios o cupos ficticios aquí.</p>
        <button className="button button-primary" type="button" disabled>Activar plan (simulación pendiente)</button>
      </section>
    </AppShell>
  );
}
