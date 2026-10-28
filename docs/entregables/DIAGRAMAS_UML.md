# NEXUS — PAQUETE DE DIAGRAMAS UML

> **SPEC-702 · Borrador asistido, 2026-10-27.** Los diagramas están en Mermaid (se ven en GitHub y en cualquier visor de Markdown con soporte) y salen del código, las migraciones y `docker-compose.yml`, no de la propuesta. **Pendiente de revisión de Víctor Chán Morales** antes de exportar a PDF.
>
> **Leyenda de estado** (igual que en `REQUISITOS_CASOS_USO.md`): línea **continua** = implementado en el código (no verificado de punta a punta); línea **punteada** o la marca *«planificado»* = especificado para el corte del 80% pero aún sin código; elementos con la marca *«fuera del corte»* = existen en la base de datos pero sin lógica.
>
> | Diagrama | Qué muestra |
> |---|---|
> | 1 | Casos de uso |
> | 2 | Clases del dominio |
> | 3 | Entidad-relación de la base de datos (30 tablas) |
> | 4 | Secuencias: registro, sesión, subida cifrada, cambio de plan, recuperación de contraseña |
> | 5 | Componentes |
> | 6 | Despliegue |
> | 7 | Estados: archivo, carga y suscripción |

---

## 1. Diagrama de casos de uso

Detalle de cada caso en `REQUISITOS_CASOS_USO.md` §7. Los actores y casos punteados están fuera del corte o sin implementar.

```mermaid
flowchart LR
  V(["Visitante"])
  C(["Colaborador"])
  A(["Tenant Admin"])
  S(["Super Admin"])

  subgraph Acceso
    UC01(["UC-01 Registrar organización"])
    UC02(["UC-02 Verificar correo"])
    UC03(["UC-03 Iniciar sesión"])
    UC04(["UC-04 Mantener y cerrar sesión"])
    UC05(["UC-05 Recuperar contraseña"])
  end
  subgraph Archivos
    UC12(["UC-12 Crear carpeta"])
    UC13(["UC-13 Explorar"])
    UC14(["UC-14 Subir archivo"])
    UC15(["UC-15 Descargar"])
    UC16(["UC-16 Mover a papelera"])
    UC17(["UC-17 Gestionar papelera"])
    UC18(["UC-18 Ver versiones"])
    UC20(["UC-20 Compartir con enlace"])
  end
  subgraph Administración
    UC06(["UC-06 Agregar y listar miembros"])
    UC07(["UC-07 Consultar planes"])
    UC08(["UC-08 Contratar o cambiar plan"])
    UC09(["UC-09 Renovar suscripción"])
    UC10(["UC-10 Historial de facturación"])
    UC11(["UC-11 Panel de uso"])
    UC19(["UC-19 Consultar auditoría"])
    UC21(["UC-21 Administrar plataforma"])
  end

  V --- UC01
  V --- UC02
  V --- UC03
  V --- UC05
  V --- UC07
  C --- UC04
  C --- UC11
  C --- UC12
  C --- UC13
  C --- UC14
  C --- UC15
  C --- UC16
  C -.- UC17
  C -.- UC18
  C -.- UC20
  A --- UC06
  A --- UC08
  A --- UC09
  A --- UC10
  A --- UC19
  A -->|"también opera archivos"| C
  S -.- UC21

  UC14 -. "incluye" .-> UC11
  UC01 -. "incluye" .-> UC02

  classDef planned stroke-dasharray: 5 5,fill:#fff8e1,stroke:#b8860b;
  classDef out stroke-dasharray: 2 6,fill:#f3f3f3,stroke:#888,color:#666;
  class UC05,UC06,UC09,UC10,UC19,UC17,UC18 planned;
  class UC20,UC21,S out;
```

---

## 2. Diagrama de clases del dominio

Refleja las entidades TypeORM y las tablas de las migraciones. Los nombres siguen el código (`camelCase`); entre paréntesis, la tabla. `BillingOperation` y `AuditEvent` existen como tablas pero **su entidad llega con SPEC-301 y SPEC-401**.

