# Plan general de integración para el hito del 50%

**Fecha objetivo:** 9 de octubre de 2026  
**Arquitectura:** monolito modular NestJS en `apps/api`, frontend Next.js en `apps/web`, PostgreSQL y SeaweedFS gestionados con Docker Compose.

## Propósito y alcance

El objetivo de este corte es demostrar un flujo vertical integrado y repetible: registro con verificación de correo, suscripción demo provisionada, inicio de sesión y renovación de sesión, consulta del Dashboard, creación de carpeta, carga, listado y descarga de un archivo, con cuota aplicada en el backend y aislamiento entre organizaciones. El cambio posterior de plan sigue siendo simulado.

Este documento define un alcance técnico verificable a partir de `BUSINESS_RULES.md`, `CONTRACTS.md` y los ADR vigentes. No sustituye la rúbrica del curso: el repositorio no contiene una rúbrica que permita certificar que estas tareas equivalen exactamente al 50% académico.

El backend se ejecuta como un solo proceso NestJS. IAM, Billing, Files, Storage y Health se comunican mediante inyección de dependencias dentro del proceso; no se crean servicios Nest independientes ni llamadas HTTP entre módulos. Next.js consume la API REST. PostgreSQL guarda identidad, suscripciones y metadatos; SeaweedFS guarda los bytes.

## Resultado que debe poder demostrarse

Una persona del equipo debe poder iniciar el entorno desde las instrucciones del repositorio y completar esta secuencia con datos de prueba:

1. Crear una cuenta y una organización, recibir el mensaje de verificación en el servicio de correo de desarrollo, verificar el correo, iniciar sesión y consultar `/auth/me`.
2. Consultar el catálogo y confirmar la suscripción demo creada durante el registro; si se selecciona otro plan, aplicar el cambio simulado sin crear una segunda suscripción activa.
3. Ver organización, plan y uso/límite de almacenamiento calculados desde datos persistidos.
4. Crear y listar una carpeta; subir un archivo permitido de hasta 100 MB; ver sus metadatos y descargar los mismos bytes.
5. Comprobar que otra organización no puede listar ni descargar el archivo.
6. Comprobar que una carga que excede el tamaño máximo o la cuota se rechaza en la API, aunque el botón del frontend se manipule.
7. Reiniciar la aplicación y confirmar que los datos y el objeto siguen disponibles.

La UI puede tener estados de carga, vacío y error. Una pantalla de maqueta no cuenta como resultado real: debe distinguirse de las respuestas conectadas a API.

## Contratos del recorrido

`CONTRACTS.md` es la referencia para nombres de rutas, entradas, salidas y errores. Los responsables deben mantener alineados contrato, backend y cliente web. No se debe introducir una ruta alternativa sin actualizar el contrato y acordarla con los consumidores.

| Dominio | Contrato que se integrará | Responsable principal |
|---|---|---|
| IAM | `POST /api/auth/register`, `POST /api/auth/login`, `GET /api/auth/me` | Sebastián |
| Billing | `GET /api/plans`, `POST /api/subscriptions/activate` | Anthony |
| Dashboard | `GET /api/dashboard`: organización, plan, bytes usados y límite en bytes | Víctor integra; Billing y Files exponen datos a través de servicios internos |
| Files | `GET /api/folders`, `POST /api/folders`, `GET /api/folders/:id/items`, `POST /api/files/upload`, `GET /api/files/:id/download` | Miguel |
| Salud | `GET /api/health` | Integración |

El contrato v0.2 no enumera todavía las rutas de verificación y renovación de sesión. Sebastián y Víctor deben acordarlas y agregarlas a `CONTRACTS.md` antes de implementarlas. El comportamiento aprobado es token de verificación de un solo uso con vencimiento de 15 minutos y refresh token de 7 días en cookie `HttpOnly`, persistido solo como hash.

ADR-002 exige crear de forma atómica usuario, organización, membresía, suscripción demo y cuota. El flujo resuelve esto provisionando el plan demo durante el registro; `POST /subscriptions/activate` se usa para el cambio/activación posterior y debe actualizar la suscripción vigente sin dejar dos activas. Sebastián y Anthony documentan esta semántica antes de integrar.

El controlador actual de Files usa algunas rutas diferentes y todavía no expone la carga. Miguel debe alinear la API con el contrato aprobado antes de conectar las pantallas. El contrato de descarga indica contenido binario con `Content-Disposition`; se debe devolver un stream protegido a través de la API, compatible con el cliente web, y no una cadena JSON con una URL. La respuesta del Dashboard puede usar `recentActivity: []` en este corte si aún no existe un módulo de auditoría; debe etiquetarse como vacío y no inventarse actividad.

La cuota se calcula en bytes en servidor. Files consulta directamente a Billing dentro del monolito para obtener el límite; el Dashboard agrega límite y uso del módulo Files. No se debe crear una llamada HTTP de Billing a Files ni confiar en uso, límite u `organizationId` enviados por el navegador.

## Distribución de trabajo

