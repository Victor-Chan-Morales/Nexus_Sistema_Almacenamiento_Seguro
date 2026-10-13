# Plan individual de Víctor para integración y frontend

**Responsabilidad:** integrar la web Next.js con el monolito modular, conservar una experiencia común y preparar una demostración reproducible del hito del 50%.

## Resultado esperado

Desde la web se puede registrar e iniciar sesión, consultar el plan y la cuota reales del backend, crear una carpeta, subir/listar/descargar un archivo y ver errores de autenticación o cuota. La interfaz no presenta datos de maqueta como datos reales.

## Pasos de trabajo

### 1. Confirmar entorno y contratos

- Leer `PLAN_INTEGRACION_50_PORCIENTO.md`, `CONTRACTS.md`, `ARCHITECTURE.md`, `BUSINESS_RULES.md` y `CONTRIBUTING.md`.
- Confirmar que `NEXT_PUBLIC_API_BASE_URL` apunta a `http://localhost:3001/api` en desarrollo y que el cliente compartido de `apps/web/src/lib/api` agrega Bearer token y credenciales de cookie según el contrato.
- Coordinar con Sebastián la forma de sesión y con Anthony/Miguel la respuesta de Dashboard/cuota y Files.
- No conservar ni enviar el token de acceso desde `localStorage`; mantenerlo en memoria. Las cookies de refresh deben ser `HttpOnly` y gestionadas por API.
- Acordar con Sebastián las rutas nuevas de verificación/refresh y actualizar `CONTRACTS.md` antes de conectar esas pantallas.

**Entrega verificable:** lista breve de contratos confirmados y bloqueos en `SESSION_LOG.md`.

### 2. Conectar autenticación y rutas privadas

- Conectar las pantallas existentes de registro y login a `register()` y `login()` en `apps/web/src/lib/api/iam.ts`.
- Conectar `/verificar-correo` al flujo de un solo uso de EmailService definido por Sebastián; mostrar el estado real que devuelve API.
- Centralizar el usuario y el access token en estado de sesión en memoria. Implementar logout y limpiar el estado ante 401.
- Proteger dashboard, archivos, perfil y suscripción con un límite de autenticación; redirigir a `/login` si no hay sesión válida.
- No basar autorización en componentes ocultos: API siempre valida sesión y tenant.

**Entrega verificable:** un visitante no autenticado no puede usar las rutas privadas; una sesión válida llega a `/auth/me`.

### 3. Integrar Dashboard real

- Implementar `GET /api/dashboard` en un `DashboardModule` del mismo NestJS (o en el módulo de integración acordado), reuniendo nombre de organización, plan, `storageUsedBytes` y `storageLimitBytes` mediante servicios exportados por Billing y Files. No consultar esos datos por HTTP interno ni acceder directamente a sus tablas.
- El endpoint requiere JWT y obtiene el tenant del usuario autenticado.
- Actualizar `apps/web/src/lib/api/dashboard.ts` y sus tipos para reflejar la respuesta acordada. Mostrar `recentActivity` vacío si aún no hay fuente real.
- Mostrar carga, error, estado vacío y valores en bytes formateados solo para presentación.

**Entrega verificable:** recargar Dashboard consulta API y refleja una carga real después de subir un archivo.

### 4. Conectar Files y Billing

- Utilizar `apps/web/src/lib/api/files.ts` y `billing.ts`; no duplicar `fetch` con rutas propias en las páginas.
- Alinear la lista y creación de carpetas con `GET/POST /folders`; listar elementos con `GET /folders/:id/items`.
- Conectar carga multipart con `POST /files/upload`, lista y descarga como contenido binario con nombre seguro.
- Conectar catálogo y activación demo con `GET /plans` y `POST /subscriptions/activate`.
- Actualizar el widget de cuota y el estado del botón de carga a partir de la respuesta del Dashboard. La deshabilitación visual no reemplaza la validación de API.

**Entrega verificable:** pantallas conectadas a datos persistidos y sin estados de demo engañosos.

### 4.1 Consideraciones por la migración de MinIO a SeaweedFS

- Mantener el navegador conectado exclusivamente a la API Nexus; no llamar al gateway S3 de SeaweedFS desde `apps/web` ni exponer credenciales, bucket, endpoint interno u object keys.
- Confirmar con Miguel que las rutas, el contrato multipart y la respuesta de descarga se mantienen aunque cambie el proveedor detrás de `StorageService`.
- Verificar carga, listado y descarga desde la UI contra el entorno integrado con SeaweedFS; comparar el archivo descargado con el original.
- Mostrar estados comprensibles para error temporal de Storage, tamaño/tipo rechazado y cuota excedida, sin exponer errores internos del proveedor.
- Revisar que README y guías locales ya no instruyan a levantar MinIO, e incluir los pasos de arranque de SeaweedFS que Miguel haya verificado.

**Entrega verificable:** el usuario completa la misma operación desde el frontend y el cliente no conoce cuál proveedor de objetos la atiende.

### 5. Integrar, registrar evidencia y preparar demo

- Integrar PRs revisados en orden IAM → Billing → Files/Storage → Dashboard/web.
- Verificar manualmente los escenarios: login, sesión ausente, activación demo, carga correcta, cuota/tamaño excedido y recurso de otra organización.
- Actualizar README con pasos de instalación/arranque y la secuencia de demo; actualizar `docs/FIGMA_MAP.md` para las pantallas cotejadas.
- Registrar en `SESSION_LOG.md` qué se probó, resultado real y pendientes.

## Archivos principales

- `apps/web/src/lib/api/*`
- `apps/web/src/app/layout.tsx` y layout privado existente
- `apps/web/src/app/dashboard/page.tsx`
- `apps/web/src/app/archivos/page.tsx` y componentes de archivos
- `apps/api/src/app.module.ts` y módulo/controlador de Dashboard, si se implementa como integración
- `README.md`, `CONTRACTS.md`, `SESSION_LOG.md`, `docs/FIGMA_MAP.md`

## Dependencias

- Sebastián confirma login, `/auth/me`, sesión y expiración.
- Anthony expone catálogo, activación y el límite del plan a los servicios internos.
- Miguel alinea rutas de Files y entrega carga/descarga reales.
- Contratos compartidos se aprueban antes de cambiar tipos o pantallas.

## Cierre de Víctor

- [ ] Ninguna pantalla afirma que una operación de maqueta fue guardada en la API.
- [ ] El access token no queda persistido en `localStorage`.
- [ ] Dashboard usa respuesta real protegida y muestra cuota en bytes convertidos a unidades legibles.
- [ ] El frontend maneja 401, 403/cuota y errores de red con estados claros.
- [ ] Entorno y demo se pueden repetir siguiendo README.
- [ ] La UI opera con SeaweedFS solo a través de la API y no contiene configuración/credenciales del proveedor.
- [ ] Carga y descarga se verificaron contra SeaweedFS con contenido íntegro y estados de error claros.
- [ ] Las instrucciones de desarrollo describen SeaweedFS y reflejan un arranque realmente comprobado.

## Tarea de integración backend para Dashboard

- Agregar el módulo/controlador al `AppModule` y proteger la ruta con la estrategia JWT.
- Pedir a Anthony un resumen del plan vigente y a Miguel el uso confirmado en bytes mediante métodos públicos de sus servicios.
- Derivar organización del usuario autenticado. Si aún no hay fuente de actividad, responder `recentActivity: []`.
- Actualizar `CONTRACTS.md` y tipos web si la integración requiere precisar campos; obtener aprobación de los dueños de Billing y Files antes del cambio.