```mermaid
classDiagram
  direction LR

  class Organization {
    +uuid id
    +string name
    +OrgStatus status
    +DeploymentModel deploymentModel
  }
  class User {
    +uuid id
    +string email
    +string passwordHash
    +string fullName
    +boolean emailVerified
    +boolean isSuperAdmin
    +UserStatus status
  }
  class Role {
    +smallint id
    +string name
  }
  class Membership {
    +uuid id
    +MembershipStatus status
  }
  class Session {
    +uuid id
    +string refreshTokenHash
    +datetime expiresAt
    +datetime revokedAt
  }
  class OneTimeToken {
    +uuid id
    +string tokenHash
    +TokenPurpose purpose
    +datetime expiresAt
    +datetime usedAt
  }
  class EmailOutbox {
    +uuid id
    +string kind
    +string status
    +int attempts
    +datetime nextAttemptAt
  }

  class Plan {
    +uuid id
    +string name
    +int storageLimitGb
    +int userLimit
    +decimal priceMonthly
    +int validityDays
  }
  class Subscription {
    +uuid id
    +SubscriptionStatus status
    +date startDate
    +date endDate
  }
  class BillingOperation {
    <<planificado SPEC-301>>
    +uuid id
    +OperationType type
    +decimal amount
    +datetime simulatedAt
  }

  class Drive {
    +uuid id
    +DriveType type
    +string name
  }
  class Folder {
    +uuid id
    +string name
    +boolean isDeleted
    +datetime deletedAt
  }
  class FileRecord {
    +uuid id
    +string name
    +string mimeType
    +boolean isDeleted
    +datetime deletedAt
  }
  class FileVersion {
    +uuid id
    +int versionNumber
    +string objectKey
    +bigint sizeBytes
    +string checksum
    +string encryptedDek
    +smallint formatVersion
  }
  class Destination {
    +uuid id
    +string providerType
    +boolean isDefault
    +string bucketOrPrefix
  }
  class TenantEncryptionKey {
    +uuid id
    +string externalReference
    +KeyStatus status
  }
  class TenantQuota {
    +bigint confirmedUsageBytes
    +bigint activeReservationsBytes
  }
  class Reservation {
    +uuid id
    +bigint sizeBytes
    +ReservationStatus status
    +datetime expiresAt
  }
  class Upload {
    +uuid id
    +string idempotencyKey
    +UploadStatus status
    +bigint declaredSizeBytes
  }
  class AuditEvent {
    <<planificado SPEC-401>>
    +uuid eventId
    +string actionType
    +string resourceType
    +string recordHash
    +string prevHash
    +datetime occurredAt
  }
  class Team {
    <<fuera del corte>>
  }
  class ShareLink {
    <<fuera del corte>>
  }

  Organization "1" --> "*" Membership
  User "1" --> "*" Membership
  Role "1" --> "*" Membership
  User "1" --> "*" Session
  Organization "1" --> "*" Session
  User "1" --> "*" OneTimeToken
  User "1" --> "*" EmailOutbox

  Organization "1" --> "*" Subscription
  Plan "1" --> "*" Subscription
  Subscription "1" --> "*" BillingOperation

  Organization "1" --> "*" Drive
  User "0..1" --> "*" Drive : dueño de un Drive personal
  Drive "1" --> "*" Folder
  Folder "0..1" --> "*" Folder : carpeta padre
  Folder "1" --> "*" FileRecord
  FileRecord "1" --> "*" FileVersion
  FileRecord "1" --> "0..1" FileVersion : versión actual
  Destination "1" --> "*" FileVersion
  TenantEncryptionKey "1" --> "*" FileVersion
  Organization "1" --> "*" Destination
  Organization "1" --> "*" TenantEncryptionKey
  Organization "1" --> "1" TenantQuota
  Organization "1" --> "*" Reservation
  Reservation "1" --> "*" Upload
  Folder "1" --> "*" Upload
  Organization "1" --> "*" AuditEvent
  User "0..1" --> "*" AuditEvent : actor
  Team "0..1" --> "*" Drive
  FileVersion "1" --> "*" ShareLink
```

> **Reglas que el diagrama no muestra:** una organización tiene a lo sumo **una** suscripción activa (índice parcial único); `Membership` es única por (usuario, organización); `FileVersion` es única por (archivo, número de versión); `AuditEvent` es solo de inserción (triggers de la BD).

---

## 3. Diagrama entidad-relación de la base de datos

30 tablas en cinco esquemas: `admin`, `iam`, `files`, `billing` y `audit`. Se muestran claves y columnas relevantes; las columnas de auditoría de fila (`created_at`, `updated_at`) se omiten. Las FK son `RESTRICT` salvo las indicadas en `database/README.md`.

