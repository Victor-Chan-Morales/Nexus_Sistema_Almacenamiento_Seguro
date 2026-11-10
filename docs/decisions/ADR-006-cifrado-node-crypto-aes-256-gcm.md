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
| **Llave maestra** | 32 bytes aleatorios en Base64 por versión. V1 usa `FILES_MASTER_KEY`. Las siguientes usan `FILES_MASTER_KEY_V<n>`. | Solo en el entorno del proceso. Nunca en BD, repositorio ni respuestas. |
| **KEK por tenant** | `HKDF-SHA256(llave maestra, salt = organizationId, info = "nexus/files/tenant-kek/v<n>")`, 32 bytes | Se deriva en cada operación a partir de la versión indicada por la referencia externa. |
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

`files.destination.connection_details_encrypted` se cifra con la **llave maestra directamente** (AES-256-GCM, AAD `destination:<organizationId>:v1`). Su contenido depende del origen del destino:

- **Destino de entorno** (creado con la configuración `S3_*`): contiene solo referencias `environment:*` a variables de entorno, no credenciales.
- **Destino propio** (SPEC-802): contiene `{ endpoint, bucket, region, accessKey, secretKey, useSsl }`. Las credenciales se descifran solo en memoria, dentro de `StorageRouter`, para construir el cliente S3 del destino. Ninguna respuesta, log ni evento de auditoría las incluye.

El prefijo `v1.` identifica los valores existentes cifrados con la llave v1. A partir de v2, el prefijo `k<n>.` identifica la llave maestra. La rotación vuelve a cifrar ambos tipos de destino con el mismo AAD.

### 2.6 Rotación de la llave maestra (SPEC-005)

1. Haz una copia de seguridad y conserva las llaves que corresponden a los datos y respaldos existentes. Genera la nueva llave en el gestor de secretos. Para v2 usa `FILES_MASTER_KEY_V2` y conserva la llave v1 en `FILES_MASTER_KEY`.
2. Despliega esta versión de la API con las dos llaves en todas las instancias. Confirma que ninguna instancia anterior siga atendiendo solicitudes.
3. En `apps/api`, ejecuta `npm run keys:rotate -- --to 2 --dry-run`. La simulación valida las DEK y los destinos que requieren cambios y reporta conteos. Si falla, corrige la configuración antes de continuar.
4. Configura `FILES_MASTER_KEY_CURRENT_VERSION=2` en todas las instancias y en el entorno de operación. Las organizaciones nuevas nacen en v2. Las existentes usan su KEK activa para escribir hasta que termina su propia transacción de rotación.
5. Ejecuta `npm run keys:rotate -- --to 2` desde el código de `apps/api` con las dependencias de desarrollo instaladas. La rotación confirma una organización a la vez. Si se interrumpe, vuelve a ejecutar el mismo comando con ambas llaves disponibles.
6. Repite la simulación y comprueba que indique cero KEK nuevas, cero versiones y cero destinos pendientes. Verifica descargas, historial y conexiones de los destinos. Deja terminar las lecturas que pudieron empezar antes del cambio y guarda la llave anterior para los respaldos que aún la requieran.

La transacción de cada organización actualiza `kek_id`, `encrypted_dek` y los datos cifrados de los destinos. El candado de esa organización coordina la rotación con nuevas cargas y cambios de credenciales. El script conserva las claves de objeto, el tamaño, los checksums y los bytes almacenados. Las descargas usan la referencia guardada en cada versión del archivo, incluso si su KEK ya no es la activa.

---

## 3. Consecuencias

### Positivas
- Sin dependencias nuevas; superficie de ataque y peso del proyecto menores.
- **AEAD:** cualquier alteración del objeto almacenado se detecta al descifrar.
- **Aislamiento por archivo y versión:** cada versión tiene su propia DEK; el AAD vincula el objeto a su organización, archivo y versión.
- **Aislamiento por tenant:** cada organización tiene una KEK distinta, derivada de forma determinista.
- Aceleración por hardware (AES-NI) vía OpenSSL.

### Negativas y limitaciones conocidas
- **No es streaming.** El archivo completo se carga en memoria al cifrar y al descifrar (pico de hasta ~100 MB por carga; mitigado con el límite de 3 cargas simultáneas por usuario). Pasar a streaming exigiría un formato por bloques (`formatVersion = 2`), y queda fuera de alcance (ADR-008 §2).
- **Rotación operada por comando.** Las lecturas necesitan acceso a las versiones de llave que referencian sus datos. Una rotación interrumpida puede dejar organizaciones con versiones activas distintas hasta que se complete el proceso.
- **Un solo punto de compromiso:** quien obtenga `FILES_MASTER_KEY` puede derivar la KEK de cualquier tenant. Se mitiga guardándola en el gestor de secretos del entorno, fuera del repositorio y de `JWT_SECRET`.
- **Pruebas:** `files-crypto.service.spec.ts` cubre la ida y vuelta, la manipulación del objeto, el aislamiento por contexto y el reenvoltorio de la DEK. `rotate-keys.spec.ts` comprueba la simulación y la reanudación. La evidencia de SPEC-005 incluye PostgreSQL y SeaweedFS.

---

## 4. Alternativas consideradas

- **libsodium (`libsodium-wrappers`) con `secretstream`:** cumple al pie de la letra la propuesta y permite streaming, a costa de una dependencia WebAssembly y de un formato propio. Se descartó por tiempo y portabilidad.
- **KEK almacenada (cifrada) en BD por tenant:** permitiría rotación real, pero exige una llave de nivel superior y más superficie. Se prefirió la derivación determinista con HKDF.

---

## 5. Desviaciones respecto de la propuesta (para la exposición)

| La propuesta dice | La implementación hace | Cómo presentarlo |
|---|---|---|
| libsodium | `node:crypto` AES-256-GCM | AEAD equivalente, sin dependencia nativa; decisión consciente documentada aquí. |
| Cifrado **en streaming** | Cifrado en memoria, archivo completo (≤ 100 MB) | No llamarlo "streaming". Es una limitación declarada con mitigación y camino de evolución. |
| Gestión de KEK (RF-005) | KEK versionada derivada por tenant con HKDF | La rotación de SPEC-005 reenvuelve las DEK mediante el comando de operador. |
