# Registro de módulos, dueños y fronteras

Este registro es operativo. Actualícelo cuando cambie un responsable, ruta, interfaz o módulo. No reasigne trabajo solo desde un PR de implementación.

## Estado

- Versión del registro: 0.1
- Fecha de inicio: 2026-09-28
- Aprobación del equipo: pendiente de revisión conjunta.

## Dueños

| Módulo | Dueño | Responsable de frontend | Alcance del primer corte | No pertenece aquí |
|---|---|---|---|---|
| Web común | Víctor | Víctor | Layout, navegación, rutas, componentes visuales, consumo tipado de API y ajuste a Figma | Reglas de autorización, SQL, credenciales SeaweedFS |
| IAM | Sebastián | Víctor | Registro, login, hash, sesión/JWT y asociación inicial usuario-organización | Pantallas duplicadas, Billing, archivos |
| Billing | Anthony | Víctor | Catálogo y activación simulada por organización | Cobro real, pantallas paralelas, cuota de Files |
| Audit | Anthony | Víctor | `AuditService.logEvent` con cadena de hashes por organización (SPEC-401); lectura en SPEC-402 | Edición o borrado de eventos, lógica de IAM/Files/Billing (cada dueño engancha sus eventos en SPEC-405) |
| Files + Storage | Miguel | Víctor | Carpetas, metadatos, primera carga/descarga, cliente `StorageService` (S3/SeaweedFS) | UI paralela, login, cobro |
| Integración | Víctor | Víctor | Contratos compartidos, estructura web, Compose/migraciones consolidadas y validación del recorrido | Reescritura silenciosa de la lógica de un dueño |

**Cambio de propiedad registrado el 2026-10-19:** `SubscriptionCoordinator` y `SubscriptionsController` (`apps/api/src/modules/integration/`) los implementó **Anthony** en la PR #4, aunque `CONTRACTS.md` asigna el coordinador de activación al integrador. El equipo acepta esa implementación y Víctor no la reescribe; el mantenimiento queda con Anthony y la revisión de integración con Víctor. Registrado en `SESSION_LOG.md`, según `CONTRIBUTING.md`.

## Rutas y archivos de web

| Ruta Next.js | Pantalla | Propietario de código | Dependencias de dominio | Figma |
|---|---|---|---|---|
| `/login` | Inicio de sesión | Víctor | IAM (Sebastián) | ID/frame pendiente |
| `/registro` | Registro | Víctor | IAM (Sebastián) | ID/frame pendiente |
| `/planes` | Catálogo/contratación simulada | Víctor | Billing (Anthony) | ID/frame pendiente |
| `/dashboard` | Resumen de organización, plan y uso | Víctor | IAM, Billing, Files | ID/frame pendiente |
| `/archivos` | Carpetas, carga/listado/descarga | Víctor | Files/Storage (Miguel) | ID/frame pendiente |

### Rutas adicionales de la interfaz web

Estas rutas siguen bajo la propiedad de Web común/Víctor. Las rutas marcadas como demostración solo gestionan estado local y no implican que el dominio de API esté implementado.

| Ruta Next.js | Pantalla | Propietario de código | Dependencias de dominio | Figma |
|---|---|---|---|---|
| `/` | Landing y acceso | Víctor | Registro/Billing | Frame existente; cotejo pendiente |
| `/verificar-correo` | Verificación | Víctor | IAM (Sebastián), EmailService | ID/frame pendiente |
| `/recuperar-contrasena` | Recuperación | Víctor | IAM (Sebastián), EmailService | ID/frame pendiente |
| `/archivos/[folderId]` | Contenido de carpeta | Víctor | Files/Storage (Miguel) | ID/frame pendiente |
| `/papelera` | Elementos eliminados | Víctor | Files (Miguel) | ID/frame pendiente |
| `/configuracion` | Configuración de cuenta/organización | Víctor | IAM (miembros, SPEC-106) | ID/frame pendiente |
| `/auditoria` | Eventos de actividad | Víctor | Audit (`GET /audit/events`, SPEC-402) + miembros para nombres (SPEC-104); conectada en SPEC-403 | ID/frame pendiente |

## Límites de carpetas

- `apps/web/**`: Víctor. Los compañeros describen campos, estados y errores que sus módulos necesitan; no implementan pantallas en paralelo.
- `apps/api/src/modules/iam/**`: Sebastián.
- `apps/api/src/modules/billing/**`: Anthony.
- `apps/api/src/modules/files/**` y `storage/**`: Miguel, con revisión de integración de Víctor.
- `apps/api/src/shared/**`, contrato, composición de app, Compose y migraciones integradas: Víctor coordina; cada módulo propone cambios.
- `docs/**`: documentos de equipo; cambios de reglas/contratos requieren acuerdo y registro. La guía de identidad visual es referencia común; Víctor custodia sus tokens web e integración con las pantallas.

