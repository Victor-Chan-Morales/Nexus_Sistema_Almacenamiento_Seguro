"use client";

import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { Dialog } from "@/components/dialog";
import { Notice } from "@/components/notice";
import { LoadingIndicator, useToast } from "@/components/toast";
import { getPlans } from "@/lib/api/billing";
import { ApiError } from "@/lib/api/client";
import {
  approveInstallationRequest,
  getPlatformMetrics,
  listPlatformInstallationRequests,
  listPlatformOrganizations,
  platformErrorMessage,
  reactivateOrganization,
  rejectInstallationRequest,
  suspendOrganization,
  updateInstallationStatus,
  updatePlatformPlan,
} from "@/lib/api/platform";
import type { PlatformPlan, PlatformPlanUpdateInput } from "@/lib/api/platform";
import type {
  PlatformInstallationRequest,
  PlatformInstallationRequestsResponse,
  PlatformInstallationStatus,
  PlatformMetrics,
  PlatformOrganization,
  PlatformStatusChange,
} from "@/lib/api/types";
import { formatBytes, formatIsoDate, usagePercent } from "@/lib/format";
import { useSession } from "@/lib/session";
import { modelLabel } from "@/lib/storage-labels";
import { type Load, useLoad } from "@/lib/use-load";

/* SPEC-502: consola de plataforma con datos reales. La API valida el rol de Super Admin en cada petición. */

const PAGE_SIZE = 20;
const METRICS_LOAD_ERROR = "No pudimos cargar el resumen de la plataforma. Inténtalo de nuevo.";
const METRICS_REFRESH_ERROR = "No pudimos actualizar el resumen. Recarga la página.";
const ORGANIZATIONS_LOAD_ERROR = "No pudimos cargar las organizaciones. Inténtalo de nuevo.";
const PENDING_LOAD_ERROR = "No pudimos cargar las solicitudes pendientes. Inténtalo de nuevo.";
const APPROVED_LOAD_ERROR = "No pudimos cargar las instalaciones en curso. Inténtalo de nuevo.";
const APPROVED_REFRESH_ERROR = "No pudimos actualizar las instalaciones en curso. Recarga la página.";

const STALE_ORGANIZATION_CODES: ReadonlySet<string> = new Set(["INVALID_ORGANIZATION_TRANSITION", "ORGANIZATION_NOT_FOUND"]);
const STALE_INSTALLATION_CODES: ReadonlySet<string> = new Set(["INVALID_INSTALLATION_TRANSITION", "INSTALLATION_NOT_FOUND"]);
const ALREADY_REVIEWED_CODES: ReadonlySet<string> = new Set(["REQUEST_ALREADY_REVIEWED"]);
const INSTALLATION_PAGE_SIZE = 10;

/* SPEC-504: catálogo de planes. La API valida reglas de negocio; aquí solo la forma de los campos. */
const PLANS_LOAD_ERROR = "No pudimos cargar los planes. Inténtalo de nuevo.";
const PLANS_REFRESH_ERROR = "No pudimos actualizar la lista de planes. Recarga la página.";
const PLAN_SAVE_FALLBACK = "No se pudo guardar el plan.";
/** NOT_FOUND: el plan ya no existe, así que la lista se recarga. */
const PLAN_STALE_CODES: ReadonlySet<string> = new Set(["NOT_FOUND"]);
/** Errores que cierran el diálogo: no tienen arreglo desde el formulario. */
const PLAN_CLOSING_CODES: ReadonlySet<string> = new Set(["NOT_FOUND", "PLAN_NOT_EDITABLE"]);
/** Errores que se muestran dentro del diálogo para corregir el dato sin cerrarlo. */
const PLAN_INLINE_CODES: ReadonlySet<string> = new Set(["PLAN_LIMIT_BELOW_USAGE", "VALIDATION_ERROR"]);
const BYTES_PER_GB = 1e9;
const PLAN_DESCRIPTION_MAX = 500;

const ORGANIZATION_STATUS_LABELS: Record<PlatformOrganization["status"], string> = {
  active: "Activa",
  suspended: "Suspendida",
  cancelled: "Cancelada",
};

const INSTALLATION_STATUS_LABELS: Record<PlatformInstallationStatus, string> = {
  "No solicitada": "No solicitada",
  Pendiente: "Pendiente",
  "En proceso": "En proceso",
  Operativa: "Operativa",
  Fallida: "Fallida",
};

type OrganizationAction = "suspend" | "reactivate";
type OrganizationChange = { organization: PlatformOrganization; action: OrganizationAction };
type InstallationAction = { label: string; next: PlatformInstallationStatus; confirm: boolean };
type InstallationChange = { request: PlatformInstallationRequest; action: InstallationAction };
type ApprovalInput = { operatorName: string; hostReference: string };

/** Transiciones que la consola ofrece. Operativa y Fallida no tienen acciones. */
const INSTALLATION_ACTIONS: Partial<Record<PlatformInstallationStatus, InstallationAction[]>> = {
  Pendiente: [{ label: "Marcar en proceso", next: "En proceso", confirm: false }],
  "En proceso": [
    { label: "Marcar operativa", next: "Operativa", confirm: false },
    { label: "Marcar fallida", next: "Fallida", confirm: true },
  ],
};

