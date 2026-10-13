# Cambios en archivos compartidos (coordinar antes de editar)

## `apps/api/src/main.ts`
```ts
import { ValidationPipe } from '@nestjs/common';
import { ApiExceptionFilter } from './common/filters/api-exception.filter';

app.setGlobalPrefix('api');
app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
app.useGlobalFilters(new ApiExceptionFilter());          // error común { code, message, requestId }
app.enableCors({ origin: process.env.WEB_ORIGIN, credentials: true });
```
`src/common/filters/api-exception.filter.ts` es transversal (afecta Billing y Files): si ya existe un filtro
global, ajustarlo al formato del contrato en lugar de duplicarlo, y registrar el dueño en `ENTS_REGISTRY.md`.

## `AppModule`
`TypeOrmModule.forRoot*` con `autoLoadEntities: true`; `ConfigModule.forRoot({ isGlobal: true })`; importar `IamModule`.

## Enganche de Billing y Files a la transacción de registro (ADR-002 / ADR-003)
Billing y Files ya importan `IamModule` por el guard, así que no hay dependencia circular.
Cada dueño implementa su hook y usa **siempre** el `manager` recibido.
```ts
// BillingService (Anthony) — suscripción demo + cuota atómicas; no debe quedar más de una suscripción activa
onModuleInit() {
  this.hooks.register('demo-subscription', ({ manager, organizationId }) =>
    this.createDemoSubscription(manager, organizationId));
}
// FilesService (Miguel) — Drive "Mi espacio" + carpeta raíz "Archivos"
onModuleInit() {
  this.hooks.register('personal-drive', ({ manager, userId, organizationId }) =>
    this.provisionPersonalDrive(manager, userId, organizationId));
}
```
Si un hook lanza error, se revierte todo el registro. Mientras no registren sus hooks, el registro funciona
pero no crea suscripción ni Drive: no declarar esos puntos del plan como cerrados hasta integrarlos.

## Migración
`docs/proposals/iam-migration-proposal.sql` → enviar al integrador; un solo PR cambia la migración compartida.