```mermaid
erDiagram
  ORGANIZATION ||--o{ MEMBERSHIP : tiene
  USER ||--o{ MEMBERSHIP : pertenece
  ROLE ||--o{ MEMBERSHIP : define
  USER ||--o{ SESSION : abre
  ORGANIZATION ||--o{ SESSION : contexto
  USER ||--o{ ONE_TIME_TOKEN : recibe
  USER ||--o{ EMAIL_OUTBOX : destinatario

  PLAN ||--o{ SUBSCRIPTION : define
  ORGANIZATION ||--o{ SUBSCRIPTION : contrata
  SUBSCRIPTION ||--o{ BILLING_OPERATION : registra
  SUBSCRIPTION ||--o{ PLAN_REVISION : revisa

  ORGANIZATION ||--o{ DRIVE : posee
  USER |o--o{ DRIVE : "dueño (personal)"
  TEAM |o--o{ DRIVE : "dueño (equipo)"
  TEAM ||--o{ TEAM_MEMBER : integra
  USER ||--o{ TEAM_MEMBER : participa
  DRIVE ||--o{ FOLDER : contiene
  FOLDER |o--o{ FOLDER : "padre de"
  FOLDER ||--o{ FILE : contiene
  FILE ||--o{ FILE_VERSION : versiona
  FILE |o--o| FILE_VERSION : "versión actual"
  DESTINATION ||--o{ FILE_VERSION : almacena
  TENANT_ENCRYPTION_KEY ||--o{ FILE_VERSION : cifra
  ORGANIZATION ||--o{ DESTINATION : configura
  ORGANIZATION ||--o{ TENANT_ENCRYPTION_KEY : tiene
  ORGANIZATION ||--|| TENANT_QUOTA : controla
  ORGANIZATION ||--o{ RESERVATION : reserva
  RESERVATION ||--o{ UPLOAD : respalda
  FOLDER ||--o{ UPLOAD : recibe
  FILE_VERSION ||--o{ SHARE_LINK : comparte
  FILE ||--o{ RESOURCE_ACCESS : concede
  FOLDER ||--o{ RESOURCE_ACCESS : concede

  ORGANIZATION ||--o{ AUDIT_EVENT : registra
  USER |o--o{ AUDIT_EVENT : actor
  AUDIT_EVENT ||--o{ AUDIT_CHAIN_CHECKPOINT : resume

  ORGANIZATION ||--o{ INSTALLATION_REQUEST : solicita
  INSTALLATION_REQUEST ||--o| INSTALLATION : origina
  INSTALLATION ||--o{ INSTALLATION_CHECK : comprueba
  INSTALLATION ||--o{ CONNECTION_SECRET_REF : referencia

  ORGANIZATION {
    uuid organization_id PK
    string name
    enum status
    enum deployment_model
  }
  USER {
    uuid user_id PK
    string email UK
    string password_hash
    boolean email_verified
    boolean is_super_admin
  }
  MEMBERSHIP {
    uuid membership_id PK
    uuid user_id FK
    uuid organization_id FK
    smallint role_id FK
    enum status
  }
  SESSION {
    uuid session_id PK
    uuid user_id FK
    uuid organization_id FK
    string refresh_token_hash
    timestamptz revoked_at
  }
  SUBSCRIPTION {
    uuid subscription_id PK
    uuid organization_id FK
    uuid plan_id FK
    enum status
    date end_date
  }
  FOLDER {
    uuid folder_id PK
    uuid drive_id FK
    uuid parent_folder_id FK
    boolean is_deleted
  }
  FILE {
    uuid file_id PK
    uuid folder_id FK
    uuid current_version_id FK
    boolean is_deleted
  }
  FILE_VERSION {
    uuid version_id PK
    uuid file_id FK
    int version_number
    string object_key
    bigint size_bytes
    string encrypted_dek
    uuid kek_id FK
  }
  TENANT_QUOTA {
    uuid organization_id PK
    bigint confirmed_usage_bytes
    bigint active_reservations_bytes
  }
  AUDIT_EVENT {
    uuid event_id PK
    uuid organization_id FK
    string action_type
    string record_hash
    string prev_hash
    timestamptz occurred_at
  }
```

