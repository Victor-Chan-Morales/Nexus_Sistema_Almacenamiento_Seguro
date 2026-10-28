# ADR-006: Cifrado envelope de archivos con `node:crypto` (AES-256-GCM)

- **Estado:** Aprobado. **Corregido el 2026-10-27** para describir lo que el código hace realmente (la versión anterior atribuía a la BD columnas que no existen y una jerarquía de llaves distinta).
- **Fecha original:** 2026-10-27
- **Autores:** Víctor Chán Morales, Miguel (Files & Storage)
- **Afecta a:** `apps/api/src/modules/files/files-crypto.service.ts`, `ARCHITECTURE.md`, `BUSINESS_RULES.md`

---

## 1. Contexto

La propuesta (RF-004, RF-005, §5.1 y §13) pide **cifrado de archivos en streaming con libsodium** y envelope encryption DEK/KEK. La implementación del módulo Files se apartó de eso en dos puntos:

1. **Biblioteca:** se usa `node:crypto` (OpenSSL, nativo de Node) en lugar de `libsodium`. Motivos: no añade dependencias, `libsodium-wrappers` trae WebAssembly/binarios que complican la portabilidad y el CI, y AES-256-GCM es un AEAD estándar con aceleración por hardware.
2. **Modo:** el cifrado es **en memoria sobre el archivo completo**, no en streaming. El límite vigente es 100 MB por archivo y 3 cargas simultáneas por usuario (CONTRACTS.md), lo que acota el consumo de memoria.

Ambas son **desviaciones respecto de la propuesta** y se deben presentar como tales (ver §5).

---

## 2. Decisión

Se adopta **AES-256-GCM de `node:crypto`** con envelope encryption de tres niveles. Todo vive en `FilesCryptoService`.

### 2.1 Jerarquía de llaves

| Nivel | Qué es | Dónde vive |
|---|---|---|
| **Llave maestra** | 32 bytes aleatorios en Base64 en la variable de entorno `FILES_MASTER_KEY` | Solo en el entorno del proceso. Nunca en BD, repositorio ni respuestas. Si falta o no mide 32 bytes, la API rechaza cifrar y descifrar. |
| **KEK por tenant** | `HKDF-SHA256(llave maestra, salt = organizationId, info = "nexus/files/tenant-kek/v1")`, 32 bytes | **No se almacena**: se deriva en cada operación. |
| **DEK por versión de archivo** | 32 bytes de `randomBytes`, generados en cada subida | Cifrada con la KEK del tenant y guardada en `files.file_version.encrypted_dek`. |

La tabla `files.tenant_encryption_key` guarda únicamente una **referencia** (`external_reference = hkdf-sha256://env/FILES_MASTER_KEY/<organizationId>/v1`) y su estado; no contiene material criptográfico.

### 2.2 Cifrado del contenido

- Algoritmo `aes-256-gcm`, **nonce aleatorio de 12 bytes**, etiqueta de autenticación de 16 bytes.
- **Datos autenticados adicionales (AAD):** `nexus/files/content/v1/<organizationId>/<fileId>/<versionNumber>`. Un objeto copiado a otra organización, archivo o versión no descifra.
- **Formato del objeto en SeaweedFS** (`formatVersion = 1`): `"NXF1"` (4 bytes) ‖ nonce (12) ‖ texto cifrado ‖ etiqueta (16). El nonce y la etiqueta **van dentro del objeto**, no en la BD. Se sube con tipo `application/octet-stream` y una clave de objeto generada por el servidor (`<orgId>/<fileId>/v<n>/<uuid>`).
- **Integridad adicional:** el SHA-256 del contenido en claro se guarda en `file_version.checksum` y se compara (en tiempo constante) tras descifrar.

### 2.3 Cifrado de la DEK

La DEK se cifra con AES-256-GCM bajo la KEK del tenant (nonce de 12 bytes, AAD `nexus/files/dek/v1/<organizationId>/<fileId>/<versionNumber>`) y se serializa como `v1.<nonce>.<etiqueta>.<texto cifrado>` en Base64URL.

### 2.4 Qué persiste en PostgreSQL (`files.file_version`)

`encrypted_dek`, `kek_id` (referencia a `tenant_encryption_key`), `format_version`, `checksum`, `object_key`, `size_bytes`. **No existen** columnas `iv`, `auth_tag` ni de algoritmo: el algoritmo lo implica `format_version`.

### 2.5 Datos de conexión de destinos

`files.destination.connection_details_encrypted` se cifra con la **llave maestra directamente** (AES-256-GCM, AAD `destination:<organizationId>:v1`) y contiene solo referencias a variables de entorno, no credenciales.

---

## 3. Consecuencias

### Positivas
- Sin dependencias nuevas; superficie de ataque y peso del proyecto menores.
- **AEAD:** cualquier alteración del objeto almacenado se detecta al descifrar.
- **Aislamiento por archivo y versión:** cada versión tiene su propia DEK; el AAD vincula el objeto a su organización, archivo y versión.
- **Aislamiento por tenant:** cada organización tiene una KEK distinta, derivada de forma determinista.
- Aceleración por hardware (AES-NI) vía OpenSSL.

### Negativas y limitaciones conocidas
- **No es streaming.** El archivo completo se carga en memoria al cifrar y al descifrar (pico de hasta ~100 MB por carga; mitigado con el límite de 3 cargas simultáneas por usuario). Pasar a streaming exigiría un formato por bloques (`formatVersion = 2`).
- **No hay rotación de llaves implementada.** El esquema tiene `kek_id` y el estado `rotated`, pero el descifrado **siempre deriva la KEK de la llave maestra actual e ignora `kek_id`**. Cambiar `FILES_MASTER_KEY` volvería ilegibles todos los archivos existentes. La rotación requiere re-cifrar las DEK (reenvolver) y está fuera del alcance actual.
- **Un solo punto de compromiso:** quien obtenga `FILES_MASTER_KEY` puede derivar la KEK de cualquier tenant. Se mitiga guardándola en el gestor de secretos del entorno, fuera del repositorio y de `JWT_SECRET`.
- **Sin pruebas dedicadas:** ninguna `*.spec.ts` ejercita `FilesCryptoService` directamente. Medido con `npm run test:cov` el 2026-10-27, `files-crypto.service.ts` tiene **13 % de líneas cubiertas** (9 de 67), y el cifrado de punta a punta no se prueba. Pendiente: pruebas de ida y vuelta, de manipulación del objeto (debe fallar) y de AAD cruzado entre organizaciones.

---

## 4. Alternativas consideradas

- **libsodium (`libsodium-wrappers`) con `secretstream`:** cumple al pie de la letra la propuesta y permite streaming, a costa de una dependencia WebAssembly y de un formato propio. Se descartó por tiempo y portabilidad; sigue siendo la ruta para el roadmap si se exige streaming.
- **KEK almacenada (cifrada) en BD por tenant:** permitiría rotación real, pero exige una llave de nivel superior y más superficie. Se prefirió la derivación determinista con HKDF.

---

## 5. Desviaciones respecto de la propuesta (para la exposición)

| La propuesta dice | La implementación hace | Cómo presentarlo |
|---|---|---|
| libsodium | `node:crypto` AES-256-GCM | AEAD equivalente, sin dependencia nativa; decisión consciente documentada aquí. |
| Cifrado **en streaming** | Cifrado en memoria, archivo completo (≤ 100 MB) | No llamarlo "streaming". Es una limitación declarada con mitigación y camino de evolución. |
| Gestión de KEK (RF-005) | KEK derivada por tenant con HKDF; sin rotación | La jerarquía DEK/KEK existe; la rotación está pendiente. |
