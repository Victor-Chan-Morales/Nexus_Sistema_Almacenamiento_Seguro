# Plan individual de Sebastián para IAM

**Responsabilidad:** identidad, registro, login, sesión y contexto de organización en el módulo IAM del monolito NestJS.

## Resultado esperado

Una cuenta puede registrarse, iniciar sesión y consultar su perfil autenticado. La organización se deriva de la identidad/membresía del backend; ningún `organizationId` enviado por el navegador autoriza una operación.

## Pasos de trabajo

### 1. Confirmar el modelo y el contrato

- Leer `PLAN_INTEGRACION_50_PORCIENTO.md`, `CONTRACTS.md`, `BUSINESS_RULES.md`, `ENTS_REGISTRY.md`, `ARCHITECTURE.md` y `docs/decisions/ADR-002-reglas-aprobadas-modelo.md`.
- Inspeccionar `apps/api/src/modules/iam` y confirmar que el contrato expone `POST /auth/register`, `POST /auth/login` y `GET /auth/me` bajo prefijo `/api`.
- Acordar con Víctor la forma de la respuesta y el uso del access token en memoria; no cambiar nombres o rutas sin editar el contrato y avisar a consumidores.

**Entrega verificable:** ejemplos JSON de éxito y error confirmados por el consumidor frontend.

### 2. Hacer registro consistente

- Validar `fullName`, correo, contraseña y `organizationName` en DTO.
- Normalizar correo para comparación sin distinguir mayúsculas/minúsculas; responder conflicto para duplicados.
- Guardar contraseña únicamente como hash Argon2id.
- Crear usuario, organización y membresía inicial dentro de una transacción. No dejar cuentas u organizaciones parciales si falla el proceso.
- Coordinar con Anthony la creación atómica de la suscripción demo y su cuota durante el registro, conforme ADR-002. La activación posterior de otro plan no debe dejar dos suscripciones activas.
- Implementar envío de verificación con `EmailService` conectado a Mailpit/Mailtrap en desarrollo; guardar solo hash del token, con vencimiento de 15 minutos y un solo uso. Acordar y documentar `POST /auth/verify-email` en `CONTRACTS.md` antes de exponerlo.
- Aplicar el rol inicial acordado y devolver únicamente `{ userId, organizationId, role, verificationRequired }`.
- Coordinar con Miguel la provisión del Drive personal `Mi espacio` y carpeta raíz `Archivos` indicada por ADR-003. Incluirla en la operación transaccional de registro o documentar y aprobar la estrategia para evitar aprovisionamiento parcial.
- Mantener esa provisión en metadatos de PostgreSQL. El registro de IAM no debe conectarse al gateway S3 ni necesitar credenciales de SeaweedFS; coordinar con Miguel qué ocurre si SeaweedFS está indisponible durante el alta.

**Entrega verificable:** registro válido persiste entidades relacionadas; correo duplicado y datos inválidos no crean registros parciales.

### Consideraciones por la migración de MinIO a SeaweedFS

- El cambio de proveedor no modifica autenticación, JWT, refresh, roles ni el origen del `organizationId`; preservar el contrato de IAM y el contexto tenant.
- Confirmar que el aprovisionamiento inicial de Drive/carpeta crea solo metadatos y no almacena bytes ni claves específicas del proveedor.
- Verificar junto con Miguel que el `organizationId` emitido por IAM coincide con el prefijo de objeto generado por Files, sin que IAM construya ni reciba dicho object key.
- No agregar variables, SDK, credenciales o llamadas a SeaweedFS en IAM. Mantener comunicación entre módulos dentro del monolito y limitarla al contrato acordado.
- Revisar registro, login y acceso a Files con SeaweedFS disponible y no disponible: una falla de Storage no debe otorgar acceso cruzado ni alterar la autenticación; acordar el comportamiento de alta si la provisión de metadatos falla.
- Eliminar de la documentación propia de IAM referencias a MinIO si las hubiera; documentar solo el contrato de Files/Storage y el contexto tenant.

**Entrega verificable:** IAM sigue autenticando y asignando tenant de la misma forma; Files administra el proveedor de objetos independientemente.

### 3. Completar inicio de sesión y sesión

- Validar credenciales con respuesta segura uniforme para correo inexistente o contraseña incorrecta.
- Emitir access token con expiración corta de 15 minutos y claims consistentes con `JwtStrategy`/`CurrentUser`.
- Implementar el refresh token de 7 días como cookie `HttpOnly` y persistir solo su hash, de acuerdo con ADR-003; acordar las rutas refresh/logout en `CONTRACTS.md` antes de exponerlas.
- Definir si el login exige correo verificado y aplicar el mismo comportamiento en API y pantalla; registrar la decisión en el contrato.
- No escribir credenciales, access token ni refresh token en logs.
- Revisar estado de usuario, organización y membresía al autenticar y al resolver contexto de requests según las reglas vigentes.

**Entrega verificable:** login correcto devuelve el esquema del contrato; credenciales inválidas y sesión vencida se rechazan sin filtrar información.

### 4. Proteger perfil y contexto tenant

- Mantener `GET /auth/me` protegido y con respuesta `{ user, organization, role }`.
- Asegurar que las rutas protegidas obtienen `userId`, `organizationId` y rol desde JWT/membresía ya validados.
- Confirmar que Files y Billing reciben el contexto de organización desde la API y no desde parámetros del cliente.
- Para el corte, implementar solo el rol inicial necesario; dejar RBAC completo como pendiente explícito, sin presentarlo como terminado.

**Entrega verificable:** request sin JWT es 401; request con tenant manipulado no cambia la organización derivada en backend.

### 5. Entregar e integrar

- Probar registro, correo duplicado, login válido/inválido, token expirado, `/auth/me` sin sesión y contexto de tenant.
- Abrir PR limitado a IAM/DTO/estrategia y cambios coordinados de contrato; documentar pasos y resultado.
- Revisar con Víctor el flujo desde los formularios existentes.

## Archivos principales

- `apps/api/src/modules/iam/iam.controller.ts`
- `apps/api/src/modules/iam/iam.service.ts`
- `apps/api/src/modules/iam/dto/`
- `apps/api/src/modules/iam/strategies/jwt.strategy.ts`
- Entidades IAM y su configuración de persistencia
- `CONTRACTS.md`, `SESSION_LOG.md`

## Dependencias

- Víctor integra login, sesión en memoria, cookie y protección de rutas.
- Billing y Files consumen organización/usuario autenticados; no duplican identidad.
- Configurar el proveedor de desarrollo definido en ADR-003 mediante variables de entorno; nunca marcar una verificación como exitosa si solo se mostró una pantalla simulada.

## Cierre de Sebastián

- [ ] Contraseñas no reversibles; no hay secretos en logs.
- [ ] Registro crea de forma consistente usuario, organización y membresía.
- [ ] JWT y `GET /auth/me` coinciden con el contrato y funcionan con guardas NestJS.
- [ ] El tenant proviene del backend y se conserva en cada operación protegida.
- [ ] Los casos de aceptación quedan documentados en el PR.
- [ ] IAM no contiene dependencia directa de MinIO ni SeaweedFS, ni credenciales del proveedor.
- [ ] La provisión de Drive/carpeta inicial permanece en PostgreSQL y respeta el aislamiento por organización.
- [ ] Se verificó que el contexto tenant de IAM funciona en el flujo de Files integrado con SeaweedFS.
