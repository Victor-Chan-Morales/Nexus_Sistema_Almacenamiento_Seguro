# NEXUS — DOCUMENTO DE REQUISITOS Y CASOS DE USO

> **SPEC-701 · Borrador asistido, 2026-10-27.** Redactado a partir del código, las migraciones, `CONTRACTS.md` v0.5 (borrador), las ADR 001–007, las specs de `specs/` y las dos fuentes del curso (la propuesta y el enunciado). **Pendiente de revisión de Víctor Chán Morales** antes de exportarlo a PDF.
>
> **Cómo leer los estados.** Este documento describe un sistema que se está terminando; no todo lo escrito existe. Cada requisito y caso de uso lleva su estado:
>
> | Marca | Significado |
> |---|---|
> | ✅ **Implementado** | Existe en el código de `main`/árbol de trabajo. **No** significa verificado de punta a punta: las pruebas existentes son unitarias con simulaciones y nadie ha ejecutado el flujo completo contra PostgreSQL y SeaweedFS reales. |
> | 🟡 **Especificado (corte 80%)** | Tiene spec en `specs/`; se construye hasta el viernes 30 de octubre de 2026. Los marcados **P2** solo entran si sobra tiempo. |
> | ⛔ **Fuera del corte** | No se construye en el corte del 80%; se declara en la exposición. |

---

## 1. Introducción

### 1.1 Propósito
Este documento define los requisitos funcionales y no funcionales de **Nexus** y detalla sus casos de uso, para que el equipo, el docente y los usuarios piloto compartan una misma descripción de lo que el sistema hace, de lo que hará en el corte del 80% y de lo que queda fuera.

### 1.2 El producto
Nexus es una plataforma **PaaS de almacenamiento seguro híbrido (STaaS)**. Una organización (tenant) se registra, contrata un plan simulado y administra archivos y carpetas desde una interfaz web. La plataforma separa el control de acceso y los metadatos (PostgreSQL) de los bytes del archivo (almacenamiento de objetos S3 compatible, hoy SeaweedFS), que se guardan **cifrados**. La propuesta prevé que el cliente decida dónde residen sus datos (nube, servidores propios o híbrido); en el corte actual existe un único destino de nube.

### 1.3 Arquitectura vigente
**Monolito modular** NestJS (IAM, Billing, Files, Storage, Integration, Dashboard, Health y, en el corte, Audit) con una aplicación Next.js independiente, PostgreSQL 16 y SeaweedFS en Docker Compose. Reemplaza a la arquitectura de microservicios de la propuesta (ADR-001).

### 1.4 Fuentes
Propuesta PaaS Almacenamiento Seguro Híbrido (§6–§10, §19) · Enunciado del Proyecto Final de Ingeniería de Software 2026 (§4, §7) · `BUSINESS_RULES.md` · `CONTRACTS.md` · `docs/decisions/ADR-001…007` · `specs/README.md`.

---

## 2. Alcance

### 2.1 Alcance del corte del 80% (viernes 30 de octubre de 2026)
Registro y autenticación con verificación de correo y recuperación de contraseña · roles de organización y alta de miembros · espacios personales con carpetas, subida, descarga y versionado de archivos con cifrado envelope · planes, suscripción simulada, historial de operaciones y renovación · panel de uso de almacenamiento · auditoría de acciones relevantes · despliegue local reproducible con Docker Compose.

### 2.2 Fuera del corte (se declara en la exposición)
Papelera completa (listar, restaurar, purgar) y versiones consultables si no entran como P2 · carpetas de equipo y permisos por recurso · enlaces compartidos temporales y su revocación · selección del modelo de despliegue y aprovisionamiento on-premises · panel del Super Admin con datos reales · rol Auditor · MFA/TOTP · rotación de llaves y cifrado en streaming · verificación de la cadena de hashes de auditoría.

### 2.3 Fuera del producto (propuesta §5.2)
Pasarelas de pago reales, edición colaborativa en vivo, aplicaciones móviles nativas y sincronización P2P.

### 2.4 Desviaciones respecto de la propuesta

| La propuesta dice | Nexus hace | Referencia |
|---|---|---|
| Microservicios con API Gateway | Monolito modular; **no hay API Gateway** (la API se expone directamente) | ADR-001 |
| libsodium, cifrado en streaming | AES-256-GCM de `node:crypto`, en memoria, límite de 100 MB | ADR-006 |
| Redis Streams para auditoría asíncrona | Sin bus; el evento se registra tras el commit de la operación | Constitución art. 3, ADR-007 §8 |
| MinIO/S3 | SeaweedFS con API S3 | ADR-004 |
| MFA/TOTP en IAM | Fuera de alcance por tiempo | ADR-002 |
| Oficial de cumplimiento y Equipo de ingeniería como usuarios | Son **interesados del proyecto** (propuesta §6), no roles del sistema | ADR-007 §3 |