## Clases nuevas del diagrama en revisión

La clase del diagrama no cambia la propiedad del módulo ni amplía automáticamente el hito:

| Clase propuesta | Dueño para implementación | Frontera |
|---|---|---|
| AuthService | Sebastián | IAM; entrega contrato de sesión y errores a Víctor. |
| BillingService | Anthony | Billing; publica plan vigente y límite para Dashboard/Files. |
| ShareLinksService | Miguel | Files; crea, lista y revoca enlaces a una versión fija (SPEC-209). El acceso público por token es de SPEC-216. |
| DestinationsService | Miguel | Files; administra los destinos propios y su prueba de conexión (SPEC-802). Las credenciales no salen de Files ni de Storage. |
| TeamsService | Miguel | Files; crea equipos con su Drive team y administra sus miembros con nivel read o write (SPEC-220). El acceso a archivos del Drive de equipo es de SPEC-222 y SPEC-224. |
| StoragePolicyService | Por asignar | Integration; coordina IAM (modelo de despliegue de la organización) y Files (destinos) para cambiar el modelo y su predeterminado en una transacción (SPEC-803). |
| InstallationRequestsService | Por asignar | Integration; registra y lista solicitudes de instalación. Una pendiente por organización. La revisión del Super Admin es de SPEC-503 (SPEC-803). |
| FolderPlacementService, DestinationDefaults | Miguel | Files; deciden el destino de una carpeta nueva según el modelo y consultan o cambian el predeterminado y las raíces de los Drives (SPEC-803). |
| PlatformActionsService | Por asignar | Revisión de solicitudes de instalación y acciones de plataforma (SPEC-503). |
| DatabaseServiceClient | No aprobado como servicio compartido | Mantener repositorios/puertos por dominio; Víctor coordina solo la composición y conexión común. |

Las relaciones Usuario–Membresía–Sesión, tenant–recursos, recurso–destino y permiso–sujeto deben conservarse aunque se muevan métodos a servicios. Los hallazgos completos están en `docs/revision-diagrama-clases.md`.

## Interfaces entre módulos

| Proveedor | Consumidor | Interfaz mínima |
|---|---|---|
| IAM | Web y módulos de API | Usuario autenticado + organización/membresía autorizada; errores de sesión y permisos |
| Billing | Web y Dashboard | Planes visibles, suscripción vigente y límites de plan |
| Files | Web y Dashboard | Carpetas/archivos autorizados; uso de espacio derivado de versiones |
| StorageRouter (ObjectStorage) | Files | Guardar, recuperar o eliminar objeto en el destino de la versión; errores previsibles, sin filtrar secreto. Para SPEC-802 también `probe` (prueba de conexión) e `invalidate` (descarta el cliente de un destino tras editarlo) |
| IAM | Files | `OpaqueTokens` y `PasswordHasher`, exportados por `IamModule` para generar y hashear tokens y contraseñas de enlaces compartidos (SPEC-209) |
| IAM | Files | `MemberAdmission.isActiveMember` y `activeMembers`, para validar y listar miembros activos de un equipo sin que Files lea tablas de IAM (SPEC-220) |
| IAM | Files | Puerto `DeploymentModelSource`, enlazado a `OrganizationRepository` (`findDeploymentModel`), para que Files lea el modelo de despliegue sin importar entidades de IAM (SPEC-803) |
| IAM | Integration | `OrganizationRepository` (`lockById`, `findDeploymentModel`, `updateDeploymentModel`), exportado por `IamModule` para la política de almacenamiento y las solicitudes (SPEC-803) |
| Files | Integration | `DestinationDefaults`, exportado por `FilesModule`: lista destinos disponibles, lee el predeterminado y lo cambia dentro de la transacción del llamador (SPEC-803) |
| Web | IAM/Billing/Files | Solicitudes HTTP según `CONTRACTS.md`; no se comunica directamente con DB ni object storage |

## Ciclo de cambio

1. El dueño propone cambio y consumidores afectados.
2. Actualiza primero `CONTRACTS.md`/modelo si cambió la interfaz y anota la decisión en `SESSION_LOG.md`.
3. Los consumidores confirman compatibilidad.
4. Se implementa y entra por PR.
