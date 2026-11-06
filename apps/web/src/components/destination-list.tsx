"use client";

import { useState } from "react";
import { useToast } from "@/components/toast";
import { testDestination } from "@/lib/api/storage";
import type { Destination, DestinationConnectionStatus, TestDestinationResponse } from "@/lib/api/types";
import { useSession } from "@/lib/session";
import { locationLabel, providerLabel, storageErrorMessage, testReasonMessage } from "@/lib/storage-labels";

const TEST_ERROR = "No se pudo probar la conexión. Inténtalo de nuevo.";

/** Clase del badge de estado. Solo presentación: el estado lo decide el servidor. */
function statusClass(status: DestinationConnectionStatus): string {
  if (status === "Conectado") return "settings-badge-admin";
  if (status === "Sin conexión") return "storage-status-error";
  return "settings-badge-colab";
}

function withoutKey(record: Readonly<Record<string, string>>, key: string): Readonly<Record<string, string>> {
  const next = { ...record };
  delete next[key];
  return next;
}

/**
 * SPEC-804 escenario 2: tabla de destinos con "Probar conexión" por fila.
 * Nunca muestra endpoint, bucket ni credenciales: solo nombre, ubicación, proveedor, estado y predeterminado.
 * Los mensajes de prueba viven aquí, así que sobreviven a la recarga silenciosa de `onChanged`.
 */
export function DestinationList({ token, destinations, onChanged }: { token: string; destinations: Destination[]; onChanged: () => Promise<void> }) {
  const { failSession } = useSession();
  const notify = useToast();
  const [testing, setTesting] = useState<ReadonlySet<string>>(() => new Set());
  const [messages, setMessages] = useState<Readonly<Record<string, string>>>({});

  async function runTest(destination: Destination) {
    const { id, name } = destination;
    setTesting((current) => new Set(current).add(id));
    setMessages((current) => withoutKey(current, id));
    let result: TestDestinationResponse | null = null;
    try {
      result = await testDestination(id, token);
    } catch (error) {
      if (!failSession(error)) setMessages((current) => ({ ...current, [id]: storageErrorMessage(error, TEST_ERROR) }));
    } finally {
      setTesting((current) => {
        const next = new Set(current);
        next.delete(id);
        return next;
      });
    }
    if (!result) return;
    const { status, reason } = result;
    if (status === "Conectado") {
      notify("success", `La conexión con «${name}» funciona.`);
    } else {
      setMessages((current) => ({ ...current, [id]: testReasonMessage(reason) ?? "No se pudo conectar con el destino." }));
    }
    await onChanged();
  }

  return <div className="settings-table-wrapper">
    <table className="settings-table">
      <thead>
        <tr><th>Nombre</th><th>Ubicación</th><th>Proveedor</th><th>Estado</th><th>Predeterminado</th><th>Acciones</th></tr>
      </thead>
      <tbody>
        {destinations.map((destination) => {
          const isTesting = testing.has(destination.id);
          const status: DestinationConnectionStatus = isTesting ? "Comprobando" : destination.connectionStatus;
          return <tr key={destination.id}>
            <td className="settings-cell-name">{destination.name}</td>
            <td><span className={`location-badge ${destination.location === "cloud" ? "location-badge-cloud" : "location-badge-local"}`}>{locationLabel(destination.location)}</span></td>
            <td className="settings-cell-muted">{providerLabel(destination.providerType)}</td>
            <td>
              <span className={`settings-badge ${statusClass(status)}`}>{status}</span>
              {!destination.isEnabled && <span className="settings-cell-muted storage-disabled-note">Deshabilitado</span>}
            </td>
            <td>{destination.isDefault ? "Sí" : "No"}</td>
            <td>
              <button type="button" className="drive-subtle-button" onClick={() => runTest(destination)} disabled={isTesting || !destination.isEnabled} aria-label={`Probar conexión de «${destination.name}»`}>
                {isTesting ? "Comprobando…" : "Probar conexión"}
              </button>
              {messages[destination.id] && <p className="storage-test-message" role="alert">{messages[destination.id]}</p>}
            </td>
          </tr>;
        })}
      </tbody>
    </table>
  </div>;
}