---

## 3. Actores

| Actor | Descripción | Estado en el sistema |
|---|---|---|
| **Visitante** | Persona sin sesión: consulta el sitio público y los planes, se registra, inicia sesión y recupera su contraseña. | ✅ |
| **Tenant Admin** (`tenant_admin`) | Administra su organización: miembros, plan y auditoría. También opera archivos. Se crea automáticamente al registrar la organización. | ✅ (autorización por rol: 🟡 SPEC-101) |
| **Colaborador** (`colaborador`) | Opera archivos dentro de su espacio personal y consulta el panel. | ✅ rol en BD/JWT; 🟡 alta de colaboradores (SPEC-102) |
| **Super Admin** | Administra la plataforma (tenants, planes). Es la marca `is_super_admin` de un usuario, **no un rol de organización**. | ⛔ solo existe una maqueta |
| **Auditor** | Consulta trazabilidad sin alterar nada. | ⛔ no se implementa en el corte; se documenta como actor futuro |
| **Sistema** | Procesos automáticos: envío de correos desde el outbox con reintentos. | ✅ |

> Los **interesados** de la propuesta (Oficial de cumplimiento, Equipo de ingeniería) orientan los requisitos de trazabilidad y calidad, pero no son actores del sistema.

---

## 4. Requisitos funcionales

### 4.1 Requisitos de la propuesta (RF-001 a RF-016)

| ID | Requisito | Estado | Evidencia / spec | Casos de uso |
|---|---|:---:|---|---|
| RF-001 | Registro y autenticación con MFA/TOTP | ✅ registro, login y verificación de correo · ⛔ MFA/TOTP | `POST /auth/register`, `/login`, `/verify-email`; MFA descartado (ADR-002) | UC-01, 02, 03 |
| RF-002 | Emisión y validación de JWT | ✅ | JWT de 15 min + refresh de 7 días en cookie `HttpOnly`; revalida la membresía en cada petición | UC-03, 04 |
| RF-003 | Control de acceso RBAC | 🟡 | Roles en BD y JWT ✅; falta el guard por rol: SPEC-101, 102, 104 | UC-06 y todos los administrativos |
| RF-004 | Cifrado de archivos en streaming con libsodium | 🟡 parcial | AES-256-GCM en memoria (ADR-006); **no es streaming ni libsodium** | UC-14, 15 |
| RF-005 | Gestión de llaves DEK/KEK | ✅ (sin rotación) | DEK por versión, KEK por tenant (HKDF); ver ADR-006 | UC-14, 15 |
| RF-006 | Carpetas de equipo | ⛔ | Tablas `files.team*` existen sin código | UC-22 |
| RF-007 | Espacios personales | ✅ | Drive `Mi espacio` y carpeta raíz `Archivos` creados en el registro | UC-12, 13 |
| RF-008 | Versionado | 🟡 parcial | Se crean versiones al repetir un nombre ✅; consulta: SPEC-206 (P2); restaurar una versión ⛔ | UC-14, 18 |
| RF-009 | Papelera y recuperación | 🟡 parcial | Borrado lógico por API ✅; listar, restaurar y purgar: SPEC-202–205 (P2) | UC-16, 17 |
| RF-010 | Enlaces temporales protegidos | ⛔ | `files.share_link` sin código (SPEC-209, 100%) | UC-20 |
| RF-011 | Revocación inmediata | ⛔ | Igual que RF-010 | UC-20 |
| RF-012 | Panel de auditoría | 🟡 | SPEC-401, 402, 403, 405 | UC-19 |
| RF-013 | Planes y límites por tenant | ✅ + 🟡 | Planes, activación y cuota ✅; renovación e historial: SPEC-301–303 | UC-07 a 11 |
| RF-014 | Selección del modelo de despliegue | ⛔ | La organización nace `cloud`; sin pantalla ni API | UC-23 |
| RF-015 | Aprovisionamiento on-premises con Docker Compose | 🟡 parcial | Compose reproducible de PostgreSQL, SeaweedFS y Mailpit; la web y la API corren con `npm` (la API tiene perfil de contenedor); sin gestión de instalaciones | — |
| RF-016 | Panel multi-tenant para Super Admin | ⛔ | Maqueta con cifras inventadas (SPEC-501/502, 100%) | UC-21 |

