"use client";

import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { Dialog } from "@/components/dialog";
import { Notice } from "@/components/notice";
import { LoadingIndicator, useToast } from "@/components/toast";
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
} from "@/lib/api/platform";
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

  return <>
    <MetricsSection state={metrics} onRetry={reloadMetrics} />
    <OrganizationsSection token={token} selfOrganizationId={selfOrganizationId} onChanged={refreshMetrics} />
    <InstallationsSection token={token} />
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

  return <div id="instalaciones" className="dashboard-lower-grid platform-section">
    <section className="panel" aria-labelledby="pendientes-title">
      <div className="settings-header-row"><div><h2 id="pendientes-title" className="settings-section-title">Solicitudes pendientes</h2><p className="settings-section-subtitle">Solicitudes de instalación esperando revisión.</p></div></div>
      {pendingState.status === "loading" && <LoadingIndicator>Cargando solicitudes…</LoadingIndicator>}
      {pendingState.status === "error" && <Notice title="No se pudieron cargar las solicitudes" message={pendingState.message} onRetry={reloadPending} />}
      {pendingState.status === "ready" && (pendingState.data.items.length === 0
        ? <p className="settings-state-box">No hay solicitudes pendientes</p>
        : <div className="settings-table-wrapper"><table className="settings-table">
          <thead><tr><th>Organización</th><th>Modelo</th><th>Fecha</th><th>Acciones</th></tr></thead>
          <tbody>{pendingState.data.items.map((request) => {
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
    </section>

    <section className="panel" aria-labelledby="curso-title">
      <div className="settings-header-row"><div><h2 id="curso-title" className="settings-section-title">Instalaciones en curso</h2><p className="settings-section-subtitle">Avance de las instalaciones aprobadas.</p></div></div>
      {approvedState.status === "loading" && <LoadingIndicator>Cargando instalaciones…</LoadingIndicator>}
      {approvedState.status === "error" && <Notice title="No se pudieron cargar las instalaciones" message={approvedState.message} onRetry={reloadApproved} />}
      {approvedState.status === "ready" && (approvedState.data.items.length === 0
        ? <p className="settings-state-box">No hay instalaciones en curso</p>
        : <div className="settings-table-wrapper"><table className="settings-table">
          <thead><tr><th>Organización</th><th>Modelo</th><th>Operador</th><th>Estado</th><th>Acciones</th></tr></thead>
          <tbody>{approvedState.data.items.map((request) => <InstallationRow key={request.id} request={request} busy={request.installationId !== null && installationBusy.ids.has(request.installationId)} onAction={(action) => requestInstallationChange(request, action)} />)}</tbody>
        </table></div>)}
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