/** Consola de plataforma (SPEC-502): resumen, organizaciones e instalaciones. */
export function PlatformConsole() {
  const { session } = useSession();
  return <>
    <div className="page-heading"><p className="eyebrow">CONSOLA DE PLATAFORMA</p><h1>Resumen global</h1><p>Estado general de Nexus y sus organizaciones.</p></div>
    <nav aria-label="Secciones de la consola"><p>
      <a href="#resumen">Resumen</a> · <a href="#organizaciones">Organizaciones</a> · <a href="#instalaciones">Instalaciones</a> · <a href="#planes">Planes</a>
    </p></nav>
    {session && <PlatformContent token={session.accessToken} selfOrganizationId={session.organization.id} />}
  </>;
}

function PlatformContent({ token, selfOrganizationId }: { token: string; selfOrganizationId: string }) {
  const { failSession } = useSession();
  const notify = useToast();
  const fetchMetrics = useCallback((signal: AbortSignal) => getPlatformMetrics(token, { signal }), [token]);
  const { state: metrics, reload: reloadMetrics, set: setMetrics } = useLoad(fetchMetrics, true, METRICS_LOAD_ERROR);

  // Suspender o reactivar cambia las cifras: recarga silenciosa, sin pasar por el estado de carga.
  const refreshMetrics = useCallback(async () => {
    try {
      setMetrics({ status: "ready", data: await getPlatformMetrics(token) });
    } catch (error) {
      if (!failSession(error)) notify("error", METRICS_REFRESH_ERROR);
    }
  }, [token, failSession, notify, setMetrics]);

  // SPEC-504: un cambio de plan altera los límites que muestran las organizaciones; se recargan con una clave nueva.
  const [organizationsKey, setOrganizationsKey] = useState(0);
  const refreshAfterPlanChange = useCallback(async () => {
    setOrganizationsKey((key) => key + 1);
    await refreshMetrics();
  }, [refreshMetrics]);

  return <>
    <MetricsSection state={metrics} onRetry={reloadMetrics} />
    <OrganizationsSection key={organizationsKey} token={token} selfOrganizationId={selfOrganizationId} onChanged={refreshMetrics} />
    <InstallationsSection token={token} />
    <PlansSection token={token} onChanged={refreshAfterPlanChange} />
  </>;
}

/**
 * Último estado de un bloque, para aplicar cambios de fila tras un await sin usar una copia obsoleta.
 * `commit` guarda el estado nuevo de inmediato, así dos respuestas seguidas no se pisan.
 */
function useLatestState<T>(state: T, set: (next: T) => void) {
  const ref = useRef(state);
  useEffect(() => {
    ref.current = state;
  });
  const commit = useCallback((next: T) => {
    ref.current = next;
    set(next);
  }, [set]);
  return { read: () => ref.current, commit };
}

/** Aplica un cambio a los elementos de un bloque cargado. Si el bloque no está listo, lo devuelve igual. */
function patchReady<R extends { items: unknown[] }>(state: Load<R>, patch: (items: R["items"]) => R["items"]): Load<R> {
  if (state.status !== "ready") return state;
  return { status: "ready", data: { ...state.data, items: patch(state.data.items) } };
}

/** Ids en curso para mostrar un spinner por fila. */
function useBusyIds() {
  const [ids, setIds] = useState<ReadonlySet<string>>(() => new Set());
  const start = useCallback((id: string) => setIds((current) => new Set(current).add(id)), []);
  const finish = useCallback((id: string) => setIds((current) => {
    const next = new Set(current);
    next.delete(id);
    return next;
  }), []);
  return { ids, start, finish };
}

function hasCode(error: unknown, codes: ReadonlySet<string>) {
  return error instanceof ApiError && codes.has(error.code);
}

/** Página de una lista en cliente (SPEC-502 §7). Si la lista se encoge, vuelve a la última página válida. */
function pageOf<T>(items: T[], offset: number): { rows: T[]; offset: number } {
  const safe = offset >= items.length ? Math.max(0, Math.floor((items.length - 1) / INSTALLATION_PAGE_SIZE) * INSTALLATION_PAGE_SIZE) : offset;
  return { rows: items.slice(safe, safe + INSTALLATION_PAGE_SIZE), offset: safe };
}

function ListPagination({ total, offset, onChange }: { total: number; offset: number; onChange: (next: number) => void }) {
  return <div className="platform-pagination">
    <span>{total === 0 ? 0 : offset + 1}–{Math.min(offset + INSTALLATION_PAGE_SIZE, total)} de {total}</span>
    <button type="button" className="button" disabled={offset === 0} onClick={() => onChange(Math.max(0, offset - INSTALLATION_PAGE_SIZE))}>Anterior</button>
    <button type="button" className="button" disabled={offset + INSTALLATION_PAGE_SIZE >= total} onClick={() => onChange(offset + INSTALLATION_PAGE_SIZE)}>Siguiente</button>
  </div>;
}