| Integrante | Dueño de | Entrega de integración |
|---|---|---|
| Víctor | Cliente web común, sesión en frontend, integración del Dashboard y entorno/documentación de ejecución | Flujo web conectado y guía de demo reproducible |
| Sebastián | IAM, registro, login, sesión y contexto de organización | Rutas IAM y pruebas de autenticación/tenant |
| Miguel | Files y Storage, carga, listados, carpetas y descarga | Flujo binario SeaweedFS ↔ API ↔ web con metadatos en PostgreSQL |
| Anthony | Catálogo, suscripción demo y límite de plan | Planes persistidos, activación simulada y datos de cuota para Files/Dashboard |

Cada dueño implementa su módulo y entrega un PR revisable. Los cambios a `CONTRACTS.md`, DTO compartidos, configuración global o componentes compartidos se acuerdan antes con las personas afectadas. Los módulos no deben duplicar reglas ni acceder a tablas de otro dominio directamente si pueden consumir el servicio exportado del módulo propietario.

## Secuencia y fechas

### 7 de octubre — Contrato y entorno

- Los cuatro responsables revisan este plan y el contrato de rutas.
- Se resuelven por escrito las diferencias de rutas de Files, descarga y agregación del Dashboard.
- Víctor confirma que PostgreSQL, SeaweedFS, API y Web pueden arrancar desde el repositorio; registra bloqueos reproducibles.
- Cada dueño identifica archivos que modificará y abre su rama/PR de trabajo.

### 8 de octubre — Implementación e integración

- Sebastián entrega IAM y contexto autenticado.
- Anthony entrega catálogo y suscripción demo persistida.
- Miguel entrega carpetas, carga, listado y descarga protegida.
- Víctor integra sesión web, Dashboard y pantallas contra los clientes API tipados.
- Los PR se revisan en orden de dependencias: IAM → Billing → Files/Storage → Dashboard y frontend.

### 9 de octubre — Aceptación y entrega

- Se congela la candidata integrada antes de preparar la demostración.
- Una persona distinta de quien documentó el arranque sigue el README desde un entorno limpio.
- Se ejecuta la secuencia de aceptación definida arriba y se registra el resultado real, incluidos errores y pendientes.
- README, `CONTRACTS.md`, `SESSION_LOG.md` y `docs/FIGMA_MAP.md` reflejan lo implementado; no se marca como terminado algo que aún usa datos de maqueta.

## Criterios de aceptación del hito

- [ ] API, web, PostgreSQL y SeaweedFS arrancan con los comandos documentados y el API responde en `/api/health`.
- [ ] Registro crea usuario, organización y membresía; la contraseña se persiste como hash Argon2id.
- [ ] Registro provisiona atómicamente organización, membresía, suscripción demo y Drive/carpeta iniciales según ADR-002/003, o se documenta y aprueba una decisión nueva antes de cambiar el alcance.
- [ ] Login devuelve la sesión acordada; `/auth/me` requiere autenticación.
- [ ] Verificación de correo usa EmailService y token de un solo uso; el refresh token usa cookie `HttpOnly` y su hash se persiste.
- [ ] Rutas privadas de la web requieren sesión; el token de acceso se mantiene en memoria y no se persiste en `localStorage`.
- [ ] El catálogo proviene de Billing; la activación es simulada y no solicita ni procesa tarjetas.
- [ ] Dashboard muestra plan y cuota desde API, con bytes como unidad de contrato.
- [ ] Crear/listar carpeta, cargar/listar/descargar un archivo funciona con PostgreSQL y SeaweedFS reales.
- [ ] Files obtiene la organización desde el usuario autenticado, comprueba cuota y permisos en servidor y responde con errores seguros.
- [ ] Una segunda organización no puede leer el recurso de la primera.
- [ ] Se entrega evidencia de los casos de aceptación: comandos, resultado y limitaciones conocidas.

## Fuera de este corte

No se presentan como terminados MFA/TOTP, RBAC completo para todos los roles, recuperación de contraseña, auditoría completa, enlaces compartidos, papelera/restauración, cifrado de archivos con libsodium, selección de destinos cloud/on-premises/híbridos, cobro real ni instalación automática en infraestructura de clientes. Se mantienen como requisitos del producto o trabajo posterior; no se eliminan del alcance final.

## Dependencias y bloqueos conocidos

- Actualmente la API IAM ya expone `/auth/register`, `/auth/login` y `/auth/me`.
- Billing expone catálogo, activación simulada y consulta de suscripción; Files debe consumir `BillingService` directamente para cuota.
- ADR-003 establece Drive personal `Mi espacio` y carpeta raíz `Archivos`; Sebastián y Miguel deben incluir su aprovisionamiento en el registro. Si hay un bloqueo, debe documentarse y aprobarse como desviación antes de cerrar el hito.
- El controlador Files aún no expone carga y sus rutas deben alinearse con `CONTRACTS.md`.
- El Dashboard y la respuesta de uso requieren agregación backend; la cifra visible no se debe calcular con muestras ni estado local.
- Si algún contrato no puede implementarse a tiempo, el dueño registra la decisión, impacto y alternativa en `SESSION_LOG.md`; Víctor ajusta la demo para no afirmar que existe una operación real.
