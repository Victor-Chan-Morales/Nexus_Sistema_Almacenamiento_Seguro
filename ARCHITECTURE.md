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
                                      ├── Storage: cliente S3 (SeaweedFS)
                                      └── Audit: eventos relevantes
                                               │
                           ┌───────────────────┴──────────────────┐
                           ▼                                      ▼
                    PostgreSQL 16                           SeaweedFS (S3)
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
- **Storage**: `StorageRouter` entrega, para cada destino, un `ObjectStorage` con `put`, `get` y `delete` (SPEC-801). Los destinos de entorno usan `StorageService`, que habla S3 con SeaweedFS; los destinos propios (SPEC-802) usan un `S3ObjectStorage` con su propio cliente, cacheado por destino. Files no usa el SDK directamente ni inyecta `StorageService`.
- **PostgreSQL**: fuente de verdad de identidad, permisos, plan, relaciones y metadatos.
- **SeaweedFS (S3)**: bytes de objetos. PostgreSQL registra la clave de objeto y datos de la versión, no el contenido.

## Límites multi-tenant

1. La API deriva `organizationId` del usuario autenticado y su membresía activa.
2. Cada lectura y escritura de recurso comprueba el alcance organizacional en backend, también cuando se conoce un UUID.
3. Las claves de objeto incluyen un prefijo controlado por el servidor y asociado al tenant; el cliente no elige un prefijo arbitrario.
4. Los datos de organizaciones distintas no se revelan en listados, errores ni métricas.

## Manejo de archivos

Files valida sesión, pertenencia, carpeta y límites; Storage persiste el objeto. FileVersion persiste tamaño y clave del objeto. El caso de uso confirma éxito después de guardar metadatos. Si el guardado en PostgreSQL falla después de que SeaweedFS recibió el objeto, se intenta una compensación para retirar el objeto huérfano y se registra el fallo de forma segura. No se finge atomicidad distribuida entre SQL y object storage.

## Seguridad objetivo

- Contraseñas con Argon2id; TLS para tráfico externo; tokens y sesiones revocables.
- Verificación de correo, restablecimiento seguro de contraseña, sesiones revocables y RBAC. MFA/TOTP queda fuera del alcance actual y se reserva para una fase posterior.
- Cifrado autenticado de archivos con AES-256-GCM (`node:crypto`) y envelope DEK/KEK por versión de archivo y por tenant (ADR-006). La propuesta pedía libsodium en streaming; la implementación cifra en memoria (límite de 100 MB), y el streaming queda fuera de alcance (ADR-008 §2). Las llaves todavía no rotan: lo implementa SPEC-005.
- Las claves reales se conservan fuera de PostgreSQL; la base almacena referencias y material cifrado permitido por el modelo.
- Mensajes API no filtran stack traces, llaves, tokens, rutas internas ni contenido.
- Auditoría sin secretos ni contenido de archivos, con cadena de hashes. SPEC-404 agrega su verificación; los checkpoints firmados no se implementan (ADR-008 §10).

## Despliegue — Monolito Modular (decisión vigente)

La arquitectura actual usa un **monolito modular**: un único proceso NestJS que contiene
todos los dominios (IAM, Billing, Files, Storage, Audit, Integration, Dashboard, Health). Esta decisión fue tomada para
el corte del 30% del proyecto universitario con el objetivo de reducir la complejidad
operacional y cumplir el plazo de entrega.

```
Persona usuaria
      │ HTTPS
      ▼
Next.js (puerto 3000)  ──── HTTP/JSON ────► NestJS Monolito (puerto 3001)
   proceso independiente                          │
                                    ┌─────────────┼─────────────────────┐
                                    │             │                     │
                               IamModule    BillingModule          FilesModule
                               (auth/JWT)   (planes/subs)      (archivos/cuotas)
                                    │             │                     │
                               StorageModule ◄────┴─────── HealthModule
                              (SeaweedFS client)                  (/api/health)
                                    │
                    ┌───────────────┴──────────────┐
                    ▼                              ▼
             PostgreSQL 16                    SeaweedFS (S3)
          (contenedor Docker)            (contenedor Docker)
```

**Comunicación entre módulos:** llamadas directas de método (inyección de dependencias
de NestJS), sin llamadas HTTP entre módulos. Por ejemplo, `FilesService` recibe
`BillingService` y `StorageService` como constructor arguments — sin `HttpModule`.

**Contenedores Docker Compose:**
- `postgres` — persistencia de datos
- `SeaweedFS` — almacenamiento de objetos
- `api` — monolito NestJS (todos los módulos en un proceso)

**Frontend:** `apps/web` (Next.js) corre como proceso independiente (`npm run dev:web`)
y consume el API en `http://localhost:3001`.

**Decisiones del alcance final (ADR-008):**
- **Monolito modular:** se mantiene y no se implementan microservicios. El despliegue sigue siendo portable con Docker Compose; el escalado por servicios (RNF-006) no forma parte del alcance.
- **Sin Redis:** Redis Streams no se implementa. La auditoría usa escritura directa con respaldo en el outbox de PostgreSQL.
- **Proxy inverso:** en lugar de un API Gateway, un proxy inverso termina TLS y aplica las cabeceras de seguridad (SPEC-806).
- **Interfaz de almacenamiento:** cada organización puede tener almacenes S3 distintos, clasificados como `cloud` u `on_premises` (SPEC-801 y SPEC-802). En modelo híbrido el destino se elige al crear una carpeta principal y sus subcarpetas lo heredan (SPEC-803). Cada versión conserva el destino donde nació.

## SOLID aplicado

- **S:** controladores atienden HTTP; servicios ejecutan casos de uso; proveedores guardan bytes.
- **O:** cambiar de SeaweedFS a MinIO o a AWS S3 es configuración (`S3_*`) y no toca las reglas de archivos; un proveedor que no hable S3 es una implementación nueva de `ObjectStorage` que devuelve `StorageRouter`, sin tocar `FilesService` (SPEC-801).
- **L:** toda implementación del proveedor respeta el resultado/error definido para guardar, recuperar y eliminar.
- **I:** separar interfaz de operaciones de objetos de las operaciones administrativas del bucket.
- **D:** `FilesService` recibe `StorageRouter` por inyección de Nest y trabaja contra la interfaz `ObjectStorage`; no instancia el cliente S3 ni conoce el proveedor de cada destino.