function MetricsSection({ state, onRetry }: { state: Load<PlatformMetrics>; onRetry: () => void }) {
  if (state.status === "loading") return <section id="resumen" className="panel platform-section"><LoadingIndicator>Cargando el resumen…</LoadingIndicator></section>;
  if (state.status === "error") return <section id="resumen" className="platform-section"><Notice title="No se pudo cargar el resumen" message={state.message} onRetry={onRetry} /></section>;
  const { organizations, activeUsers, usedBytes, subscriptionsByPlan } = state.data;
  return <section id="resumen" className="admin-metrics-grid platform-section" aria-label="Resumen de la plataforma">
    <article className="admin-metric-card"><span>ORGANIZACIONES ACTIVAS</span><b>{organizations.active}</b></article>
    <article className="admin-metric-card"><span>ORGANIZACIONES SUSPENDIDAS</span><b>{organizations.suspended}</b></article>
    <article className="admin-metric-card"><span>ORGANIZACIONES CANCELADAS</span><b>{organizations.cancelled}</b></article>
    <article className="admin-metric-card"><span>USUARIOS ACTIVOS</span><b>{activeUsers}</b></article>
    <article className="admin-metric-card"><span>ALMACENAMIENTO USADO</span><b>{formatBytes(usedBytes)}</b></article>
    <article className="admin-metric-card platform-wide-card"><span>SUSCRIPCIONES POR PLAN</span>
      {subscriptionsByPlan.length === 0
        ? <small>Sin suscripciones registradas</small>
        : <ul className="platform-plan-list">{subscriptionsByPlan.map((plan) => <li key={plan.planName}><span>{plan.planName}</span><b>{plan.count}</b></li>)}</ul>}
    </article>
  </section>;
}

function OrganizationsSection({ token, selfOrganizationId, onChanged }: { token: string; selfOrganizationId: string; onChanged: () => Promise<void> }) {
  const { failSession } = useSession();
  const notify = useToast();
  const [offset, setOffset] = useState(0);
  const [pendingChange, setPendingChange] = useState<OrganizationChange | null>(null);
  const busy = useBusyIds();

  const fetchOrganizations = useCallback((signal: AbortSignal) => listPlatformOrganizations(token, { limit: PAGE_SIZE, offset }, { signal }), [token, offset]);
  const { state, reload, set } = useLoad(fetchOrganizations, true, ORGANIZATIONS_LOAD_ERROR);
  const latest = useLatestState(state, set);

  function goToPage(next: number) {
    set({ status: "loading" });
    setOffset(next);
  }

  function patchOrganization(change: PlatformStatusChange) {
    latest.commit(patchReady(latest.read(), (items) => items.map((item) => (item.id === change.id ? { ...item, status: change.status } : item))));
  }

  async function runChange({ organization, action }: OrganizationChange) {
    busy.start(organization.id);
    try {
      const change = action === "suspend" ? await suspendOrganization(token, organization.id) : await reactivateOrganization(token, organization.id);
      patchOrganization(change);
      notify("success", action === "suspend" ? "Organización suspendida." : "Organización reactivada.");
      void onChanged();
    } catch (error) {
      if (failSession(error)) return;
      notify("error", platformErrorMessage(error, "No se pudo actualizar la organización."));
      if (hasCode(error, STALE_ORGANIZATION_CODES)) reload();
    } finally {
      busy.finish(organization.id);
    }
  }

  return <section id="organizaciones" className="panel platform-section" aria-labelledby="organizaciones-title">
    <div className="settings-header-row"><div><h2 id="organizaciones-title" className="settings-section-title">Organizaciones</h2><p className="settings-section-subtitle">Organizaciones registradas en la plataforma.</p></div></div>
    {state.status === "loading" && <LoadingIndicator>Cargando organizaciones…</LoadingIndicator>}
    {state.status === "error" && <Notice title="No se pudieron cargar las organizaciones" message={state.message} onRetry={reload} />}
    {state.status === "ready" && (state.data.items.length === 0
      ? <p className="settings-state-box">No hay organizaciones registradas</p>
      : <>
        <div className="settings-table-wrapper"><table className="settings-table">
          <thead><tr><th>Organización</th><th>Estado</th><th>Plan</th><th>Almacenamiento</th><th>Miembros</th><th>Modelo</th><th>Creada</th><th>Acción</th></tr></thead>
          <tbody>{state.data.items.map((organization) => <OrganizationRow key={organization.id} organization={organization} isSelf={organization.id === selfOrganizationId} busy={busy.ids.has(organization.id)} onRequest={(action) => setPendingChange({ organization, action })} />)}</tbody>
        </table></div>
        <div className="platform-pagination">
          <span>{state.data.items.length ? offset + 1 : 0}–{offset + state.data.items.length} de {state.data.total}</span>
          <button type="button" className="button" disabled={offset === 0} onClick={() => goToPage(Math.max(0, offset - PAGE_SIZE))}>Anterior</button>
          <button type="button" className="button" disabled={offset + PAGE_SIZE >= state.data.total} onClick={() => goToPage(offset + PAGE_SIZE)}>Siguiente</button>
        </div>
      </>)}
    {pendingChange && <Dialog labelledBy="organization-change-title" onClose={() => setPendingChange(null)}>
      <h2 id="organization-change-title">{pendingChange.action === "suspend" ? `¿Suspender «${pendingChange.organization.name}»?` : `¿Reactivar «${pendingChange.organization.name}»?`}</h2>
      <p>{pendingChange.action === "suspend" ? "Sus miembros perderán el acceso y se revocarán sus sesiones activas." : "Sus miembros recuperarán el acceso a Nexus."}</p>
      <div className="drive-modal-actions">
        <button type="button" className="drive-subtle-button" onClick={() => setPendingChange(null)}>Cancelar</button>
        <button type="button" className={`button ${pendingChange.action === "suspend" ? "button-danger" : "button-primary"}`} onClick={() => { const change = pendingChange; setPendingChange(null); void runChange(change); }}>{pendingChange.action === "suspend" ? "Suspender" : "Reactivar"}</button>
      </div>
    </Dialog>}
  </section>;
}

