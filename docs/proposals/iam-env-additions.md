# Variables para `.env.example` (archivo compartido: coordinar antes de editar)

Solo valores de desarrollo. Nunca subir `.env` real.

```
# ── IAM ──
JWT_SECRET=dev-only-jwt-secret-change-me-0123456789   # >= 32 caracteres; en producción no puede empezar con "dev-only"
IAM_REQUIRE_VERIFIED_EMAIL=true     # propuesta de contrato: el login exige correo verificado
COOKIE_SECURE=false                 # true en producción (HTTPS)
COOKIE_SAMESITE=lax                 # lax | strict | none (none exige COOKIE_SECURE=true)
APP_URL=http://localhost:3000       # base del enlace de verificación (frontend)
WEB_ORIGIN=http://localhost:3000    # origen permitido por CORS con credenciales

# SMTP de desarrollo (ADR-003): Mailpit, UI en http://localhost:8025
MAIL_HOST=localhost
MAIL_PORT=1025
MAIL_FROM="Nexus <no-reply@nexus.local>"
# Mailtrap: MAIL_HOST=sandbox.smtp.mailtrap.io  MAIL_PORT=2525  MAIL_USER=...  MAIL_PASS=...
```
