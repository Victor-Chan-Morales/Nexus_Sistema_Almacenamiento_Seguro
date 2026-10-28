# CONSTITUCIÓN DE INGENIERÍA DE SOFTWARE — PROYECTO NEXUS

> **Documento normativo de arquitectura, diseño y calidad.**  
> Aplica a todo código desarrollado en el repositorio de Nexus por los integrantes del equipo o asistentes de IA.

---

## Artículo 1. La Especificación Manda

1. No se escribe una sola línea de código de producción sin una especificación previa en `specs/` con estado mínimo **Aprobada**.
2. Las correcciones menores o refactors que no alteren contratos ni esquemas de datos pueden gestionarse bajo nivel **N0** (receta documentada en el PR).
3. Si durante la implementación surge la necesidad de alterar el diseño original, se detiene la codificación, se actualiza la spec y se solicita aprobación antes de continuar.

---

## Artículo 2. Principios SOLID en el Dominio Nexus

Todo módulo de NestJS y componente de Next.js debe reflejar fielmente los principios SOLID con base en los siguientes ejemplos del sistema:

### S — Responsabilidad Única (Single Responsibility Principle)
- **Controlador (`FilesController`)**: Solo maneja HTTP, deserializa requests, valida DTOs de entrada y retorna respuestas con códigos HTTP canónicos. No toca la base de datos ni ejecuta lógica de cuotas.
- **Servicio (`FilesService`)**: Orquesta casos de uso de negocio (validar cuota disponible, generar versión, coordinar cifrado y persistencia).
- **Servicio de almacenamiento (`StorageService`, módulo Storage)**: Solo sabe hablar el protocolo S3 (SeaweedFS) para guardar, leer, borrar y firmar URLs de objetos, y garantizar que exista el bucket. Desconoce conceptos como organizaciones, planes o usuarios.

### O — Abierto para Extensión, Cerrado para Modificación (Open/Closed Principle)
- `StorageService` habla S3 estándar con el endpoint y las credenciales por variables de entorno (`S3_*`): pasar de SeaweedFS a MinIO o a AWS S3 es configuración y no obliga a tocar `FilesService`. Un proveedor que **no** hable S3 sí exigiría extraer una interfaz propia (`StorageProvider`), que **hoy no existe**; se extraerá cuando haga falta (YAGNI), no antes.

### L — Sustitución de Liskov (Liskov Substitution Principle)
- Cuando se extraiga una interfaz de proveedor (ver O), cualquier implementación deberá respetar escrupulosamente los contratos de streams, excepciones y metadatos que esa interfaz defina, garantizando intercambiabilidad sin efectos colaterales.

### I — Segregación de Interfaces (Interface Segregation Principle)
- Separar interfaces operativas de archivos de interfaces de gestión administrativa. Los clientes que solo leen metadatos no dependen de interfaces que coordinan llaves criptográficas KEK o borrado físico en disco.

### D — Inversión de Dependencias (Dependency Inversion Principle)
- Estado actual: `FilesService` recibe la clase `StorageService` por inyección de Nest y **nunca instancia el cliente S3**; ese cliente entra a `StorageService` mediante los tokens `S3_CLIENT` y `S3_PUBLIC_CLIENT`. Depender de una abstracción propia (interfaz + token de inyección) es la evolución prevista, no el estado de hoy.

---

## Artículo 3. YAGNI Explícito (Lo que NO se construye en esta fase)

Para garantizar la entrega puntual del corte 80% (30 de octubre) y el 100% (primera semana de noviembre), queda terminantemente prohibido construir:

1. **MFA / TOTP (Autenticación de Dos Factores)**: Fuera de alcance para este ciclo académico.
2. **Pasarelas de Pago Reales**: No se integrará Stripe, PayPal ni cobros bancarios reales. Toda operación de facturación es simulada (`simulated: true`).
3. **Microservicios o Colas Distribuidas complejas**: No se introducirá Redis, Kafka ni RabbitMQ. La arquitectura se mantiene como Monolito Modular con Transactional Outbox en PostgreSQL para correos.
4. **Almacenamiento Multi-Nube Simultáneo**: El almacenamiento en desarrollo opera exclusivamente con la instancia local de SeaweedFS.
5. **Previsualización interactiva de documentos pesados / edición colaborativa en vivo**: Solo visualización básica de tipos comunes y descarga binaria directa.

---

## Artículo 4. DRY y Tabla de Fuentes Únicas de Verdad

Cada pieza de información tiene un único dueño en el sistema. Prohibida la duplicación de lógica:

| Concepto / Dato | Única Fuente de Verdad | Regla de Acceso |
|---|---|---|
| **Catálogo de Planes y Precios** | `modules/billing/` (Tabla `plan`) | Frontend consulta `GET /api/plans`. No codificar planes "hardcoded" en React. **Excepción conocida (deuda):** `apps/web/src/lib/plans.ts` conserva un catálogo codificado que usan la landing, `/planes` y las vistas de demostración; no debe usarse en pantallas nuevas. |
| **Cuota Usada y Almacenamiento** | `FilesService.getUsedStorageBytes()` / `getTotalStorageUsage()` (cuota) y `calculateFolderSizes()` (tamaño de carpeta: solo la versión actual de los archivos activos) | El cálculo reside en la BD/API mediante consultas agregadas. Frontend solo formatea bytes (`formatBytes`). |
| **Identidad y Organización Activa** | Token JWT y sesión en `modules/iam` | Extraído de `req.user.organizationId` por el Guard. Prohibido recibirlo por Query/Body de cliente. |
| **Formato de Bytes y Fechas** | `apps/web/src/lib/format.ts` | Toda pantalla usa `formatBytes()` y `formatIsoDate()`. |
| **Códigos de Error y Mensajes** | `CONTRACTS.md` (raíz; catálogo en «Códigos de error») | Códigos en mayúsculas (`STORAGE_QUOTA_EXCEEDED`, `EMAIL_NOT_VERIFIED`). |