function OrganizationRow({ organization, isSelf, busy, onRequest }: { organization: PlatformOrganization; isSelf: boolean; busy: boolean; onRequest: (action: OrganizationAction) => void }) {
  const action: OrganizationAction = organization.status === "active" ? "suspend" : "reactivate";
  const blocked = action === "suspend" && isSelf;
  const badgeClass = organization.status === "suspended" ? "settings-badge-suspended" : organization.status === "active" ? "settings-badge-admin" : "settings-badge-colab";
  const storage = organization.storageLimitBytes === null
    ? "—"
    : `${formatBytes(organization.usedBytes)} / ${formatBytes(organization.storageLimitBytes)} (${usagePercent(organization.usedBytes, organization.storageLimitBytes)}%)`;
  return <tr>
    <td className="settings-cell-name">{organization.name}</td>
    <td><span className={`settings-badge ${badgeClass}`}>{ORGANIZATION_STATUS_LABELS[organization.status]}</span></td>
    <td>{organization.planName ?? "Sin plan"}</td>
    <td className="settings-cell-muted">{storage}</td>
    <td>{organization.memberCount}</td>
    <td>{modelLabel(organization.deploymentModel)}</td>
    <td className="settings-cell-muted">{formatIsoDate(organization.createdAt)}</td>
    <td><div className="settings-actions-cell">
      <button type="button" className={`settings-action-btn${action === "suspend" ? " settings-action-danger" : ""}`} disabled={busy || blocked} onClick={() => onRequest(action)}>
        {action === "suspend" ? "Suspender" : "Reactivar"}
      </button>
      {blocked && <span className="settings-cell-muted">Es tu organización</span>}
      {busy && <span className="platform-spinner" role="img" aria-label={`Actualizando ${organization.name}`} />}
    </div></td>
  </tr>;
}