> **Estado por esquema.** `iam` (6 tablas) y, de `billing` (4 tablas), `plan` y `subscription`: en uso. `files` (13 tablas; en uso `drive`, `folder`, `file`, `file_version`, `destination`, `tenant_encryption_key`, `tenant_quota`, `reservation`, `upload`): `team`, `team_member`, `resource_access` y `share_link`: **sin código**. `audit`: sin código hasta SPEC-401. `admin` (5 tablas): solo `organization` en uso; `installation_request`, `installation`, `installation_check` y `connection_secret_ref`: **sin código**. `billing.plan_revision` y `billing.billing_operation`: sin código hasta SPEC-301.

---

## 4. Diagramas de secuencia

### 4.1 Registro atómico y verificación de correo · implementado

```mermaid
sequenceDiagram
  autonumber
  actor U as Visitante
  participant W as Web (Next.js)
  participant C as IamController
  participant R as RegistrationService
  participant H as RegistrationHooks
  participant DB as PostgreSQL
  participant M as Mailpit (SMTP)

  U->>W: Completa el formulario de registro
  W->>C: POST /api/auth/register
  C->>R: register(dto)
  R->>R: Argon2id del password
  R->>DB: BEGIN
  R->>DB: ¿existe el correo?
  alt correo ya registrado
    R-->>C: 409 EMAIL_TAKEN
    C-->>W: error común
  else correo libre
    R->>DB: INSERT usuario, organización, membresía tenant_admin
    R->>H: run(manager, userId, organizationId)
    H->>DB: Billing: suscripción Demo (hook demo-subscription)
    H->>DB: Files: Drive "Mi espacio", carpeta "Archivos", cuota, destino, referencia de llave (hook personal-drive)
    R->>DB: INSERT token de verificación (hash) + mensaje en el outbox
    R->>DB: COMMIT
    R->>M: envía el correo con el enlace (tras el commit)
    Note over R,M: Si el SMTP falla, el mensaje queda pendiente<br/>y se reintenta durante 24 h
    R-->>C: userId, organizationId, role, verificationRequired
    C-->>W: 201 Created
  end

  U->>W: Abre /verificar-correo?token=...
  W->>C: POST /api/auth/verify-email
  C->>DB: valida token (vigente, sin usar) y marca el correo verificado
  C-->>W: 200 { verified: true }
```

### 4.2 Inicio de sesión, JWT y renovación · implementado

```mermaid
sequenceDiagram
  autonumber
  participant W as Web (Next.js)
  participant C as IamController
  participant A as AuthService
  participant S as SessionService
  participant DB as PostgreSQL
  participant G as JwtStrategy (cada petición)

  W->>C: POST /api/auth/login { email, password }
  C->>A: authenticate(email, password)
  A->>DB: busca usuario por correo normalizado
  A->>A: verifica Argon2id (con hash señuelo si no existe)
  A->>DB: busca la membresía activa más antigua
  alt credenciales inválidas, cuenta inactiva o sin membresía
    A-->>W: 401 / 403 EMAIL_NOT_VERIFIED
  else correcto
    A->>S: open(user, membership)
    S->>DB: INSERT sesión (solo el hash del refresh token)
    S-->>C: access token JWT (15 min) + refresh token
    C-->>W: 200 + cookie nexus_refresh (HttpOnly, 7 días)
    Note over W: El access token vive solo en memoria
  end

  Note over W,G: Cada petición protegida
  W->>G: Authorization: Bearer <JWT>
  G->>DB: ¿membresía activa del usuario en esa organización?
  G-->>W: req.user = { userId, organizationId, role } (el rol sale de la BD, no del token)

  Note over W,S: Al recargar la página
  W->>C: POST /api/auth/refresh (cookie)
  C->>S: refresh(cookie)
  alt token ya revocado
    S->>DB: revoca TODAS las sesiones del usuario
    S-->>W: 401
  else válido
    S->>DB: revoca el token usado y abre una sesión nueva (rotación)
    S-->>W: 200 + nueva cookie
  end
```

### 4.3 Subida de archivo con cifrado envelope · implementado