---

## Artículo 5. Código Limpio y TypeScript Estricto

1. **TypeScript estricto en código nuevo**: tipos explícitos y **prohibido el uso de `any`**; si un tipo es desconocido, usar `unknown` con validadores de tipo o class-validator. Estado actual: el `tsconfig` de la API **no** activa `strict` (`strictNullChecks` y `noImplicitAny` en `false`) y el código existente usa `any` en ~21 sitios; es deuda conocida, no una licencia para añadir más.
2. **Longitud de Funciones**: Máximo 30-40 líneas por función. Si una función hace más de una cosa, dividirla en métodos privados con nombres semánticos.
3. **Cero Logs Contaminantes**: Prohibido `console.log` en producción. Usar el `Logger` tipado de NestJS en backend y remover logs de depuración antes del PR.
4. **Nombres Descriptivos**: Evitar abreviaciones oscuras (`usr`, `fld`, `sz`). Usar `user`, `folder`, `sizeBytes`.
5. **Manejo de Errores Tipado**: Usar excepciones de NestJS (`NotFoundException`, `ForbiddenException`, `UnprocessableEntityException`) con DTOs de error estándar.

---

## Artículo 6. Seguridad y Privacidad por Defecto

1. **Aislamiento Multitenant Inquebrantable**:
   - Cada consulta SQL o de TypeORM que consulte o modifique recursos (archivos, carpetas, cuotas) DEBE incluir la cláusula `WHERE organization_id = :orgId`.
   - Si un usuario solicita un archivo por UUID que pertenece a otra organización, el sistema responde **404 Not Found**, jamás 403 Forbidden (para no revelar la existencia del recurso a atacantes).
2. **Contraseñas**: Cifradas exclusivamente con Argon2id con salt único. Prohibido MD5, SHA256 simple o texto plano.
3. **Cifrado de Archivos**: Cifrado Envelope con AES-256-GCM (ADR-006). El nonce y la etiqueta de autenticación viajan dentro del objeto cifrado. La llave maestra (`FILES_MASTER_KEY`) vive solo en el entorno del backend; la KEK de cada tenant se **deriva** de ella y no se almacena, y la DEK de cada versión se guarda cifrada en `file_version.encrypted_dek`.

---

## Artículo 7. Correspondencia con la Documentación

1. Si un endpoint cambia su payload o código de respuesta, `CONTRACTS.md` debe actualizarse en el mismo Pull Request.
2. Si se agrega o modifica una entidad, se debe registrar en `ENTS_REGISTRY.md`.
3. Está terminantemente prohibido dejar pantallas "placeholders" que simulen éxito falso sin informar al usuario de su estado real.

---

## Artículo 8. Accesibilidad y Calidad de Interfaz

1. Toda pantalla de Next.js debe implementar los cuatro estados de UI:
   - **Cargando (Loading)**: Skeletons o spinners legibles con tokens visuales oficiales.
   - **Vacío (Empty state)**: Ilustración o mensaje amigable indicando qué hacer (ej. "No hay archivos en esta carpeta").
   - **Error**: Mensaje claro con acción sugerida (ej. botón "Reintentar").
   - **Éxito (Data state)**: Información renderizada con tipografía Inter y contraste accesible (WCAG AA).
2. Todos los botones de acción deben tener etiquetas accesibles (`aria-label`) y feedback interactivo (hover/focus).

---

## Artículo 9. Antipatrones de Código Generado por Asistentes de IA

Los siguientes errores cometidos frecuentemente por IA serán rechazados automáticamente por el Revisor:

1. **Alucinación de dependencias**: Instalar paquetes npm no autorizados o inexistentes.
2. **Omisión de filtro tenant**: Olvidar el `organization_id` en queries agregadas o búsquedas.
3. **Lógica de negocio en React**: Calcular porcentajes de cuota, permisos o precios en `apps/web`.
4. **Exposición directa de la entidad**: Retornar `UserEntity` directamente en el controlador, exponiendo `password_hash` o tokens.
5. **Reinvención de helpers**: Crear funciones caseras para formatear bytes o fechas cuando ya existen en `lib/format.ts`.
6. **Desincronización de esquemas**: Crear entidades TypeORM sin la correspondiente migración SQL en `database/migrations/`.

---

## Artículo 10. Definición de Hecho (Definition of Done - DoD)

Una tarea o spec se considera **COMPLETADA (Done)** únicamente cuando cumple todos los siguientes puntos:

- [ ] Código implementado estrictamente dentro del módulo asignado.
- [ ] Pruebas unitarias o de integración escritas en Jest cubriendo los Criterios de Aceptación.
- [ ] `npm run build:api` y `npm run build:web` compilan exitosamente sin advertencias de tipos.
- [ ] `npm run test:api` pasa al 100% de pruebas verdes.
- [ ] Verificación de aislamiento multitenant probada.
- [ ] Documentación vinculada actualizada (`CONTRACTS.md`, `ENTS_REGISTRY.md` si aplica).
- [ ] Revisión de código completada por el Revisor y aprobada por el Coordinador (**Víctor Chán**).
