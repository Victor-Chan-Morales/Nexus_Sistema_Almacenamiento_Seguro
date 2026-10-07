# Módulo IAM (Identity and Access Management)

**Dueño:** Sebastián.

## Responsabilidades
- Registro de nuevos usuarios con organización y membresía inicial atómica.
- Inicio de sesión con validación de credenciales (hashing Argon2id).
- Emisión y validación de tokens JWT con claims de usuario y `organizationId`.
- Estrategia de autenticación Passport JWT.
- Consulta de información del usuario y organización actual (`/auth/me`).

## Comunicación en el Monolito Modular
Este módulo exporta `IamService` para que otros módulos (Files, Billing) puedan inyectarlo directamente si requieren validar membresías o usuarios, sin realizar llamadas HTTP externas.