```mermaid
sequenceDiagram
  autonumber
  participant W as Web (Next.js)
  participant FC as FilesController
  participant FS as FilesService
  participant B as BillingService
  participant K as FilesCryptoService
  participant ST as StorageService
  participant DB as PostgreSQL
  participant S3 as SeaweedFS (S3)

  W->>FC: POST /api/files/upload (JWT, multipart, Idempotency-Key)
  FC->>FS: uploadMultipartFile(org, user, folderId, file)
  FS->>FS: valida tamaño (≤ 100 MB), tipo y contenido real
  Note over FS: Más de 3 cargas simultáneas por usuario → 429
  FS->>DB: reserveUpload — BEGIN, bloquea la cuota del tenant
  FS->>DB: ¿existe esa Idempotency-Key? (si ya terminó, devuelve el resultado anterior)
  FS->>B: getStorageLimitBytes(org)
  alt usado + reservas + tamaño > límite
    FS-->>W: 422 STORAGE_QUOTA_EXCEEDED
  else cabe
    FS->>DB: crea reserva (24 h) y upload "Pendiente", COMMIT
    FS->>DB: BEGIN — bloquea cuota y carpeta, busca o crea el archivo y calcula la versión n
    FS->>K: encryptFile(org, fileId, n, bytes)
    Note over K: DEK aleatoria de 32 bytes · AES-256-GCM con AAD org/archivo/versión<br/>DEK envuelta con la KEK del tenant (HKDF)
    K-->>FS: objeto cifrado NXF1, checksum SHA-256, DEK envuelta
    FS->>ST: put(objectKey, objeto cifrado)
    ST->>S3: PutObject
    FS->>DB: INSERT versión, archivo.currentVersion = n, reserva "released", upload "Disponible", recalcula la cuota, COMMIT
    FS-->>W: 200 { id, name, mimeType, sizeBytes, versionId, uploadedAt }
  end
  opt falla la BD después de guardar el objeto
    FS->>ST: delete(objectKey) (compensación)
    FS->>DB: libera la reserva, upload "Fallida" o "Limpieza pendiente" si el borrado también falló
    FS-->>W: 500 error seguro
  end
```

### 4.4 Activar o cambiar de plan · implementado (el registro de la operación llega con SPEC-301)

```mermaid
sequenceDiagram
  autonumber
  participant W as Web (Next.js)
  participant SC as SubscriptionsController
  participant CO as SubscriptionCoordinator
  participant B as BillingService
  participant FS as FilesService
  participant DB as PostgreSQL

  W->>SC: POST /api/subscriptions/activate { planId } (JWT)
  SC->>CO: activateSubscription(org, planId)
  CO->>B: findPlanById(planId)
  CO->>DB: BEGIN — bloquea la suscripción vigente (FOR UPDATE)
  alt ya está activo ese plan
    CO-->>W: devuelve la suscripción vigente sin crear otra
  else plan distinto
    CO->>FS: getTotalStorageUsage(org) (uso confirmado + reservas)
    alt Files no responde
      CO-->>W: 500 — se aborta, nunca se asume 0 bytes
    else uso + reservas > límite del plan nuevo
      CO-->>W: 422 STORAGE_QUOTA_EXCEEDED (no se borra nada)
    else cabe
      CO->>DB: cancela la suscripción anterior y crea la nueva (30 días si el plan es pagado)
      CO-->>DB: (planificado SPEC-301) operación "charge" simulada
      CO->>DB: COMMIT
      CO-->>W: 200 { subscriptionId, status: "active", simulated: true, startDate, endDate }
    end
  end
  Note over CO,DB: Dos activaciones simultáneas: el índice único parcial responde 409
```

### 4.5 Recuperación de contraseña · planificado (SPEC-103)

```mermaid
sequenceDiagram
  autonumber
  actor U as Visitante
  participant W as Web (Next.js)
  participant C as IamController
  participant P as PasswordResetService
  participant DB as PostgreSQL
  participant O as EmailOutboxService
  participant M as Mailpit (SMTP)

  U->>W: Escribe su correo en /recuperar-contrasena
  W->>C: POST /api/auth/forgot-password { email }
  C->>P: requestReset(email)
  alt la cuenta existe y está activa
    P->>DB: BEGIN — invalida tokens previos, crea token (hash, 15 min) y mensaje "password_reset", COMMIT
    P-->>O: dispatch (sin esperar la respuesta)
    O->>M: envía el enlace /nueva-contrasena?token=...
  else no existe
    Note over P: No hace nada
  end
  C-->>W: 200 con el MISMO mensaje genérico en ambos casos

  U->>W: Abre el enlace y define su nueva contraseña
  W->>C: POST /api/auth/reset-password { token, newPassword }
  C->>P: reset(token, newPassword)
  P->>DB: BEGIN — valida token (vigente, sin usar)
  alt token inválido o vencido
    P-->>W: 400 INVALID_OR_EXPIRED_TOKEN
  else válido
    P->>DB: guarda Argon2id, marca el token usado, correo verificado, revoca TODAS las sesiones, COMMIT
    P-->>W: 200 — ya puede iniciar sesión
  end
```

