# Arquitectura de Nexus

## Propósito y límites

Nexus ofrece una experiencia web única para organizaciones que almacenan archivos en infraestructura cloud, propia o híbrida. La aplicación mantiene separados el control de acceso, los metadatos y los bytes del archivo.

## Vista lógica

```text
Persona usuaria
      │ HTTPS
      ▼
Next.js Web ── JSON/multipart ──► NestJS API
                                      ├── IAM: identidad, sesiones y membresías
                                      ├── Billing: planes y suscripción simulada
                                      ├── Files: carpetas, metadatos y reglas de cuota
                                      ├── Storage: interfaz de proveedor + MinIO/S3
                                      └── Audit: eventos relevantes (fase posterior)
                                               │
                           ┌───────────────────┴──────────────────┐
                           ▼                                      ▼
                    PostgreSQL 16                           MinIO / S3
               identidad, permisos,                     contenido cifrado,
               suscripciones, metadatos                  separado de metadatos
```

La figura expresa límites lógicos. No afirma que todos los módulos ya existan ni que cada caja se despliegue como servicio separado.

## Capas y propiedad de datos

- **Web (`apps/web`)**: páginas de Next.js, componentes visuales, navegación y cliente HTTP tipado. No contiene autorización de seguridad ni reglas de negocio como fuente de verdad.
- **API (`apps/api`)**: NestJS. Los controladores traducen HTTP; los servicios de aplicación aplican casos de uso; los repositorios abstraen PostgreSQL; los proveedores encapsulan almacenamiento.
- **IAM**: usuario, organización, membresía, rol y sesión. Determina el contexto organizacional autorizado.
- **Billing**: plan, suscripción y operaciones marcadas como simuladas. No procesa dinero real.
- **Files**: carpetas, archivos, versiones, límites y autorización de recursos.
- **Storage**: contrato pequeño (`put`, `get`, `delete`) e implementación MinIO para el primer entorno. La lógica de Files depende del contrato, no del SDK concreto.
- **PostgreSQL**: fuente de verdad de identidad, permisos, plan, relaciones y metadatos.
- **MinIO/S3**: bytes de objetos. PostgreSQL registra la clave de objeto y datos de la versión, no el contenido.

## Límites multi-tenant

1. La API deriva `organizationId` del usuario autenticado y su membresía activa.
2. Cada lectura y escritura de recurso comprueba el alcance organizacional en backend, también cuando se conoce un UUID.
3. Las claves de objeto incluyen un prefijo controlado por el servidor y asociado al tenant; el cliente no elige un prefijo arbitrario.
4. Los datos de organizaciones distintas no se revelan en listados, errores ni métricas.

## Manejo de archivos

Files valida sesión, pertenencia, carpeta y límites; Storage persiste el objeto. FileVersion persiste tamaño y clave del objeto. El caso de uso confirma éxito después de guardar metadatos. Si el guardado en PostgreSQL falla después de que MinIO recibió el objeto, se intenta una compensación para retirar el objeto huérfano y se registra el fallo de forma segura. No se finge atomicidad distribuida entre SQL y object storage.

## Seguridad objetivo

- Contraseñas con Argon2id; TLS para tráfico externo; tokens y sesiones revocables.
- MFA/TOTP, verificación de correo, restablecimiento seguro de contraseña y RBAC según alcance y entregas.
- Cifrado autenticado de archivos en streaming con libsodium y diseño envelope DEK/KEK conforme a la propuesta.
- Las claves reales se conservan fuera de PostgreSQL; la base almacena referencias y material cifrado permitido por el modelo.
- Mensajes API no filtran stack traces, llaves, tokens, rutas internas ni contenido.
- Auditoría futura sin secretos ni contenido de archivos y con controles de integridad descritos en el diccionario.

## Despliegue por etapas

El objetivo final de la propuesta es separar dominios y permitir cloud, on-premises e híbrido. El alcance inicial usa dominios modulares y servicios locales de desarrollo. La decisión exacta de ejecutar una API modular en un proceso o varios contenedores debe seguir el ADR de 30% y aprobarse por el equipo; esto no modifica el objetivo final.

## SOLID aplicado

- **S:** controladores atienden HTTP; servicios ejecutan casos de uso; proveedores guardan bytes.
- **O:** agregar S3 u otro destino añadiendo una implementación de `StorageProvider` y configuración, sin reescribir reglas de archivos.
- **L:** toda implementación del proveedor respeta el resultado/error definido para guardar, recuperar y eliminar.
- **I:** separar interfaz de operaciones de objetos de las operaciones administrativas del bucket.
- **D:** `FilesService` recibe `StorageProvider` por inyección; no instancia el cliente MinIO directamente.