> **Criterio de aceptación de la propuesta (§19):** «RF-001 a RF-016 implementados y verificados». En el corte del 80% **no se cumple**. Hoy: 3 completos (RF-002, 005, 007); RF-013 completo salvo renovación e historial; 7 parciales o solo especificados (RF-001, 003, 004, 008, 009, 012, 015); y 5 sin empezar (RF-006, 010, 011, 014, 016). Las specs P1 reducen la lista, pero no la cierran. El documento lo declara abiertamente.

### 4.2 Requisitos del enunciado del curso

| Ref. del curso | Requisito | Estado | Cómo se cubre |
|---|---|:---:|---|
| §4.1 Registro | Registro de usuarios, validación de correo | ✅ | UC-01, UC-02 |
| §4.1 Registro | Recuperación de contraseña | 🟡 | SPEC-103/105 · UC-05 |
| §4.1 Inicio de sesión | Autenticación segura y manejo de sesiones | ✅ | UC-03, UC-04 (Argon2id, sesiones revocables) |
| §4.1 Roles | Administrador y Cliente como mínimo | 🟡 | `tenant_admin` y `colaborador`; el segundo solo se puede crear con SPEC-102 · UC-06 |
| §4.2 Suscripciones | Visualización de planes (nombre, descripción, precio, vigencia) | ✅ | UC-07 |
| §4.2 Suscripciones | Contratación de servicios | ✅ | UC-08 |
| §4.2 Suscripciones | Historial de pagos | 🟡 | SPEC-301/303 · UC-10 |
| §4.2 Suscripciones | Renovación de servicios | 🟡 | SPEC-302 · UC-09 |
| §4.2 Suscripciones | Simulación de pagos, sin dinero real | ✅ | Toda operación es simulada |
| §4.3 Opción B | Cargar y descargar archivos | ✅ | UC-14, UC-15 |
| §4.3 Opción B | Gestionar carpetas | ✅ | UC-12, UC-13 (crear y navegar; sin renombrar ni eliminar carpetas) |
| §4.3 Opción B | Monitorear el espacio disponible | ✅ | UC-11 |

---

## 5. Requisitos no funcionales

| ID | Requisito | Estado | Evidencia o brecha |
|---|---|:---:|---|
| RNF-001 | Disponibilidad objetivo del 99.5% en la nube | ⛔ | Sin despliegue productivo ni medición |
| RNF-002 | TLS 1.3 para comunicaciones externas | ⛔ | Solo HTTP en desarrollo; la cookie lleva `Secure` en producción; TLS se resolvería en el despliegue |
| RNF-003 | Cifrado de datos en reposo | ✅ | AES-256-GCM antes de guardar el objeto (ADR-006) |
| RNF-004 | Hash de contraseñas con Argon2id | ✅ | `memoryCost` 19 456 KiB, `timeCost` 2, `parallelism` 1 |
| RNF-005 | API < 300 ms en el percentil 95 | ⛔ | Sin pruebas de rendimiento |
| RNF-006 | Escalabilidad horizontal de microservicios | ⛔ | No aplica: la arquitectura es un monolito modular (ADR-001) |
| RNF-007 | Auditoría inmutable | 🟡 | Triggers de BD rechazan `UPDATE`/`DELETE`/`TRUNCATE` en `audit.audit_event` ✅; `record_hash` y `prev_hash` desde la v1 (SPEC-401); verificación de la cadena: SPEC-404 (100%) |
| RNF-008 | Compatibilidad con navegadores modernos | 🟡 | Next.js 16 / React 19; sin matriz de pruebas por navegador |
| RNF-009 | Onboarding sin capacitación formal | 🟡 | Sin pruebas con usuarios piloto |
| RNF-010 | Despliegue portable con Docker Compose | 🟡 | `docker compose up -d` levanta la infraestructura; la web no está contenerizada |
| RNF-011 | HSTS y CSP | ⛔ | Sin cabeceras de seguridad configuradas (ni `helmet` ni `headers()` de Next.js) |

### 5.1 Requisitos de calidad internos (de la constitución del proyecto)
Aislamiento multi-tenant en cada consulta; respuesta `404` ante recursos de otra organización; ningún `organizationId` aceptado desde el navegador; errores con el formato común `{ code, message, requestId }`; ninguna entidad de base de datos expuesta en la API; mensajes de interfaz en español y código en inglés.

