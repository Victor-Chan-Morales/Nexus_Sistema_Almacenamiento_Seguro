import { AppShell } from "@/components/app-shell";

export function PlaceholderPage({ title, description }: { title: string; description: string }) {
  return <AppShell active=""><div className="page-heading"><p className="eyebrow">ESPACIO DE TRABAJO</p><h1>{title}</h1><p>{description}</p></div><section className="panel placeholder-panel"><span className="placeholder-icon">◌</span><h2>Esta sección estará disponible más adelante</h2><p className="muted">La ruta y la navegación están preparadas. Su funcionalidad está pendiente de implementación.</p></section></AppShell>;
}
