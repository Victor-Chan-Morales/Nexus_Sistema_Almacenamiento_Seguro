"use client";

import { useCallback, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { Notice } from "@/components/notice";
import { getAuditEvents } from "@/lib/api/audit";
import { getMembers } from "@/lib/api/members";
import type { AuditEvent } from "@/lib/api/types";
import { formatIsoDate } from "@/lib/format";
import { useSession } from "@/lib/session";
import { useLoad } from "@/lib/use-load";

type ActionFamily = "auth" | "files" | "team" | "plan";

/** Etiquetas de las acciones de CONTRACTS v0.5 «Auditoría». Un código ausente se muestra tal cual con la insignia neutra. */
const ACTIONS: Partial<Record<string, { label: string; family: ActionFamily }>> = {
  AUTH_LOGIN: { label: "Inicio de sesión", family: "auth" },
  AUTH_PASSWORD_RESET: { label: "Contraseña restablecida", family: "auth" },
  MEMBER_ADDED: { label: "Miembro agregado", family: "team" },
  FILE_UPLOAD: { label: "Archivo subido", family: "files" },
  FILE_DOWNLOAD: { label: "Archivo descargado", family: "files" },
  FILE_DELETE: { label: "Archivo movido a la papelera", family: "files" },
  FILE_RESTORE: { label: "Archivo restaurado", family: "files" },
  FILE_PURGE: { label: "Archivo eliminado definitivamente", family: "files" },
  FOLDER_CREATE: { label: "Carpeta creada", family: "files" },
  FOLDER_DELETE: { label: "Carpeta movida a la papelera", family: "files" },
  FOLDER_RESTORE: { label: "Carpeta restaurada", family: "files" },
  FOLDER_PURGE: { label: "Carpeta eliminada definitivamente", family: "files" },
  PLAN_ACTIVATED: { label: "Plan activado", family: "plan" },
  PLAN_RENEWED: { label: "Plan renovado", family: "plan" },
};

const RESOURCES: Partial<Record<string, string>> = { user: "Usuario", membership: "Membresía", file: "Archivo", folder: "Carpeta", subscription: "Suscripción" };

type AuditLogData = { events: AuditEvent[]; nextBefore: string | null; actorNames: Map<string, string> };

/** Datos de la bitácora. El nombre del actor es solo presentación: actorId es el id de usuario (member.userId). */
function useAuditLog(token: string) {
  const { failSession } = useSession();
  const fetcher = useCallback(async (signal: AbortSignal): Promise<AuditLogData> => {
    const [page, team] = await Promise.all([getAuditEvents(token, {}, { signal }), getMembers(token, { signal })]);
    return { ...page, actorNames: new Map(team.members.map((member) => [member.userId, member.fullName])) };
  }, [token]);
  const { state, reload, set } = useLoad(fetcher, true, "No pudimos cargar la auditoría. Inténtalo de nuevo.");
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreFailed, setLoadMoreFailed] = useState(false);

  async function loadMore() {
    if (state.status !== "ready") return;
    const current = state.data;
    const { nextBefore } = current;
    if (!nextBefore) return;
    setLoadingMore(true);
    setLoadMoreFailed(false);
    try {
      const page = await getAuditEvents(token, { before: nextBefore });
      set({ status: "ready", data: { ...current, events: [...current.events, ...page.events], nextBefore: page.nextBefore } });
    } catch (error) {
      if (!failSession(error)) setLoadMoreFailed(true);
    } finally {
      setLoadingMore(false);
    }
  }

  return { state, reload, loadMore, loadingMore, loadMoreFailed };
}

export function AuditLog() {
  const { session } = useSession();
  // Solo oculta la vista: la API rechaza con 403 a quien no es tenant_admin.
  const isAdmin = session?.role === "tenant_admin";
  return <AppShell active="/auditoria">
    <div className="page-heading"><p className="eyebrow">ESPACIO DE TRABAJO</p><h1>Auditoría</h1><p>Registro de actividad relevante de la organización.</p></div>
    {isAdmin && session ? <AuditLogContent token={session.accessToken} /> : <section className="panel"><p className="muted">Solo los administradores consultan la auditoría</p></section>}
  </AppShell>;
}

function AuditLogContent({ token }: { token: string }) {
  const { state, reload, loadMore, loadingMore, loadMoreFailed } = useAuditLog(token);
  const [actionFilter, setActionFilter] = useState("");

  if (state.status === "loading") return <section className="panel"><p className="muted" role="status">Cargando actividad…</p></section>;
  if (state.status === "error") return <Notice title="No se pudo cargar la auditoría" message={state.message} onRetry={reload} />;

  const { events, nextBefore, actorNames } = state.data;
  if (events.length === 0) return <section className="panel"><p className="muted">Aún no hay actividad registrada</p></section>;
  // Filtro solo visual sobre lo ya cargado (spec 403, escenario 2).
  const visible = actionFilter ? events.filter((event) => event.action === actionFilter) : events;

  return <section className="panel">
    <label className="billing-select-label" htmlFor="audit-action-filter">Tipo de acción</label>
    <select id="audit-action-filter" className="billing-select" value={actionFilter} onChange={(event) => setActionFilter(event.target.value)}>
      <option value="">Todas las acciones</option>
      {Object.entries(ACTIONS).map(([code, info]) => <option key={code} value={code}>{info?.label}</option>)}
    </select>
    {visible.length === 0 ? <p className="muted">No hay eventos de este tipo entre los cargados.</p> : <AuditTable events={visible} actorNames={actorNames} />}
    {loadMoreFailed && <Notice title="No se pudieron cargar más eventos" message="Inténtalo de nuevo." />}
    {nextBefore && <button type="button" className="button button-secondary" onClick={loadMore} disabled={loadingMore}>{loadingMore ? "Cargando…" : "Cargar más"}</button>}
  </section>;
}

function AuditTable({ events, actorNames }: { events: AuditEvent[]; actorNames: Map<string, string> }) {
  return <div className="billing-table-wrapper"><table className="billing-table">
    <thead><tr><th>Fecha</th><th>Actor</th><th>Acción</th><th>Recurso</th></tr></thead>
    <tbody>{events.map((event) => <tr key={event.id}>
      <td>{formatIsoDate(event.occurredAt)}</td>
      <td>{actorNames.get(event.actorId) ?? "Usuario"}</td>
      <td><ActionBadge action={event.action} /></td>
      <td>{resourceLabel(event)}</td>
    </tr>)}</tbody>
  </table></div>;
}

function ActionBadge({ action }: { action: string }) {
  const info = ACTIONS[action];
  return <span className={info ? `billing-badge audit-badge-${info.family}` : "billing-badge"}>{info?.label ?? action}</span>;
}

/** El evento no guarda nombres de archivo: se muestra el tipo de recurso y el inicio de su id. */
function resourceLabel({ resourceType, resourceId }: AuditEvent) {
  if (!resourceType) return "—";
  const label = RESOURCES[resourceType] ?? resourceType;
  return resourceId ? `${label} · ${resourceId.slice(0, 8)}` : label;
}