function InstallationsSection({ token }: { token: string }) {
  const { failSession } = useSession();
  const notify = useToast();
  const [approving, setApproving] = useState<PlatformInstallationRequest | null>(null);
  const [rejecting, setRejecting] = useState<PlatformInstallationRequest | null>(null);
  const [pendingInstallation, setPendingInstallation] = useState<InstallationChange | null>(null);
  const pendingBusy = useBusyIds();
  const installationBusy = useBusyIds();
  const [pendingOffset, setPendingOffset] = useState(0);
  const [approvedOffset, setApprovedOffset] = useState(0);

  const fetchPending = useCallback((signal: AbortSignal) => listPlatformInstallationRequests(token, "Pendiente", { signal }), [token]);
  const { state: pendingState, reload: reloadPending, set: setPending } = useLoad(fetchPending, true, PENDING_LOAD_ERROR);
  const pendingLatest = useLatestState(pendingState, setPending);

  const fetchApproved = useCallback((signal: AbortSignal) => fetchApprovedInstallations(token, signal), [token]);
  const { state: approvedState, reload: reloadApproved, set: setApproved } = useLoad(fetchApproved, true, APPROVED_LOAD_ERROR);

  // Recarga silenciosa de instalaciones en curso (tras aprobar, rechazar o cambiar un estado).
  const refreshApproved = useCallback(async () => {
    try {
      setApproved({ status: "ready", data: await fetchApprovedInstallations(token) });
    } catch (error) {
      if (!failSession(error)) notify("error", APPROVED_REFRESH_ERROR);
    }
  }, [token, failSession, notify, setApproved]);

  function removePendingRequest(id: string) {
    pendingLatest.commit(patchReady(pendingLatest.read(), (items) => items.filter((item) => item.id !== id)));
  }

  async function approve(request: PlatformInstallationRequest, input: ApprovalInput) {
    pendingBusy.start(request.id);
    try {
      await approveInstallationRequest(token, request.id, input);
      setApproving(null);
      removePendingRequest(request.id);
      notify("success", "Solicitud aprobada. La instalación quedó pendiente.");
      void refreshApproved();
    } catch (error) {
      if (failSession(error)) return;
      notify("error", platformErrorMessage(error, "No se pudo aprobar la solicitud."));
      if (hasCode(error, ALREADY_REVIEWED_CODES)) {
        setApproving(null);
        reloadPending();
        reloadApproved();
      }
    } finally {
      pendingBusy.finish(request.id);
    }
  }

  async function reject(request: PlatformInstallationRequest) {
    pendingBusy.start(request.id);
    try {
      await rejectInstallationRequest(token, request.id);
      setRejecting(null);
      removePendingRequest(request.id);
      notify("success", "Solicitud rechazada.");
      void refreshApproved();
    } catch (error) {
      if (failSession(error)) return;
      notify("error", platformErrorMessage(error, "No se pudo rechazar la solicitud."));
      if (hasCode(error, ALREADY_REVIEWED_CODES)) {
        setRejecting(null);
        reloadPending();
        reloadApproved();
      }
    } finally {
      pendingBusy.finish(request.id);
    }
  }

  async function changeInstallation({ request, action }: InstallationChange) {
    const installationId = request.installationId;
    if (!installationId) return;
    installationBusy.start(installationId);
    try {
      await updateInstallationStatus(token, installationId, { status: action.next });
      notify("success", "Instalación actualizada.");
      await refreshApproved();
    } catch (error) {
      if (failSession(error)) return;
      notify("error", platformErrorMessage(error, "No se pudo actualizar la instalación."));
      if (hasCode(error, STALE_INSTALLATION_CODES)) void refreshApproved();
    } finally {
      installationBusy.finish(installationId);
    }
  }

  function requestInstallationChange(request: PlatformInstallationRequest, action: InstallationAction) {
    if (action.confirm) setPendingInstallation({ request, action });
    else void changeInstallation({ request, action });
  }

  const pendingPage = pendingState.status === "ready" ? pageOf(pendingState.data.items, pendingOffset) : null;
  const approvedPage = approvedState.status === "ready" ? pageOf(approvedState.data.items, approvedOffset) : null;

  return <div id="instalaciones" className="dashboard-lower-grid platform-section">
    <section className="panel" aria-labelledby="pendientes-title">
      <div className="settings-header-row"><div><h2 id="pendientes-title" className="settings-section-title">Solicitudes pendientes</h2><p className="settings-section-subtitle">Solicitudes de instalación esperando revisión.</p></div></div>
      {pendingState.status === "loading" && <LoadingIndicator>Cargando solicitudes…</LoadingIndicator>}
      {pendingState.status === "error" && <Notice title="No se pudieron cargar las solicitudes" message={pendingState.message} onRetry={reloadPending} />}
      {pendingState.status === "ready" && (pendingState.data.items.length === 0
        ? <p className="settings-state-box">No hay solicitudes pendientes</p>
        : <div className="settings-table-wrapper"><table className="settings-table">
          <thead><tr><th>Organización</th><th>Modelo</th><th>Fecha</th><th>Acciones</th></tr></thead>
          <tbody>{(pendingPage?.rows ?? []).map((request) => {
            const busy = pendingBusy.ids.has(request.id);
            return <tr key={request.id}>
              <td className="settings-cell-name">{request.organizationName}</td>
              <td>{modelLabel(request.requestedModel)}</td>
              <td className="settings-cell-muted">{formatIsoDate(request.createdAt)}</td>
              <td><div className="settings-actions-cell">
                <button type="button" className="settings-action-btn" disabled={busy} onClick={() => setApproving(request)}>Aprobar</button>
                <button type="button" className="settings-action-btn settings-action-danger" disabled={busy} onClick={() => setRejecting(request)}>Rechazar</button>
              </div></td>
            </tr>;
          })}</tbody>
        </table></div>)}
      {pendingState.status === "ready" && pendingState.data.items.length > 0 && <ListPagination total={pendingState.data.items.length} offset={pendingPage?.offset ?? 0} onChange={setPendingOffset} />}
    </section>

    <section className="panel" aria-labelledby="curso-title">
      <div className="settings-header-row"><div><h2 id="curso-title" className="settings-section-title">Instalaciones en curso</h2><p className="settings-section-subtitle">Avance de las instalaciones aprobadas.</p></div></div>
      {approvedState.status === "loading" && <LoadingIndicator>Cargando instalaciones…</LoadingIndicator>}
      {approvedState.status === "error" && <Notice title="No se pudieron cargar las instalaciones" message={approvedState.message} onRetry={reloadApproved} />}
      {approvedState.status === "ready" && (approvedState.data.items.length === 0
        ? <p className="settings-state-box">No hay instalaciones en curso</p>
        : <div className="settings-table-wrapper"><table className="settings-table">
          <thead><tr><th>Organización</th><th>Modelo</th><th>Operador</th><th>Estado</th><th>Acciones</th></tr></thead>
          <tbody>{(approvedPage?.rows ?? []).map((request) => <InstallationRow key={request.id} request={request} busy={request.installationId !== null && installationBusy.ids.has(request.installationId)} onAction={(action) => requestInstallationChange(request, action)} />)}</tbody>
        </table></div>)}
      {approvedState.status === "ready" && approvedState.data.items.length > 0 && <ListPagination total={approvedState.data.items.length} offset={approvedPage?.offset ?? 0} onChange={setApprovedOffset} />}
    </section>

    {approving && <ApproveDialog request={approving} busy={pendingBusy.ids.has(approving.id)} onCancel={() => setApproving(null)} onApprove={(input) => void approve(approving, input)} />}
    {rejecting && <Dialog labelledBy="reject-title" onClose={() => setRejecting(null)} disabled={pendingBusy.ids.has(rejecting.id)}>
      <h2 id="reject-title">¿Rechazar la solicitud de «{rejecting.organizationName}»?</h2>
      <p>No se creará ninguna instalación para esta solicitud.</p>
      <div className="drive-modal-actions">
        <button type="button" className="drive-subtle-button" onClick={() => setRejecting(null)} disabled={pendingBusy.ids.has(rejecting.id)}>Cancelar</button>
        <button type="button" className="button button-danger" onClick={() => void reject(rejecting)} disabled={pendingBusy.ids.has(rejecting.id)}>{pendingBusy.ids.has(rejecting.id) ? "Rechazando…" : "Rechazar"}</button>
      </div>
    </Dialog>}
    {pendingInstallation && <Dialog labelledBy="installation-failed-title" onClose={() => setPendingInstallation(null)}>
      <h2 id="installation-failed-title">¿Marcar como fallida la instalación de «{pendingInstallation.request.organizationName}»?</h2>
      <p>Desde esta pantalla no se podrá cambiar el estado después.</p>
      <div className="drive-modal-actions">
        <button type="button" className="drive-subtle-button" onClick={() => setPendingInstallation(null)}>Cancelar</button>
        <button type="button" className="button button-danger" onClick={() => { const change = pendingInstallation; setPendingInstallation(null); void changeInstallation(change); }}>Marcar fallida</button>
      </div>
    </Dialog>}
  </div>;
}

