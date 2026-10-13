# PR — `feature/sebastian/iam-register` → `main`

**Título:** feat(iam): registro, login, sesión y /auth/me en el monolito

## Propósito
Implementar el módulo IAM del plan individual: una cuenta se registra, verifica su correo, inicia sesión y consulta su
perfil. El tenant se deriva siempre de JWT + membresía activa en backend.

## Contrato afectado
- Consume sin cambios: `POST /auth/register`, `POST /auth/login`, `GET /auth/me` (CONTRACTS.md v0.2).
- **Propone** (bloqueadas por contrato hasta aprobación de Víctor): `POST /auth/verify-email`, `POST /auth/refresh`, `POST /auth/logout`. Ver `docs/proposals/iam-contracts-patch.md`.
- Decisión a registrar: el login exige correo verificado.

## Archivos tocados
- `apps/api/src/modules/iam/**` (controller, service, repository, DTO, entidades, estrategia JWT, guard, decorador, servicios, hooks, errores)
- `apps/api/src/common/filters/api-exception.filter.ts` ← **compartido**, requiere visto bueno (afecta a todos los módulos)
- `apps/api/test/iam.e2e-spec.ts`, `docs/modules/IAM.md`
- Propuestas (no ejecutables): migración, variables de entorno, cambios en `main.ts`, contrato.

## Cómo probar
1. `docker compose up -d` (PostgreSQL + Mailpit) y aplicar la migración aprobada por el integrador.
2. Copiar las variables de `docs/proposals/iam-env-additions.md` a `.env` local.
3. `npm run dev:api`; abrir Mailpit (http://localhost:8025) para ver el correo de verificación.
4. `npm run test:e2e -w apps/api -- iam` (pega la salida en este PR).
5. Manual: registro → correo → `verify-email` → login → `GET /api/auth/me` con Bearer; repetir `/me` agregando `x-organization-id` y `?organizationId=` falsos: la organización devuelta no cambia.

## Captura
No cambia interfaz. Los estados de las pantallas de acceso se cotejan con Figma (`docs/FIGMA_MAP.md`) al integrar con Víctor.

## Limitaciones
- Solo rol inicial `owner`; RBAC completo pendiente.
- Billing (suscripción demo + cuota) y Files (Drive personal) se enganchan con `RegistrationHooks`; hasta que Anthony y Miguel registren sus hooks, el registro no los crea.
- Sin recuperación de contraseña, reenvío de verificación ni rate limiting.
- Probado por el autor: **pendiente de pegar resultados** (este borrador no fue compilado ni ejecutado).

## Commits sugeridos
`feat(iam): agregar entidades y repositorio` · `feat(iam): registro transaccional con verificación de correo` · `feat(iam): login y sesión con refresh en cookie HttpOnly` · `feat(iam): proteger /auth/me y contexto de tenant` · `docs(iam): contrato, módulo y pruebas`

---

## Borrador de entrada para `SESSION_LOG.md`
- 2026-10-08 · Sebastián · IAM: implementado register/login/me conforme a CONTRACTS v0.2; propuestas verify-email/refresh/logout pendientes de aprobación; filtro global de error común propuesto (archivo compartido); migración y variables enviadas como propuesta al integrador. Pendiente: hooks de Billing/Files, RBAC completo.
