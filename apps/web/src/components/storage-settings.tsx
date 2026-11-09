"use client";

import { useCallback, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { DestinationForm } from "@/components/destination-form";
import { DestinationList } from "@/components/destination-list";
import { InstallationRequestPanel } from "@/components/installation-request-panel";
import { Notice } from "@/components/notice";
import { ModelCardContent, StorageModelPicker } from "@/components/storage-model-picker";
import { LoadingIndicator, useToast } from "@/components/toast";
import { UiIcon } from "@/components/ui-icon";
import { getStoragePolicy, listDestinations, listInstallationRequests } from "@/lib/api/storage";
import type { Destination, InstallationRequest } from "@/lib/api/types";
import { useSession } from "@/lib/session";
import { type Load, useLoad } from "@/lib/use-load";

const POLICY_LOAD_ERROR = "No pudimos cargar el almacenamiento. Inténtalo de nuevo.";
const DESTINATIONS_LOAD_ERROR = "No pudimos cargar los destinos. Inténtalo de nuevo.";
const REQUESTS_LOAD_ERROR = "No pudimos cargar las solicitudes. Inténtalo de nuevo.";
const REFRESH_ERROR = "No pudimos actualizar la información. Recarga la página.";

/**
 * SPEC-804: pantalla /almacenamiento. Cualquier miembro ve el modelo actual en solo lectura;
 * solo el administrador ve y cambia el modelo, administra destinos y pide instalación.
 * La API valida el rol: ocultar aquí no sustituye el 403 del servidor.
 */
export function StorageSettings() {
  const { session } = useSession();
  return <AppShell active="/almacenamiento">
    <div className="page-heading"><p className="eyebrow">ESPACIO DE TRABAJO</p><h1>Almacenamiento</h1><p>Elige dónde se guardan los archivos de tu organización y administra sus destinos.</p></div>
    {session && <StorageContent token={session.accessToken} isAdmin={session.role === "tenant_admin"} />}
  </AppShell>;
}

function StorageContent({ token, isAdmin }: { token: string; isAdmin: boolean }) {
  const { failSession } = useSession();
  const notify = useToast();
  const [formOpen, setFormOpen] = useState(false);

  const fetchPolicy = useCallback((signal: AbortSignal) => getStoragePolicy(token, { signal }), [token]);
  const { state: policyState, reload: reloadPolicy, set: setPolicy } = useLoad(fetchPolicy, true, POLICY_LOAD_ERROR);

  // Un colaborador nunca llama a GET /destinations ni a GET /organizations/installation-requests.
  const fetchDestinations = useCallback(async (signal: AbortSignal): Promise<Destination[]> => (await listDestinations(token, { signal })).items, [token]);
  const { state: destinationsState, reload: reloadDestinations, set: setDestinations } = useLoad(fetchDestinations, isAdmin, DESTINATIONS_LOAD_ERROR);

  const fetchRequests = useCallback(async (signal: AbortSignal): Promise<InstallationRequest[]> => (await listInstallationRequests(token, { signal })).items, [token]);
  const { state: requestsState, reload: reloadRequests, set: setRequests } = useLoad(fetchRequests, isAdmin, REQUESTS_LOAD_ERROR);

  // Recargas silenciosas: no pasan por el estado de carga, así la tabla y sus mensajes de prueba se conservan.
  const refreshPolicy = useCallback(async () => {
    try {
      setPolicy({ status: "ready", data: await getStoragePolicy(token) });
    } catch (error) {
      if (!failSession(error)) notify("error", REFRESH_ERROR);
    }
  }, [token, failSession, notify, setPolicy]);

  const refreshDestinations = useCallback(async () => {
    try {
      setDestinations({ status: "ready", data: (await listDestinations(token)).items });
    } catch (error) {
      if (!failSession(error)) notify("error", REFRESH_ERROR);
    }
  }, [token, failSession, notify, setDestinations]);

  const refreshRequests = useCallback(async () => {
    try {
      setRequests({ status: "ready", data: (await listInstallationRequests(token)).items });
    } catch (error) {
      if (!failSession(error)) notify("error", REFRESH_ERROR);
    }
  }, [token, failSession, notify, setRequests]);

  // Probar un destino cambia su estado y, con ello, qué destinos ofrece la política.
  const refreshAfterTest = useCallback(async () => {
    await Promise.all([refreshPolicy(), refreshDestinations()]);
  }, [refreshPolicy, refreshDestinations]);

  if (policyState.status === "loading") return <section className="panel"><LoadingIndicator>Cargando almacenamiento…</LoadingIndicator></section>;
  if (policyState.status === "error") return <Notice title="No se pudo cargar el almacenamiento" message={policyState.message} onRetry={reloadPolicy} />;
  const policy = policyState.data;

  if (!isAdmin) {
    return <section className="panel storage-section">
      <h2 className="settings-section-title">Modelo actual</h2>
      <p className="settings-section-subtitle">Así se guardan los archivos de tu organización.</p>
      <article className="storage-model-card is-current"><ModelCardContent model={policy.model} isCurrent /></article>
      <div className="notice storage-readonly-note"><UiIcon name="shield" size={16} /><span>Solo un administrador puede cambiarlo.</span></div>
    </section>;
  }

  const defaultName = policy.destinations.find((destination) => destination.id === policy.defaultDestinationId)?.name;

  return <>
    <section className="panel storage-section">
      <h2 className="settings-section-title">Modelo de almacenamiento</h2>
      <p className="settings-section-subtitle">{defaultName ? `Destino predeterminado: ${defaultName}.` : "No hay un destino predeterminado disponible."}</p>
      <StorageModelPicker token={token} policy={policy} onChanged={refreshPolicy} />
    </section>

    <section className="panel storage-section">
      <div className="settings-header-row">
        <div>
          <h2 className="settings-section-title">Destinos</h2>
          <p className="settings-section-subtitle">Servicios S3 donde se guardan los archivos. Prueba la conexión de cada uno.</p>
        </div>
        <button type="button" className="button button-primary" onClick={() => setFormOpen(true)}>Registrar destino</button>
      </div>
      <DestinationsBody state={destinationsState} token={token} onRetry={reloadDestinations} onChanged={refreshAfterTest} />
    </section>

    <section className="panel storage-section">
      <h2 className="settings-section-title">Solicitud de instalación</h2>
      <RequestsBody state={requestsState} token={token} onRetry={reloadRequests} onChanged={refreshRequests} />
    </section>

    {formOpen && <DestinationForm token={token} onClose={() => setFormOpen(false)} onCreated={refreshDestinations} />}
  </>;
}

function DestinationsBody({ state, token, onRetry, onChanged }: { state: Load<Destination[]>; token: string; onRetry: () => void; onChanged: () => Promise<void> }) {
  if (state.status === "loading") return <LoadingIndicator>Cargando destinos…</LoadingIndicator>;
  if (state.status === "error") return <Notice title="No se pudieron cargar los destinos" message={state.message} onRetry={onRetry} />;
  if (state.data.length === 0) {
    return <div className="empty-state">
      <span><UiIcon name="storage" size={24} /></span>
      <b>Aún no hay destinos registrados</b>
      <p>Registra un destino de Nube o de Servidor local para poder elegir un modelo que lo use.</p>
    </div>;
  }
  return <DestinationList token={token} destinations={state.data} onChanged={onChanged} />;
}

function RequestsBody({ state, token, onRetry, onChanged }: { state: Load<InstallationRequest[]>; token: string; onRetry: () => void; onChanged: () => Promise<void> }) {
  if (state.status === "loading") return <LoadingIndicator>Cargando solicitudes…</LoadingIndicator>;
  if (state.status === "error") return <Notice title="No se pudieron cargar las solicitudes" message={state.message} onRetry={onRetry} />;
  return <InstallationRequestPanel token={token} requests={state.data} onChanged={onChanged} />;
}