---

## 5. Diagrama de componentes

Dependencias reales entre módulos NestJS (`imports` de cada módulo). Todo corre en **un solo proceso**; la comunicación entre módulos es por inyección de dependencias, sin HTTP interno (ADR-001).

```mermaid
flowchart LR
  B(["Navegador"])

  subgraph WEB["Next.js :3000 (proceso independiente)"]
    UI["Rutas y componentes<br/>(sitio público, planes, archivos, panel)"]
    SES["Sesión en memoria<br/>(access token)"]
    CLI["Cliente HTTP tipado<br/>lib/api/*"]
  end

  subgraph API["NestJS :3001 (monolito modular)"]
    FIL["Filtro de errores común<br/>+ ValidationPipe"]
    IAM["IamModule<br/>identidad, sesiones, miembros"]
    BIL["BillingModule<br/>planes y suscripciones"]
    FLS["FilesModule<br/>carpetas, archivos, versiones, cuota, cifrado"]
    STO["StorageModule<br/>cliente S3"]
    INT["IntegrationModule<br/>SubscriptionCoordinator"]
    DSH["DashboardModule"]
    HLT["HealthModule"]
    AUD["AuditModule<br/>(planificado SPEC-401, global)"]
  end

  PG[("PostgreSQL 16<br/>esquemas iam, admin, files, billing, audit")]
  S3[("SeaweedFS<br/>API S3 :8333")]
  SMTP["Mailpit<br/>SMTP :1025"]

  B --> UI
  UI --> SES
  UI --> CLI
  CLI -->|"HTTP/JSON + cookie nexus_refresh"| FIL
  FIL --> IAM
  FIL --> BIL
  FIL --> FLS
  FIL --> INT
  FIL --> DSH
  FIL --> HLT

  BIL -->|"guard JWT"| IAM
  FLS -->|"guard JWT"| IAM
  FLS -->|"límite de almacenamiento"| BIL
  FLS --> STO
  INT --> BIL
  INT --> FLS
  DSH --> BIL
  DSH -->|"uso confirmado"| FLS
  BIL -. "hook demo-subscription" .-> IAM
  FLS -. "hook personal-drive" .-> IAM

  IAM -. "eventos" .-> AUD
  FLS -. "eventos" .-> AUD
  BIL -. "eventos" .-> AUD

  IAM --> PG
  BIL --> PG
  FLS --> PG
  AUD -.-> PG
  STO -->|"objetos cifrados"| S3
  IAM -->|"correo de verificación (outbox)"| SMTP
  HLT --> PG

  classDef planned stroke-dasharray: 5 5,fill:#fff8e1,stroke:#b8860b;
  class AUD planned;
```

> **Lo que el diagrama deja ver:** `BillingModule` no depende de `FilesModule` (para evitar un ciclo), por eso `IntegrationModule` coordina la activación de planes consultando a ambos. Los hooks de registro invierten la dependencia: Billing y Files se registran en IAM sin que IAM los conozca.

---

## 6. Diagrama de despliegue

Topología de desarrollo según `docker-compose.yml`. La web **no** está en Compose; la API corre en el equipo con `npm run dev:api` o, con el perfil `containerized-api`, en un contenedor.

```mermaid
flowchart TB
  USR(["Navegador del usuario"])

  subgraph HOST["Equipo de desarrollo / servidor"]
    WEB["Next.js<br/>npm run dev:web<br/>:3000"]
    APIH["NestJS (por defecto en el equipo)<br/>npm run dev:api<br/>:3001"]

    subgraph NET["Red Docker nexus_backend"]
      PG["postgres<br/>postgres:16-alpine<br/>host 5433 → 5432"]
      SW["seaweedfs<br/>chrislusf/seaweedfs (digest fijo)<br/>S3 :8333 · master :9333 · filer :8888"]
      MP["mailpit<br/>SMTP :1025 · interfaz :8025"]
      MG["migrate (perfil tools)<br/>dbmate — se ejecuta a mano"]
      APIC["api (perfil containerized-api)<br/>NestJS en contenedor :3001"]
    end

    VPG[("volumen nexus-postgres-data")]
    VSW[("volumen nexus-seaweedfs-data")]
  end

  USR -->|"HTTP :3000"| WEB
  WEB -->|"HTTP :3001 /api"| APIH
  WEB -. "alternativa" .-> APIC
  APIH -->|"5433"| PG
  APIH -->|"8333"| SW
  APIH -->|"1025"| MP
  APIC -->|"5432"| PG
  APIC -->|"8333"| SW
  APIC -->|"1025"| MP
  MG -->|"aplica migraciones"| PG
  PG --- VPG
  SW --- VSW
```

