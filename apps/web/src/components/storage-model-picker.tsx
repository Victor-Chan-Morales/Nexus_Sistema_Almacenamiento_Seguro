"use client";

import { FormEvent, useState } from "react";
import { Dialog } from "@/components/dialog";
import { useToast } from "@/components/toast";
import { UiIcon } from "@/components/ui-icon";
import { updateStoragePolicy } from "@/lib/api/storage";
import type { DeploymentModel, DestinationLocation, StoragePolicy, StoragePolicyDestination } from "@/lib/api/types";
import { useSession } from "@/lib/session";
import { locationLabel, modelDescription, modelLabel, modelRequirementHint, storageErrorMessage } from "@/lib/storage-labels";

const MODELS: readonly DeploymentModel[] = ["cloud", "on_premises", "hybrid"];

const MODEL_ICONS = { cloud: "cloud", on_premises: "server", hybrid: "layers" } as const;

/**
 * Ubicaciones con destino conectado que pide cada modelo. Solo sirve para la pista de la pantalla
 * (qué falta y si se habilita "Cambiar"). El servidor es quien valida y responde 422 si no se cumple.
 */
const REQUIRED_LOCATIONS: Record<DeploymentModel, DestinationLocation[]> = {
  cloud: ["cloud"],
  on_premises: ["on_premises"],
  hybrid: ["cloud", "on_premises"],
};

/** Contenido de una tarjeta de modelo: ícono, nombre, insignia "Actual" y explicación en lenguaje sencillo. */
export function ModelCardContent({ model, isCurrent }: { model: DeploymentModel; isCurrent: boolean }) {
  return <>
    <span className="storage-model-card-icon"><UiIcon name={MODEL_ICONS[model]} size={20} /></span>
    <span className="storage-model-card-head"><b>{modelLabel(model)}</b>{isCurrent && <span className="settings-badge settings-badge-admin">Actual</span>}</span>
    <span className="storage-model-card-text">{modelDescription(model)}</span>
  </>;
}

/** SPEC-804 escenario 1 y 3: tres tarjetas con el modelo actual marcado. Elegir otro abre el aviso de cambio. */
export function StorageModelPicker({ token, policy, onChanged }: { token: string; policy: StoragePolicy; onChanged: () => Promise<void> }) {
  const [target, setTarget] = useState<DeploymentModel | null>(null);

  return <>
    <div className="storage-model-grid">
      {MODELS.map((model) => {
        const isCurrent = model === policy.model;
        return <button key={model} type="button" className="storage-model-card" aria-pressed={isCurrent} onClick={() => { if (!isCurrent) setTarget(model); }}>
          <ModelCardContent model={model} isCurrent={isCurrent} />
        </button>;
      })}
    </div>
    {target && <ModelChangeDialog key={target} token={token} policy={policy} target={target} onClose={() => setTarget(null)} onChanged={onChanged} />}
  </>;
}

/** Ubicaciones que el modelo pide y la organización no tiene conectadas. */
function missingLocations(model: DeploymentModel, destinations: StoragePolicyDestination[]): DestinationLocation[] {
  return REQUIRED_LOCATIONS[model].filter((location) => !destinations.some((destination) => destination.location === location));
}

/** Preselecciona el predeterminado actual si sirve para el modelo elegido; si no, el primero compatible. */
function preselectedDestination(model: DeploymentModel, policy: StoragePolicy): string {
  const locations = REQUIRED_LOCATIONS[model];
  const compatible = policy.destinations.filter((destination) => locations.includes(destination.location));
  return (compatible.find((destination) => destination.id === policy.defaultDestinationId) ?? compatible[0])?.id ?? "";
}

/** SPEC-804 escenario 3: aviso de que los archivos no se mueven, elección del predeterminado y envío con errores del servidor. */
function ModelChangeDialog({
  token,
  policy,
  target,
  onClose,
  onChanged,
}: {
  token: string;
  policy: StoragePolicy;
  target: DeploymentModel;
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const { failSession } = useSession();
  const notify = useToast();
  const missing = missingLocations(target, policy.destinations);
  const [defaultDestinationId, setDefaultDestinationId] = useState(() => preselectedDestination(target, policy));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canConfirm = missing.length === 0 && defaultDestinationId !== "" && !submitting;
  const leavesHybrid = policy.model === "hybrid" && target !== "hybrid";

  async function confirm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canConfirm) return;
    setSubmitting(true);
    setError(null);
    try {
      await updateStoragePolicy({ model: target, defaultDestinationId }, token);
    } catch (err) {
      if (!failSession(err)) setError(storageErrorMessage(err, "No se pudo cambiar el modelo. Inténtalo de nuevo."));
      setSubmitting(false);
      return;
    }
    notify("success", `El modelo de almacenamiento es ahora ${modelLabel(target)}.`);
    onClose();
    await onChanged();
  }

  return <Dialog labelledBy="storage-model-change-title" onClose={onClose} disabled={submitting}>
    <span className="drive-modal-icon"><UiIcon name={MODEL_ICONS[target]} size={20} /></span>
    <h2 id="storage-model-change-title">¿Cambiar a {modelLabel(target)}?</h2>
    <p><b>Los archivos que ya están guardados no se mueven.</b> {modelDescription(target)}</p>
    <form onSubmit={confirm}>
      {leavesHybrid && <div className="notice">Las carpetas existentes conservan su ubicación. Las carpetas nuevas usarán el destino predeterminado.</div>}
      {missing.length > 0 ? <div className="notice" role="status">
        <b>{modelRequirementHint(target)}.</b> Falta conectar: {missing.map((location) => locationLabel(location)).join(" y ")}.
      </div> : <div className="field">
        <label htmlFor="storage-default-destination">Destino predeterminado</label>
        <select id="storage-default-destination" className="storage-select" value={defaultDestinationId} onChange={(event) => setDefaultDestinationId(event.target.value)} disabled={submitting}>
          {policy.destinations.map((destination) => <option key={destination.id} value={destination.id}>{destination.name} · {locationLabel(destination.location)}</option>)}
        </select>
        <p className="muted storage-field-hint">Se usa para las carpetas nuevas que no eligen otro destino.</p>
      </div>}
      {error && <div className="auth-alert" role="alert">{error}</div>}
      <div className="drive-modal-actions">
        <button type="button" className="drive-subtle-button" onClick={onClose} disabled={submitting}>Cancelar</button>
        <button type="submit" className="drive-primary-button" disabled={!canConfirm}>{submitting ? "Cambiando…" : `Cambiar a ${modelLabel(target)}`}</button>
      </div>
    </form>
  </Dialog>;
}
