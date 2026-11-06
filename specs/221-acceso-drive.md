# SPEC-221: CENTRALIZAR EL ACCESO A DRIVES

## 1. Metadatos

| Campo | Valor |
|---|---|
| **Nivel de Rigor** | N2 (autorización de todo Files) |
| **Responsable Principal** | Por asignar |
| **Aprobador** | Víctor Chán Morales |
| **Módulo Afectado** | `apps/api/src/modules/files/` |
| **Requisitos Vinculados** | RF-006, RF-007, RF-003 |
| **Dependencias** | SPEC-006. **Etapa 1: nadie más toca Files hasta fusionarla.** |
| **Prioridad** | P1 |
| **Estimación** | 3 h |
| **Estado** | Implementada (2026-11-05). Aprobada el 2026-11-04 por Víctor Chán Morales |

## 2. Objetivo

`FilesService` da por hecho que todo Drive es personal (`findPersonalDrive`, `requirePersonalFolder`, `locateOwnFile`). Esta spec centraliza la decisión de acceso en un servicio, **sin cambiar ningún comportamiento**, para que los equipos se puedan agregar sin tocar cada operación.

## 3. Fuera de Alcance

- Equipos, Drives de equipo o niveles reales (SPEC-220 a 224). Aquí solo existe el Drive personal.
- Rutas, DTO, respuestas o códigos de error nuevos.
- Dividir el resto de `files.service.ts`.

## 4. Criterios de Aceptación

```gherkin
Escenario 1: Sin cambios visibles
  Dada toda la suite actual de Files y Dashboard
  Entonces pasa sin modificar ninguna aserción

Escenario 2: Drive personal propio
  Cuando DriveAccessService resuelve un Drive personal de quien solicita
  Entonces devuelve el Drive con nivel "owner"

Escenario 3: Drive ajeno
  Dado un Drive personal de otro miembro o de otra organización
  Entonces responde como no encontrado (404), sin revelar que existe

Escenario 4: Sin accesos directos
  Cuando se busca en files.service.ts
  Entonces findPersonalDrive y requirePersonalFolder ya no se usan fuera de DriveAccessService
```

## 5. Contrato de API

Sin cambios.

## 6. Datos y Esquema

No modifica la base de datos.

## 8. Diseño Técnico

```typescript
export type DriveAccessLevel = 'read' | 'write' | 'owner';
export interface DriveActor { organizationId: string; userId: string; }
export interface DriveAccess { drive: Drive; level: DriveAccessLevel; }

@Injectable()
export class DriveAccessService {
  /** Sin driveId: el Drive personal. No crea nada. */
  findDrive(actor: DriveActor, driveId?: string, manager?: EntityManager): Promise<DriveAccess | null>;
  /** Carpeta activa dentro de un Drive accesible; 404 si no. */
  requireFolder(actor: DriveActor, folderId: string, options?: { manager?: EntityManager; lock?: boolean }): Promise<{ folder: Folder; access: DriveAccess }>;
  /** Archivo de un Drive accesible, en cualquier estado de papelera. */
  locateFile(actor: DriveActor, fileId: string, options?: { manager?: EntityManager; lock?: boolean }): Promise<{ file: FileRecord; folder: Folder; access: DriveAccess } | null>;
}
```

- `getOrCreateUserDrive` y `ensureUserDrive` siguen creando el Drive personal; no se mueven.
- **Migración mecánica:** reemplazar cada uso en `listFolders`, `createFolder`, `getFolderItems`, `listFiles`, `uploadMultipartFile`, `downloadFileStream`, `softDelete`, carpetas, `restoreFile`, `purgeFile` y `listTrash`.
- **Candados:** se conserva exactamente el orden de bloqueo actual. `lockTenantQuota` sigue antes que el archivo.
- **Riesgo principal:** olvidar el filtro `organizationId` o `driveId` en un caso → fuga entre organizaciones. Mitigación: pruebas del escenario 3 por operación.

## 9. Plan de Tareas

- [ ] **T1 (45 min)**: `DriveAccessService` y sus pruebas.
- [ ] **T2 (75 min)**: Migrar lecturas y subida/descarga.
- [ ] **T3 (45 min)**: Migrar papelera, restaurar y purgar.
- [ ] **T4 (15 min)**: Confirmar los escenarios 1 y 4.

**Archivos permitidos:** `files/drive-access.service.ts` y su spec (nuevos), `files/files.service.ts`, `files/files.module.ts`. Si un `*.spec.ts` existente necesita registrar el proveedor, solo se añade; no se cambian aserciones.

## 10. Estrategia de Pruebas

| Criterio | Tipo | Archivo |
|---|---|---|
| Escenario 1 | Regresión | Suites existentes de `modules/files` |
| Escenarios 2, 3 | Unitaria | `drive-access.service.spec.ts` |
| Escenario 3 por operación | Unitaria | `files.service.spec.ts` |

## 11. Impacto en Documentación

- [ ] `apps/api/src/modules/files/README.md`.

## 12. Preguntas Abiertas

Ninguna.

## 13. Registro de Cambios

| Fecha | Autor | Descripción |
|---|---|---|
| 2026-11-04 | Claude Code (borrador) | Versión inicial. |
| 2026-11-04 | Víctor Chán Morales | Aprobada. |
| 2026-11-04 | Claude Code (revisión) | "Oleada 0" pasa a "Etapa 1", como en el catálogo. Aprobado por el coordinador (2026-11-04). |
| 2026-11-05 | Claude Code | Implementada en PR #48. Añadidas pruebas de Drive ajeno (404) por operación, sección 10. |