> **Comandos:** `docker compose up -d` levanta `postgres`, `seaweedfs` y `mailpit`; `docker compose run --rm migrate` aplica las migraciones; `docker compose --profile containerized-api up -d --build` añade la API. **Atención:** el script `npm run infra:up` levanta solo `postgres` y `seaweedfs` (**sin Mailpit**), así que con él no llegan los correos de verificación, recuperación ni invitación.
>
> **Brechas respecto de RF-015/RNF-010:** la web no está contenerizada, no hay proxy inverso ni TLS, y no existe aprovisionamiento on-premises gestionado.

---

## 7. Diagramas de estados

### 7.1 Ciclo de vida de un archivo

```mermaid
stateDiagram-v2
  [*] --> Activo : subida (versión 1)
  Activo --> Activo : subida con el mismo nombre<br/>(nueva versión)
  Activo --> EnPapelera : DELETE /files/:id<br/>(is_deleted = true)
  EnPapelera --> Activo : restaurar (SPEC-203, P2)
  EnPapelera --> Purgado : purgar (SPEC-204, P2)
  Purgado --> [*]

  note right of EnPapelera
    Cuenta para la cuota durante 30 días
    desde deleted_at. No hay purga automática.
  end note
```

### 7.2 Estados de una carga

```mermaid
stateDiagram-v2
  [*] --> Pendiente : se reserva la cuota
  Pendiente --> Disponible : bytes y metadatos confirmados
  Pendiente --> Fallida : error y objeto huérfano eliminado
  Pendiente --> LimpiezaPendiente : error y no se pudo borrar el objeto
  Fallida --> Pendiente : reintento con la misma Idempotency-Key
  Disponible --> [*]
  LimpiezaPendiente --> [*]

  note right of Pendiente
    La base de datos también define Cargando y Confirmando,
    pero el código actual no los usa.
  end note
```

### 7.3 Estados de una suscripción

```mermaid
stateDiagram-v2
  [*] --> active : alta de la organización (Demo)<br/>o activación de un plan
  active --> cancelled : se activa otro plan
  active --> expired : vence end_date<br/>(se evalúa al consultarla)
  active --> active : renovar (SPEC-302)<br/>extiende end_date
  cancelled --> [*]
  expired --> [*]

  note right of active
    Una organización tiene a lo sumo
    una suscripción activa.
    Demo no vence ni se renueva.
  end note
```

---

## 8. Correspondencia con el código

| Diagrama | Fuente |
|---|---|
| 1 | `REQUISITOS_CASOS_USO.md` §7 |
| 2 | `apps/api/src/modules/*/entities/*.entity.ts` y `database/migrations/` |
| 3 | `database/migrations/20260928090*_*.sql` y las migraciones del 2026-10-19 |
| 4.1 | `RegistrationService`, `RegistrationHooks`, `EmailVerificationService`, `EmailOutboxService` |
| 4.2 | `AuthService`, `SessionService`, `JwtStrategy`, `IamController` |
| 4.3 | `FilesService.uploadMultipartFile`, `reserveUpload`, `finishFailedUpload`, `FilesCryptoService` |
| 4.4 | `SubscriptionCoordinator`, `SubscriptionsController` |
| 4.5 | SPEC-103 (diseño; sin código) |
| 5 | `imports` de cada `*.module.ts` |
| 6 | `docker-compose.yml`, `README.md` |
| 7 | `files.service.ts`, `subscription.entity.ts`, `files.upload_status` |

## 9. Puntos para revisar antes de exportar a PDF

- Actualizar los elementos *planificados* según lo que haya entrado al corte (los diagramas 4.4, 4.5, 5, 7.1 y 7.3 cambian).
- Si el PDF no renderiza Mermaid, exportar cada diagrama a imagen con `mermaid-cli` (`mmdc`) o desde el visor de GitHub.
- Verificar con el equipo los nombres de clases frente a cualquier diagrama de clases previo del curso (`docs/revision-diagrama-clases.md`).
