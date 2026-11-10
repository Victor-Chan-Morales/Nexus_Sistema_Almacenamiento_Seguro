"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { AppShell } from "@/components/app-shell";
import { ApiError } from "@/lib/api/client";
import { getDashboard } from "@/lib/api/dashboard";
import type { DashboardResponse } from "@/lib/api/types";
import { formatBytes as formatLiveBytes, formatIsoDate, usagePercent } from "@/lib/format";
import { useSession } from "@/lib/session";
import { DemoState, formatBytes, parseDemo, readDemoRaw } from "@/lib/demo";
import { parseSubscription, readSubscriptionRaw } from "@/lib/billing-demo";
import { noopSubscribe } from "@/lib/client-store";
import { getPlan } from "@/lib/plans";
import { UiIcon } from "@/components/ui-icon";

type DashboardVariant = "standard" | "empty" | "quota";

function formatStorage(bytes: number) {
  if (bytes === 0) return "0 GB";
  const gb = bytes / 1024 ** 3;
  return gb >= 1 ? `${Number(gb.toFixed(1))} GB` : formatBytes(bytes);
}

const localDateFormatter = new Intl.DateTimeFormat("es-GT", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

function todayLabel() {
  return localDateFormatter.format(new Date());
}

function LocalDate() {
  const date = useSyncExternalStore(noopSubscribe, todayLabel, () => "");
  return <>{date}</>;
}

function ActivityList({ files, userName }: { files: DemoState["files"]; userName: string }) {
  const events = files.slice(0, 3).map((file, index) => ({
    tone: index === 0 ? "violet" : "blue",
    title: `Se agregó ${file.name}`,
    description: `${userName} · ${formatBytes(file.size)}`,
    when: index === 0 ? "Hace 2 horas" : "Ayer",
  }));
  return events.length ? <div className="dashboard-activity-list">{events.map((event, index) => <div className="dashboard-activity-item" key={`${event.title}-${index}`}><span className={`activity-icon ${event.tone}`}><UiIcon name="files" size={15} /></span><div><b>{event.title}</b><small>{event.description}</small></div><time>{event.when}</time></div>)}</div> : <div className="dashboard-empty-inline"><span><UiIcon name="activity" size={17} /></span><b>Aún no hay actividad</b><p>Los movimientos de tu equipo aparecerán aquí.</p></div>;
}

type LoadState = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; data: DashboardResponse };

/** Dashboard conectado a GET /api/dashboard. Todas las cifras llegan de la API en bytes. */
export function DashboardView() {
  const { session, failSession } = useSession();
  const [load, setLoad] = useState<LoadState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const token = session?.accessToken;

  useEffect(() => {
    if (!token) return;
    const controller = new AbortController();
    getDashboard(token, { signal: controller.signal })
      .then((data) => setLoad({ status: "ready", data }))
      .catch((error: unknown) => {
        if (error instanceof Error && error.name === "AbortError") return;
        if (failSession(error)) return;
        setLoad({ status: "error", message: error instanceof ApiError && error.status === 0 ? error.message : "No pudimos cargar el resumen de tu espacio. Inténtalo de nuevo." });
      });
    return () => controller.abort();
  }, [token, attempt, failSession]);

  const firstName = session?.user.fullName.split(/\s+/)[0] ?? "";
  return <AppShell active="/dashboard">
    <div className="dashboard-page-heading"><div><p className="eyebrow"><LocalDate /></p><h1>{firstName ? `Hola, ${firstName}` : "Resumen"}</h1><p>{load.status === "ready" ? `Resumen de ${load.data.organizationName}` : "Resumen de tu organización"}</p></div><Link href="/archivos" className="button button-primary">Explorar archivos <UiIcon name="arrowRight" size={15} /></Link></div>
    {load.status === "loading" && <section className="panel" role="status" aria-live="polite"><p className="muted">Cargando el resumen de tu espacio…</p></section>}
    {load.status === "error" && <section className="quota-alert" role="alert"><span className="quota-alert-icon">!</span><div><b>No se pudo cargar el resumen</b><p>{load.message}</p></div><button type="button" className="text-button" onClick={() => { setLoad({ status: "loading" }); setAttempt((value) => value + 1); }}>Reintentar</button></section>}
    {load.status === "ready" && <LiveDashboard data={load.data} />}
  </AppShell>;
}

