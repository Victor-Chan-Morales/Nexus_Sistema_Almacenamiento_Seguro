# SPEC-801: ALMACENAMIENTO INTERCAMBIABLE (STRATEGY)

## 1. Metadatos

| Campo | Valor |
|---|---|
| **Nivel de Rigor** | N2 (núcleo de almacenamiento) |
| **Responsable Principal** | Por asignar |
| **Aprobador** | Víctor Chán Morales |
| **Módulo Afectado** | `apps/api/src/modules/storage/`, `apps/api/src/modules/files/` |
| **Requisitos Vinculados** | §12.1.1 (Strategy), RF-014 |
| **Dependencias** | SPEC-006, SPEC-221. **Etapa 1: nadie más toca Storage hasta fusionarla.** |
| **Prioridad** | P1 |
| **Estimación** | 3 h |
| **Estado** | Aprobada (2026-11-04, Víctor Chán Morales) |

## 2. Objetivo

Hoy `StorageService` tiene un solo bucket y un cliente S3 fijos. Esta spec crea una interfaz y un selector para que cada archivo se lea del almacén donde se guardó. **El comportamiento visible no cambia:** todos los destinos existentes siguen usando la configuración `S3_*`.

## 3. Fuera de Alcance

- Administrar destinos o guardar credenciales propias (SPEC-802).
- Elegir modelo (SPEC-803).
- Proveedores que no hablen S3.
- `getPresignedUrl`: se conserva sin usarse en la interfaz.

## 4. Criterios de Aceptación

```gherkin
Escenario 1: Sin cambios visibles
  Dada toda la suite actual y un recorrido manual de subir, descargar y purgar
  Entonces todo funciona igual

Escenario 2: Selección por versión
  Dado un archivo con versiones en dos destinos distintos (simulado en pruebas)
  Cuando se descarga cada versión
  Entonces cada una se lee con el proveedor de su destination_id

Escenario 3: Compensación y purga
  Dado un objeto a compensar o purgar
  Entonces se borra en el destino de su versión, no en el predeterminado

Escenario 4: Destino ajeno o deshabilitado
  Dado un destination_id de otra organización
  Entonces falla sin tocar el almacén
  Y un destino deshabilitado sigue permitiendo leer, pero no escribir

Escenario 5: Sin acoplamiento
  Cuando se busca en modules/files
  Entonces no se importa @aws-sdk ni se inyecta StorageService directamente
```

## 5. Contrato de API

Sin cambios.

## 6. Datos y Esquema

Sin migración. Usa `file_version.destination_id`, `folder.destination_id` y `files.destination`.

## 8. Diseño Técnico

```typescript
export interface ObjectStorage {
  put(objectKey: string, body: Buffer, size: number, contentType: string): Promise<void>;
  get(objectKey: string): Promise<Readable>;
  delete(objectKey: string): Promise<void>;
}

@Injectable()
export class StorageRouter {
  /** Lectura y borrado: admite destinos deshabilitados. */
  forRead(organizationId: string, destinationId: string): Promise<ObjectStorage>;
  /** Escritura: exige destino habilitado. */
  forWrite(organizationId: string, destinationId: string): Promise<ObjectStorage>;
}
```

- `S3ObjectStorage` implementa la interfaz. `StorageService` actual queda como la implementación del destino de entorno.
- `connection_details_encrypted` hoy contiene referencias `environment:*`. El selector devuelve el `StorageService` existente en ese caso. **SPEC-802 agrega el caso de credenciales propias**, con su caché.
- **Cambios en `files.service.ts`** (líneas actuales ~768, ~836, ~1099, ~1506): `put`, compensación, `get` y `deleteOrphanObjects`. Este último pasa de `string[]` a `{ destinationId, objectKey }[]`, también en `applyPurge`.
- **Destino al escribir:** `folder.destinationId` o, si es nulo, el predeterminado de `ensureTenantResources`. Se guarda en la versión como hoy.
- **Riesgo:** borrar en el almacén equivocado. Mitigación: el escenario 3 y la unicidad `(destination_id, object_key)`.

## 9. Plan de Tareas

- [ ] **T1 (45 min)**: Interfaz, `StorageRouter` y pruebas.
- [ ] **T2 (75 min)**: Migrar las llamadas en Files.
- [ ] **T3 (30 min)**: Purga y compensación con destino.
- [ ] **T4 (30 min)**: Regresión y prueba manual con SeaweedFS.

**Archivos permitidos:** `storage/object-storage.ts`, `storage/storage-router.service.ts` y su spec (nuevos), `storage/storage.module.ts`, `storage/storage.service.ts`, `files/files.service.ts`, `files/files.module.ts`, `files/*.spec.ts` (solo el proveedor simulado), `apps/api/src/modules/storage/README.md`.

## 10. Estrategia de Pruebas

| Criterio | Tipo | Archivo |
|---|---|---|
| Escenario 1 | Regresión y manual | Suites existentes |
| Escenarios 2–4 | Unitaria | `storage-router.service.spec.ts`, `files.service.spec.ts` |
| Escenario 5 | Búsqueda de texto | Evidencia en el PR |

## 11. Impacto en Documentación

- [ ] `ARCHITECTURE.md` (O y D de SOLID), `docs/sdd/constitucion.md`.

## 12. Preguntas Abiertas

Ninguna.

## 13. Registro de Cambios

| Fecha | Autor | Descripción |
|---|---|---|
| 2026-11-04 | Claude Code (borrador) | Versión inicial. |
| 2026-11-04 | Víctor Chán Morales | Aprobada. |
| 2026-11-04 | Claude Code (revisión) | "Oleada 0" pasa a "Etapa 1", como en el catálogo. Aprobado por el coordinador (2026-11-04). |
