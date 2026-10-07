# ADR-001: Adopción de Monolito Modular para Nexus

- **Estado:** APROBADO por el equipo.
- **Fecha:** 2026-10-06.
- **Contexto:**
  El proyecto requería una evaluación de viabilidad de la arquitectura para cumplir con la entrega académica de fin de mes. Una arquitectura basada en microservicios independientes distribuía innecesariamente el esfuerzo en orquestación de red, descubrimiento de servicios, CI/CD múltiple y debugging interservicio distribuido, lo que ponía en alto riesgo el plazo de entrega.

- **Decisión:**
  Se adopta una arquitectura de **Monolito Modular** en NestJS:
  1. Todos los dominios (`IAM`, `Billing`, `Files`, `Storage`, `Health`) se implementan como módulos de NestJS que residen en una sola aplicación ejecutable (`apps/api`).
  2. La comunicación entre módulos se realiza exclusivamente a nivel de memoria (in-process) mediante la **inyección de dependencias** de NestJS, eliminando llamadas HTTP interservicios.
  3. El frontend Next.js (`apps/web`) se mantiene como un proceso independiente en el puerto 3000, consumiendo la API mediante contratos REST estandarizados en el puerto 3001.
  4. Los servicios auxiliares de infraestructura persistente (`PostgreSQL 16` y `MinIO`) se gestionan mediante Docker Compose.

- **Consecuencias:**
  - **Positivas:**
    - Se elimina el overhead operacional de red y despliegue distribuido.
    - Se garantiza el cumplimiento de la entrega antes de fin de mes con pruebas unitarias e integración inmediatas.
    - Se preserva el aislamiento estricto de dominios (alta cohesión, bajo acoplamiento).
    - Facilita la extracción futura a microservicios independientes si la escala real del sistema lo llega a requerir en etapas posteriores.
  - **Riesgos mitigados:**
    - Errores de sincronización de red entre servicios eliminados.
    - Complejidad de transacciones distribuidas eliminada.