---

## 6. Reglas de negocio transversales

| ID | Regla | Fuente |
|---|---|---|
| RN-01 | La organización activa sale siempre del token validado contra una membresía activa; nunca del navegador. | CONTRACTS, IAM |
| RN-02 | Un recurso de otra organización (o de otro miembro) se trata como inexistente: `404`. | CONTRACTS, Constitución art. 6 |
| RN-03 | Contraseña: 8–128 caracteres con letras y números; se guarda solo su hash Argon2id. | `RegisterDto`, RNF-004 |
| RN-04 | El login exige correo verificado; el token de verificación vence a los 15 minutos y se usa una sola vez. | CONTRACTS v0.4 |
| RN-05 | Sesión: token de acceso de 15 minutos (en memoria) y refresh de 7 días (cookie `nexus_refresh`, rotado, guardado como hash). Reutilizar un refresh revocado revoca todas las sesiones. | CONTRACTS, `SessionService` |
| RN-06 | El registro crea, en una sola transacción, usuario, organización, membresía `tenant_admin`, suscripción Demo, cuota, Drive `Mi espacio` y carpeta `Archivos`; si algo falla, no se crea nada. | ADR-003 |
| RN-07 | Archivos: máximo 100 MB; PDF, DOCX, XLSX, PPTX, JPG, PNG, TXT y ZIP (se valida extensión, tipo declarado y contenido); máximo 3 cargas simultáneas por usuario. | CONTRACTS, `FilesService` |
| RN-08 | Repetir un nombre en la misma carpeta crea una **nueva versión** del mismo archivo; `Idempotency-Key` evita duplicados en reintentos. | CONTRACTS |
| RN-09 | Cuota en bytes: suma el tamaño real de **todas** las versiones almacenadas, más las reservas de carga activas; los archivos eliminados cuentan durante 30 días. Sin suscripción vigente el límite es 0. | CONTRACTS, ADR-007 §7 |
| RN-10 | Una organización tiene como máximo una suscripción activa; reactivar el mismo plan no crea otra; reducir de plan solo se acepta si el uso confirmado más las reservas caben en el nuevo límite. | CONTRACTS, ADR-003 |
| RN-11 | Los planes y precios salen del catálogo persistido (Demo, Team, Business, Enterprise); toda operación de pago es simulada. | CONTRACTS, `BillingService` |
| RN-12 | Los planes pagados vencen a los 30 días; Demo no vence ni se renueva. | CONTRACTS v0.5 |
| RN-13 | Solo `tenant_admin` gestiona miembros, plan, historial de facturación y consulta la auditoría. | ADR-007 §4 |
| RN-14 | El límite de usuarios lo fija el plan vigente (Demo: 5). | CONTRACTS v0.5 |
| RN-15 | La auditoría no guarda contraseñas, tokens, llaves ni contenido de archivos; registra después del commit y nunca bloquea la operación. | BUSINESS_RULES, ADR-007 §8 |

---

## 7. Casos de uso

### 7.1 Diagrama y catálogo
El diagrama de casos de uso está en `DIAGRAMAS_UML.md` (§1).

| ID | Caso de uso | Actor principal | Estado |
|---|---|---|:---:|
| UC-01 | Registrar organización y cuenta | Visitante | ✅ |
| UC-02 | Verificar correo | Visitante | ✅ |
| UC-03 | Iniciar sesión | Visitante | ✅ |
| UC-04 | Mantener y cerrar la sesión | Usuario autenticado | ✅ |
| UC-05 | Recuperar contraseña | Visitante | 🟡 |
| UC-06 | Agregar y listar miembros | Tenant Admin | 🟡 |
| UC-07 | Consultar planes | Visitante / Usuario | ✅ |
| UC-08 | Contratar o cambiar de plan | Tenant Admin | ✅ (restricción por rol 🟡) |
| UC-09 | Renovar la suscripción | Tenant Admin | 🟡 |
| UC-10 | Consultar el historial de facturación | Tenant Admin | 🟡 |
| UC-11 | Consultar el panel de uso | Usuario autenticado | ✅ |
| UC-12 | Crear carpeta | Usuario autenticado | ✅ |
| UC-13 | Explorar carpetas y archivos | Usuario autenticado | ✅ |
| UC-14 | Subir archivo | Usuario autenticado | ✅ |
| UC-15 | Descargar archivo | Usuario autenticado | ✅ |
| UC-16 | Mover un archivo a la papelera | Usuario autenticado | ✅ API · ⛔ sin acción en la interfaz (SPEC-205, P2) |
| UC-17 | Gestionar la papelera (listar, restaurar, purgar) | Usuario autenticado | 🟡 P2 |
| UC-18 | Consultar el historial de versiones | Usuario autenticado | 🟡 P2 |
| UC-19 | Consultar la auditoría | Tenant Admin | 🟡 |
| UC-20 | Compartir un archivo con enlace temporal | Usuario autenticado | ⛔ |
| UC-21 | Administrar la plataforma multi-tenant | Super Admin | ⛔ |
| UC-22 | Trabajar en un espacio de equipo | Usuario autenticado | ⛔ |
| UC-23 | Elegir el modelo de despliegue | Tenant Admin | ⛔ |

