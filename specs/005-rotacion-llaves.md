# SPEC-005: ROTACIÓN DE LLAVES

## 1. Metadatos

| Campo | Valor |
|---|---|
| **Nivel de Rigor** | N2 (cifrado; un error deja archivos ilegibles) |
| **Responsable Principal** | Por asignar |
| **Aprobador** | Víctor Chán Morales |
| **Módulo Afectado** | `apps/api/src/modules/files/`, `apps/api/src/scripts/` |
| **Requisitos Vinculados** | RF-005, Riesgos §16 |
| **Dependencias** | SPEC-006, SPEC-802 |
| **Prioridad** | P1 |
| **Estimación** | 3 h |
| **Estado** | Aprobada (2026-11-04, Víctor Chán Morales) |

## 2. Objetivo

Hoy el descifrado ignora `kek_id` y deriva la KEK de `FILES_MASTER_KEY`: cambiar esa llave deja todo ilegible. Esta spec permite rotarla re-cifrando las DEK, sin tocar el contenido en el almacén.

## 3. Fuera de Alcance

- Re-cifrar el contenido de los archivos.
- Pantalla o endpoint HTTP: la rotación es un script de operador.
- Rotación automática programada.

## 4. Criterios de Aceptación

```gherkin
Escenario 1: Compatibilidad
  Dado un archivo cifrado antes de esta spec
  Cuando se descarga después de desplegarla, sin rotar
  Entonces el contenido es idéntico

Escenario 2: Rotación exitosa
  Dado FILES_MASTER_KEY (v1) y FILES_MASTER_KEY_V2 configuradas
  Cuando se ejecuta rotate-keys --to 2
  Entonces cada organización tiene una KEK activa v2 y la anterior queda "rotated" con rotated_at
  Y todas sus versiones apuntan a la KEK v2 con la DEK re-cifrada
  Y las claves de objeto y los bytes almacenados no cambian
  Y todos los archivos se siguen descargando idénticos

Escenario 3: Subida durante o después de la rotación
  Cuando se sube un archivo con FILES_MASTER_KEY_CURRENT_VERSION = 2
  Entonces su versión usa la KEK activa v2

Escenario 4: Interrupción
  Dado que el script falla a mitad de una organización
  Entonces esa transacción se revierte, los archivos siguen legibles
  Y volver a ejecutarlo continúa sin duplicar KEK

Escenario 5: Llave faltante
  Dado que falta FILES_MASTER_KEY_V2
  Entonces el script termina con error antes de escribir nada

Escenario 6: Secretos
  Entonces ningún log ni salida contiene llaves, DEK ni contenido
```

## 5. Contrato de API

Sin cambios. Comando: `npm run keys:rotate -- --to <versión> [--dry-run]`.

## 6. Datos y Esquema

- **Sin migración.** `files.tenant_encryption_key` ya tiene `external_reference`, `status` y `rotated_at`; `uq_tenant_encryption_key_one_active_per_organization` asegura una activa.
- `file_version.encrypted_dek` y `kek_id` se actualizan. `object_key`, `checksum` y `size_bytes` no.

## 8. Diseño Técnico

- **Referencia versionada:** `hkdf-sha256://env/FILES_MASTER_KEY_V<n>/<organizationId>/v<n>`. La referencia actual sin `_V<n>` equivale a v1.
- **Variables:** `FILES_MASTER_KEY` (v1), `FILES_MASTER_KEY_V2`… y `FILES_MASTER_KEY_CURRENT_VERSION` (por defecto 1).
- **HKDF:** la `info` de v1 no cambia (`nexus/files/tenant-kek/v1`); para v2+ se usa `.../v<n>`.

```typescript
// FilesCryptoService
keyVersionFromReference(externalReference: string): number;
encryptFile(org, fileId, versionNumber, plaintext, keyVersion?: number): EncryptedFile;
decryptFile(org, fileId, versionNumber, encryptedDek, checksum, objectBytes, keyVersion?: number): Buffer;
rewrapDek(org, fileId, versionNumber, encryptedDek, fromVersion: number, toVersion: number): string;
```

- **Descarga:** cargar la KEK por `version.kekId`, obtener la versión y pasarla a `decryptFile`. **Nunca** suponer la activa.
- **AAD:** no cambia; solo cambia la llave que envuelve la DEK.
- **Script:** una transacción por organización: bloquear la KEK activa → crear la nueva → re-cifrar versiones por lotes → marcar la anterior `rotated`. Los índices solo admiten una activa, así que primero se marca `rotated` y después se inserta la nueva.
- **Destinos:** `connection_details_encrypted` usa la llave maestra directamente. El script también lo re-cifra en la misma transacción; el contexto `destination:<org>:v1` no cambia, pero el valor cifrado debe indicar la versión de llave (`v1.` → `k<n>.`). Coordinar con SPEC-802 sobre `decryptConnectionDetails`.
- **Riesgos:** retirar la llave vieja antes de terminar deja archivos ilegibles → el manual exige `--dry-run` y conservar la llave anterior hasta verificar.

## 9. Plan de Tareas

- [ ] **T1 (60 min)**: Versionado de llave en `FilesCryptoService` y `rewrapDek`.
- [ ] **T2 (30 min)**: Descarga y subida usan la versión de la KEK.
- [ ] **T3 (60 min)**: Script con `--dry-run`, por lotes y reanudable.
- [ ] **T4 (30 min)**: Pruebas y prueba manual contra Postgres.

**Archivos permitidos:** `files-crypto.service.ts` y su spec, `files.service.ts` (solo llamadas de cifrado), `apps/api/src/scripts/rotate-keys.ts` (nuevo), `apps/api/package.json`, `.env.example`, `ADR-006`.

## 10. Estrategia de Pruebas

| Criterio | Tipo | Archivo |
|---|---|---|
| Escenarios 1–3, 5 | Unitaria | `files-crypto.service.spec.ts`, `rotate-keys.spec.ts` |
| Escenario 4 | Unitaria con fallo simulado | `rotate-keys.spec.ts` |
| Escenario 2 de punta a punta | Manual con Postgres y SeaweedFS | Evidencia en el PR |

## 11. Impacto en Documentación

- [ ] `ADR-006`: describir la rotación y el procedimiento.
- [ ] `.env.example`: variables nuevas.

## 12. Preguntas Abiertas

Ninguna.

## 13. Registro de Cambios

| Fecha | Autor | Descripción |
|---|---|---|
| 2026-11-04 | Claude Code (borrador) | Versión inicial. |
| 2026-11-04 | Víctor Chán Morales | Aprobada. |
| 2026-11-04 | Claude Code (revisión) | SPEC-802 pasa a ser dependencia firme, como en el orden de ejecución. Aprobado por el coordinador (2026-11-04). |
