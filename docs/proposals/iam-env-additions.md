# Variables para `.env.example` (archivo compartido: coordinar antes de editar)

Solo valores de desarrollo. Nunca subir `.env` real.

```
# ── IAM ──
JWT_SECRET=dev-only-jwt-secret-change-me-0123456789   # >= 32 caracteres; en producción no puede empezar con "dev-only"
IAM_REQUIRE_VERIFIED_EMAIL=true     # propuesta de contrato: el login exige correo verificado
COOKIE_SECURE=false                 # true en producción (HTTPS)
COOKIE_SAMESITE=lax                 # lax | strict | none (none exige COOKIE_SECURE=true)
APP_URL=http://localhost:3000       # base del enlace de verificación (frontend)
# IAM_VERIFY_EMAIL_PATH=/verificar-correo   # (opcional) página web que recibe el enlace; por defecto /verificar-correo
# CORS usa WEB_URL (ya existente en main.ts); debe ser el origen exacto del frontend, no '*'
DB_SYNCHRONIZE=false                # el esquema lo crean las migraciones; true solo a propósito

# SMTP de desarrollo (ADR-003): Mailpit, UI en http://localhost:8025
MAIL_HOST=localhost
MAIL_PORT=1025
MAIL_FROM="Nexus <no-reply@nexus.local>"
# Mailtrap: MAIL_HOST=sandbox.smtp.mailtrap.io  MAIL_PORT=2525  MAIL_USER=...  MAIL_PASS=...
```