function LiveDashboard({ data }: { data: DashboardResponse }) {
  const { plan, storageUsedBytes, storageLimitBytes } = data;
  const percent = usagePercent(storageUsedBytes, storageLimitBytes);
  const full = storageLimitBytes > 0 && storageUsedBytes >= storageLimitBytes;
  return <>
    {!plan && <section className="quota-alert" role="alert"><span className="quota-alert-icon">!</span><div><b>Tu organización no tiene una suscripción activa</b><p>Contrata un plan para definir tu límite de almacenamiento.</p></div><Link href="/planes">Ver planes</Link></section>}
    {full && <section className="quota-alert" role="alert"><span className="quota-alert-icon">!</span><div><b>Has alcanzado el límite de almacenamiento</b><p>Tu espacio está al {percent}% de su capacidad. Libera espacio o mejora tu plan para seguir subiendo archivos.</p></div><Link href="/planes">Mejorar plan</Link></section>}
    <div className="dashboard-metrics">
      <section className="dashboard-metric-card"><div className="dashboard-metric-top"><span className="dashboard-metric-icon violet"><UiIcon name="plans" size={17} /></span><span className={`dashboard-status-pill ${full || !plan ? "warning" : ""}`}>{!plan ? "Sin plan" : full ? "Límite alcanzado" : "Activo"}</span></div><small>PLAN ACTIVO</small><strong>{plan?.name ?? "—"}</strong><Link href="/suscripcion">Ver suscripción <UiIcon name="arrowRight" size={14} /></Link></section>
      <section className={`dashboard-metric-card dashboard-storage-card ${full ? "quota-metric" : ""}`}><div className="dashboard-metric-top"><span className="dashboard-metric-icon violet"><UiIcon name="storage" size={17} /></span><span className="dashboard-metric-caption">{percent}% usado</span></div><small>ALMACENAMIENTO</small><strong>{formatLiveBytes(storageUsedBytes)} <em>de {plan ? formatLiveBytes(storageLimitBytes) : "—"}</em></strong><div className="dashboard-meter"><span style={{ width: `${percent}%` }} /></div><div className="dashboard-storage-meta"><span>Disponible</span><b>{plan ? formatLiveBytes(Math.max(0, storageLimitBytes - storageUsedBytes)) : "—"}</b></div></section>
      <section className="dashboard-metric-card"><div className="dashboard-metric-top"><span className="dashboard-metric-icon coral"><UiIcon name="organizations" size={17} /></span><span className="dashboard-metric-caption">Organización</span></div><small>LÍMITE DE USUARIOS</small><strong>{plan ? `Hasta ${plan.userLimit}` : "—"}</strong><Link href="/configuracion">Administrar equipo <UiIcon name="arrowRight" size={14} /></Link></section>
      <section className="dashboard-metric-card"><div className="dashboard-metric-top"><span className="dashboard-metric-icon blue"><UiIcon name="subscription" size={17} /></span><span className="dashboard-status-pill muted">Simulada</span></div><small>VIGENCIA</small><strong>{formatIsoDate(plan?.expiresAt)}</strong><span className="dashboard-destination-state">Suscripción de demostración, sin cobro</span></section>
    </div>
    <div className="dashboard-section-heading"><div><h2>Accesos rápidos</h2><p>Atajos a las herramientas principales de tu espacio.</p></div></div>
    <div className="quick-grid dashboard-quick-grid"><Link href="/archivos" className="quick-card"><span className="quick-icon violet-bg"><UiIcon name="files" size={17} /></span><b>Mis archivos</b><span>Explora carpetas y documentos</span><i><UiIcon name="arrowRight" size={15} /></i></Link><Link href="/suscripcion" className="quick-card"><span className="quick-icon coral-bg"><UiIcon name="subscription" size={17} /></span><b>Plan y suscripción</b><span>Consulta capacidad y vigencia</span><i><UiIcon name="arrowRight" size={15} /></i></Link><Link href="/perfil" className="quick-card"><span className="quick-icon blue-bg"><UiIcon name="user" size={17} /></span><b>Mi perfil</b><span>Revisa tu cuenta</span><i><UiIcon name="arrowRight" size={15} /></i></Link></div>
    <div className="dashboard-lower-grid">
      <section className="panel dashboard-activity-panel"><div className="dashboard-section-heading"><div><h2>Actividad reciente</h2><p>Movimientos recientes de tu espacio.</p></div></div>{data.recentActivity.length === 0 && <div className="dashboard-empty-inline"><span><UiIcon name="activity" size={17} /></span><b>Aún no hay actividad registrada</b><p>El registro de actividad estará disponible cuando se habilite la auditoría.</p></div>}</section>
    </div>
  </>;
}

