# SPEC-805: INSTALACIÓN ON-PREMISES EN UN COMANDO

## 1. Metadatos

| Campo | Valor |
|---|---|
| **Nivel de Rigor** | N2 (Compose, zona protegida) |
| **Responsable Principal** | Por asignar |
| **Aprobador** | Víctor Chán Morales |
| **Módulo Afectado** | `deploy/on-premises/`, `apps/web/`, `apps/api/Dockerfile` |
| **Requisitos Vinculados** | RF-015, RNF-010 |
| **Dependencias** | SPEC-801 |
| **Prioridad** | P1 |
| **Estimación** | 4 h |
| **Estado** | Aprobada (2026-11-04, Víctor Chán Morales) |

## 2. Objetivo

Que un operador levante Nexus completo en un servidor del cliente con un solo comando, validando antes lo necesario. El `docker-compose.yml` actual es solo de desarrollo y no incluye la web.

## 3. Fuera de Alcance

- TLS y cabeceras (SPEC-806): esta spec expone HTTP local.
- Actualizaciones automáticas, Kubernetes y alta disponibilidad.
- Conexión automática con una instalación central.
- Respaldos automáticos: se documenta el procedimiento manual.

## 4. Criterios de Aceptación

```gherkin
Escenario 1: Instalación limpia
  Dado un servidor Linux con Docker Compose v2, sin datos previos
  Cuando ejecuta ./deploy/on-premises/install.sh
  Entonces se crean los secretos, se construyen las imágenes, se aplican las migraciones
  y web, api, postgres y seaweedfs quedan sanos

Escenario 2: Secretos
  Entonces JWT_SECRET, FILES_MASTER_KEY, contraseñas y claves se generan aleatoriamente en .env con permisos 600
  Y el script nunca los imprime

Escenario 3: Reejecutar
  Cuando ejecuta el script de nuevo
  Entonces no sobrescribe .env ni borra datos, y aplica las migraciones pendientes

Escenario 4: Validación previa
  Dado que falta Docker, Compose v2, espacio mínimo o un puerto requerido
  Entonces termina con un mensaje claro antes de crear nada

Escenario 5: Sin puertos internos
  Entonces postgres y seaweedfs no publican puertos al host
  Y solo se publican la web y la API

Escenario 6: Reinicio
  Cuando se reinicia el servidor
  Entonces los servicios vuelven solos y los archivos siguen disponibles

Escenario 7: Recorrido
  Entonces se puede registrar, verificar, iniciar sesión, subir y descargar un archivo
  Y el correo se puede configurar por SMTP o se muestra el motivo si falta

Escenario 8: Imágenes fijas
  Entonces no se usa ninguna imagen con la etiqueta "latest" sin digest
```

## 5. Contrato de API

Sin cambios.

## 6. Datos y Esquema

Sin cambios de esquema. Reutiliza `database/migrations/`.

## 8. Diseño Técnico

```text
deploy/on-premises/
├── docker-compose.yml
├── .env.template
├── install.sh
├── smoke-test.sh
└── README.md
apps/web/Dockerfile
```

- **`apps/web/Dockerfile`** (nuevo): multietapa con `output: "standalone"` en `next.config.ts`. `NEXT_PUBLIC_API_BASE_URL` se fija **al construir** (build arg).
- **Contexto de build:** `apps/web` es workspace, así que usa la raíz; `apps/api` no.
- **Dependencia del arranque:** `migrate` termina → `api` arranca, con `service_completed_successfully`.
- **`dbmate`:** fijar por digest, igual que SeaweedFS.
- **Volúmenes con nombre** y `restart: unless-stopped`.
- **Credenciales S3:** `.env.template` define los valores; SeaweedFS recibe `AWS_*` como en desarrollo.
- `IAM_REQUIRE_VERIFIED_EMAIL` debe poder funcionar sin SMTP real: se documenta la opción y sus riesgos.
- **Riesgo:** cambiar `FILES_MASTER_KEY` deja archivos ilegibles. `install.sh` no la regenera y el manual lo advierte, con referencia a SPEC-005.

## 9. Plan de Tareas

- [ ] **T1 (60 min)**: Dockerfile de la web y `standalone`.
- [ ] **T2 (60 min)**: Compose y `.env.template`.
- [ ] **T3 (60 min)**: `install.sh` con validación y secretos.
- [ ] **T4 (60 min)**: `smoke-test.sh`, README y prueba desde cero.

**Archivos permitidos:** `deploy/on-premises/*`, `apps/web/Dockerfile`, `apps/web/.dockerignore` (nuevos), `apps/web/next.config.ts`, `apps/api/Dockerfile` (solo si hace falta).

## 10. Estrategia de Pruebas

| Criterio | Tipo | Evidencia |
|---|---|---|
| Escenarios 1–8 | Manual en una máquina limpia o VM, con `smoke-test.sh` | Salida en el PR |
| `shellcheck` en los scripts | Estática | Salida en el PR |

## 11. Impacto en Documentación

- [ ] `deploy/on-premises/README.md`, referencia en `README.md`.

## 12. Preguntas Abiertas

Ninguna.

## 13. Registro de Cambios

| Fecha | Autor | Descripción |
|---|---|---|
| 2026-11-04 | Claude Code (borrador) | Versión inicial. |
| 2026-11-04 | Víctor Chán Morales | Aprobada. |
