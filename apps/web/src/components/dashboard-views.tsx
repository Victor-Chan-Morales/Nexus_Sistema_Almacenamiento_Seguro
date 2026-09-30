"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { DemoState, formatBytes, initialDemo, readDemo } from "@/lib/demo";
import { DemoSubscription, initialSubscription, readSubscription } from "@/lib/billing-demo";
import { getPlan } from "@/lib/plans";
import { UiIcon } from "@/components/ui-icon";

type DashboardVariant = "standard" | "empty" | "quota";

function formatStorage(bytes: number) {
  if (bytes === 0) return "0 GB";
  const gb = bytes / 1024 ** 3;
  return gb >= 1 ? `${Number(gb.toFixed(1))} GB` : formatBytes(bytes);
}

function LocalDate() {
  const [date, setDate] = useState("");
  useEffect(() => setDate(new Intl.DateTimeFormat("es-GT", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(new Date())), []);
  return <>{date}</>;
}

function ActivityList({ files, userName }: { files: DemoState["files"]; userName: string }) {
  const events = files.slice(0, 3).map((file, index) => ({
    icon: file.type === "PDF" ? "▤" : "▧",
    tone: index === 0 ? "violet" : "blue",
    title: `Se agregó ${file.name}`,
    description: `${userName} · ${formatBytes(file.size)}`,
    when: index === 0 ? "Hace 2 horas" : "Ayer",
  }));
  return events.length ? <div className="dashboard-activity-list">{events.map((event, index) => <div className="dashboard-activity-item" key={`${event.title}-${index}`}><span className={`activity-icon ${event.tone}`}><UiIcon name="files" size={15} /></span><div><b>{event.title}</b><small>{event.description}</small></div><time>{event.when}</time></div>)}</div> : <div className="dashboard-empty-inline"><span><UiIcon name="activity" size={17} /></span><b>Aún no hay actividad</b><p>Los movimientos de tu equipo aparecerán aquí.</p></div>;
}

export function DashboardView({ variant = "standard" }: { variant?: DashboardVariant }) {
  const [state, setState] = useState<DemoState | null>(null);
  const [billing, setBilling] = useState<DemoSubscription | null>(null);
  useEffect(() => { setState(readDemo()); }, []);
  useEffect(() => { setBilling(readSubscription()); }, []);
  const currentState = state ?? initialDemo;
  const emptyMode = variant === "empty";
  const quotaMode = variant === "quota";
  const visibleFiles = emptyMode ? [] : currentState.files.filter((file) => !file.deleted);
  const subscription = billing ?? initialSubscription;
  const plan = getPlan(emptyMode ? "demo" : quotaMode ? "profesional" : subscription.planId);
  const usedGb = emptyMode ? 0 : quotaMode ? plan.storageGb + 1 : subscription.storageUsedGb;
  const capBytes = plan.storageGb * 1024 ** 3;
  const usedBytes = usedGb * 1024 ** 3;
  const percent = Math.round(usedGb / plan.storageGb * 100);
  const orgName = emptyMode ? "Organización nueva" : currentState.user.organization;
  const userName = currentState.user.name;

  return <AppShell active="/dashboard">
    <div className="dashboard-page-heading"><div><p className="eyebrow"><LocalDate /></p><h1>{emptyMode ? "Tu espacio está listo" : `Buenos días, ${userName.split(" ")[0]}`}</h1><p>{emptyMode ? "Comienza a organizar los archivos de tu organización." : `Resumen de ${orgName}`}</p></div><Link href="/archivos" className="button button-primary">Explorar archivos <span>→</span></Link></div>
    {quotaMode && <section className="quota-alert" role="alert"><span className="quota-alert-icon">!</span><div><b>Has alcanzado el límite de almacenamiento</b><p>Tu espacio está al {percent}% de su capacidad. Libera espacio o mejora tu plan para seguir subiendo archivos.</p></div><Link href="/planes">Mejorar plan</Link></section>}
    <div className="dashboard-metrics">
      <section className="dashboard-metric-card"><div className="dashboard-metric-top"><span className="dashboard-metric-icon violet"><UiIcon name="plans" size={17} /></span><span className={`dashboard-status-pill ${quotaMode ? "warning" : ""}`}>{quotaMode ? "Límite alcanzado" : "Activo"}</span></div><small>PLAN ACTIVO</small><strong>{plan.name}</strong><Link href="/suscripcion">Ver suscripción →</Link></section>
      <section className={`dashboard-metric-card dashboard-storage-card ${quotaMode ? "quota-metric" : ""}`}><div className="dashboard-metric-top"><span className="dashboard-metric-icon violet"><UiIcon name="storage" size={17} /></span><span className="dashboard-metric-caption">{percent}% usado</span></div><small>ALMACENAMIENTO</small><strong>{formatStorage(usedBytes)} <em>de {plan.storageGb} GB</em></strong><div className="dashboard-meter"><span style={{ width: `${Math.min(percent, 100)}%` }} /></div><div className="dashboard-storage-meta"><span>Disponible</span><b>{formatStorage(Math.max(0, capBytes - usedBytes))}</b></div></section>
      <section className="dashboard-metric-card"><div className="dashboard-metric-top"><span className="dashboard-metric-icon coral"><UiIcon name="organizations" size={17} /></span><span className="dashboard-metric-caption">Organización</span></div><small>USUARIOS</small><strong>{emptyMode ? "1" : "1"} <em>de {plan.users ?? "—"}</em></strong><Link href="/configuracion">Administrar equipo →</Link></section>
      <section className="dashboard-metric-card"><div className="dashboard-metric-top"><span className="dashboard-metric-icon blue"><UiIcon name="storage" size={17} /></span><span className="dashboard-status-pill muted">Pendiente</span></div><small>DESTINO DE ALMACENAMIENTO</small><strong>Nube</strong><span className="dashboard-destination-state">Sin configurar</span><Link href="/configuracion">Configurar destino →</Link></section>
    </div>

    <div className="dashboard-section-heading"><div><h2>Accesos rápidos</h2><p>Atajos a las herramientas principales de tu espacio.</p></div></div>
    <div className="quick-grid dashboard-quick-grid"><Link href="/archivos" className="quick-card"><span className="quick-icon violet-bg"><UiIcon name="files" size={17} /></span><b>Mis archivos</b><span>Explora carpetas y documentos</span><i>→</i></Link><Link href="/suscripcion" className="quick-card"><span className="quick-icon coral-bg"><UiIcon name="subscription" size={17} /></span><b>Plan y suscripción</b><span>Consulta capacidad y vigencia</span><i>→</i></Link><Link href="/configuracion" className="quick-card"><span className="quick-icon blue-bg"><UiIcon name="settings" size={17} /></span><b>Configuración</b><span>Administra tu organización</span><i>→</i></Link></div>

    <div className="dashboard-lower-grid">
      <section className="panel dashboard-recent-panel"><div className="dashboard-section-heading"><div><h2>Archivos recientes</h2><p>{visibleFiles.length ? "Últimos elementos de tu organización." : "Los archivos que agregues aparecerán aquí."}</p></div><Link href="/archivos">Ver todos →</Link></div>
        {visibleFiles.length ? <div className="dashboard-recent-list">{visibleFiles.slice(0, 4).map((file) => <Link className="dashboard-recent-file" href="/archivos" key={file.id}><span className={`document-icon ${file.type.toLowerCase()}`}>▤</span><span><b>{file.name}</b><small>{file.type} · {formatBytes(file.size)}</small></span><time>Reciente</time></Link>)}</div> : <div className="dashboard-empty-inline"><span>▤</span><b>Sin archivos todavía</b><p>Sube tu primer documento para comenzar.</p><Link className="button button-primary" href="/archivos">Ir a mis archivos</Link></div>}
      </section>
      <section className="panel dashboard-activity-panel"><div className="dashboard-section-heading"><div><h2>Actividad reciente</h2><p>Movimientos recientes de tu espacio.</p></div><Link href="/auditoria">Ver actividad →</Link></div><ActivityList files={visibleFiles} userName={userName} /></section>
    </div>
    {emptyMode && <p className="dashboard-demo-note">Vista de demostración de una organización nueva: sin archivos ni actividad.</p>}
    {quotaMode && <p className="dashboard-demo-note">Vista de cuota alcanzada. Las cargas deben bloquearse al exceder el límite del plan.</p>}
  </AppShell>;
}

const adminOrganizations = [
  { name: "Acme Guatemala", plan: "Profesional", status: "Activa", color: "good" },
  { name: "Corporación S.A.", plan: "Demo", status: "Activa", color: "good" },
  { name: "Nexus Demo", plan: "Demo", status: "Pendiente", color: "pending" },
];

export function SuperAdminDashboard() {
  return <AppShell active="/dashboard/super-admin" superAdmin><div className="dashboard-page-heading"><div><p className="eyebrow">CONSOLA DE PLATAFORMA</p><h1>Resumen global</h1><p>Estado general de Nexus y sus organizaciones.</p></div><span className="admin-demo-badge">Métricas simuladas</span></div>
    <section className="platform-health-banner"><span className="platform-health-indicator"/><div><b>Plataforma operativa</b><p>Estado de demostración · No conectado a telemetría real</p></div><span className="platform-health-check">Operativa</span></section>
    <div className="admin-metrics-grid"><a href="#organizaciones" className="admin-metric-card"><span>ORGANIZACIONES</span><b>3</b><small>2 activas · 1 pendiente</small></a><a href="#planes" className="admin-metric-card"><span>PLANES</span><b>2</b><small>Demo y Profesional</small></a><a href="#instalaciones" className="admin-metric-card"><span>INSTALACIONES</span><b>1</b><small>Entorno de demostración</small></a><a href="#actividad" className="admin-metric-card"><span>ACTIVIDAD GLOBAL</span><b>12</b><small>Eventos recientes de muestra</small></a></div>
    <div className="dashboard-lower-grid admin-content-grid">
      <section className="panel" id="organizaciones"><div className="dashboard-section-heading"><div><h2>Organizaciones</h2><p>Tenants registrados en la plataforma.</p></div><Link href="/configuracion">Administrar →</Link></div><div className="admin-org-list">{adminOrganizations.map((org) => <div className="admin-org-row" key={org.name}><span className="org-avatar">{org.name.charAt(0)}</span><div><b>{org.name}</b><small>Plan {org.plan}</small></div><span className={`admin-org-status ${org.color}`}>{org.status}</span></div>)}</div></section>
      <section className="panel" id="planes"><div className="dashboard-section-heading"><div><h2>Planes disponibles</h2><p>Resumen del catálogo de muestra.</p></div><Link href="/planes">Ver catálogo →</Link></div><div className="admin-plan-row"><span><b>Demo</b><small>5 GB · hasta 5 usuarios</small></span><strong>Gratis</strong></div><div className="admin-plan-row"><span><b>Profesional</b><small>100 GB · usuarios por definir</small></span><strong>US$59.99</strong></div></section>
      <section className="panel" id="instalaciones"><div className="dashboard-section-heading"><div><h2>Instalaciones</h2><p>Destinos e infraestructura de ejemplo.</p></div></div><div className="admin-installation"><span className="dashboard-metric-icon violet"><UiIcon name="storage" size={17} /></span><div><b>Cloud de demostración</b><small>Proveedor no conectado</small></div><span className="admin-org-status pending">Simulado</span></div></section>
      <section className="panel" id="actividad"><div className="dashboard-section-heading"><div><h2>Actividad global</h2><p>Eventos recientes de muestra.</p></div><Link href="/auditoria">Abrir auditoría →</Link></div><div className="admin-global-event"><span className="activity-icon violet">＋</span><div><b>Se registró una organización</b><small>Nexus Demo · Hace 18 min</small></div></div><div className="admin-global-event"><span className="activity-icon blue">◇</span><div><b>Se activó un plan Profesional</b><small>Acme Guatemala · Hace 1 h</small></div></div><div className="admin-global-event"><span className="activity-icon coral">⚙</span><div><b>Se revisó una instalación</b><small>Cloud de demostración · Hoy</small></div></div></section>
    </div>
    <p className="dashboard-demo-note">La vista Super Admin es solo una maqueta. Las cifras y los eventos no proceden de la base de datos.</p>
  </AppShell>;
}
