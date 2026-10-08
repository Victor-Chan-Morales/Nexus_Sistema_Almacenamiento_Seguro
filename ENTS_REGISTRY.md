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
| Files + Storage | Miguel | Víctor | Carpetas, metadatos, primera carga/descarga, interfaz `StorageProvider`, SeaweedFS | UI paralela, login, cobro |
| Integración | Víctor | Víctor | Contratos compartidos, estructura web, Compose/migraciones consolidadas y validación del recorrido | Reescritura silenciosa de la lógica de un dueño |

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
| `/configuracion` | Configuración de cuenta/organización | Víctor | IAM; alcance posterior | ID/frame pendiente |
| `/auditoria` | Eventos de actividad | Víctor | Audit; fase posterior | ID/frame pendiente |

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
| InstallationService | Pendiente de acuerdo | El equipo define responsable y alcance antes de implementarlo. |
| DatabaseServiceClient | No aprobado como servicio compartido | Mantener repositorios/puertos por dominio; Víctor coordina solo la composición y conexión común. |

Las relaciones Usuario–Membresía–Sesión, tenant–recursos, recurso–destino y permiso–sujeto deben conservarse aunque se muevan métodos a servicios. Los hallazgos completos están en `docs/revision-diagrama-clases.md`.

## Interfaces entre módulos

| Proveedor | Consumidor | Interfaz mínima |
|---|---|---|
| IAM | Web y módulos de API | Usuario autenticado + organización/membresía autorizada; errores de sesión y permisos |
| Billing | Web y Dashboard | Planes visibles, suscripción vigente y límites de plan |
| Files | Web y Dashboard | Carpetas/archivos autorizados; uso de espacio derivado de versiones |
| StorageProvider | Files | Guardar, recuperar o eliminar objeto; errores previsibles, sin filtrar secreto |
| Web | IAM/Billing/Files | Solicitudes HTTP según `CONTRACTS.md`; no se comunica directamente con DB ni object storage |

## Ciclo de cambio

1. El dueño propone cambio y consumidores afectados.
2. Actualiza primero `CONTRACTS.md`/modelo si cambió la interfaz y anota la decisión en `SESSION_LOG.md`.
3. Los consumidores confirman compatibilidad.
4. Se implementa y entra por PR.
