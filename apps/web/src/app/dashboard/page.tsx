import { AppShell } from "@/components/app-shell";
import { ScreenNote } from "@/components/screen-note";

export default function DashboardPage() {
  return (
    <AppShell active="/dashboard">
      <div className="page-heading"><p className="eyebrow">Nexus</p><h1>Resumen</h1><p>Vista prevista para la organización autenticada.</p></div>
      <ScreenNote />
      <div className="grid">
        {[["Organización", "—"], ["Plan activo", "—"], ["Espacio utilizado", "—"]].map(([label, value]) => (
          <section className="stat-card" key={label}><p className="stat-label">{label}</p><p className="stat-value">{value}</p><p className="stat-hint">Dato real pendiente de `GET /dashboard`</p></section>
        ))}
      </div>
      <section className="panel"><h2>Actividad reciente</h2><p className="muted">La lista se completa cuando se acuerde el contrato y la fuente de actividad.</p></section>
    </AppShell>
  );
}
