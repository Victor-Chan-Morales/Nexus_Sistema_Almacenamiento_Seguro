"use client";

import { FormEvent, useState } from "react";
import { useToast } from "@/components/toast";
import { ApiError } from "@/lib/api/client";
import { createInstallationRequest } from "@/lib/api/storage";
import type { DeploymentModel, InstallationRequest, InstallationRequestStatus } from "@/lib/api/types";
import { formatIsoDate } from "@/lib/format";
import { useSession } from "@/lib/session";
import { modelLabel, storageErrorMessage } from "@/lib/storage-labels";

const MODELS: readonly DeploymentModel[] = ["cloud", "on_premises", "hybrid"];
const REQUEST_ERROR = "No se pudo enviar la solicitud. Inténtalo de nuevo.";

/** Clase del badge de estado de una solicitud. Solo presentación. */
function requestStatusClass(status: InstallationRequestStatus): string {
  return status === "Pendiente" ? "settings-badge-admin" : "settings-badge-colab";
}

/** SPEC-804 escenario 7: solicitar la instalación de un modelo y ver el estado de las solicitudes (solo tenant_admin). */
export function InstallationRequestPanel({ token, requests, onChanged }: { token: string; requests: InstallationRequest[]; onChanged: () => Promise<void> }) {
  const { failSession } = useSession();
  const notify = useToast();
  const [requestedModel, setRequestedModel] = useState<DeploymentModel>("on_premises");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await createInstallationRequest({ requestedModel }, token);
      notify("success", `Solicitud de instalación de ${modelLabel(requestedModel)} enviada.`);
      await onChanged();
    } catch (err) {
      if (!failSession(err)) {
        setError(storageErrorMessage(err, REQUEST_ERROR));
        // Con una solicitud pendiente ya existente, se recarga la lista para mostrarla.
        if (err instanceof ApiError && err.code === "INSTALLATION_REQUEST_PENDING") await onChanged();
      }
    } finally {
      setSubmitting(false);
    }
  }

  return <div>
    <p className="settings-section-subtitle">Pide la instalación del modelo que necesitas. Elegir un modelo no depende de esta solicitud.</p>
    <form onSubmit={submit} className="settings-form">
      <div className="field">
        <label htmlFor="installation-model">Modelo solicitado</label>
        <select id="installation-model" className="storage-select" value={requestedModel} onChange={(event) => setRequestedModel(event.target.value as DeploymentModel)} disabled={submitting}>
          {MODELS.map((model) => <option key={model} value={model}>{modelLabel(model)}</option>)}
        </select>
      </div>
      <button type="submit" className="button button-primary settings-submit-btn" disabled={submitting}>{submitting ? "Enviando…" : "Solicitar instalación"}</button>
    </form>
    {error && <div className="auth-alert storage-panel-alert" role="alert">{error}</div>}
    <h3 className="storage-subheading">Mis solicitudes</h3>
    {requests.length === 0 ? <p className="muted">Aún no has solicitado una instalación.</p> : <div className="settings-table-wrapper">
      <table className="settings-table">
        <thead><tr><th>Modelo</th><th>Solicitada</th><th>Estado</th><th>Revisada</th></tr></thead>
        <tbody>{requests.map((request) => <tr key={request.id}>
          <td className="settings-cell-name">{modelLabel(request.requestedModel)}</td>
          <td className="settings-cell-muted">{formatIsoDate(request.createdAt)}</td>
          <td><span className={`settings-badge ${requestStatusClass(request.status)}`}>{request.status}</span></td>
          <td className="settings-cell-muted">{formatIsoDate(request.reviewedAt)}</td>
        </tr>)}</tbody>
      </table>
    </div>}
  </div>;
}
