# ADR-002: Reglas aprobadas para el modelo de datos y alcance

- **Estado:** Aprobada
- **Fecha:** 2026-09-29
- **Decisor:** Equipo Nexus

## Contexto

La revisión del modelo entidad-relación y del diccionario de datos dejó varias decisiones que deben ser iguales para IAM, Billing, Files, Storage, Audit y frontend.

## Decisiones

1. Un usuario puede pertenecer a varias organizaciones mediante `MEMBERSHIP`.
2. Cada organización tiene una suscripción activa como máximo y una cuota asociada.
3. Drives, carpetas, archivos, versiones, destinos, equipos y permisos no pueden cruzar organizaciones.
4. Cada versión conserva el destino donde fue almacenada; una carpeta puede heredar el destino predeterminado de la organización.
5. Las cargas son idempotentes y solo crean una versión disponible después de confirmar tamaño, integridad y cifrado.
6. Los permisos se otorgan a usuarios o equipos; se aplica el nivel más alto cuando existen permisos directos y heredados.
7. Las sesiones pueden coexistir en varios dispositivos. Cambiar la contraseña revoca las sesiones activas.
8. Los enlaces compartidos son de solo lectura, apuntan a una versión fija, vencen obligatoriamente y pueden revocarse.
9. La creación inicial de usuario, organización, membresía, suscripción demo y cuota es atómica.
10. MFA/TOTP queda fuera del alcance actual por tiempo. No debe aparecer como requisito de implementación ni como dependencia del primer flujo.
11. Auditoría registra acciones críticas sin secretos, tokens completos, claves ni contenido; la cadena de hashes se conserva como objetivo del producto.

## Consecuencia

Los documentos de reglas, arquitectura, contratos y modelo mínimo deben aplicar estas decisiones. Si una implementación necesita apartarse, debe abrir una nueva decisión antes de cambiar contratos o migraciones.
