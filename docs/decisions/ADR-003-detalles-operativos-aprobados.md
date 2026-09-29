# ADR-003: Detalles operativos aprobados

- **Estado:** Aprobada
- **Fecha:** 2026-09-29

Estas decisiones completan las reglas de `ADR-002` sin reemplazarlas.

## Identidad y correo

- La verificación se realizará mediante un proveedor de correo usando `EmailService`.
- En desarrollo se utilizará Mailpit/Mailtrap; para demostración se podrá usar un proveedor real como Resend o Brevo.
- El token se guarda como hash, vence en 15 minutos y solo se utiliza una vez.
- La clave del proveedor se guarda en variables de entorno y nunca en Git o logs.

## Sesiones

- Access token: 15 minutos.
- Refresh token: 7 días, en cookie `HttpOnly` y `Secure` en producción.
- El refresh token se persiste únicamente como hash.
- Se permiten varias sesiones por usuario.
- Cambiar contraseña revoca todas las sesiones activas.

## Archivos y cuota

- Límite inicial por archivo: 100 MB.
- Plan demo: 5 GB y 5 usuarios.
- Tipos iniciales: PDF, DOCX, XLSX, PPTX, JPG, PNG, TXT y ZIP.
- Máximo inicial: 3 cargas simultáneas por usuario.
- La cuota se calcula en bytes con el tamaño real confirmado.

## Drive inicial

- El registro crea un Drive personal llamado `Mi espacio` y una carpeta raíz `Archivos`.
- El Drive usa el destino predeterminado de la organización.
- Los Drives de equipo se incorporan después.

## Planes

- Las ampliaciones se aplican después de confirmación simulada.
- Las reducciones solo se aceptan si uso confirmado más reservas activas caben en el nuevo límite.
- No se borran archivos automáticamente para reducir un plan.

## Auditoría

- Se registran autenticación, archivos, permisos, enlaces, planes y cambios administrativos.
- Se guardan `record_hash` y `prev_hash` desde la primera versión.
- La verificación completa de cadena y checkpoints firmados queda para una etapa posterior.

## Papelera y nombres

- La papelera conserva elementos durante 30 días.
- El contenido en papelera sigue consumiendo cuota.
- La eliminación definitiva requiere permisos administrativos y queda auditada.
- Las carpetas tienen nombres únicos dentro del mismo padre, sin distinguir mayúsculas/minúsculas.
- Una nueva carga con el mismo nombre y carpeta crea una nueva versión del mismo archivo.

## Instalación

- La primera versión registra solicitudes, destinos y comprobaciones de conectividad.
- La instalación física automática en el servidor del cliente queda para una etapa posterior.

## API y base de datos

- El contrato inicial queda en `v0.2` para registro, login, planes, dashboard, carpetas, carga y descarga.
- La API responde límites de almacenamiento en bytes.
- Las migraciones implementarán claves compuestas, unicidad, aislamiento multi-tenant y una sola suscripción activa por organización.
