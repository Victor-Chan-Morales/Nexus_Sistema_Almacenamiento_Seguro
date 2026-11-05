# SPEC-006: PRUEBAS DEL CIFRADO DE ARCHIVOS

## 1. Metadatos

| Campo | Valor |
|---|---|
| **Nivel de Rigor** | N1 (solo agrega pruebas) |
| **Responsable Principal** | Por asignar |
| **Aprobador** | Víctor Chán Morales |
| **Módulo Afectado** | `apps/api/src/modules/files/` |
| **Requisitos Vinculados** | RF-004, RF-005, RNF-003 |
| **Dependencias** | SPEC-004 |
| **Prioridad** | P1 |
| **Estimación** | 1.5 h |
| **Estado** | Aprobada (2026-11-04, Víctor Chán Morales) |

## 2. Objetivo

`FilesCryptoService` protege todos los archivos y tenía 13 % de cobertura (ADR-006). Estas pruebas dan red de seguridad antes de SPEC-005 y SPEC-801.

## 3. Fuera de Alcance

- Modificar `files-crypto.service.ts`. **Si una prueba descubre un defecto, se detiene y se reporta.**
- Pruebas contra SeaweedFS real.

## 4. Criterios de Aceptación

```gherkin
Escenario 1: Ida y vuelta
  Dado un contenido cualquiera
  Cuando se cifra y se descifra con la misma organización, archivo y versión
  Entonces se obtiene exactamente el mismo contenido

Escenario 2: Objeto alterado
  Cuando se cambia un byte del nonce, del texto cifrado o de la etiqueta
  Entonces descifrar lanza un error y no devuelve contenido

Escenario 3: Contexto cruzado
  Cuando se descifra con otra organización, otro archivo u otra versión
  Entonces descifrar lanza un error

Escenario 4: Llaves distintas
  Cuando se cifra el mismo contenido dos veces
  Entonces cambian la DEK cifrada y el nonce

Escenario 5: Checksum incorrecto
  Dado un checksum que no coincide
  Entonces descifrar lanza "No se pudo validar la integridad del archivo"

Escenario 6: Llave maestra inválida
  Dado FILES_MASTER_KEY ausente o distinta de 32 bytes
  Entonces cifrar y descifrar lanzan un error

Escenario 7: Formato inválido
  Dado un objeto sin el prefijo NXF1 o demasiado corto
  Entonces descifrar lanza "El objeto almacenado tiene un formato inválido"
```

## 5. Contrato de API

Sin cambios.

## 6. Datos y Esquema

No modifica la base de datos.

## 8. Diseño Técnico

- Instanciar el servicio con un `ConfigService` simulado y una llave de prueba generada en la propia prueba. No usar `.env`.
- Cubrir también vacío (0 bytes) y un contenido de 1 MB.

## 9. Plan de Tareas

- [x] **T1 (60 min)**: Escenarios 1–5.
- [x] **T2 (30 min)**: Escenarios 6–7 y medir cobertura con `npm run test:cov`.

**Archivos permitidos:** `apps/api/src/modules/files/files-crypto.service.spec.ts` (nuevo), los documentos de §11.

## 10. Estrategia de Pruebas

| Criterio | Tipo | Archivo |
|---|---|---|
| Escenarios 1–7 | Unitaria | `files-crypto.service.spec.ts` |

Meta: ≥ 90 % de líneas de `files-crypto.service.ts`.

## 11. Impacto en Documentación

- [x] `ADR-006`: actualizar la limitación "sin pruebas dedicadas".
- [x] `docs/entregables/REQUISITOS_CASOS_USO.md`: matriz y conteo de pruebas.
- [x] `specs/README.md`: SPEC-004 pasa a Hecho.

## 12. Preguntas Abiertas

Ninguna.

## 13. Registro de Cambios

| Fecha | Autor | Descripción |
|---|---|---|
| 2026-11-04 | Claude Code (borrador) | Versión inicial. |
| 2026-11-04 | Víctor Chán Morales | Aprobada. |
| 2026-11-04 | Claude Code | Implementada. Se agregan a los archivos permitidos los documentos de §11, que la lista omitía. |
