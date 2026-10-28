# MATRIZ DE ENTREGABLES ACADÉMICOS — CURSO INGENIERÍA DE SOFTWARE

> **Mapeo de requerimientos académicos a archivos del repositorio.**  
> Formato de trabajo continuo: **Markdown en el repositorio** (`docs/entregables/`).  
> Formato de entrega final evaluable: **Exportación a PDF consolidado**.

---

## 1. Mapeo de Entregables del Curso

| Entregable Académico | Archivo Fuente en Repo | Responsable | Formato Intermedio | Hito Objetivo |
|---|---|---|:---:|:---:|
| **1. Requisitos de Software y Casos de Uso** | `docs/entregables/REQUISITOS_CASOS_USO.md` | Víctor Chán | Markdown (Gherkin/Tablas) | 🔴 **80% (30-Oct)** |
| **2. Paquete de Diagramas UML del Sistema** | `docs/entregables/DIAGRAMAS_UML.md` | Equipo (Miguel/Sebastián) | Mermaid / PlantUML | 🔴 **80% (30-Oct)** |
| **3. Matriz de Trazabilidad y Pruebas** | `docs/entregables/TRAZABILIDAD_PRUEBAS.md` | Anthony / Equipo | Markdown | 🔵 100% (Nov) |
| **4. Manual Técnico y de Arquitectura** | `docs/entregables/MANUAL_TECNICO.md` | Víctor Chán | Markdown → PDF | 🔵 100% (Nov) |
| **5. Manual de Usuario con Capturas** | `docs/entregables/MANUAL_USUARIO.md` | Víctor Chán | Markdown → PDF | 🔵 100% (Nov) |

---

## 2. Detalle de Contenido por Entregable

### 1. Requisitos de Software y Casos de Uso (`REQUISITOS_CASOS_USO.md`)
- Matriz completa de Requisitos Funcionales (RF-001 a RF-016) traducidos a casos de uso formales.
- Actores del sistema: Super Admin, Tenant Admin, Colaborador, Auditor. **Super Admin y Auditor se documentan como actores "no implementados en el corte del 80%"** (ADR-007 §3); los casos de uso de Tenant Admin y Colaborador son los que tienen implementación.
- Flujos principales y alternativos en formato estándar (Actores, Precondiciones, Flujo Principal, Postcondiciones, Criterios de Aceptación Gherkin).
- Requisitos No Funcionales (Seguridad, Cifrado, Rendimiento, Disponibilidad, Multitenancy).

### 2. Paquete de Diagramas UML (`DIAGRAMAS_UML.md`)
- **Diagrama de Clases del Dominio**: Mapeo entidad-relación de TypeORM (User, Organization, Membership, Plan, Subscription, Drive, Folder, File, FileVersion, AuditEvent).
- **Diagrama de Secuencia 1**: Flujo de Registro Atómico, verificación outbox y emisión de JWT.
- **Diagrama de Secuencia 2**: Flujo de Subida de Archivo con cifrado Envelope AES-256-GCM y persistencia en SeaweedFS.
- **Diagrama de Componentes**: Desacoplamiento entre Next.js Web, API NestJS, módulos de dominio (IAM, Files, Storage, Billing, Audit), Postgres y SeaweedFS.
- **Diagrama de Despliegue Físico**: Topología Docker Compose, puertos expuestos (3000, 3001, 5433, 8333, 1025) y volúmenes persistentes.

### 3. Matriz de Trazabilidad y Pruebas (`TRAZABILIDAD_PRUEBAS.md`)
- Mapeo bidireccional: `ID Requisito` ↔ `Endpoint / Pantalla` ↔ `Archivo de Prueba Jest (*.spec.ts)`.
- Registro de pruebas unitarias y de integración que garantizan que ningún requisito carezca de verificación automatizada.

### 4. Manual Técnico y de Instalación (`MANUAL_TECNICO.md`)
- Requisitos de entorno (Node.js 22 LTS, Docker, Docker Compose, Git).
- Guía de configuración paso a paso de variables de entorno (`.env` y `apps/web/.env.local`).
- Comandos de inicialización de infraestructura, aplicación de migraciones TypeORM y levantamiento de servidores.
- Procedimientos de resolución de problemas comunes (puertos ocupados, variables faltantes, permisos de Docker).

### 5. Manual de Usuario (`MANUAL_USUARIO.md`)
- Guía ilustrada con capturas de pantalla de la interfaz Next.js:
  1. Registro de organización y verificación de correo.
  2. Inicio de sesión y navegación por el Dashboard.
  3. Navegación, creación de carpetas y subida de archivos cifrados.
  4. Descarga y visualización de versiones previas.
  5. Gestión de papelera (restauración y purga definitiva).
  6. Gestión de miembros y roles del equipo.
  7. Consulta de planes y facturación simulada.

---

## 3. Entregables de la propuesta §14 aún sin asignar

La propuesta (§14) lista además de lo anterior: **Seguridad** (descripción criptográfica, políticas y resultados de pruebas), **Pruebas** (unitarias, integración, seguridad, rendimiento y aceptación), **Presentación ejecutiva** y **Capacitación**; y el curso §7 pide **diseño de base de datos / modelo entidad-relación** (hoy solo implícito en el diagrama de clases). Ninguno tiene archivo ni responsable en la tabla de arriba. Pendiente de asignar para el 100% (el ADR-006 es la base del documento de Seguridad).