function fetchApprovedInstallations(token: string, signal?: AbortSignal) {
  return listPlatformInstallationRequests(token, "Aprobada", { signal }).then(keepInstallations);
}

/** Solo las solicitudes con instalación: sin `installationId` no hay nada que avanzar. */
function keepInstallations(response: PlatformInstallationRequestsResponse): PlatformInstallationRequestsResponse {
  return { items: response.items.filter((item) => item.installationId !== null) };
}

function InstallationRow({ request, busy, onAction }: { request: PlatformInstallationRequest; busy: boolean; onAction: (action: InstallationAction) => void }) {
  const status = request.installationStatus;
  const actions = status ? (INSTALLATION_ACTIONS[status] ?? []) : [];
  const badgeClass = status === "Operativa" ? "settings-badge-admin" : status === "Fallida" ? "settings-badge-suspended" : "settings-badge-colab";
  return <tr>
    <td className="settings-cell-name">{request.organizationName}</td>
    <td>{modelLabel(request.requestedModel)}</td>
    <td className="settings-cell-muted">{request.operatorName ?? "—"}</td>
    <td><span className={`settings-badge ${badgeClass}`}>{status ? INSTALLATION_STATUS_LABELS[status] : "—"}</span></td>
    <td><div className="settings-actions-cell">
      {actions.map((action) => <button key={action.next} type="button" className={`settings-action-btn${action.confirm ? " settings-action-danger" : ""}`} disabled={busy} onClick={() => onAction(action)}>{action.label}</button>)}
      {busy && <span className="platform-spinner" role="img" aria-label="Actualizando instalación" />}
    </div></td>
  </tr>;
}

/** Reglas del formulario de aprobación: operador obligatorio (≤150 tras recortar) y referencia opcional (≤255). */
function validateApproval(operatorName: string, hostReference: string) {
  const operator = operatorName.trim();
  const host = hostReference.trim();
  const errors: { operator?: string; host?: string } = {};
  if (operator.length === 0) errors.operator = "Escribe el nombre del operador.";
  else if (operator.length > 150) errors.operator = "El nombre del operador no puede tener más de 150 caracteres.";
  if (host.length > 255) errors.host = "La referencia del servidor no puede tener más de 255 caracteres.";
  return errors;
}

function ApproveDialog({ request, busy, onCancel, onApprove }: { request: PlatformInstallationRequest; busy: boolean; onCancel: () => void; onApprove: (input: ApprovalInput) => void }) {
  const [operatorName, setOperatorName] = useState("");
  const [hostReference, setHostReference] = useState("");
  const [errors, setErrors] = useState<{ operator?: string; host?: string }>({});

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const nextErrors = validateApproval(operatorName, hostReference);
    setErrors(nextErrors);
    if (nextErrors.operator || nextErrors.host) return;
    onApprove({ operatorName: operatorName.trim(), hostReference: hostReference.trim() });
  }

  return <Dialog labelledBy="approve-title" onClose={onCancel} disabled={busy}>
    <h2 id="approve-title">Aprobar instalación de «{request.organizationName}»</h2>
    <p>Indica quién se encarga de la instalación. Modelo solicitado: {modelLabel(request.requestedModel)}.</p>
    <form onSubmit={handleSubmit} noValidate>
      <div className="field">
        <label htmlFor="approve-operator">Operador</label>
        <input id="approve-operator" className="drive-modal-input" value={operatorName} autoComplete="off" disabled={busy} aria-invalid={errors.operator ? true : undefined} aria-describedby={errors.operator ? "approve-operator-error" : undefined} onChange={(event) => setOperatorName(event.target.value)} />
        {errors.operator && <p id="approve-operator-error" className="platform-field-error" role="alert">{errors.operator}</p>}
      </div>
      <div className="field">
        <label htmlFor="approve-host">Referencia del servidor (opcional)</label>
        <input id="approve-host" className="drive-modal-input" value={hostReference} autoComplete="off" disabled={busy} aria-invalid={errors.host ? true : undefined} aria-describedby={errors.host ? "approve-host-error" : undefined} onChange={(event) => setHostReference(event.target.value)} />
        {errors.host && <p id="approve-host-error" className="platform-field-error" role="alert">{errors.host}</p>}
      </div>
      <div className="drive-modal-actions">
        <button type="button" className="drive-subtle-button" onClick={onCancel} disabled={busy}>Cancelar</button>
        <button type="submit" className="drive-primary-button" disabled={busy}>{busy ? "Aprobando…" : "Aprobar"}</button>
      </div>
    </form>
  </Dialog>;
}

type PlanForm = { price: string; storageGb: string; userLimit: string; description: string };
type PlanFormErrors = Partial<Record<keyof PlanForm, string>>;

/** GB enteros a partir de bytes: la API guarda bytes y el formulario edita GB. */
function storageGbOf(plan: PlatformPlan) {
  return Math.round(plan.storageLimitBytes / BYTES_PER_GB);
}

