# ADR-008: Decisiones del alcance final

- **Estado:** Aprobada por el coordinador (Víctor Chán Morales) el 2026-11-04.
- **Alcance:** fija las decisiones que asumen las specs para completar la propuesta. Complementa ADR-002, ADR-003, ADR-006 y ADR-007. Las enmiendas a documentos anteriores se aplican con SPEC-004.
- **Fuera de este ADR:** exposición y fechas de entrega.

## 1. Arquitectura

- Se mantiene el **monolito modular**. No se implementan microservicios.
- **Redis Streams no se implementa.** La auditoría usa escritura directa con respaldo en el outbox de PostgreSQL (SPEC-401).
- **API Gateway no se implementa.** Un proxy inverso termina TLS y aplica cabeceras de seguridad (SPEC-806).
- **RNF-006** (escalabilidad horizontal de microservicios) se reformula: el despliegue sigue siendo portable con Docker Compose; el escalado por servicios no forma parte del alcance.

## 2. Exclusiones y desviaciones frente a la propuesta

| Propuesta | Decisión |
|---|---|
| MFA/TOTP (RF-001) | **Fuera de alcance.** Se mantiene ADR-002 §10. El rechazo de `mfaEnabled` en el login se conserva. |
| Modo oscuro (§5.1) | **Fuera de alcance.** |
| libsodium (§13, RF-004) | **Sustituido** por `node:crypto` (ADR-006). |
| Cifrado en streaming (RF-004) | **Fuera de alcance.** Se mantiene el cifrado en memoria con límite de 100 MB (ADR-006). |
| Rol Auditor | **No se implementa.** La propuesta §7 define tres roles. |
| Instalación automática en el servidor del cliente | **No se implementa** (ADR-003). Se ofrece un paquete Compose que el operador ejecuta. |
| Permisos por archivo individual (`files.resource_access`) | **No se implementan.** El permiso se asigna por miembro de equipo. |

## 3. Cifrado

- Se implementa la **rotación de llaves** re-cifrando las DEK y los datos de conexión de los destinos, sin re-cifrar el contenido (SPEC-005).

## 4. Almacenamiento híbrido

- Los destinos son **reales**: cada organización puede tener almacenes S3 distintos.
- Cada destino se clasifica como `cloud` u `on_premises`.
- En modelo híbrido se elige el destino al crear una **carpeta principal** (hija directa de la raíz del Drive). Las subcarpetas lo heredan.
- Cada versión conserva el destino donde nació (ADR-002 §4). Cambiar de modelo no mueve archivos existentes.

## 5. Pago simulado

- **Enmienda a `BUSINESS_RULES.md` y `CONTRACTS.md`:** la activación y la renovación de planes con precio mayor que cero solicitan una **tarjeta de prueba**.
- Solo se aceptan números ficticios fijos definidos en el código: uno se aprueba y otro se rechaza. Cualquier otro número se rechaza con un aviso para no usar tarjetas reales.
- Nunca se guarda ni se registra el número completo ni el CVV; solo los últimos cuatro dígitos de la tarjeta de prueba aprobada.
- No se procesa dinero real.

## 6. Eliminar empresa

- Cerrar una organización la deja en estado `cancelled`, cancela su suscripción, revoca sus sesiones y **conserva sus archivos**. No hay borrado físico.
- Solo un Super Admin puede reactivarla (SPEC-503).

## 7. Equipos

- Cada miembro de un equipo tiene nivel `read` (ver y descargar) o `write` (además subir, crear carpetas y enviar a la papelera).
- Un `tenant_admin` administra los equipos y tiene acceso `write` a todos los Drives de equipo de su organización.
- **La eliminación definitiva en un Drive de equipo queda reservada a `tenant_admin`** (ADR-003). En el Drive personal sigue pudiendo hacerla el dueño (ADR-007 §7).

## 8. Enlaces compartidos

- Apuntan a una versión fija (ADR-002 §8), duran **1, 7 o 30 días** y admiten contraseña opcional.
- Se pueden revocar de inmediato. Dejan de funcionar si el archivo pasa a la papelera.

## 9. Papelera y cuota

- **Enmienda a ADR-007 §7 y CONTRACTS v0.5:** todo lo que está en la papelera **cuenta en la cuota hasta su eliminación física**.
- Una tarea periódica purga lo que supera 30 días (SPEC-215). `retentionEndsAt` pasa a indicar cuándo se borrará.

## 10. Auditoría

- Se admiten actores `system` (tareas automáticas) y `visitor` (acceso público por enlace), y el resultado `failure`.
- La verificación de cadena detecta alteraciones y huecos (SPEC-404). Los checkpoints firmados no se implementan, por lo que **borrar los eventos finales de la cadena no es detectable**; es una limitación declarada.

## 11. Super Admin

- Es el flag `is_super_admin`, no un rol (ADR-007 §3). Se asigna solo por script o semilla; ninguna ruta permite otorgarlo.
- No otorga acceso a archivos de otras organizaciones (`BUSINESS_RULES.md`, Identidad, regla 7).

## 12. Dependencias nuevas

No se autorizan librerías nuevas de backend o frontend. Se usa `node:crypto`, `setInterval` (mismo patrón de `AuditOutboxService`) y código propio. Se autoriza una imagen de **Caddy** en el Compose on-premises como proxy inverso (SPEC-806).
