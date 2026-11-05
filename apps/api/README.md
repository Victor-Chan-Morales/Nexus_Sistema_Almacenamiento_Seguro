# API NestJS (Monolito Modular)

La API de Nexus está desarrollada en **NestJS + TypeScript** bajo el patrón de **Monolito Modular**. Todos los dominios del sistema coexisten en un único proceso backend con comunicación interna in-process (inyección de dependencias), evitando la sobrecarga de latencia y red entre servicios.

## Estructura de módulos (`src/modules/`)

| Módulo | Responsable | Descripción | Exportaciones principales |
|---|---|---|---|
| `iam/` | Sebastián | Autenticación, registro, login con Argon2id + JWT, entidades de usuario, organización y membresía. | `AuthService`, `JwtModule`, `PassportModule`, `RegistrationHooks`, `MemberAdmission` |
| `billing/` | Anthony | Catálogo de planes, suscripciones (simuladas) y cálculo de límites de almacenamiento por organización. | `BillingService` |
| `files/` | Miguel | Gestión de carpetas jerárquicas, metadatos de archivos, control de versiones y verificación de cuota. | `FilesService` |
| `storage/` | Miguel | Cliente de almacenamiento compatible con SeaweedFS (S3). SPEC-801 agrega el patrón Strategy. | `StorageService` |
| `audit/` | Anthony | Eventos con cadena de hashes, su outbox y `GET /audit/events`. | `AuditService` |
| `integration/` | Anthony | Activación y renovación de suscripciones, que coordinan Billing y Files. | — |
| `dashboard/` | Víctor | Resumen de organización, plan y uso. | — |
| `health/` | Víctor | Endpoint de liveness y verificación de PostgreSQL con `@nestjs/terminus`. | `HealthModule` |

## Comunicación interna entre módulos

En lugar de llamadas HTTP entre servicios, la comunicación se realiza mediante **inyección de dependencias** de NestJS:
- `FilesModule` importa directamente `BillingModule` e inyecta `BillingService` para consultar cuotas (`this.billingService.getStorageLimitBytes(orgId)`).
- `FilesModule` importa directamente `StorageModule` e inyecta `StorageService` para persistir binarios (`this.storageService.put(...)`).
- Los endpoints protegidos obtienen la identidad del usuario y su organización mediante el decorador `@CurrentUser()` o `req.user`.

## Ejecución

### Desarrollo local (hot-reload)
```bash
npm run dev
# o desde la raíz del monorepo:
npm run dev:api
```
La API estará disponible en `http://localhost:3001/api`.

### Compilación y producción
```bash
npm run build
npm run start
```
