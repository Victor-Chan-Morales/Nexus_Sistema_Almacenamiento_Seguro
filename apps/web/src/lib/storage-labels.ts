import { ApiError } from "@/lib/api/client";
import type { DeploymentModel, DestinationLocation, DestinationProviderType, TestDestinationResponse } from "@/lib/api/types";

/*
 * SPEC-804: textos de almacenamiento para la interfaz. Funciones puras, sin React.
 * Regla de terminología: nunca se muestra el valor `on_premises`; la interfaz usa "Servidor local" y "Nube".
 */

const LOCATION_LABELS: Record<DestinationLocation, string> = {
  cloud: "Nube",
  on_premises: "Servidor local",
};

const PROVIDER_LABELS: Record<DestinationProviderType, string> = {
  s3: "S3 compatible",
  minio: "MinIO",
};

const MODEL_LABELS: Record<DeploymentModel, string> = {
  cloud: "Nube",
  on_premises: "Servidor local",
  hybrid: "Híbrido",
};

const MODEL_DESCRIPTIONS: Record<DeploymentModel, string> = {
  cloud: "Los archivos se guardan en la nube.",
  on_premises: "Los archivos se guardan en un servidor propio de tu organización.",
  hybrid: "Cada carpeta principal elige si sus archivos se guardan en la nube o en el servidor local.",
};

const MODEL_REQUIREMENT_HINTS: Record<DeploymentModel, string> = {
  cloud: "Necesitas un destino de Nube conectado",
  on_premises: "Necesitas un destino de Servidor local conectado",
  hybrid: "Necesitas un destino de Nube y uno de Servidor local conectados",
};

const TEST_REASON_MESSAGES: Record<NonNullable<TestDestinationResponse["reason"]>, string> = {
  AUTH: "Las credenciales no son válidas. Revisa la clave de acceso y la clave secreta.",
  NETWORK: "No se pudo conectar con el endpoint. Revisa la dirección y que el servicio esté encendido.",
  BUCKET_NOT_FOUND: "El bucket no existe en el servicio. Créalo antes de probar la conexión.",
  DATA_MISMATCH: "El servicio respondió, pero los datos de prueba no coincidieron.",
};

const GENERIC_REQUIREMENTS_MESSAGE = "Faltan destinos conectados para elegir este modelo.";
const GENERIC_VALIDATION_MESSAGE = "Revisa los datos ingresados.";

/** Etiqueta de la ubicación de un destino o carpeta: "Nube" o "Servidor local". */
export function locationLabel(location: DestinationLocation): string {
  return LOCATION_LABELS[location];
}

/** Nombre del proveedor de un destino para la tabla de destinos. */
export function providerLabel(providerType: DestinationProviderType): string {
  return PROVIDER_LABELS[providerType];
}

/** Nombre corto de un modelo de despliegue: "Nube", "Servidor local" o "Híbrido". */
export function modelLabel(model: DeploymentModel): string {
  return MODEL_LABELS[model];
}

/** Explicación en lenguaje sencillo de lo que hace cada modelo. */
export function modelDescription(model: DeploymentModel): string {
  return MODEL_DESCRIPTIONS[model];
}

/** Qué destino hace falta conectar para activar el modelo. */
export function modelRequirementHint(model: DeploymentModel): string {
  return MODEL_REQUIREMENT_HINTS[model];
}

/** Frase en español para el motivo de una prueba de conexión fallida. Null cuando la conexión funciona. */
export function testReasonMessage(reason: TestDestinationResponse["reason"]): string | null {
  return reason ? TEST_REASON_MESSAGES[reason] : null;
}

/**
 * Mensaje para un error de los endpoints de almacenamiento. Se decide por `code` (estable), no por el texto.
 * Si el error no es de la API se usa `fallback`. Un error de red (status 0) ya trae un mensaje en español.
 */
export function storageErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof ApiError)) return fallback;
  if (error.status === 0) return error.message;
  switch (error.code) {
    case "DEPLOYMENT_MODEL_REQUIREMENTS_UNMET":
      // El servidor ya explica qué destino falta; si no trae texto, se usa el genérico.
      return error.message || GENERIC_REQUIREMENTS_MESSAGE;
    case "DESTINATION_NOT_AVAILABLE":
      return "El destino elegido no está disponible. Debe estar habilitado y conectado.";
    case "DESTINATION_SELECTION_NOT_ALLOWED":
      return "Esta carpeta no admite elegir un destino. Usará el de su carpeta principal o el predeterminado.";
    case "DESTINATION_ENDPOINT_NOT_ALLOWED":
      return "El endpoint no está permitido. Usa la IP de la red o el nombre del servicio, no localhost.";
    case "INSTALLATION_REQUEST_PENDING":
      return "Ya tienes una solicitud pendiente";
    case "FORBIDDEN_ROLE":
      return "Solo un administrador puede hacer esta acción.";
    case "VALIDATION_ERROR":
      return error.message || GENERIC_VALIDATION_MESSAGE;
    default:
      return fallback;
  }
}