### 7.2 Descripción de los casos de uso

#### UC-01 Registrar organización y cuenta · ✅ · RF-001, RF-007, RF-013
- **Actor:** Visitante. **Endpoint:** `POST /auth/register`.
- **Precondiciones:** el correo no está registrado.
- **Flujo principal:** 1) La persona ingresa nombre, correo, contraseña y nombre de la organización. 2) El sistema valida los datos (RN-03). 3) En **una transacción** crea usuario, organización, membresía `tenant_admin`, suscripción Demo (y, con SPEC-301, su operación de US$0), cuota, Drive `Mi espacio` y carpeta `Archivos`, y deja un correo de verificación en el outbox. 4) Tras confirmar, intenta enviar el correo. 5) Responde `201` indicando que se requiere verificar el correo.
- **Alternativos:** *A1* correo ya registrado → `409` (también ante dos registros simultáneos); *A2* datos inválidos → `400`; *A3* el servicio de correo falla → la cuenta queda creada y el mensaje se reintenta durante 24 h; *A4* falla un paso de la transacción → no se crea nada.
- **Postcondiciones:** cuenta sin verificar con plan Demo (5 GB, 5 usuarios) y espacio personal listo.

#### UC-02 Verificar correo · ✅ · RF-001
- **Actor:** Visitante. **Endpoint:** `POST /auth/verify-email`; pantalla `/verificar-correo?token=…`.
- **Flujo principal:** 1) La persona abre el enlace del correo. 2) El sistema valida el token (vigente, sin usar). 3) Marca el correo como verificado y consume el token.
- **Alternativos:** token vencido (15 min), usado o inválido → error y no cambia nada. No existe reenvío manual en este corte.
- **Postcondiciones:** la cuenta puede iniciar sesión.

#### UC-03 Iniciar sesión · ✅ · RF-001, RF-002
- **Actor:** Visitante. **Endpoint:** `POST /auth/login`.
- **Flujo principal:** 1) Ingresa correo y contraseña. 2) El sistema verifica la contraseña (Argon2id), el estado de la cuenta, que el correo esté verificado y que tenga una membresía activa. 3) Abre una sesión: emite el token de acceso (15 min) y fija la cookie de refresh `HttpOnly` (7 días). 4) Devuelve usuario, organización y rol.
- **Alternativos:** credenciales inválidas o cuenta inactiva → mismo error (no revela el motivo); correo no verificado → `403 EMAIL_NOT_VERIFIED`; sin membresía activa → error; MFA activado → rechazo (no soportado).
- **Postcondiciones:** sesión activa; el token de acceso vive solo en memoria del navegador.
- **Nota:** con varias membresías se toma la activa más antigua; no hay selector de organización.

#### UC-04 Mantener y cerrar la sesión · ✅ · RF-002
- **Endpoints:** `POST /auth/refresh`, `POST /auth/logout`.
- **Flujo principal:** al recargar la página, la web pide un nuevo token con la cookie de refresh; el sistema valida la sesión y la membresía, **rota** el refresh y devuelve la sesión. Al cerrar sesión, se revoca la sesión y se limpia la cookie.
- **Alternativos:** refresh revocado o vencido → sesión inválida; **reutilizar un refresh ya usado revoca todas las sesiones** del usuario (posible robo); membresía suspendida → sesión rechazada.

