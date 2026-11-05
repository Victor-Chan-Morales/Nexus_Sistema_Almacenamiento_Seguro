# SPEC-803: ELEGIR NUBE, LOCAL O HÍBRIDO

## 1. Metadatos

| Campo | Valor |
|---|---|
| **Nivel de Rigor** | N2 |
| **Responsable Principal** | Por asignar |
| **Aprobador** | Víctor Chán Morales |
| **Módulo Afectado** | `apps/api/src/modules/files/`, `apps/api/src/modules/integration/` |
| **Requisitos Vinculados** | RF-014, RF-015 |
| **Dependencias** | SPEC-802 |
| **Prioridad** | P1 |
| **Estimación** | 3 h |
| **Estado** | Aprobada (2026-11-04, Víctor Chán Morales) |

## 2. Objetivo

Cada organización elige dónde vive su información. En híbrido, cada **carpeta principal** se asigna a Nube o Local y sus subcarpetas lo heredan. Lo ya guardado se queda donde nació.

## 3. Fuera de Alcance

- Migrar archivos entre destinos.
- Pantalla (SPEC-804).
- Revisar solicitudes de instalación (SPEC-503).

## 4. Criterios de Aceptación

```gherkin
Escenario 1: Consultar
  Cuando un miembro envía GET /organizations/storage-policy
  Entonces recibe el modelo y los destinos disponibles para elegir, sin credenciales

Escenario 2: Cambiar a Local
  Dado un destino on_premises "Conectado"
  Cuando un tenant_admin envía PUT /organizations/storage-policy con { model: "on_premises", defaultDestinationId }
  Entonces el modelo cambia y ese destino pasa a ser el predeterminado

Escenario 3: Requisitos del modelo
  Dado cloud u on_premises sin un destino "Conectado" de esa ubicación
  Dado hybrid sin uno de cada ubicación
  Entonces responde 422 DEPLOYMENT_MODEL_REQUIREMENTS_UNMET

Escenario 4: Nada se mueve
  Cuando cambia de modelo
  Entonces las versiones existentes conservan su destino y se siguen descargando

Escenario 5: Nube o Local por modelo
  Dado un modelo cloud u on_premises
  Entonces toda carpeta principal nueva usa el predeterminado
  Y enviar destinationId responde 422 DESTINATION_SELECTION_NOT_ALLOWED

Escenario 6: Carpeta principal en híbrido
  Dado un modelo hybrid
  Cuando crea una carpeta hija directa de la raíz con destinationId
  Entonces la carpeta usa ese destino

Escenario 7: Falta el destino
  Dado hybrid y una carpeta principal sin destinationId → usa el predeterminado

Escenario 8: Subcarpetas
  Cuando crea una subcarpeta
  Entonces hereda el destino, y enviar otro destinationId responde 422 DESTINATION_SELECTION_NOT_ALLOWED

Escenario 9: Subida real
  Dadas dos carpetas principales en destinos distintos
  Entonces cada archivo termina en el almacén de su carpeta, y version.destination_id lo refleja

Escenario 10: Destino inválido
  Dado un destino ajeno, deshabilitado o no "Conectado" → 422 DESTINATION_NOT_AVAILABLE

Escenario 11: Solicitud de instalación
  Cuando un tenant_admin envía POST /organizations/installation-requests con { requestedModel }
  Entonces queda "Pendiente"
  Y otra pendiente responde 409 INSTALLATION_REQUEST_PENDING

Escenario 12: Permisos
  Dado un colaborador cambiando el modelo → 403 FORBIDDEN_ROLE
```

## 5. Contrato de API

| Método y ruta | Rol | Entrada | Respuesta |
|---|---|---|---|
| `GET /organizations/storage-policy` | miembro | — | `{ model, defaultDestinationId, destinations: [{ id, name, location }] }` |
| `PUT /organizations/storage-policy` | `tenant_admin` | `{ model, defaultDestinationId }` | Igual a `GET` |
| `POST /folders` | según Drive | añade `destinationId?` | añade `destinationId` y `destinationLocation` |
| `POST /organizations/installation-requests` | `tenant_admin` | `{ requestedModel }` | `201 { id, status, createdAt }` |
| `GET /organizations/installation-requests` | `tenant_admin` | — | `{ items: [...] }` |

Las respuestas de `GET /folders/:id/items` añaden `destinationLocation` a cada carpeta.

## 6. Datos y Esquema

Sin migración. Usa `admin.organization.deployment_model`, `folder.destination_id`, `destination.is_default` (`uq_destination_one_default_per_organization`) y `admin.installation_request`.

## 8. Diseño Técnico

- `StoragePolicyService` en `modules/integration/`, porque coordina IAM (`organization`) y Files (`destination`).
- **Cambio de predeterminado:** en una transacción, primero quitar `is_default` y después marcar el nuevo, por el índice único. En la misma transacción, apuntar las carpetas raíz de los Drives de la organización al nuevo destino, para que lo subido directo a la raíz no siga yendo al anterior. Las versiones existentes no cambian.
- **Destino en `createFolder`:** parent es raíz y el modelo es `hybrid` → admite `destinationId` o usa el predeterminado; parent es raíz en otro modelo → usa el predeterminado; subcarpeta → hereda del padre. La raíz del Drive tiene el destino predeterminado al crearse.
- **Cambiar de híbrido a un solo modelo:** las carpetas conservan su `destination_id`, así que sus versiones nuevas seguirán allí. Se documenta y se muestra en la pantalla.
- **Límite de la solicitud:** registrar una solicitud no es requisito para elegir el modelo (ver §12).
- **Auditoría:** `DEPLOYMENT_MODEL_CHANGED`, `INSTALLATION_REQUESTED`.

## 9. Plan de Tareas

- [ ] **T1 (60 min)**: `StoragePolicyService` y rutas.
- [ ] **T2 (50 min)**: `createFolder` y respuestas con destino.
- [ ] **T3 (20 min)**: Solicitudes de instalación.
- [ ] **T4 (50 min)**: Pruebas y prueba manual con dos contenedores.

**Archivos permitidos:** `integration/storage-policy.service.ts`, `integration/storage-policy.controller.ts`, `integration/entities/installation-request.entity.ts`, sus specs (nuevos; coordinar la entidad con SPEC-503), `integration/integration.module.ts`, `files/files.service.ts`, `files/files.controller.ts`, `iam/entities/organization.entity.ts`, `iam/ports/repositories.ts`, `iam/infrastructure/typeorm-repositories.ts`, `audit/audit.types.ts`.

## 10. Estrategia de Pruebas

| Criterio | Tipo | Archivo |
|---|---|---|
| Escenarios 1–8, 10–12 | Unitaria | `storage-policy.service.spec.ts`, `files.service.spec.ts` |
| Escenarios 4, 9 | Manual con dos contenedores S3 | Evidencia en el PR |

## 11. Impacto en Documentación

- [ ] `CONTRACTS.md` v0.6, `BUSINESS_RULES.md`.

## 12. Preguntas Abiertas

Ninguna. Decisión del coordinador (2026-11-04): elegir Local o Híbrido solo requiere un destino conectado. La aprobación del Super Admin no es obligatoria: la solicitud es un pedido de ayuda para instalar.

## 13. Registro de Cambios

| Fecha | Autor | Descripción |
|---|---|---|
| 2026-11-04 | Claude Code (borrador) | Versión inicial. |
| 2026-11-04 | Víctor Chán Morales | Aprobada, con decisión de §12. |
| 2026-11-04 | Claude Code (revisión) | Corrige el destino de las carpetas principales y las raíces al cambiar de modelo. Aprobado por el coordinador (2026-11-04). |
