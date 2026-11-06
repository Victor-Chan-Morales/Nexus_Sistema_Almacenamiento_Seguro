"use client";

import { FormEvent, useState } from "react";
import { Dialog } from "@/components/dialog";
import { useToast } from "@/components/toast";
import { UiIcon } from "@/components/ui-icon";
import { createDestination } from "@/lib/api/storage";
import type { CreateDestinationInput, DestinationLocation, DestinationProviderType } from "@/lib/api/types";
import { useSession } from "@/lib/session";
import { locationLabel, providerLabel, storageErrorMessage } from "@/lib/storage-labels";

const CREATE_ERROR = "No se pudo registrar el destino. Revisa los datos e inténtalo de nuevo.";

/**
 * SPEC-804 escenario 2: alta de un destino S3 (Nube o Servidor local).
 * La clave secreta nunca se precarga y se vacía del estado al crear con éxito o al cerrar.
 * La validación del cliente se limita a `required`; las reglas de negocio las aplica el servidor.
 */
export function DestinationForm({ token, onClose, onCreated }: { token: string; onClose: () => void; onCreated: () => Promise<void> }) {
  const { failSession } = useSession();
  const notify = useToast();
  const [name, setName] = useState("");
  const [location, setLocation] = useState<DestinationLocation>("cloud");
  const [providerType, setProviderType] = useState<DestinationProviderType>("s3");
  const [endpoint, setEndpoint] = useState("");
  const [bucket, setBucket] = useState("");
  const [region, setRegion] = useState("");
  const [accessKey, setAccessKey] = useState("");
  const [secretKey, setSecretKey] = useState("");
  const [useSsl, setUseSsl] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function close() {
    setSecretKey("");
    onClose();
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    const input: CreateDestinationInput = {
      name: name.trim(),
      location,
      providerType,
      endpoint: endpoint.trim(),
      bucket: bucket.trim(),
      region: region.trim(),
      accessKey: accessKey.trim(),
      secretKey,
      useSsl,
    };
    setSubmitting(true);
    setError(null);
    try {
      await createDestination(input, token);
    } catch (err) {
      if (!failSession(err)) setError(storageErrorMessage(err, CREATE_ERROR));
      setSubmitting(false);
      return;
    }
    notify("success", `Se registró el destino «${input.name}». Pruébalo para comprobar la conexión.`);
    setSecretKey("");
    await onCreated();
    onClose();
  }

  return <Dialog labelledBy="destination-form-title" onClose={close} disabled={submitting}>
    <span className="drive-modal-icon"><UiIcon name="storage" size={20} /></span>
    <h2 id="destination-form-title">Registrar destino</h2>
    <p>Conecta un servicio S3 compatible. Las credenciales se guardan cifradas y no se vuelven a mostrar.</p>
    <form onSubmit={submit}>
      {error && <div className="auth-alert" role="alert">{error}</div>}
      <div className="field">
        <label htmlFor="destination-name">Nombre</label>
        <input id="destination-name" type="text" value={name} onChange={(event) => setName(event.target.value)} placeholder="Ej. Servidor de respaldo" required disabled={submitting} />
      </div>
      <fieldset className="storage-radio-group" disabled={submitting}>
        <legend>Ubicación</legend>
        {(["cloud", "on_premises"] as const).map((option) => <label key={option} className="storage-radio-option">
          <input type="radio" name="destination-location" value={option} checked={location === option} onChange={() => setLocation(option)} />
          {locationLabel(option)}
        </label>)}
      </fieldset>
      <div className="storage-form-grid">
        <div className="field">
          <label htmlFor="destination-provider">Proveedor</label>
          <select id="destination-provider" className="storage-select" value={providerType} onChange={(event) => setProviderType(event.target.value as DestinationProviderType)} disabled={submitting}>
            <option value="s3">{providerLabel("s3")}</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="destination-endpoint">Endpoint</label>
          <input id="destination-endpoint" type="text" inputMode="url" value={endpoint} onChange={(event) => setEndpoint(event.target.value)} placeholder="http://192.168.1.20:8334" required disabled={submitting} />
        </div>
        <div className="field">
          <label htmlFor="destination-bucket">Bucket</label>
          <input id="destination-bucket" type="text" value={bucket} onChange={(event) => setBucket(event.target.value)} placeholder="nexus-local" required disabled={submitting} />
        </div>
        <div className="field">
          <label htmlFor="destination-region">Región</label>
          <input id="destination-region" type="text" value={region} onChange={(event) => setRegion(event.target.value)} placeholder="us-east-1" required disabled={submitting} />
        </div>
        <div className="field">
          <label htmlFor="destination-access-key">Clave de acceso</label>
          <input id="destination-access-key" type="text" autoComplete="off" value={accessKey} onChange={(event) => setAccessKey(event.target.value)} required disabled={submitting} />
        </div>
        <div className="field">
          <label htmlFor="destination-secret-key">Clave secreta</label>
          <input id="destination-secret-key" type="password" autoComplete="new-password" value={secretKey} onChange={(event) => setSecretKey(event.target.value)} required disabled={submitting} />
        </div>
      </div>
      <label className="storage-check">
        <input type="checkbox" checked={useSsl} onChange={(event) => setUseSsl(event.target.checked)} disabled={submitting} />
        Usar SSL (HTTPS)
      </label>
      <div className="drive-modal-actions">
        <button type="button" className="drive-subtle-button" onClick={close} disabled={submitting}>Cancelar</button>
        <button type="submit" className="drive-primary-button" disabled={submitting}>{submitting ? "Registrando…" : "Registrar destino"}</button>
      </div>
    </form>
  </Dialog>;
}