#### UC-05 Recuperar contraseña · 🟡 SPEC-103/105 · Curso §4.1
- **Actor:** Visitante. **Endpoints:** `POST /auth/forgot-password`, `POST /auth/reset-password`.
- **Flujo principal:** 1) Escribe su correo. 2) El sistema responde siempre con el mismo mensaje y, si la cuenta existe, envía un enlace de un solo uso (15 min). 3) La persona abre `/nueva-contrasena?token=…` y define una contraseña. 4) El sistema la guarda con Argon2id, consume el token, **revoca todas las sesiones** y marca el correo como verificado.
- **Alternativos:** correo inexistente → misma respuesta, sin correo; token inválido o vencido → `400 INVALID_OR_EXPIRED_TOKEN`; contraseña débil → `400` sin consumir el token.

#### UC-06 Agregar y listar miembros · 🟡 SPEC-102/104/106 · RF-003
- **Actor:** Tenant Admin. **Endpoints:** `POST` y `GET /organizations/members`.
- **Precondiciones:** rol `tenant_admin`; cupo disponible en el plan.
- **Flujo principal:** 1) Desde `/configuracion` el administrador ve los miembros y el cupo («N de M usuarios»). 2) Completa nombre, correo y rol (`tenant_admin` o `colaborador`). 3) El sistema crea la cuenta con una contraseña aleatoria inutilizable, la membresía activa y un correo de invitación (24 h). 4) La persona define su contraseña con el enlace (UC-05) y puede iniciar sesión.
- **Alternativos:** el solicitante no es administrador → `403 FORBIDDEN_ROLE`; ya es miembro → `422 MEMBER_ALREADY_EXISTS`; el correo pertenece a otra organización → `422 EMAIL_BELONGS_TO_OTHER_ORGANIZATION`; cupo agotado o sin plan vigente → `422 USER_LIMIT_EXCEEDED`.
- **Postcondiciones:** nuevo miembro con su espacio personal creado en su primer uso.

#### UC-07 Consultar planes · ✅ · RF-013, Curso §4.2
- **Endpoint:** `GET /plans` (público). **Flujo:** el sistema devuelve el catálogo (nombre, descripción, precio mensual, almacenamiento en bytes, usuarios, vigencia) desde la BD.

#### UC-08 Contratar o cambiar de plan · ✅ · RF-013, Curso §4.2
- **Actor:** Tenant Admin (la restricción por rol llega con SPEC-302). **Endpoint:** `POST /subscriptions/activate`.
- **Flujo principal:** 1) Elige un plan y confirma (pantallas de planes y confirmación). 2) El sistema bloquea la suscripción vigente, comprueba que el uso confirmado más las reservas **quepan** en el límite del nuevo plan, cancela la anterior y crea la nueva (con vencimiento a 30 días en planes pagados). 3) *(🟡 con SPEC-301)* Registra una operación simulada de cobro. 4) Responde con la suscripción activa.
- **Alternativos:** el mismo plan vigente → devuelve la existente sin crear otra; reducción que no cabe → `422 STORAGE_QUOTA_EXCEEDED` (no se borra nada); activación simultánea → `409`; si Files no responde, **se aborta** (nunca se asume 0 bytes).
- **Postcondiciones:** una sola suscripción activa; el panel refleja el nuevo límite.

#### UC-09 Renovar la suscripción · 🟡 SPEC-302/303 · Curso §4.2
- **Endpoint:** `POST /subscriptions/renew`. **Flujo:** el administrador pulsa «Renovar»; el sistema extiende la vigencia 30 días desde la fecha mayor entre hoy y el fin actual, sin crear otra suscripción, y registra una operación de renovación.
- **Alternativos:** plan Demo → `422 PLAN_NOT_RENEWABLE`; sin suscripción vigente → `422 NO_ACTIVE_SUBSCRIPTION`.

#### UC-10 Consultar el historial de facturación · 🟡 SPEC-301/303 · Curso §4.2
- **Endpoint:** `GET /billing/operations`. **Flujo:** en `/suscripcion` el administrador ve la tabla de operaciones simuladas (fecha, plan, tipo y monto en USD) de su organización, con la marca «Simulado».

#### UC-11 Consultar el panel de uso · ✅ · RF-013, Curso §4.3
- **Endpoint:** `GET /dashboard`. **Flujo:** el sistema devuelve la organización, el plan vigente, el almacenamiento usado y el límite, todo en bytes; la interfaz solo los formatea. Sin suscripción vigente, el límite es 0.

#### UC-12 Crear carpeta · ✅ · RF-007
- **Endpoint:** `POST /folders`. **Flujo:** el usuario indica el nombre y la carpeta padre (por defecto la raíz); el sistema la crea en su espacio personal. **Brecha:** ADR-003 y las reglas de negocio exigen nombres únicos dentro del mismo padre sin distinguir mayúsculas, pero **hoy ni la API ni la BD lo validan** (no hay índice único): se pueden crear carpetas duplicadas.