/** Variantes de maqueta de Figma (organización nueva y cuota llena). No usan la API. */
export function DashboardDemoView({ variant = "standard" }: { variant?: DashboardVariant }) {
  const demoRaw = useSyncExternalStore(noopSubscribe, readDemoRaw, () => null);
  const billingRaw = useSyncExternalStore(noopSubscribe, readSubscriptionRaw, () => null);
  const currentState = useMemo(() => parseDemo(demoRaw), [demoRaw]);
  const subscription = useMemo(() => parseSubscription(billingRaw), [billingRaw]);
  const emptyMode = variant === "empty";
  const quotaMode = variant === "quota";
  const visibleFiles = emptyMode ? [] : currentState.files.filter((file) => !file.deleted);
  const plan = getPlan(emptyMode ? "demo" : quotaMode ? "profesional" : subscription.planId);
  const usedGb = emptyMode ? 0 : quotaMode ? plan.storageGb + 1 : subscription.storageUsedGb;
  const capBytes = plan.storageGb * 1024 ** 3;
  const usedBytes = usedGb * 1024 ** 3;
  const percent = Math.round(usedGb / plan.storageGb * 100);
  const orgName = emptyMode ? "Organización nueva" : currentState.user.organization;
  const userName = currentState.user.name;

  return <AppShell active="/dashboard" demo>
    <div className="dashboard-page-heading"><div><p className="eyebrow"><LocalDate /></p><h1>{emptyMode ? "Tu espacio está listo" : `Buenos días, ${userName.split(" ")[0]}`}</h1><p>{emptyMode ? "Comienza a organizar los archivos de tu organización." : `Resumen de ${orgName}`}</p></div><Link href="/archivos" className="button button-primary">Explorar archivos <UiIcon name="arrowRight" size={15} /></Link></div>
    {quotaMode && <section className="quota-alert" role="alert"><span className="quota-alert-icon">!</span><div><b>Has alcanzado el límite de almacenamiento</b><p>Tu espacio está al {percent}% de su capacidad. Libera espacio o mejora tu plan para seguir subiendo archivos.</p></div><Link href="/planes">Mejorar plan</Link></section>}
    <div className="dashboard-metrics">
      <section className="dashboard-metric-card"><div className="dashboard-metric-top"><span className="dashboard-metric-icon violet"><UiIcon name="plans" size={17} /></span><span className={`dashboard-status-pill ${quotaMode ? "warning" : ""}`}>{quotaMode ? "Límite alcanzado" : "Activo"}</span></div><small>PLAN ACTIVO</small><strong>{plan.name}</strong><Link href="/suscripcion">Ver suscripción <UiIcon name="arrowRight" size={14} /></Link></section>
      <section className={`dashboard-metric-card dashboard-storage-card ${quotaMode ? "quota-metric" : ""}`}><div className="dashboard-metric-top"><span className="dashboard-metric-icon violet"><UiIcon name="storage" size={17} /></span><span className="dashboard-metric-caption">{percent}% usado</span></div><small>ALMACENAMIENTO</small><strong>{formatStorage(usedBytes)} <em>de {plan.storageGb} GB</em></strong><div className="dashboard-meter"><span style={{ width: `${Math.min(percent, 100)}%` }} /></div><div className="dashboard-storage-meta"><span>Disponible</span><b>{formatStorage(Math.max(0, capBytes - usedBytes))}</b></div></section>
      <section className="dashboard-metric-card"><div className="dashboard-metric-top"><span className="dashboard-metric-icon coral"><UiIcon name="organizations" size={17} /></span><span className="dashboard-metric-caption">Organización</span></div><small>USUARIOS</small><strong>{emptyMode ? "1" : "1"} <em>de {plan.users ?? "—"}</em></strong><Link href="/configuracion">Administrar equipo <UiIcon name="arrowRight" size={14} /></Link></section>
      <section className="dashboard-metric-card"><div className="dashboard-metric-top"><span className="dashboard-metric-icon blue"><UiIcon name="storage" size={17} /></span><span className="dashboard-status-pill muted">Pendiente</span></div><small>DESTINO DE ALMACENAMIENTO</small><strong>Nube</strong><span className="dashboard-destination-state">Sin configurar</span><Link href="/configuracion">Configurar destino <UiIcon name="arrowRight" size={14} /></Link></section>
    </div>

    <div className="dashboard-section-heading"><div><h2>Accesos rápidos</h2><p>Atajos a las herramientas principales de tu espacio.</p></div></div>
    <div className="quick-grid dashboard-quick-grid"><Link href="/archivos" className="quick-card"><span className="quick-icon violet-bg"><UiIcon name="files" size={17} /></span><b>Mis archivos</b><span>Explora carpetas y documentos</span><i><UiIcon name="arrowRight" size={15} /></i></Link><Link href="/suscripcion" className="quick-card"><span className="quick-icon coral-bg"><UiIcon name="subscription" size={17} /></span><b>Plan y suscripción</b><span>Consulta capacidad y vigencia</span><i><UiIcon name="arrowRight" size={15} /></i></Link><Link href="/configuracion" className="quick-card"><span className="quick-icon blue-bg"><UiIcon name="settings" size={17} /></span><b>Configuración</b><span>Administra tu organización</span><i><UiIcon name="arrowRight" size={15} /></i></Link></div>

    <div className="dashboard-lower-grid">
      <section className="panel dashboard-recent-panel"><div className="dashboard-section-heading"><div><h2>Archivos recientes</h2><p>{visibleFiles.length ? "Últimos elementos de tu organización." : "Los archivos que agregues aparecerán aquí."}</p></div><Link href="/archivos">Ver todos <UiIcon name="arrowRight" size={14} /></Link></div>
        {visibleFiles.length ? <div className="dashboard-recent-list">{visibleFiles.slice(0, 4).map((file) => <Link className="dashboard-recent-file" href="/archivos" key={file.id}><span className={`document-icon ${file.type.toLowerCase()}`}><UiIcon name="files" size={17} /></span><span><b>{file.name}</b><small>{file.type} · {formatBytes(file.size)}</small></span><time>Reciente</time></Link>)}</div> : <div className="dashboard-empty-inline"><span><UiIcon name="files" size={17} /></span><b>Sin archivos todavía</b><p>Sube tu primer documento para comenzar.</p><Link className="button button-primary" href="/archivos">Ir a mis archivos</Link></div>}
      </section>
      <section className="panel dashboard-activity-panel"><div className="dashboard-section-heading"><div><h2>Actividad reciente</h2><p>Movimientos recientes de tu espacio.</p></div><Link href="/auditoria">Ver actividad <UiIcon name="arrowRight" size={14} /></Link></div><ActivityList files={visibleFiles} userName={userName} /></section>
    </div>
    {emptyMode && <p className="dashboard-demo-note">Vista de demostración de una organización nueva: sin archivos ni actividad.</p>}
    {quotaMode && <p className="dashboard-demo-note">Vista de cuota alcanzada. Las cargas deben bloquearse al exceder el límite del plan.</p>}
  </AppShell>;
}
