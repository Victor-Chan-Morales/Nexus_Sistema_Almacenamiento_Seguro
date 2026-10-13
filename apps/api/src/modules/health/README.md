# Módulo Health

**Dueño:** Víctor (Integración).

## Responsabilidades
- Diagnóstico de salud de la aplicación backend y dependencias principales.
- Expone `GET /api/health` usando `@nestjs/terminus`.
- Comprueba conectividad directa con PostgreSQL.
- Utilizado por las directivas de healthcheck de Docker Compose para orquestación confiable.