/** SPEC-504: catálogo de planes (GET /plans, público) y edición por Super Admin (PATCH /platform/plans/:id). */
function PlansSection({ token, onChanged }: { token: string; onChanged: () => Promise<void> }) {
  const { failSession } = useSession();
  const notify = useToast();
  const fetchPlans = useCallback((signal: AbortSignal) => getPlans({ signal }), []);
  const { state, reload, set } = useLoad(fetchPlans, true, PLANS_LOAD_ERROR);
  const [editing, setEditing] = useState<PlatformPlan | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const busy = useBusyIds();
  // Plan cuyo botón Editar recupera el foco al cerrar el diálogo.
  const returnFocusId = useRef<string | null>(null);

  // Recarga silenciosa: la tabla no se desmonta, así el foco puede volver a su botón.
  const refreshPlans = useCallback(async () => {
    try {
      set({ status: "ready", data: await getPlans() });
    } catch (error) {
      if (!failSession(error)) notify("error", PLANS_REFRESH_ERROR);
    }
  }, [failSession, notify, set]);

  useEffect(() => {
    if (editing) return;
    const id = returnFocusId.current;
    if (!id) return;
    returnFocusId.current = null;
    document.getElementById(`plan-edit-${id}`)?.focus();
  }, [editing]);

  function openEditor(plan: PlatformPlan) {
    setEditError(null);
    setEditing(plan);
  }

  function closeEditor(planId: string) {
    returnFocusId.current = planId;
    setEditError(null);
    setEditing(null);
  }

  async function savePlan(plan: PlatformPlan, input: PlatformPlanUpdateInput) {
    setEditError(null);
    busy.start(plan.id);
    try {
      await updatePlatformPlan(token, plan.id, input);
      closeEditor(plan.id);
      notify("success", "Plan actualizado.");
      void refreshPlans();
      void onChanged();
    } catch (error) {
      if (failSession(error)) return;
      const message = platformErrorMessage(error, PLAN_SAVE_FALLBACK);
      if (hasCode(error, PLAN_CLOSING_CODES)) {
        closeEditor(plan.id);
        notify("error", message);
        if (hasCode(error, PLAN_STALE_CODES)) void refreshPlans();
      } else if (hasCode(error, PLAN_INLINE_CODES)) {
        // Validación o límite de uso: el diálogo sigue abierto para corregir el dato.
        setEditError(message);
      } else {
        // Resto de errores (403, red, otros): aviso como en las demás secciones; el diálogo sigue abierto.
        notify("error", message);
      }
    } finally {
      busy.finish(plan.id);
    }
  }

  return <section id="planes" className="panel platform-section" aria-labelledby="planes-title">
    <div className="settings-header-row"><div><h2 id="planes-title" className="settings-section-title">Planes</h2><p className="settings-section-subtitle">Catálogo de planes. Los cambios afectan a las organizaciones suscritas.</p></div></div>
    {state.status === "loading" && <LoadingIndicator>Cargando planes…</LoadingIndicator>}
    {state.status === "error" && <Notice title="No se pudieron cargar los planes" message={state.message} onRetry={reload} />}
    {state.status === "ready" && (state.data.items.length === 0
      ? <p className="settings-state-box">No hay planes registrados</p>
      : <div className="settings-table-wrapper"><table className="settings-table">
        <thead><tr><th>Plan</th><th>Precio (US$/mes)</th><th>Almacenamiento (GB)</th><th>Usuarios</th><th>Vigencia</th><th>Acción</th></tr></thead>
        <tbody>{state.data.items.map((plan) => <PlanRow key={plan.id} plan={plan} onEdit={() => openEditor(plan)} />)}</tbody>
      </table></div>)}
    {editing && <PlanEditDialog plan={editing} busy={busy.ids.has(editing.id)} error={editError} onCancel={() => closeEditor(editing.id)} onSave={(input) => void savePlan(editing, input)} />}
  </section>;
}

function PlanRow({ plan, onEdit }: { plan: PlatformPlan; onEdit: () => void }) {
  const validity = plan.validityDays === null ? "Sin vigencia" : plan.validityDays === 1 ? "1 día" : `${plan.validityDays} días`;
  // Solo evita un intento inútil: la API sigue siendo la que decide (responde 422 PLAN_NOT_EDITABLE).
  const isDemo = plan.name === "Demo";
  const noteId = `plan-demo-note-${plan.id}`;
  return <tr>
    <td className="settings-cell-name">{plan.name}</td>
    <td>{plan.priceMonthly.toFixed(2)}</td>
    <td>{storageGbOf(plan)}</td>
    <td>{plan.userLimit}</td>
    <td className="settings-cell-muted">{validity}</td>
    <td><div className="settings-actions-cell">
      <button id={`plan-edit-${plan.id}`} type="button" className="settings-action-btn" aria-label={`Editar plan ${plan.name}`} disabled={isDemo} aria-describedby={isDemo ? noteId : undefined} onClick={onEdit}>Editar</button>
      {isDemo && <span id={noteId} className="settings-cell-muted">El plan Demo no se puede editar.</span>}
    </div></td>
  </tr>;
}

