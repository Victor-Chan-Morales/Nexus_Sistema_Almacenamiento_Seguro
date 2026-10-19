# Devolución para Sebastián — PR #6 IAM

> **Cerrada el 2026-10-18: no hay nada que devolver.** Sebastián corrigió la PR y el integrador terminó
> lo que faltaba (hooks de Billing y Files, catálogo de planes, unificación de `WEB_URL` y renovación del
> token de verificación) al integrarla. El estado real y lo verificado están en la entrada
> «Integración de la PR #6 (IAM) en main» de [`SESSION_LOG.md`](../SESSION_LOG.md).
> Lo que sigue es el registro histórico de la revisión y ya no describe la rama.

**Fecha:** 2026-10-17
**Devolución dirigida a:** Sebastián (responsable de IAM, según el plan del módulo)
**Usuario autor en GitHub:** `Pun-Yei`
**Área:** IAM
**PR:** [PR #6](https://github.com/Victor-Chan-Morales/Nexus_Sistema_Almacenamiento_Seguro/pull/6)
**Instrucción vigente:** corregir la PR #6 directamente contra `CONTRACTS.md` v0.3, aprobado por Víctor como integrador el 2026-10-18. Las rutas de verificación, refresh y logout ya están aprobadas; no hace falta esperar otra aprobación. Preservar la organización activa y terminar los hooks transaccionales con Billing y Files.

Se revisó el diff de la PR y se contrastó con los contratos, planes y decisiones vigentes del repositorio. No se ejecutaron pruebas; los pasos o capturas incluidos por el autor no se consideran verificación independiente del estado actual de la rama.

---

### Correcciones necesarias

1. **Alinear rutas y cookie con el contrato aprobado.** Implementar `POST /auth/verify-email` con `{ token }` y respuesta `{ verified: true }`; `POST /auth/refresh` y `POST /auth/logout` usan la cookie `nexus_refresh`. En la propuesta adjunta a la PR aparece `nexus_rt`; cambiar ese nombre para que web, API y contrato coincidan. Access token: 15 minutos, solo en memoria. Refresh: 7 días, hash en servidor, cookie `HttpOnly`, `SameSite=Lax`, `Path=/api/auth`, `Secure` en producción; rotar en refresh y revocar en logout. No enviar refresh token en JSON ni guardar access token en `localStorage`.

2. **Preservar la organización y completar el principal JWT.** El guard debe validar usuario y membresía activa en cada request y entregar `req.user = { userId, email, organizationId, organizationName, role }`. El nombre debe venir de la organización asociada a esa membresía. Si el usuario pertenece a varias organizaciones, refresh conserva y revalida la organización de la sesión; no selecciona la primera ni acepta el tenant desde body, query o header del navegador.

3. **Conectar los hooks de registro de Billing y Files.** `RegistrationService` invoca `RegistrationHooks`, pero en este diff no aparece el registro efectivo de hooks desde Billing y Files; la documentación del mismo PR reconoce que sin ellos no se crea suscripción/cuota ni Drive. Integrar ambos propietarios en la transacción con el `manager` recibido y comprobar rollback total si cualquiera falla. El resultado requerido es usuario + organización + membresía + Demo/cuota + Drive/carpeta inicial, todo confirmado o revertido conjuntamente.

4. **Unificar entidades de token.** Se agregan tanto `EmailVerificationToken` como `OneTimeToken`; el módulo registra `OneTimeToken` y el servicio de verificación lo usa. Elegir un modelo persistente, eliminar la entidad/tabla paralela que no se usa y asegurar que la migración, el propósito del token, hash, caducidad y uso único coincidan.

5. **Consolidar migraciones con el integrador.** La ubicación canónica aprobada es `database/migrations/` en la raíz; `apps/db/database/migrations/` no es una segunda fuente. Entrega al integrador los cambios de esquema y su secuencia para consolidarlos en un solo PR coordinado, conforme a `CONTRIBUTING.md`. Revisa las tablas reales y confirma que las entidades TypeORM coinciden con nombres, schemas, enums, columnas, FK e índices de la migración.

6. **Coordinar cambios globales con el contrato v0.3.** El PR modifica `AppModule`, `main.ts`, `.env.example`, Docker Compose y filtros globales de errores. Son archivos compartidos y también los toca la integración de Víctor. Conservar prefijo `/api`, `ValidationPipe`, formato común `{ code, message, requestId }`, configuración PostgreSQL para host/Docker y un `JWT_SECRET` solo de desarrollo. CORS usa el origen explícito `WEB_URL`, permite credenciales y expone `Content-Disposition`; evitar variables duplicadas (`WEB_ORIGIN`) con valores distintos.

7. **Alinear el enlace de correo con la web.** `EmailService` debe crear `${APP_URL}/verificar-correo?token=...`, ruta exacta fijada por v0.3. El token vence en 15 minutos y se usa una sola vez. La página lo lee del query param y llama al endpoint aprobado; el enlace no debe abrir `/verify-email` ni una página 404.
8. **Persistir y reintentar el correo de verificación.** En la misma transacción del registro, guardar un mensaje en una outbox persistente. Enviar el correo después del commit y reintentar fallas SMTP temporales desde esa outbox. Una falla temporal de correo no revierte la cuenta ni debe dejarla sin un envío pendiente. No registrar ni devolver el token al navegador; en este corte no se agrega un endpoint manual de reenvío. La respuesta de la interfaz debe indicar que la verificación es necesaria sin afirmar que el proveedor ya entregó el mensaje.

9. **Comprobar catálogo de roles y estado activo.** El alta depende de que exista el rol `tenant_admin` en las tablas iniciales; garantizar que seed/migración corra antes de aceptar registros y que el fallo no deje una cuenta incompleta. `JwtStrategy` debe revalidar estado de usuario, organización y membresía en cada request conforme a `BUSINESS_RULES.md`.

10. **Completar pruebas de integración reproducibles.** El PR incluye pruebas unitarias y e2e, pero la descripción indica que la evidencia del autor sigue pendiente. Ejecutar contra la migración canónica y Mailpit/fake mailer, registrar comandos/resultados y cubrir: usuario duplicado con distinta capitalización, token vencido/reutilizado, refresh rotado/reutilizado, logout, cuenta/membresía suspendida, contexto multi-organización y rollback si falla un hook transaccional. Probar por separado que una falla SMTP temporal conserva el mensaje en la outbox y permite reintentar el envío sin duplicar la cuenta ni la verificación.

11. **Limpiar artefactos.** Retirar `.Rhistory` y revisar las migraciones, seeds y documentación nuevas para que no dupliquen una fuente de esquema existente. Mantener solo archivos fuente y evidencia que se pueda reproducir.

### Contrato aprobado que debe implementar (v0.3)

- `POST /auth/register`, `POST /auth/login`, `GET /auth/me`, `POST /auth/verify-email`, `POST /auth/refresh` y `POST /auth/logout` usan las rutas y esquemas de `CONTRACTS.md` v0.3.
- El login y refresh devuelven el mismo esquema de sesión. `expiresAt` del access token refleja 15 minutos; refresh rota una cookie `nexus_refresh` de 7 días.
- `req.user` incluye `userId`, `email`, `organizationId`, `organizationName` y `role` derivados de la membresía validada. El navegador nunca elige el tenant.
- Password hash Argon2id; correo normalizado y único; refresh persistido solo como hash y entregado solo en cookie HttpOnly.
- El registro crea usuario, organización, membresía, suscripción Demo/cuota y Drive `Mi espacio`/raíz `Archivos` con el mismo `EntityManager`. Si un hook falla, se revierte el alta; los hooks escriben metadatos PostgreSQL y no llaman a SeaweedFS.
- El enlace de correo abre `/verificar-correo?token=...`; el token vence en 15 minutos y es de un solo uso.
- Error común `{ code, message, requestId }`, sin tokens, stack trace ni detalles internos. CORS permite el origen `WEB_URL`, credenciales y expone `Content-Disposition`.

### Falta implementar o demostrar

- Las decisiones de rutas y sesión ya están aprobadas en v0.3; queda implementarlas y registrar los resultados en `SESSION_LOG.md`.
- Sesión renovable que conserva organización activa en cuentas con varias membresías.
- Hooks funcionales de Billing/Files y atomicidad completa del alta.
- Outbox persistente en el registro y reintento seguro de entrega ante fallas SMTP temporales.
- Migración única compatible con entidades, datos de rol y sesiones existentes.
- Resultados de pruebas en CI/local y evidencia de flujo registro → correo → verificación → login → refresh → logout.

**Referencias:** `Planes de trabajo individuales/PLAN_SEBASTIAN_IAM.md`; `CONTRACTS.md` v0.3, `BUSINESS_RULES.md`, `ARCHITECTURE.md`, `CONTRIBUTING.md`, ADR-002/003 y `docs/FIGMA_MAP.md` para textos/estados de interfaz. Las propuestas `docs/proposals/iam-contracts-patch.md`, `iam-migration-proposal.sql` e `iam-shared-changes.md` quedan subordinadas al contrato v0.3: si sus valores difieren, seguir el contrato aprobado.

---
## Criterios para solicitar nueva revisión

- [ ] Verificación, refresh y logout usan las rutas, cookie y respuestas de `CONTRACTS.md` v0.3 (`nexus_refresh`).
- [ ] El refresh preserva y revalida la organización activa, incluso si la cuenta tiene varias membresías.
- [ ] Hooks reales de Billing y Files se ejecutan dentro de la transacción de registro; una falla revierte el alta completa.
- [ ] URL de verificación dirige a `/verificar-correo` o a una redirección acordada.
- [ ] Entidades y migración corresponden a una única estrategia y ubicación canónica; no hay modelos de token duplicados.
- [ ] El mensaje de verificación se persiste junto con el registro; fallas SMTP temporales se reintentan después del commit sin devolver el token ni revertir la cuenta.
- [ ] `req.user` incluye nombre de organización validado; CORS usa `WEB_URL`, credenciales y expone `Content-Disposition`.
- [ ] Hooks de Billing y Files comparten el `EntityManager` del registro y revierten el alta completa si fallan.
- [ ] Se adjuntan resultados de registro/verificación/login/refresh/logout, expiración, multi-organización y rollback.
