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

- El contrato de integración queda en `v0.3` en `CONTRACTS.md` para IAM, Billing, Files, Dashboard y web.
- La API responde límites de almacenamiento en bytes.
- Las migraciones implementarán claves compuestas, unicidad, aislamiento multi-tenant y una sola suscripción activa por organización.

## Decisiones de integración aprobadas — 2026-10-18

- Access token de 15 minutos; refresh token de 7 días, rotado, persistido solo como hash y entregado mediante cookie `nexus_refresh` (`HttpOnly`, `SameSite=Lax`, `Path=/api/auth`; `Secure` en producción). Login y refresh comparten el esquema de respuesta. Logout revoca la sesión y limpia la cookie.
- La identidad autenticada expone `userId`, `organizationId`, `organizationName` y `role` desde la membresía activa validada. Refresh conserva ese contexto y vuelve a validar la membresía.
- La organización se registra junto con membresía, suscripción Demo, cuota, Drive `Mi espacio` y raíz `Archivos` dentro de una sola transacción PostgreSQL. Los hooks de Billing y Files reciben el mismo contexto transaccional; el alta completa se revierte si uno falla. Ningún hook del registro necesita hablar con SeaweedFS.
- La transacción de registro incluye un mensaje persistente de salida para el correo de verificación. El envío ocurre después del commit y se reintenta ante una falla temporal SMTP; la falla de correo no deja la cuenta sin un mensaje pendiente ni devuelve el token al navegador.
- Las cuotas comerciales usan unidades decimales: 1 GB = 1,000,000,000 bytes y 1 TB = 1,000,000,000,000 bytes. Demo es 5 GB/5 usuarios sin vencimiento; los planes pagados vencen a los 30 días en la simulación.
- Uso confirmado suma todas las versiones que permanecen almacenadas, incluidas las de papelera durante 30 días. No se suma `FileRecord.sizeBytes` además de `FileVersion.sizeBytes`. Las reservas de carga se contabilizan aparte y se consideran tanto al aceptar una carga como al bajar de plan.
- Sin suscripción vigente el límite es 0 bytes; la API no aplica una cuota de respaldo. El registro normal provisiona Demo para cada organización.
- El endpoint de cambio/activación de plan se coordina desde un `SubscriptionCoordinator` de integración que consulta Files y delega persistencia en Billing. Billing no inyecta Files; Files puede seguir consultando Billing para aplicar el límite de carga.
- La respuesta de Dashboard usa `organizationName` del principal validado, uso confirmado de Files, plan/límite de Billing y `recentActivity: []` hasta que Audit tenga fuente de datos.
- Las migraciones de todos los dominios comparten `database/migrations/` en la raíz. Víctor integra en un solo PR el esquema coordinado; las carpetas duplicadas bajo `apps/db/` no son una segunda fuente de migraciones.

## Enmienda 2026-10-27 (ver ADR-007)

- **Papelera:** la eliminación definitiva puede ejecutarla el dueño del archivo desde su propio Drive; ya no se limita a administradores. Sigue auditada. Motivo: en este corte no existen Drives de equipo ni vista administrativa de la papelera de otros miembros.
- **Sesiones:** la recuperación de contraseña revoca todas las sesiones del usuario (se implementa en SPEC-103).