#### UC-13 Explorar carpetas y archivos · ✅ · RF-007
- **Endpoints:** `GET /folders`, `GET /folders/:id/items`. **Flujo:** el sistema devuelve el espacio personal y, para cada carpeta, sus subcarpetas (con tamaño y fecha) y archivos (nombre, tipo, tamaño, versión y fecha). Una carpeta ajena responde `404`.

#### UC-14 Subir archivo · ✅ · RF-004, RF-005, RF-008, RNF-003
- **Endpoint:** `POST /files/upload` (multipart, `Idempotency-Key` opcional).
- **Precondiciones:** carpeta propia; cuota disponible; archivo ≤ 100 MB de un tipo permitido.
- **Flujo principal:** 1) El sistema valida tamaño, tipo y contenido real. 2) **Reserva** el espacio en la cuota de forma atómica. 3) Si el nombre ya existe en la carpeta, prepara una nueva versión; si no, crea el archivo. 4) **Cifra** el contenido (DEK aleatoria por versión, AES-256-GCM) y envuelve la DEK con la KEK del tenant. 5) Guarda el objeto en el almacenamiento y los metadatos en PostgreSQL. 6) Libera la reserva, recalcula la cuota y responde con el archivo y su versión.
- **Alternativos:** cuota insuficiente → `422 STORAGE_QUOTA_EXCEEDED`; demasiado grande → `413`; tipo no permitido → `415`; más de 3 cargas simultáneas → `429`; reintento con la misma `Idempotency-Key` → devuelve el resultado anterior sin duplicar; **falla la BD después de guardar el objeto** → se borra el objeto huérfano y se libera la reserva (si el borrado falla, la carga queda en «Limpieza pendiente»).
- **Postcondiciones:** nueva versión disponible; los bytes en el almacenamiento están cifrados.

#### UC-15 Descargar archivo · ✅ · RF-004, RF-005
- **Endpoint:** `GET /files/:id/download`. **Flujo:** el sistema localiza el archivo activo en el espacio del solicitante, lee el objeto, lo **descifra y verifica su integridad** (etiqueta GCM y SHA-256) y lo entrega con un `Content-Disposition` seguro.
- **Alternativos:** archivo ajeno, eliminado o inexistente → `404`; objeto alterado o llave inválida → error interno sin revelar detalles.

#### UC-16 Mover un archivo a la papelera · ✅ API · RF-009
- **Endpoint:** `DELETE /files/:id`. **Flujo:** el sistema marca el archivo como eliminado con su fecha; deja de aparecer en el explorador. **Limitación:** la interfaz aún no ofrece esta acción (SPEC-205).

#### UC-17 Gestionar la papelera · 🟡 P2 SPEC-202–205 · RF-009
- **Endpoints:** `GET /files/trash`, `POST /files/:id/restore`, `DELETE /files/:id/purge`. **Alcance:** solo archivos y solo del espacio del solicitante.
- **Flujo principal:** el usuario ve sus archivos eliminados y la fecha en que dejan de contar para la cuota; puede **restaurar** uno a su carpeta original o **eliminarlo definitivamente** (se borran sus versiones y objetos y se libera la cuota).
- **Alternativos:** restaurar con un nombre ya usado en la carpeta → `409 FILE_NAME_CONFLICT`; purgar un archivo activo → `422 CANNOT_PURGE_ACTIVE_FILE`.
- **Limitación:** no hay purga automática a los 30 días.

#### UC-18 Consultar el historial de versiones · 🟡 P2 SPEC-206/207 · RF-008
- **Endpoint:** `GET /files/:id/versions`. **Flujo:** el usuario abre «Versiones» de un archivo y ve cada versión con su tamaño y fecha, indicando cuál es la actual. Es de solo lectura.

#### UC-19 Consultar la auditoría · 🟡 SPEC-401–403, 405 · RF-012, RNF-007
- **Actor:** Tenant Admin. **Endpoint:** `GET /audit/events`.
- **Flujo principal:** el administrador abre `/auditoria` y ve, de la más reciente a la más antigua, quién hizo qué y cuándo (inicio de sesión, cambio de contraseña, alta de miembro, subida, descarga, eliminación, restauración, purga, activación y renovación de plan); puede filtrar por tipo y cargar más.
- **Alternativos:** un colaborador → `403 FORBIDDEN_ROLE`. No se registran intentos fallidos en este corte.

