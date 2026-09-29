# ADR-001: despliegue por dominios para el corte del 30%

- **Estado:** propuesta pendiente de aprobación del equipo.
- **Fecha:** 2026-09-28.
- **Contexto:** la propuesta final separa microservicios y despliegue híbrido. El primer avance tiene plazo corto y requiere demostrar un recorrido completo en entorno local.
- **Propuesta:** conservar módulos y contratos por dominio; operar solo los procesos que el equipo pueda probar con confiabilidad. Para desarrollo se prevén web, API, PostgreSQL y MinIO con Docker Compose. No exponer decisiones de microservicio como implementadas hasta existir servicios, comunicaciones y pruebas reales.
- **Consecuencias:** menos carga inicial de despliegue, integración más rápida y fronteras que facilitan separar servicios después. Debe quedar documentado qué objetivos finales (Redis Streams, auditoría completa, despliegue on-premises) no forman parte de este corte.
- **Alternativas:** desplegar todos los microservicios ya, si el equipo demuestra que puede configurar observabilidad, seguridad y pruebas interservicio en el plazo acordado.
- **Revisión requerida:** los cuatro integrantes aceptan o rechazan la propuesta y registran fecha/decisión en `SESSION_LOG.md`.