/** Reglas de forma del formulario de plan. La regla de negocio (p. ej. uso frente al límite) la decide la API. */
function validatePlanForm(form: PlanForm): PlanFormErrors {
  const errors: PlanFormErrors = {};
  if (!/^\d+(\.\d{1,2})?$/.test(form.price.trim())) errors.price = "Escribe un precio en dólares, con punto decimal y hasta 2 decimales (por ejemplo, 19.99).";
  if (!/^\d+$/.test(form.storageGb.trim()) || Number(form.storageGb) < 1) errors.storageGb = "Escribe un número entero de GB, mayor que 0.";
  if (!/^\d+$/.test(form.userLimit.trim()) || Number(form.userLimit) < 1) errors.userLimit = "Escribe un número entero de usuarios, mayor que 0.";
  const description = form.description.trim();
  if (description.length === 0) errors.description = "Escribe una descripción para el plan.";
  else if (Array.from(description).length > PLAN_DESCRIPTION_MAX) errors.description = `La descripción no puede tener más de ${PLAN_DESCRIPTION_MAX} caracteres.`;
  return errors;
}

/** Solo los campos que cambiaron, comparados en las unidades que muestra el formulario. */
function planChanges(plan: PlatformPlan, form: PlanForm): PlatformPlanUpdateInput {
  const input: PlatformPlanUpdateInput = {};
  const priceMonthly = Number(form.price.trim());
  if (priceMonthly !== plan.priceMonthly) input.priceMonthly = priceMonthly;
  const storageLimitGb = Number(form.storageGb.trim());
  if (storageLimitGb !== storageGbOf(plan)) input.storageLimitGb = storageLimitGb;
  const userLimit = Number(form.userLimit.trim());
  if (userLimit !== plan.userLimit) input.userLimit = userLimit;
  const description = form.description.trim();
  if (description !== plan.description.trim()) input.description = description;
  return input;
}

function PlanEditDialog({ plan, busy, error, onCancel, onSave }: { plan: PlatformPlan; busy: boolean; error: string | null; onCancel: () => void; onSave: (input: PlatformPlanUpdateInput) => void }) {
  const [form, setForm] = useState<PlanForm>(() => ({
    price: String(plan.priceMonthly),
    storageGb: String(storageGbOf(plan)),
    userLimit: String(plan.userLimit),
    description: plan.description,
  }));
  const [errors, setErrors] = useState<PlanFormErrors>({});
  const [noChanges, setNoChanges] = useState(false);
  const firstFieldRef = useRef<HTMLInputElement>(null);

  // Dialog enfoca al abrir su primer elemento (la × de cierre). Este efecto corre después y deja el foco en el primer campo.
  useEffect(() => {
    firstFieldRef.current?.focus();
  }, []);

  function update(field: keyof PlanForm, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
    setNoChanges(false);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const nextErrors = validatePlanForm(form);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;
    const input = planChanges(plan, form);
    if (Object.keys(input).length === 0) {
      setNoChanges(true);
      return;
    }
    onSave(input);
  }

  return <Dialog labelledBy="plan-edit-title" onClose={onCancel} disabled={busy}>
    <h2 id="plan-edit-title">Editar plan «{plan.name}»</h2>
    <p>Los cambios se aplican a las organizaciones suscritas a este plan.</p>
    <form onSubmit={handleSubmit} noValidate>
      <div className="field">
        <label htmlFor="plan-price">Precio mensual (US$)</label>
        <input id="plan-price" ref={firstFieldRef} className="drive-modal-input" inputMode="decimal" autoComplete="off" value={form.price} aria-invalid={errors.price ? true : undefined} aria-describedby={errors.price ? "plan-price-error" : undefined} onChange={(event) => update("price", event.target.value)} />
        {errors.price && <p id="plan-price-error" className="platform-field-error" role="alert">{errors.price}</p>}
      </div>
      <div className="field">
        <label htmlFor="plan-storage">Almacenamiento (GB)</label>
        <input id="plan-storage" className="drive-modal-input" inputMode="numeric" autoComplete="off" value={form.storageGb} aria-invalid={errors.storageGb ? true : undefined} aria-describedby={errors.storageGb ? "plan-storage-error" : undefined} onChange={(event) => update("storageGb", event.target.value)} />
        {errors.storageGb && <p id="plan-storage-error" className="platform-field-error" role="alert">{errors.storageGb}</p>}
      </div>
      <div className="field">
        <label htmlFor="plan-users">Usuarios</label>
        <input id="plan-users" className="drive-modal-input" inputMode="numeric" autoComplete="off" value={form.userLimit} aria-invalid={errors.userLimit ? true : undefined} aria-describedby={errors.userLimit ? "plan-users-error" : undefined} onChange={(event) => update("userLimit", event.target.value)} />
        {errors.userLimit && <p id="plan-users-error" className="platform-field-error" role="alert">{errors.userLimit}</p>}
      </div>
      <div className="field">
        <label htmlFor="plan-description">Descripción</label>
        <textarea id="plan-description" className="drive-modal-input" rows={3} style={{ padding: "10px 12px", resize: "vertical" }} value={form.description} aria-invalid={errors.description ? true : undefined} aria-describedby={errors.description ? "plan-description-error" : undefined} onChange={(event) => update("description", event.target.value)} />
        {errors.description && <p id="plan-description-error" className="platform-field-error" role="alert">{errors.description}</p>}
      </div>
      {error && <p className="platform-field-error" role="alert">{error}</p>}
      {noChanges && <p className="settings-cell-muted" role="status">No hay cambios que guardar.</p>}
      <div className="drive-modal-actions">
        <button type="button" className="drive-subtle-button" onClick={onCancel} disabled={busy}>Cancelar</button>
        <button type="submit" className="drive-primary-button" disabled={busy}>{busy ? "Guardando…" : "Guardar"}</button>
      </div>
    </form>
  </Dialog>;
}
