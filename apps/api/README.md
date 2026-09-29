# API NestJS (estructura por inicializar)

El repositorio reserva este espacio para una API NestJS + TypeScript con módulos de dominio. Antes de generar la aplicación, el equipo debe aceptar `CONTRACTS.md`, definir versión común de NestJS/Node y acordar qué servicios corren en el Compose inicial.

Carpetas previstas:

```text
src/
  modules/iam/
  modules/billing/
  modules/files/
  modules/storage/
  modules/health/
  shared/          # filtros de error, contexto de request y utilidades realmente comunes
```

Los responsables de IAM, Billing y Files implementan dentro de sus módulos asignados. No generen la aplicación completa sobre `main` sin revisar el paquete/workspace existente y coordinar la migración inicial.