#### UC-20 a UC-23 · ⛔ Fuera del corte
| Caso de uso | Resumen | Referencia |
|---|---|---|
| UC-20 Compartir con enlace temporal | Enlace de solo lectura a una versión fija, con vencimiento obligatorio, contraseña opcional y revocación inmediata. | RF-010, RF-011 · SPEC-209 |
| UC-21 Administrar la plataforma | Super Admin gestiona organizaciones, planes e instalaciones, con actividad global auditada. | RF-016 · SPEC-501/502 |
| UC-22 Espacios de equipo | Carpetas compartidas por equipo y permisos por usuario o equipo (nivel más alto prevalece). | RF-006 |
| UC-23 Modelo de despliegue | Elegir nube, servidores propios o híbrido y solicitar una instalación. | RF-014, RF-015 |

---

## 8. Matriz de trazabilidad

| Requisito | Casos de uso | Spec(s) | Endpoint(s) / pantalla | Prueba |
|---|---|---|---|---|
| RF-001 | UC-01, 02, 03 | — (implementado) | `POST /auth/register`, `/login`, `/verify-email` | `iam.registration.spec`, `iam.services.spec`, `iam.security.spec` |
| RF-002 | UC-03, 04 | — | `/auth/refresh`, `/logout`, `/me` | `iam.session.spec`, `iam.security.spec` |
| RF-003 | UC-06 | 101, 102, 104, 106 | `/organizations/members` · `/configuracion` | pendiente |
| RF-004/005 | UC-14, 15 | ADR-006 | `/files/upload`, `/files/:id/download` | **sin prueba dedicada del cifrado** |
| RF-007 | UC-12, 13 | 001, 201 | `/folders`, `/archivos` | `files.service.spec` (2 pruebas) |
| RF-008 | UC-14, 18 | 206, 207 (P2) | `/files/:id/versions` | pendiente |
| RF-009 | UC-16, 17 | 202–205 (P2) | `/files/trash`, `/restore`, `/purge` · `/papelera` | pendiente |
| RF-012 | UC-19 | 401, 402, 403, 405 | `/audit/events` · `/auditoria` | pendiente |
| RF-013 | UC-07–11 | 301, 302, 303 | `/plans`, `/subscriptions/*`, `/billing/operations`, `/dashboard` | `billing.service.spec`, `billing.controller.spec`, `subscription.coordinator.spec`, `dashboard.service.spec` |
| Curso §4.1 recuperación | UC-05 | 103, 105 | `/auth/forgot-password`, `/reset-password` | pendiente |

> **Honestidad sobre las pruebas:** hoy hay 79 pruebas unitarias en 12 suites (todas pasan); el cifrado, la papelera, la auditoría y el aislamiento entre organizaciones **no tienen aún pruebas de integración**. El documento de trazabilidad completo es SPEC-705 (100%).

---

## 9. Supuestos, restricciones y riesgos

**Supuestos.** Acceso desde un navegador web; facturación simulada; un único destino de almacenamiento (SeaweedFS); el equipo trabaja con ramas y revisión de pull requests.

**Restricciones.** Tiempo académico limitado; equipo de cuatro personas con ~7 horas cada una hasta el viernes 30; alcance definido por el corte.

**Riesgos abiertos.**
1. **Sin verificación de punta a punta**: el recorrido registro → verificación → login → subir → descargar no se ha ejecutado contra PostgreSQL y SeaweedFS reales.
2. **Aislamiento entre organizaciones sin probar** con dos organizaciones reales.
3. **Sin rotación de llaves**: cambiar `FILES_MASTER_KEY` deja ilegibles los archivos existentes (ADR-006).
4. **Cuota y papelera**: sin purga automática, los archivos eliminados hace más de 30 días dejan de contar para la cuota pero siguen almacenados.
5. **Sin límite de intentos ni cabeceras de seguridad** (HSTS/CSP) en la API.
6. **Carpetas duplicadas:** la unicidad de nombres por carpeta padre que exige ADR-003 no está implementada.

---

## 10. Puntos para revisar antes de exportar a PDF

- Confirmar el alcance final (qué P2 entró) y actualizar los estados 🟡/⛔ al cierre.
- Confirmar que el estado «✅ implementado» corresponde a lo que se ve funcionando en la demo.
- Sustituir la sección 8 por la matriz definitiva de SPEC-705 cuando exista.
- Añadir capturas de pantalla al manual de usuario (SPEC-704), no a este documento.
